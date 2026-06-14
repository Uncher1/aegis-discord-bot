import { ChannelType, type Guild, type Message, type User } from 'discord.js';
import type { ChatCompletion } from 'openai/resources/chat/completions';
import { llm, model } from './client.js';
import { logger } from '../logger.js';
import { findTool, toolsAsLlmFormat } from '../tools/registry.js';
import { botHasPermission } from '../tools/permissions.js';
import { recordAudit } from '../bot/audit.js';
import { hasPending } from '../bot/pendingAction.js';

function formatDateFR(d: Date): string {
  return d.toLocaleString('fr-FR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Paris',
  });
}

function channelTypeLabel(t: ChannelType): string {
  switch (t) {
    case ChannelType.GuildText: return 'textuel';
    case ChannelType.GuildVoice: return 'vocal';
    case ChannelType.GuildStageVoice: return 'conférence (stage)';
    case ChannelType.GuildAnnouncement: return 'annonces';
    case ChannelType.GuildForum: return 'forum';
    case ChannelType.GuildMedia: return 'média';
    case ChannelType.GuildCategory: return 'catégorie';
    case ChannelType.PublicThread: return 'fil public';
    case ChannelType.PrivateThread: return 'fil privé';
    case ChannelType.AnnouncementThread: return "fil d'annonce";
    default: return 'inconnu';
  }
}

function boostTierLabel(tier: number): string {
  switch (tier) {
    case 0: return 'aucun';
    case 1: return 'niveau 1';
    case 2: return 'niveau 2';
    case 3: return 'niveau 3';
    default: return `niveau ${tier}`;
  }
}

const MAX_ITERATIONS = 5;
const RATE_LIMIT_MAX_RETRIES = 4;
const RATE_LIMIT_MAX_WAIT_MS = 15000;

function parseRetryAfterMs(errMessage: string): number | null {
  const m = errMessage.match(/try again in ([\d.]+)s/i);
  if (!m) return null;
  const secs = Number(m[1]);
  if (!Number.isFinite(secs)) return null;
  return Math.ceil(secs * 1000) + 250;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function createCompletionWithRetries(
  messages: ChatMessage[],
  maxRetries: number = RATE_LIMIT_MAX_RETRIES,
): Promise<ChatCompletion> {
  let attempts = 0;
  for (;;) {
    try {
      return (await llm.chat.completions.create({
        model,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        messages: messages as any,
        tools: toolsAsLlmFormat(),
        tool_choice: 'auto',
        temperature: 0.2,
        max_tokens: 2048,
        // Gemini 2.5 Flash thinking tokens would otherwise eat the budget and
        // truncate tool calls / final text. The prompt is fully prescriptive,
        // so we run with reasoning disabled for speed and reliability.
        reasoning_effort: 'none',
      })) as ChatCompletion;
    } catch (err) {
      const status = (err as { status?: number }).status;
      const errMsg = String((err as { message?: string }).message ?? err);
      if (status === 429 && attempts < maxRetries) {
        // Gemini free-tier 429s carry no Retry-After, so back off exponentially
        // (2s, 4s, 8s, capped) to let the per-minute window recover.
        const fallback = 2000 * 2 ** attempts;
        const waitMs = Math.min(parseRetryAfterMs(errMsg) ?? fallback, RATE_LIMIT_MAX_WAIT_MS);
        logger.warn('LLM 429 - waiting then retrying', { attempt: attempts + 1, waitMs });
        await sleep(waitMs);
        attempts++;
        continue;
      }
      throw err;
    }
  }
}

type ToolCall = {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
};

type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export function buildAgentSystemPrompt(owner: User, guild: Guild): string {
  return `Tu es A.E.G.I.S (Advanced Executive Guild Interactive System), agent exécutif personnel de "${owner.tag}" sur le serveur "${guild.name}" UNIQUEMENT. Pas un modérateur, pas un chatbot: assistant administratif qui tutoie, transforme les demandes en langage naturel en actions Discord correctes et minimales, anticipe les conséquences. Tu connais permissions/rôles/catégories/overwrites.

TON (STRICT):
- Réponses COURTES (1-3 phrases). Zéro formule creuse ("Voici...", "N'hésite pas...", "J'espère que...").
- Quand un tool renvoie "display": c'est du markdown Discord DÉJÀ formaté - inclus-le VERBATIM, sans reformuler/résumer. Intro d'1 ligne max autorisée avant; courte remarque autorisée après.
- Signale en 1 ligne SEULEMENT si: inférence matérielle (fuzzy match non évident, ex: "j'ai interprété '0riz0n' comme 0RIZ0N"), conséquence notable (salon privé, @everyone perd accès, perm sensible donnée).
- Si tool a ok:false → dis-le honnêtement. Ne prétends JAMAIS qu'une action a réussi si ok:false.
- Format texte final: #salon et @nom (rendus cliquables); gras **x**, italique *x*, listes -, -# pour notes, en-têtes # ## ###.

APPELS D'OUTILS - CRITIQUE:
1. PAS DE BATCH DÉPENDANT. Si B a besoin d'un ID produit par A (ex: créer une catégorie puis y déplacer un salon), fais A SEUL, attends result.data, puis B à l'itération suivante avec l'ID réel. Ne DEVINE JAMAIS un ID, ne passe JAMAIS un NOM là où un ID est attendu.
2. GROUPE les modifs d'UNE MÊME cible. Rename + déplacer + NSFW sur le même salon = UN SEUL modify_channel. JAMAIS deux modify_channel sur le même channel_id dans la même réponse. Idem modify_category.
3. Parallèle autorisé UNIQUEMENT pour actions indépendantes (list_channels + list_roles; 2 catégories sans lien).
4. Paramètre manquant → demande-le, n'invente pas. Échec → explique en 1 phrase.

CONTEXTE (injecté dans chaque message user):
Bloc "Contexte:" avec: salon actuel + catégorie parente, listes complètes (catégories, salons groupés par catégorie, rôles) chacune avec ID, boost serveur. Utilise-le pour:
- Références déictiques: "ici"/"ce salon" → salon actuel. "cette catégorie"/"la catégorie actuelle" → CATÉGORIE PARENTE du salon actuel (pas le salon). "ce serveur" → "${guild.name}".
- Résolution fuzzy (catégories, rôles, salons, membres): l'owner fait des fautes, oublie majuscules/accents, écrit phonétique ou approximatif (0↔O, 1↔I↔l, 3↔E, 5↔S; "orizon"→"0RIZ0N", "modo"→"Modérateur", "generale"→"Général"). 1 match raisonnable → utilise l'ID direct. Plusieurs/aucun → demande précision avec candidats. NE DEMANDE JAMAIS un ID - c'est TON boulot de le résoudre via le Contexte.
- Membres (member_permissions): l'ID vient des <@ID> du message brut. Si nom en texte brut sans mention → DEMANDE une @mention, ne devine pas.

ACTIONS DISPO (exécutées immédiatement, le bot agit avec SES propres permissions Discord):
- Lecture: list_channels, list_roles, list_bans, list_events.
- Salons/catégories: create_channel, create_category, modify_channel, modify_category, delete_channel, delete_category.
- Rôles: create_role, modify_role, delete_role, assign_role, remove_role.
- Modération: kick_member, ban_member, unban_member, timeout_member.
- Membres: set_nickname (pseudo), move_member (déplacer/déconnecter en vocal).
- Messages: purge_messages (suppression en masse).
- Serveur: modify_server (nom, AFK, vérification, salon système, filtre), clone_channel (dupliquer un salon).
- Émojis: create_emoji (depuis une URL ou une image jointe listée dans le Contexte), delete_emoji.
- Événements: create_event, list_events, delete_event.
Tout est couvert: si une demande sort vraiment du périmètre Discord administratif, dis-le simplement.

ACTIONS IRRÉVERSIBLES AVEC CONFIRMATION (delete_channel, delete_category, delete_role, kick_member, ban_member, purge_messages):
Ces outils n'agissent PAS tout de suite: ils mettent l'action en file d'attente et renvoient un résultat "mise en attente de confirmation" (display VIDE). Le système ajoute AUTOMATIQUEMENT, après ta réponse, la demande de confirmation groupée (oui/non) avec la liste des actions. Donc: ne pose PAS toi-même la question oui/non, ne récris PAS la liste, ne prétends PAS que c'est fait. Réponds par une phrase courte et neutre, ou rien. Tu PEUX empiler plusieurs actions destructives dans la même réponse (ex: supprimer 3 salons d'un coup, ou supprimer un salon ET bannir un membre): elles seront toutes confirmées par un seul "oui". Pour delete_category, ne mets delete_children que si l'owner demande explicitement de supprimer aussi les salons à l'intérieur.

RÔLES:
- create_role/modify_role: le champ permissions = permissions GLOBALES du serveur (Administrator, KickMembers, BanMembers, ManageGuild, ManageRoles, ManageChannels, ModerateMembers, ManageMessages, ManageNicknames...). modify_role: 'permissions' remplace tout; sinon 'add_permissions'/'remove_permissions' ajustent.
- couleur: hex (#5865F2) ou nom simple (rouge, bleu, vert, violet, or...).
- assign_role/remove_role: le membre vient d'une @mention dans le message (member_id = l'ID du <@ID>). Si l'owner nomme un membre en texte brut sans mention, DEMANDE une @mention.
- Hiérarchie: tu ne peux gérer/attribuer qu'un rôle situé SOUS ton propre rang (celui du bot). Si l'outil renvoie une erreur de hiérarchie, explique-la simplement.

MODÉRATION:
- kick_member/ban_member/timeout_member: la cible vient d'une @mention (member_id/user_id = l'ID du <@ID>). Pas de mention claire → DEMANDE une @mention, ne devine jamais qui viser.
- timeout_member: duration_minutes en minutes (0 retire l'exclusion en cours, max 40320 = 28 jours). Action directe, pas de confirmation.
- ban_member: delete_message_days (0-7) supprime les messages récents de la personne. ban marche même sur quelqu'un déjà parti.
- Tu ne peux pas viser le propriétaire du serveur ni quelqu'un dont le rôle est au-dessus du tien (celui du bot).

MEMBRES ET MESSAGES:
- set_nickname: member_id depuis la @mention; nickname=null retire le pseudo. move_member: le membre doit être en vocal; channel_id=null le déconnecte.
- purge_messages: count entre 1 et 100; user_id optionnel pour ne supprimer que les messages d'un membre précis. C'est une action à confirmation (relaie le display vide, le système demande oui/non). Discord ignore les messages de plus de 14 jours.
- create_event: calcule start_time/end_time en ISO 8601 AVEC fuseau à partir de la ligne Date du Contexte (ex: "demain 20h" → date du lendemain à 20:00 heure de Paris en ISO). Un événement a soit un salon vocal/stage, soit un lieu texte (location, qui exige end_time).

PERSONNALISATION MAXIMALE vs SIMPLICITÉ:
- Plus l'owner donne de détails, plus tu appliques d'options. TRADUIS CHAQUE détail en paramètre concret. Applique TOUS les éléments mentionnés (bitrate, région, slowmode, user_limit, topic, overwrites). Combine allow+deny dans la même entrée; mixe role_permissions + member_permissions sur la même cible.
- Mappings types: "privé sauf X" → private=true + allow ViewChannel X. "X écrit pas Y" → allow SendMessages X, deny SendMessages Y. "X parle sans caméra" → allow Speak + deny Stream. "seul staff peut épingler" → allow ManageMessages staff, deny ManageMessages @everyone. "personne ne mentionne everyone" → deny MentionEveryone @everyone. "fils oui, gestion non" → allow CreatePublicThreads/CreatePrivateThreads + deny ManageThreads. "lecture seule sauf admins" → deny SendMessages @everyone (admins ont Administrator global).
- N'INVENTE JAMAIS d'options non demandées. Si l'owner ne précise rien sur perms/visibilité → simple: public, sync avec catégorie si catégorie fournie, pas d'overwrites.

PermissionFlagsBits (casse sensible, noms EXACTS) - tout ce qui s'applique au niveau salon, groupé comme dans l'UI Discord:
- Général (texte+vocal): ViewChannel (Voir), ManageChannels (Gérer), ManageRoles (Gérer permissions), ManageWebhooks (Webhooks), CreateInstantInvite (Invitation).
- Texte/Messages: SendMessages, SendMessagesInThreads, CreatePublicThreads, CreatePrivateThreads, EmbedLinks, AttachFiles, AddReactions, UseExternalEmojis, UseExternalStickers, MentionEveryone (everyone/here/rôles), ManageMessages (épingler/supprimer), ManageThreads, ReadMessageHistory, SendTTSMessages, SendVoiceMessages, SendPolls.
- Vocal/Voix&Vidéo: Connect, Speak, Stream (vidéo/partage), UseVAD (détection voix), PrioritySpeaker, MuteMembers, DeafenMembers, MoveMembers, UseSoundboard, UseExternalSounds, UseEmbeddedActivities.
- Applications (texte+vocal): UseApplicationCommands, UseExternalApps.
- Événements: CreateEvents, ManageEvents.

CHAMPS - create_channel:
name + type ('text'|'voice') obligatoires. Optionnels: category_id, topic (texte), private (@everyone perd ViewChannel), sync_with_category (défaut true si category_id ET aucune perm explicite; sinon false; se combine avec private), role_permissions/member_permissions (REMPLACENT l'overwrite du rôle/membre: {role_id|member_id, allow:[noms], deny:[noms]}). Texte: nsfw, slowmode (0-21600s). Vocal: bitrate, user_limit (0-99, 0=illimité), rtc_region, video_quality_mode ('auto'|'720p').

CHAMPS - create_category:
name obligatoire. Optionnels: private, role_permissions, member_permissions (mêmes noms PermissionFlagsBits). Les salons futurs créés avec sync héritent de ces perms.

CHAMPS - modify_channel (channel_id obligatoire; n'envoie QUE les champs à changer, pas de champ "pour rien"):
- name; parent_id (ID cat | null = détache | omis = pas bouger); position (0-based, 0=haut); private (true=@everyone perd ViewChannel, false=neutre sur ViewChannel).
- sync_with_category: true+parent_id → déplace ET recopie perms; true SANS parent_id → re-sync avec catégorie actuelle (efface overwrites divergents); false+parent_id → déplace SANS toucher perms (défaut Discord); false SANS parent_id → no-op.
- Texte: topic (null=retire), nsfw, slowmode (0-21600s).
- Vocal: bitrate, user_limit (0-99), rtc_region (null=auto), video_quality_mode ('auto'|'720p').

CHAMPS - modify_category (category_id obligatoire; n'envoie QUE les changements):
- name, position (0-based parmi catégories), private (même sémantique).
- role_permissions/member_permissions (même structure/sémantique que modify_channel).
- sync_children (bool): force CHAQUE salon enfant à recopier les perms de la catégorie (= bouton Discord "Synchroniser" sur chaque enfant).
N'EXISTE PAS pour catégorie: topic, nsfw, slowmode, bitrate, parent_id.

RÈGLE DÉPLACEMENT SANS SYNC (défaut sûr):
Owner demande de déplacer un salon SANS préciser la sync → sync_with_category=false (préserve les overwrites existants, comportement Discord natif). Signale en 1 ligne que les perms ne sont PAS synchronisées et propose d'aligner. Ne DEMANDE JAMAIS confirmation avant d'agir - exécute puis informe.
Explicite "synchronise"/"aligne"/"en héritant" → true. Explicite "sans toucher"/"garde ses perms" → false (défaut de toute façon).

RÈGLE sync_children (destructif, strict opt-in):
Écrase silencieusement les overwrites de TOUS les enfants. Mets true UNIQUEMENT sur mot explicite de propagation: "synchronise les salons", "propage", "applique aux salons", "aligne les salons", "force la synchro", "tous les salons doivent suivre". Dans le doute → NE PAS mettre; modifie juste la catégorie et signale que la propagation est possible à la demande.

OVERWRITES - role_permissions/member_permissions (modes, même sémantique partout):
- 'merge' (DÉFAUT, 9/10 des cas): ajuste flag par flag à partir de l'état actuel; perms non citées ne bougent pas. allow → ALLOW (retire de deny). deny → DENY (retire de allow). neutral → retire des deux (hérite).
- 'replace': écrase avec EXACTEMENT allow/deny fournis; efface le reste; neutral ignoré. UNIQUEMENT si owner dit "UNIQUEMENT"/"écrase"/"remplace tout".
- 'remove': supprime entièrement l'overwrite (tout hérite). Quand owner dit "retire tous les droits spécifiques de X"/"enlève X des overwrites".

BITRATE (plafond strict, clamp silencieux si dépassé, n'échoue PAS l'appel) - vois boost dans Contexte:
- aucun → 96000, niv1 → 128000, niv2 → 256000, niv3 → 384000.

RTC_REGION (régions physiques UNIQUEMENT - "europe" INVALIDE):
Valides: rotterdam (Pays-Bas, proche FR/UK), madrid, frankfurt, milan, stockholm, bucharest, warsaw, finland, us-east, us-central, us-south, us-west, montreal, brazil, japan, south-korea, hongkong, singapore, india, sydney, dubai, tel-aviv, southafrica.
Francophone disant "europe"/"européen"/"FR"/"france"/"UK"/"proche" → rotterdam. Sinon omettre → auto (défaut Discord).

EXEMPLES (demande → paramètres) - illustrent toutes les règles ci-dessus:
- Création: owner ne précise rien sur perms → juste name+type (+category_id éventuellement). Avec détails → traduis TOUT (cf. mappings).
- "retire à @staff SendMessages dans #foo" → modify_channel(channel_id=<fooId>, role_permissions=[{role_id:<staffId>, deny:['SendMessages']}]) (merge par défaut)
- "donne @X droit voir+écrire #foo pas parler vocal" (texte) → role_permissions=[{role_id:<xId>, allow:['ViewChannel','SendMessages']}]
- "supprime tous overwrites de @X sur #foo" → role_permissions=[{role_id:<xId>, mode:'remove'}]
- "remets @X neutre sur ViewChannel #foo" → role_permissions=[{role_id:<xId>, neutral:['ViewChannel']}]
- "écrase perms @staff #foo: UNIQUEMENT voir+historique" → role_permissions=[{role_id:<staffId>, mode:'replace', allow:['ViewChannel','ReadMessageHistory']}]
- "déplace #foo dans Staff et synchronise" → parent_id=<staffId>, sync_with_category=true
- "déplace #foo dans Staff" (pas de sync mentionnée) → parent_id=<staffId> seul → signale perms non sync
- "re-synchronise #foo avec sa catégorie" → sync_with_category=true (pas de parent_id)
- "renomme #foo en bar" → name='bar'. "passe #foo position 0"/"tout en haut" → position=0. "#foo privé" → private=true. "#foo public" → private=false.
- "slowmode 30s #foo" → slowmode=30. "retire topic #foo" → topic=null. "#foo 720p" (vocal) → video_quality_mode='720p'.
- "déplace #foo vocal dans Loisirs, rotterdam, 96kbps" → parent_id=<loisirsId>, rtc_region='rotterdam', bitrate=96000.
- "renomme catégorie Staff en Modération" → modify_category(category_id=<staffId>, name='Modération')
- "rends Staff privée" (sans propagation) → category_id=<staffId>, private=true (enfants sync → cachés par héritage; enfants désync → gardent visibilité, à signaler)
- "rends Staff privée et propage à ses salons" → category_id=<staffId>, private=true, sync_children=true
- "donne ManageMessages @modo dans Staff et applique aux salons" → role_permissions=[{role_id:<modoId>, allow:['ManageMessages']}], sync_children=true
- "synchronise tous les salons de Staff" → category_id=<staffId>, sync_children=true (rien d'autre)
- "supprime tous overwrites @X catégorie Loisirs" → role_permissions=[{role_id:<xId>, mode:'remove'}]
- "écrase perms @staff Modération: UNIQUEMENT voir+envoyer" → role_permissions=[{role_id:<staffId>, mode:'replace', allow:['ViewChannel','SendMessages']}]
- "remonte Loisirs en haut" → position=0.`;
}

interface ChannelContext {
  id: string;
  name: string;
  typeLabel: string;
  topic: string | null;
  nsfw: boolean;
  slowmode: number;
  parentName: string | null;
  parentId: string | null;
}

function extractChannelContext(message: Message): ChannelContext {
  const ch = message.channel;

  if (ch.isThread()) {
    const parentChannel = ch.parent;
    const category =
      parentChannel && 'parent' in parentChannel ? parentChannel.parent : null;
    return {
      id: ch.id,
      name: ch.name ?? 'thread',
      typeLabel: channelTypeLabel(ch.type),
      topic: null,
      nsfw: 'nsfw' in ch && typeof ch.nsfw === 'boolean' ? ch.nsfw : false,
      slowmode:
        'rateLimitPerUser' in ch && typeof ch.rateLimitPerUser === 'number'
          ? ch.rateLimitPerUser
          : 0,
      parentName: category?.name ?? null,
      parentId: category?.id ?? null,
    };
  }

  const name = 'name' in ch && typeof ch.name === 'string' ? ch.name : 'inconnu';
  const parent = 'parent' in ch ? ch.parent : null;
  const topic = 'topic' in ch && typeof ch.topic === 'string' ? ch.topic : null;
  const nsfw = 'nsfw' in ch && typeof ch.nsfw === 'boolean' ? ch.nsfw : false;
  const slowmode =
    'rateLimitPerUser' in ch && typeof ch.rateLimitPerUser === 'number'
      ? ch.rateLimitPerUser
      : 0;

  return {
    id: ch.id,
    name,
    typeLabel: channelTypeLabel(ch.type),
    topic,
    nsfw,
    slowmode,
    parentName: parent?.name ?? null,
    parentId: parent?.id ?? null,
  };
}

/** Order-independent serialization, so two tool calls that differ only by JSON
 * key order are recognised as the same call. */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

function toolCallKey(name: string, rawArgs: string): string {
  try {
    return `${name}:${stableStringify(JSON.parse(rawArgs))}`;
  } catch {
    return `${name}:${rawArgs}`;
  }
}

export async function runAgent(
  message: Message,
  owner: User,
  guild: Guild,
): Promise<string> {
  const systemPrompt = buildAgentSystemPrompt(owner, guild);
  const ctx = extractChannelContext(message);

  const currentChannelExtras: string[] = [];
  if (ctx.topic) currentChannelExtras.push(`sujet: "${ctx.topic}"`);
  if (ctx.nsfw) currentChannelExtras.push('NSFW: oui');
  if (ctx.slowmode > 0) currentChannelExtras.push(`slowmode: ${ctx.slowmode}s`);
  const currentChannelExtrasLine =
    currentChannelExtras.length > 0 ? ` [${currentChannelExtras.join(', ')}]` : '';

  const all = Array.from(guild.channels.cache.values());
  const categories = all
    .filter((c) => c.type === ChannelType.GuildCategory)
    .sort((a, b) => a.rawPosition - b.rawPosition);
  const nNonCategoryChannels = all.filter((c) => c.type !== ChannelType.GuildCategory).length;

  const categoriesBlock =
    categories.length === 0
      ? 'Catégories: aucune'
      : `Catégories (${categories.length}): ${categories
          .map((c) => `"${c.name}"=${c.id}`)
          .join(', ')}`;

  const shortTypeLabel = (t: ChannelType): string => {
    switch (t) {
      case ChannelType.GuildText: return 'texte';
      case ChannelType.GuildVoice: return 'vocal';
      case ChannelType.GuildStageVoice: return 'stage';
      case ChannelType.GuildAnnouncement: return 'annonces';
      case ChannelType.GuildForum: return 'forum';
      case ChannelType.GuildMedia: return 'média';
      default: return 'autre';
    }
  };
  const THREAD_TYPES: ReadonlySet<ChannelType> = new Set([
    ChannelType.PublicThread,
    ChannelType.PrivateThread,
    ChannelType.AnnouncementThread,
  ]);
  const nonCategoryChannels = all
    .filter((c) => c.type !== ChannelType.GuildCategory && !THREAD_TYPES.has(c.type))
    .filter((c): c is Exclude<typeof c, { isThread(): true }> => !('isThread' in c && c.isThread()))
    .sort((a, b) => {
      const ap = 'rawPosition' in a ? a.rawPosition : 0;
      const bp = 'rawPosition' in b ? b.rawPosition : 0;
      return ap - bp;
    });
  const orphanChannels = nonCategoryChannels.filter((c) => !c.parentId);
  const childrenByCat = new Map<string, typeof nonCategoryChannels>();
  for (const c of nonCategoryChannels) {
    if (!c.parentId) continue;
    const arr = childrenByCat.get(c.parentId);
    if (arr) arr.push(c);
    else childrenByCat.set(c.parentId, [c]);
  }
  const fmtChan = (c: typeof nonCategoryChannels[number]): string =>
    `#${c.name}=${c.id}(${shortTypeLabel(c.type)})`;
  const channelsBlockLines: string[] = [
    `Salons (${nonCategoryChannels.length}, format "#nom=id(type)"):`,
  ];
  if (orphanChannels.length > 0) {
    channelsBlockLines.push(`  sans-catégorie: ${orphanChannels.map(fmtChan).join(', ')}`);
  }
  for (const cat of categories) {
    const kids = childrenByCat.get(cat.id) ?? [];
    const kidsStr = kids.length === 0 ? '(vide)' : kids.map(fmtChan).join(', ');
    channelsBlockLines.push(`  "${cat.name}"=${cat.id}: ${kidsStr}`);
  }
  const channelsBlock = channelsBlockLines.join('\n');

  const roles = Array.from(guild.roles.cache.values())
    .filter((r) => r.name !== '@everyone')
    .filter((r) => r.tags?.botId === undefined)
    .filter((r) => !r.managed)
    .sort((a, b) => b.position - a.position);

  const rolesBlock =
    roles.length === 0
      ? `Rôles (1, @everyone seul): @everyone=${guild.roles.everyone.id}`
      : `Rôles (${roles.length + 1}, format "@nom=id"): ${roles
          .map((r) => `@${r.name}=${r.id}`)
          .join(', ')}, @everyone=${guild.roles.everyone.id}`;

  const me = guild.members.me;
  const myRoles =
    me?.roles.cache
      .filter((r) => r.name !== '@everyone')
      .sort((a, b) => b.position - a.position)
      .map((r) => r.name) ?? [];
  const myInfoLine = me
    ? `Moi (A.E.G.I.S): pseudo "${me.nickname ?? me.user.username}", rôles [${myRoles.length > 0 ? myRoles.join(', ') : 'aucun'}]`
    : 'Moi (A.E.G.I.S): infos indisponibles';

  const parentShort = ctx.parentName
    ? `parent="${ctx.parentName}"=${ctx.parentId}`
    : 'parent=aucun';

  const emojis = Array.from(guild.emojis.cache.values());
  const emojisBlock =
    emojis.length === 0
      ? ''
      : `Emojis (${emojis.length}, format ":nom:"=id): ${emojis.map((e) => `":${e.name}:"=${e.id}`).join(', ')}\n\n`;

  const attachmentUrls = Array.from(message.attachments.values()).map((att) => att.url);
  const attachmentsLine =
    attachmentUrls.length > 0
      ? `Images/fichiers joints au message (URLs utilisables, ex: create_emoji): ${attachmentUrls.join(', ')}\n\n`
      : '';

  const now = new Date();
  const userContent = `Contexte:
Date: ${formatDateFR(now)} (Europe/Paris) | ISO UTC: ${now.toISOString()}
Serveur: "${guild.name}", ${guild.memberCount} membres, boost=${boostTierLabel(guild.premiumTier)} (${guild.premiumSubscriptionCount ?? 0}), locale=${guild.preferredLocale}, créé ${formatDateFR(guild.createdAt)}. Stats: ${categories.length} cat, ${nNonCategoryChannels} salons hors-cat, ${roles.length + 1} rôles (@everyone inclus).
${myInfoLine}
Salon actuel: #${ctx.name}=${ctx.id}(${ctx.typeLabel})${currentChannelExtrasLine}, ${parentShort}

${categoriesBlock}

${channelsBlock}

${rolesBlock}

${emojisBlock}${attachmentsLine}Message de ${owner.tag}: ${message.content}`;

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];

  // What the executed tools actually reported, used as the response when the
  // model finishes without writing any text of its own.
  const executedDisplays: string[] = [];

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let response: ChatCompletion;
    try {
      // Once tools have run, this call only fetches the model's wrap-up text, and
      // we already have the tool displays as a fallback. So retry it only briefly
      // instead of stalling ~30s on the rate limit before giving up.
      const maxRetries = executedDisplays.length > 0 ? 1 : RATE_LIMIT_MAX_RETRIES;
      response = await createCompletionWithRetries(messages, maxRetries);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const errMsg = String((err as { message?: string }).message ?? err);
      if (status === 400 && /tool_use_failed|did not match schema/.test(errMsg)) {
        logger.warn('LLM 400 tool_use_failed - feeding error back for correction', { errMsg });
        messages.push({
          role: 'user',
          content: `Ton dernier tool_call a été rejeté par l'API pour cause de types incorrects: ${errMsg}. Réémets l'appel avec les types EXACTS du schéma (numbers comme 0 et pas "0", booleans comme true/false sans quotes, etc.).`,
        });
        continue;
      }
      // The action already happened (tools ran); report what was done rather
      // than a generic error just because the follow-up summary call failed.
      if (executedDisplays.length > 0) {
        logger.warn('LLM call failed after tools ran; returning tool results', { errMsg });
        return executedDisplays.join('\n\n');
      }
      throw err;
    }

    const assistantMsg = response.choices[0]?.message;
    if (!assistantMsg) {
      logger.error('Agent: no response from LLM');
      return "Désolé, je n'ai pas pu traiter ta demande (réponse vide du LLM).";
    }

    const toolCalls = assistantMsg.tool_calls as ToolCall[] | undefined;
    logger.debug('Agent iteration', {
      iter,
      hasToolCalls: !!toolCalls?.length,
      toolCount: toolCalls?.length ?? 0,
    });

    if (!toolCalls || toolCalls.length === 0) {
      const content = assistantMsg.content?.trim();
      if (content) return content;
      // Model wrote nothing: report what the tools actually did instead of a
      // bare acknowledgement. Empty is fine only when nothing was executed (e.g.
      // destructive actions queued, where the confirmation prompt is appended).
      return executedDisplays.length > 0 ? executedDisplays.join('\n\n') : '';
    }

    messages.push({
      role: 'assistant',
      content: assistantMsg.content ?? null,
      tool_calls: toolCalls,
    });

    const seenCalls = new Set<string>();
    for (const call of toolCalls) {
      const toolName = call.function.name;
      const tool = findTool(toolName);

      logger.info('Tool call requested', { name: toolName, args: call.function.arguments });

      // Guard against a model emitting the same call twice in one response
      // (seen with weaker models, e.g. creating a channel in duplicate).
      const dedupKey = toolCallKey(toolName, call.function.arguments);
      if (seenCalls.has(dedupKey)) {
        logger.warn('Duplicate tool call in same response, skipping execution', { name: toolName });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: true, summary: 'Appel en double ignoré (déjà effectué dans cette réponse).', display: '' }),
        });
        continue;
      }
      seenCalls.add(dedupKey);

      if (!tool) {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: `Outil inconnu: ${toolName}` }),
        });
        continue;
      }

      if (tool.requiredPermission !== null && !botHasPermission(guild, tool.requiredPermission)) {
        logger.warn('Bot lacks required permission for tool', { name: toolName });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({
            ok: false,
            error: `Je n'ai pas la permission Discord requise pour exécuter ${toolName}. Donne-moi la permission correspondante dans les réglages du serveur.`,
          }),
        });
        continue;
      }

      let args: unknown;
      try {
        args = JSON.parse(call.function.arguments);
      } catch {
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: 'Arguments JSON invalides' }),
        });
        continue;
      }

      try {
        const result = await tool.execute(args, { guild, owner });
        logger.info('Tool executed', { name: toolName, ok: result.ok });
        recordAudit({
          owner: owner.tag,
          action: toolName,
          ok: result.ok,
          detail: result.ok ? result.summary : result.error,
        });
        if (result.ok && typeof result.display === 'string' && result.display.trim() !== '') {
          executedDisplays.push(result.display);
        }
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        logger.error('Tool execution threw', { name: toolName, err: String(err) });
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: `Exception: ${String(err)}` }),
        });
      }
    }
  }

  // If actions were queued during the loop, stay silent: the confirmation
  // prompt appended downstream carries the message. Otherwise, report the stall.
  if (hasPending(owner.id)) return '';
  return `Désolé, j'ai atteint la limite de ${MAX_ITERATIONS} itérations sans conclusion. Reformule ta demande de manière plus directe.`;
}
