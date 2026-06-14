import {
  ChannelType,
  PermissionFlagsBits,
  VideoQualityMode,
  type CategoryChannel,
  type OverwriteResolvable,
  type TextChannel,
  type VoiceChannel,
} from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';
import { parsePermissionNames } from './permNames.js';
import { applyOverwriteEdit, bitsOf, type OverwriteMode } from './overwrites.js';

interface PermEntry {
  role_id?: string;
  member_id?: string;
  mode?: OverwriteMode;
  allow?: string[];
  deny?: string[];
  neutral?: string[];
}

interface Args {
  channel_id: string;
  name?: string;
  parent_id?: string | null;
  sync_with_category?: boolean;
  position?: number;
  private?: boolean;
  topic?: string | null;
  nsfw?: boolean;
  slowmode?: number;
  bitrate?: number;
  user_limit?: number;
  rtc_region?: string | null;
  video_quality_mode?: 'auto' | '720p';
  role_permissions?: Array<{
    role_id: string;
    mode?: OverwriteMode;
    allow?: string[];
    deny?: string[];
    neutral?: string[];
  }>;
  member_permissions?: Array<{
    member_id: string;
    mode?: OverwriteMode;
    allow?: string[];
    deny?: string[];
    neutral?: string[];
  }>;
}

export const modifyChannelTool: ToolDefinition = {
  name: 'modify_channel',
  description:
    "Modifie un salon textuel ou vocal existant. Tous les champs sauf channel_id sont optionnels; ne passe que ce qui doit changer. Couvre rename, déplacement (parent_id), (re-)synchronisation avec la catégorie, position, options textuelles/vocales, et édition fine des overwrites de permissions par rôle ou membre (mode merge/replace/remove + allow/deny/neutral).",
  parameters: {
    type: 'object',
    properties: {
      channel_id: {
        type: 'string',
        description: 'ID du salon à modifier (salon textuel ou vocal uniquement).',
      },
      name: {
        type: 'string',
        description: 'Nouveau nom du salon (Discord forcera minuscules/tirets pour les salons textuels).',
      },
      parent_id: {
        type: ['string', 'null'],
        description:
          "ID de la nouvelle catégorie parente. Passe null pour détacher le salon de toute catégorie. Omettre = ne pas déplacer.",
      },
      sync_with_category: {
        type: 'boolean',
        description:
          "Contrôle la synchronisation des permissions avec la catégorie parente. Avec parent_id: détermine si le déplacement recopie les perms de la nouvelle catégorie. Seul (sans parent_id): true = re-synchronise avec la catégorie ACTUELLE du salon (efface les overwrites divergents); false seul = no-op. Par défaut (lors d'un déplacement sans valeur explicite): false (perms conservées, comme dans Discord).",
      },
      position: {
        type: 'number',
        description:
          "Position du salon (0-based) dans sa catégorie (ou à la racine). 0 = tout en haut. Discord plafonne automatiquement au nombre de salons.",
      },
      private: {
        type: 'boolean',
        description:
          "Raccourci. true: @everyone perd ViewChannel (salon caché). false: retire ViewChannel de allow ET deny pour @everyone (neutre, hérite de la catégorie/rôle). Omettre = ne touche pas à @everyone.",
      },
      topic: {
        type: ['string', 'null'],
        description: 'Salons textuels uniquement. null ou chaîne vide = retire le topic.',
      },
      nsfw: {
        type: 'boolean',
        description: 'Salons textuels uniquement. Active/désactive le mode +18.',
      },
      slowmode: {
        type: 'number',
        description:
          'Salons textuels uniquement. Délai entre messages par membre (0 à 21600 secondes). 0 = désactivé.',
      },
      bitrate: {
        type: 'number',
        description:
          "Salons vocaux uniquement. Bitrate en bits/s (min 8000). Plafond selon boost du serveur: 96000 (aucun), 128000 (T1), 256000 (T2), 384000 (T3). Si valeur trop haute, clamp silencieux au plafond.",
      },
      user_limit: {
        type: 'number',
        description: "Salons vocaux uniquement. 0 = illimité, max 99.",
      },
      rtc_region: {
        type: ['string', 'null'],
        description:
          "Salons vocaux uniquement. Nom de région physique Discord (rotterdam, madrid, frankfurt, milan, stockholm, warsaw, us-east, us-west, us-central, us-south, brazil, japan, south-korea, hongkong, singapore, sydney, india, dubai, southafrica). null = région auto. 'europe' n'est PAS valide.",
      },
      video_quality_mode: {
        type: 'string',
        enum: ['auto', '720p'],
        description: "Salons vocaux uniquement. 'auto' ou '720p'.",
      },
      role_permissions: {
        type: 'array',
        description:
          "Édite les overwrites par rôle. Chaque entrée a un 'mode': 'merge' (défaut, modifie seulement les perms listées sans toucher aux autres), 'replace' (écrase l'overwrite du rôle avec exactement allow/deny - neutral ignoré), 'remove' (supprime entièrement l'overwrite du rôle - allow/deny/neutral ignorés).",
        items: {
          type: 'object',
          properties: {
            role_id: { type: 'string', description: 'ID du rôle' },
            mode: {
              type: 'string',
              enum: ['merge', 'replace', 'remove'],
              description:
                "merge (défaut): ajuste flag par flag en partant de l'état actuel. replace: écrase avec allow/deny exactement. remove: supprime l'overwrite.",
            },
            allow: {
              type: 'array',
              items: { type: 'string' },
              description:
                "Permissions à mettre à ALLOW (PermissionFlagsBits). Vocabulaire complet: ViewChannel, ManageChannels, ManageRoles, ManageWebhooks, CreateInstantInvite, SendMessages, SendMessagesInThreads, CreatePublicThreads, CreatePrivateThreads, EmbedLinks, AttachFiles, AddReactions, UseExternalEmojis, UseExternalStickers, MentionEveryone, ManageMessages, ManageThreads, ReadMessageHistory, SendTTSMessages, SendVoiceMessages, SendPolls, Connect, Speak, Stream, UseVAD, PrioritySpeaker, MuteMembers, DeafenMembers, MoveMembers, UseSoundboard, UseExternalSounds, UseEmbeddedActivities, UseApplicationCommands, UseExternalApps, CreateEvents, ManageEvents.",
            },
            deny: {
              type: 'array',
              items: { type: 'string' },
              description: 'Permissions à mettre à DENY (mêmes noms que allow).',
            },
            neutral: {
              type: 'array',
              items: { type: 'string' },
              description:
                "Mode merge uniquement. Permissions à retirer de allow ET deny (reviennent à l'héritage - ni autorisé ni refusé spécifiquement sur ce salon).",
            },
          },
          required: ['role_id'],
        },
      },
      member_permissions: {
        type: 'array',
        description:
          'Édite les overwrites par membre. Même structure que role_permissions avec member_id à la place de role_id.',
        items: {
          type: 'object',
          properties: {
            member_id: { type: 'string', description: "ID de l'utilisateur Discord" },
            mode: {
              type: 'string',
              enum: ['merge', 'replace', 'remove'],
            },
            allow: { type: 'array', items: { type: 'string' } },
            deny: { type: 'array', items: { type: 'string' } },
            neutral: { type: 'array', items: { type: 'string' } },
          },
          required: ['member_id'],
        },
      },
    },
    required: ['channel_id'],
  },
  requiredPermission: PermissionFlagsBits.ManageChannels,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as Args;

    // 1) Cible
    if (!a.channel_id || typeof a.channel_id !== 'string') {
      return { ok: false, error: 'channel_id (string) requis.' };
    }
    if (a.name !== undefined && a.name.trim() === '') {
      return { ok: false, error: 'name doit etre une chaine non vide.' };
    }
    const raw = ctx.guild.channels.cache.get(a.channel_id);
    if (!raw) {
      return { ok: false, error: `Salon ID "${a.channel_id}" introuvable.` };
    }
    if (raw.type !== ChannelType.GuildText && raw.type !== ChannelType.GuildVoice) {
      return {
        ok: false,
        error: `Salon "${raw.name}" (type ${raw.type}) non modifiable par cet outil (seulement textuels et vocaux).`,
      };
    }
    const channel = raw as TextChannel | VoiceChannel;
    const isText = channel.type === ChannelType.GuildText;

    // 2) Validation compatibilité type
    const textOnly: string[] = [];
    if (a.topic !== undefined) textOnly.push('topic');
    if (a.nsfw !== undefined) textOnly.push('nsfw');
    if (a.slowmode !== undefined) textOnly.push('slowmode');
    if (!isText && textOnly.length > 0) {
      return {
        ok: false,
        error: `Paramètres textuels [${textOnly.join(', ')}] appliqués à un salon vocal.`,
      };
    }
    const voiceOnly: string[] = [];
    if (a.bitrate !== undefined) voiceOnly.push('bitrate');
    if (a.user_limit !== undefined) voiceOnly.push('user_limit');
    if (a.rtc_region !== undefined) voiceOnly.push('rtc_region');
    if (a.video_quality_mode !== undefined) voiceOnly.push('video_quality_mode');
    if (isText && voiceOnly.length > 0) {
      return {
        ok: false,
        error: `Paramètres vocaux [${voiceOnly.join(', ')}] appliqués à un salon textuel.`,
      };
    }

    // 3) parent_id: valider si fourni
    let newParent: CategoryChannel | null | undefined = undefined;
    if (a.parent_id !== undefined) {
      if (a.parent_id === null) {
        newParent = null;
      } else {
        const p = ctx.guild.channels.cache.get(a.parent_id);
        if (!p || p.type !== ChannelType.GuildCategory) {
          return {
            ok: false,
            error: `Catégorie ID "${a.parent_id}" introuvable ou n'est pas une catégorie.`,
          };
        }
        newParent = p as CategoryChannel;
      }
    }
    if (newParent === null && a.sync_with_category === true) {
      return {
        ok: false,
        error: 'sync_with_category=true incompatible avec parent_id=null (aucune catégorie pour synchroniser).',
      };
    }

    // 4) Plages numériques
    if (a.slowmode !== undefined && (!Number.isInteger(a.slowmode) || a.slowmode < 0 || a.slowmode > 21600)) {
      return { ok: false, error: 'slowmode doit être un entier entre 0 et 21600 (secondes).' };
    }
    if (a.user_limit !== undefined && (!Number.isInteger(a.user_limit) || a.user_limit < 0 || a.user_limit > 99)) {
      return { ok: false, error: 'user_limit doit être un entier entre 0 et 99.' };
    }
    if (a.bitrate !== undefined && (!Number.isInteger(a.bitrate) || a.bitrate < 8000)) {
      return { ok: false, error: 'bitrate doit être un entier ≥ 8000 (bits/s).' };
    }
    if (a.position !== undefined && (!Number.isInteger(a.position) || a.position < 0)) {
      return { ok: false, error: 'position doit être un entier ≥ 0.' };
    }

    // 5) Validation des entrées de permissions (IDs + noms de perms)
    const explicit: PermEntry[] = [
      ...(a.role_permissions ?? []),
      ...(a.member_permissions ?? []),
    ];
    for (const entry of explicit) {
      if (!entry.role_id && !entry.member_id) {
        return {
          ok: false,
          error: 'Chaque entrée role_permissions/member_permissions doit avoir role_id ou member_id.',
        };
      }
      if (entry.role_id && !ctx.guild.roles.cache.has(entry.role_id)) {
        return { ok: false, error: `Rôle ID "${entry.role_id}" introuvable.` };
      }
      if (entry.member_id) {
        try {
          await ctx.guild.members.fetch(entry.member_id);
        } catch {
          return {
            ok: false,
            error: `Membre ID "${entry.member_id}" introuvable dans le serveur.`,
          };
        }
      }
      const label = entry.role_id
        ? `role_permissions[${entry.role_id}]`
        : `member_permissions[${entry.member_id}]`;
      const a1 = parsePermissionNames(entry.allow, `${label}.allow`);
      if (!a1.ok) return a1;
      const a2 = parsePermissionNames(entry.deny, `${label}.deny`);
      if (!a2.ok) return a2;
      const a3 = parsePermissionNames(entry.neutral, `${label}.neutral`);
      if (!a3.ok) return a3;
    }

    // 6) Déplacement et/ou (re-)synchronisation
    const movingParent = newParent !== undefined;
    const syncDuringMove = a.sync_with_category === true;
    try {
      if (movingParent) {
        await channel.setParent(newParent?.id ?? null, {
          lockPermissions: syncDuringMove,
        });
      } else if (a.sync_with_category === true) {
        if (!channel.parent) {
          return {
            ok: false,
            error: "Impossible de synchroniser: le salon n'est dans aucune catégorie.",
          };
        }
        await channel.lockPermissions();
      }
      // sync_with_category === false seul = no-op (Discord gère cette sémantique implicitement)
    } catch (err) {
      return { ok: false, error: `Échec déplacement/synchronisation: ${String(err)}` };
    }

    // 7) Accumulateur à partir de l'état courant (mis à jour après move/sync)
    type Accum = { id: string; allow: bigint; deny: bigint };
    const accs = new Map<string, Accum>();
    for (const po of channel.permissionOverwrites.cache.values()) {
      accs.set(po.id, {
        id: po.id,
        allow: po.allow.bitfield,
        deny: po.deny.bitfield,
      });
    }

    // 8) Raccourci private
    if (a.private === true) {
      const eId = ctx.guild.roles.everyone.id;
      const cur = accs.get(eId) ?? { id: eId, allow: 0n, deny: 0n };
      cur.allow &= ~PermissionFlagsBits.ViewChannel;
      cur.deny |= PermissionFlagsBits.ViewChannel;
      accs.set(eId, cur);
    } else if (a.private === false) {
      const eId = ctx.guild.roles.everyone.id;
      const cur = accs.get(eId);
      if (cur) {
        cur.allow &= ~PermissionFlagsBits.ViewChannel;
        cur.deny &= ~PermissionFlagsBits.ViewChannel;
        if (cur.allow === 0n && cur.deny === 0n) accs.delete(eId);
        else accs.set(eId, cur);
      }
    }

    // 9) Overwrites explicites (logique merge/replace/remove dans overwrites.ts)
    for (const entry of explicit) {
      const targetId = (entry.role_id ?? entry.member_id) as string;
      const mode: OverwriteMode = entry.mode ?? 'merge';
      const cur = accs.get(targetId) ?? { id: targetId, allow: 0n, deny: 0n };
      const next = applyOverwriteEdit(
        cur,
        mode,
        bitsOf(entry.allow),
        bitsOf(entry.deny),
        mode === 'merge' ? bitsOf(entry.neutral) : 0n,
      );
      if (next === null) accs.delete(targetId);
      else accs.set(targetId, { id: targetId, allow: next.allow, deny: next.deny });
    }

    // 10) Payload de edit()
    const hasOverwriteChanges = a.private !== undefined || explicit.length > 0;
    const overwritePayload: OverwriteResolvable[] | undefined = hasOverwriteChanges
      ? Array.from(accs.values()).map((acc) => ({
          id: acc.id,
          allow: acc.allow,
          deny: acc.deny,
        }))
      : undefined;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editPayload: Record<string, any> = {};
    if (a.name !== undefined) editPayload.name = a.name;
    if (a.position !== undefined) editPayload.position = a.position;
    if (isText) {
      if (a.topic !== undefined) editPayload.topic = a.topic;
      if (a.nsfw !== undefined) editPayload.nsfw = a.nsfw;
      if (a.slowmode !== undefined) editPayload.rateLimitPerUser = a.slowmode;
    } else {
      if (a.bitrate !== undefined) editPayload.bitrate = a.bitrate;
      if (a.user_limit !== undefined) editPayload.userLimit = a.user_limit;
      if (a.rtc_region !== undefined) editPayload.rtcRegion = a.rtc_region;
      if (a.video_quality_mode !== undefined) {
        editPayload.videoQualityMode =
          a.video_quality_mode === '720p' ? VideoQualityMode.Full : VideoQualityMode.Auto;
      }
    }
    if (overwritePayload !== undefined) editPayload.permissionOverwrites = overwritePayload;

    const hasEditWork = Object.keys(editPayload).length > 0;
    const didMoveOrSync = movingParent || a.sync_with_category === true;

    if (!hasEditWork && !didMoveOrSync) {
      return {
        ok: true,
        summary: `Aucune modification appliquée sur "${channel.name}"`,
        display: `Rien à changer sur <#${channel.id}> (aucun paramètre fourni n'a produit d'action).`,
        data: { id: channel.id },
      };
    }

    try {
      if (hasEditWork) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await channel.edit(editPayload as any);
      }
    } catch (err) {
      return { ok: false, error: `Échec de la modification: ${String(err)}` };
    }

    // 11) Display
    const changes: string[] = [];
    if (a.name !== undefined) changes.push(`renommé en \`${a.name}\``);
    if (movingParent) {
      const dst = newParent ? `**${newParent.name}**` : '*aucune catégorie*';
      changes.push(
        syncDuringMove
          ? `déplacé vers ${dst} (perms synchronisées)`
          : `déplacé vers ${dst} (perms du salon conservées)`,
      );
    } else if (a.sync_with_category === true) {
      changes.push(`re-synchronisé avec **${channel.parent?.name ?? 'sa catégorie'}**`);
    }
    if (a.position !== undefined) changes.push(`position ${a.position}`);
    if (isText && a.topic !== undefined) changes.push(a.topic ? 'topic modifié' : 'topic retiré');
    if (isText && a.nsfw !== undefined) changes.push(a.nsfw ? 'NSFW activé' : 'NSFW désactivé');
    if (isText && a.slowmode !== undefined)
      changes.push(a.slowmode > 0 ? `slowmode ${a.slowmode}s` : 'slowmode désactivé');
    if (!isText && a.bitrate !== undefined)
      changes.push(`bitrate ${Math.round(a.bitrate / 1000)}kbps`);
    if (!isText && a.user_limit !== undefined)
      changes.push(a.user_limit > 0 ? `limite ${a.user_limit}` : 'limite illimitée');
    if (!isText && a.rtc_region !== undefined)
      changes.push(a.rtc_region ? `région ${a.rtc_region}` : 'région auto');
    if (!isText && a.video_quality_mode !== undefined)
      changes.push(`vidéo ${a.video_quality_mode}`);
    if (a.private === true) changes.push('rendu privé (@everyone perd ViewChannel)');
    if (a.private === false) changes.push('@everyone remis en neutre sur ViewChannel');
    if (explicit.length > 0) {
      const nRoles = a.role_permissions?.length ?? 0;
      const nMembers = a.member_permissions?.length ?? 0;
      const bits: string[] = [];
      if (nRoles > 0) bits.push(`${nRoles} rôle${nRoles > 1 ? 's' : ''}`);
      if (nMembers > 0) bits.push(`${nMembers} membre${nMembers > 1 ? 's' : ''}`);
      changes.push(`overwrites édités (${bits.join(', ')})`);
    }

    let warning = '';
    if (movingParent && a.sync_with_category === undefined && newParent) {
      warning = `\n-# Attention: permissions du salon NON synchronisées avec **${newParent.name}**. Dis-moi si tu veux aligner.`;
    }

    return {
      ok: true,
      summary: `Salon "${channel.name}" modifié`,
      display: `<#${channel.id}> mis à jour: ${changes.join(' · ')}${warning}`,
      data: { id: channel.id, changes: changes.length },
    };
  },
};
