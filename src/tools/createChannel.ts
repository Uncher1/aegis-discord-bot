import {
  ChannelType,
  PermissionFlagsBits,
  VideoQualityMode,
  type CategoryChannel,
  type OverwriteResolvable,
} from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';
import { parsePermissionNames } from './permNames.js';

interface PermEntry {
  role_id?: string;
  member_id?: string;
  allow?: string[];
  deny?: string[];
}

interface Args {
  name: string;
  type: 'text' | 'voice';
  category_id?: string;
  topic?: string;
  private?: boolean;
  sync_with_category?: boolean;
  role_permissions?: Array<{ role_id: string; allow?: string[]; deny?: string[] }>;
  member_permissions?: Array<{ member_id: string; allow?: string[]; deny?: string[] }>;
  nsfw?: boolean;
  slowmode?: number;
  bitrate?: number;
  user_limit?: number;
  rtc_region?: string;
  video_quality_mode?: 'auto' | '720p';
}


export const createChannelTool: ToolDefinition = {
  name: 'create_channel',
  description:
    "Crée un nouveau salon textuel ou vocal. Supporte placement dans une catégorie, visibilité publique/privée, synchronisation des permissions avec la catégorie, et overwrites explicites par rôle ou par membre. Par défaut, si une catégorie est fournie et qu'aucune permission explicite n'est spécifiée, le salon hérite (sync) des permissions de la catégorie.",
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Nom du salon (Discord forcera minuscules et tirets pour les salons textuels)',
      },
      type: {
        type: 'string',
        enum: ['text', 'voice'],
        description: "'text' pour un salon textuel, 'voice' pour un vocal",
      },
      category_id: {
        type: 'string',
        description: 'ID de la catégorie parente (optionnel). Omettre pour créer un salon sans catégorie.',
      },
      topic: {
        type: 'string',
        description: 'Sujet/description (salons textuels uniquement, optionnel)',
      },
      private: {
        type: 'boolean',
        description:
          "Si true, le rôle @everyone n'a pas la permission ViewChannel (salon caché au public). Par défaut false.",
      },
      sync_with_category: {
        type: 'boolean',
        description:
          "Si true, copie les permissions de la catégorie parente au salon. Si false, n'hérite pas. Par défaut: true si category_id fourni ET aucune permission explicite par rôle/membre n'est donnée, false sinon. 'private' peut se combiner avec la synchronisation.",
      },
      role_permissions: {
        type: 'array',
        description:
          "Overwrites par rôle. Chaque entrée fixe (REMPLACE) l'overwrite du rôle sur ce salon.",
        items: {
          type: 'object',
          properties: {
            role_id: { type: 'string', description: 'ID du rôle' },
            allow: {
              type: 'array',
              items: { type: 'string' },
              description:
                "Noms de permissions à AUTORISER (PermissionFlagsBits exacts). Général: ViewChannel, ManageChannels, ManageRoles, ManageWebhooks, CreateInstantInvite. Texte: SendMessages, SendMessagesInThreads, CreatePublicThreads, CreatePrivateThreads, EmbedLinks, AttachFiles, AddReactions, UseExternalEmojis, UseExternalStickers, MentionEveryone, ManageMessages, ManageThreads, ReadMessageHistory, SendTTSMessages, SendVoiceMessages, SendPolls. Vocal: Connect, Speak, Stream, UseVAD, PrioritySpeaker, MuteMembers, DeafenMembers, MoveMembers, UseSoundboard, UseExternalSounds, UseEmbeddedActivities. Apps: UseApplicationCommands, UseExternalApps. Événements: CreateEvents, ManageEvents.",
            },
            deny: {
              type: 'array',
              items: { type: 'string' },
              description:
                "Noms de permissions à REFUSER (mêmes noms que 'allow').",
            },
          },
          required: ['role_id'],
        },
      },
      member_permissions: {
        type: 'array',
        description:
          'Overwrites par membre (via ID utilisateur). REMPLACE toute entrée pour cet ID. Utilise les mêmes noms PermissionFlagsBits que role_permissions.',
        items: {
          type: 'object',
          properties: {
            member_id: { type: 'string', description: "ID de l'utilisateur Discord" },
            allow: {
              type: 'array',
              items: { type: 'string' },
              description: 'Noms PermissionFlagsBits à AUTORISER pour ce membre.',
            },
            deny: {
              type: 'array',
              items: { type: 'string' },
              description: 'Noms PermissionFlagsBits à REFUSER pour ce membre.',
            },
          },
          required: ['member_id'],
        },
      },
      nsfw: {
        type: 'boolean',
        description: 'Salons textuels uniquement. Marque le salon comme +18 (age-restricted). Par défaut false.',
      },
      slowmode: {
        type: 'number',
        description:
          "Salons textuels uniquement. Délai minimum entre deux messages par membre, en secondes (0 à 21600). 0 = désactivé.",
      },
      bitrate: {
        type: 'number',
        description:
          "Salons vocaux uniquement. Bitrate en bits/s (8000 min). Plafond selon le niveau de boost du serveur: 96000 (aucun), 128000 (T1), 256000 (T2), 384000 (T3).",
      },
      user_limit: {
        type: 'number',
        description:
          "Salons vocaux uniquement. Nombre max d'utilisateurs simultanés (0 = illimité, max 99).",
      },
      rtc_region: {
        type: 'string',
        description:
          "Salons vocaux uniquement. Nom de région physique Discord (ex: 'rotterdam', 'madrid', 'frankfurt', 'milan', 'stockholm', 'warsaw', 'us-east', 'us-west', 'us-central', 'us-south', 'brazil', 'japan', 'south-korea', 'hongkong', 'singapore', 'sydney', 'india', 'dubai', 'southafrica'). 'europe' n'est PAS valide. Omettre = région auto (défaut recommandé).",
      },
      video_quality_mode: {
        type: 'string',
        enum: ['auto', '720p'],
        description:
          "Salons vocaux uniquement. 'auto' (défaut Discord) ou '720p' (force qualité supérieure).",
      },
    },
    required: ['name', 'type'],
  },
  requiredPermission: PermissionFlagsBits.ManageChannels,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as Args;

    if (!a.name || typeof a.name !== 'string') {
      return { ok: false, error: 'Paramètre "name" (string) requis.' };
    }
    if (a.type !== 'text' && a.type !== 'voice') {
      return { ok: false, error: 'Paramètre "type" doit être "text" ou "voice".' };
    }

    let category: CategoryChannel | null = null;
    if (a.category_id) {
      const c = ctx.guild.channels.cache.get(a.category_id);
      if (!c || c.type !== ChannelType.GuildCategory) {
        return {
          ok: false,
          error: `Catégorie ID "${a.category_id}" introuvable ou n'est pas une catégorie.`,
        };
      }
      category = c as CategoryChannel;
    }

    const hasExplicitOverwrites =
      !!a.role_permissions?.length || !!a.member_permissions?.length;
    const shouldSync =
      a.sync_with_category ?? (category !== null && !hasExplicitOverwrites);

    type Accum = { id: string; allow: bigint; deny: bigint };
    const accs = new Map<string, Accum>();
    const ensure = (id: string): Accum => {
      let acc = accs.get(id);
      if (!acc) {
        acc = { id, allow: 0n, deny: 0n };
        accs.set(id, acc);
      }
      return acc;
    };

    if (shouldSync && category) {
      for (const po of category.permissionOverwrites.cache.values()) {
        accs.set(po.id, {
          id: po.id,
          allow: po.allow.bitfield,
          deny: po.deny.bitfield,
        });
      }
    }

    if (a.private === true) {
      const acc = ensure(ctx.guild.roles.everyone.id);
      acc.allow &= ~PermissionFlagsBits.ViewChannel;
      acc.deny |= PermissionFlagsBits.ViewChannel;
    }

    const explicit: PermEntry[] = [
      ...(a.role_permissions ?? []),
      ...(a.member_permissions ?? []),
    ];
    for (const entry of explicit) {
      const targetId = entry.role_id ?? entry.member_id;
      if (!targetId) continue;

      if (entry.role_id) {
        if (!ctx.guild.roles.cache.has(entry.role_id)) {
          return { ok: false, error: `Rôle ID "${entry.role_id}" introuvable.` };
        }
      } else if (entry.member_id) {
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
      const allowP = parsePermissionNames(entry.allow, `${label}.allow`);
      if (!allowP.ok) return allowP;
      const denyP = parsePermissionNames(entry.deny, `${label}.deny`);
      if (!denyP.ok) return denyP;

      accs.set(targetId, { id: targetId, allow: allowP.bits, deny: denyP.bits });
    }

    const overwrites: OverwriteResolvable[] = Array.from(accs.values()).map((acc) => ({
      id: acc.id,
      allow: acc.allow,
      deny: acc.deny,
    }));

    if (a.slowmode !== undefined) {
      if (!Number.isInteger(a.slowmode) || a.slowmode < 0 || a.slowmode > 21600) {
        return { ok: false, error: 'slowmode doit être un entier entre 0 et 21600 (secondes).' };
      }
    }
    if (a.user_limit !== undefined) {
      if (!Number.isInteger(a.user_limit) || a.user_limit < 0 || a.user_limit > 99) {
        return { ok: false, error: 'user_limit doit être un entier entre 0 et 99.' };
      }
    }
    if (a.bitrate !== undefined) {
      if (!Number.isInteger(a.bitrate) || a.bitrate < 8000) {
        return { ok: false, error: 'bitrate doit être un entier ≥ 8000 (bits/s).' };
      }
    }

    const isText = a.type === 'text';
    const videoQuality =
      a.video_quality_mode === '720p'
        ? VideoQualityMode.Full
        : a.video_quality_mode === 'auto'
          ? VideoQualityMode.Auto
          : undefined;

    try {
      const channel = await ctx.guild.channels.create({
        name: a.name,
        type: isText ? ChannelType.GuildText : ChannelType.GuildVoice,
        parent: category?.id ?? undefined,
        topic: isText ? a.topic : undefined,
        nsfw: isText ? a.nsfw : undefined,
        rateLimitPerUser: isText ? a.slowmode : undefined,
        bitrate: !isText ? a.bitrate : undefined,
        userLimit: !isText ? a.user_limit : undefined,
        rtcRegion: !isText ? a.rtc_region : undefined,
        videoQualityMode: !isText ? videoQuality : undefined,
        permissionOverwrites: overwrites.length > 0 ? overwrites : undefined,
      });

      const parts: string[] = [`Salon <#${channel.id}> créé`];
      if (category) parts.push(`dans **${category.name}**`);
      const tags: string[] = [];
      if (a.private) tags.push('privé');
      if (shouldSync && !a.private) tags.push('permissions synchronisées avec la catégorie');
      if (isText && a.nsfw) tags.push('NSFW');
      if (isText && a.slowmode && a.slowmode > 0) tags.push(`slowmode ${a.slowmode}s`);
      if (!isText && a.bitrate) tags.push(`bitrate ${Math.round(a.bitrate / 1000)}kbps`);
      if (!isText && a.user_limit !== undefined && a.user_limit > 0) tags.push(`limite ${a.user_limit}`);
      if (!isText && a.rtc_region) tags.push(`région ${a.rtc_region}`);
      if (!isText && a.video_quality_mode === '720p') tags.push('vidéo 720p');
      if (hasExplicitOverwrites) {
        const nRoles = a.role_permissions?.length ?? 0;
        const nMembers = a.member_permissions?.length ?? 0;
        const bits: string[] = [];
        if (nRoles > 0) bits.push(`${nRoles} rôle${nRoles > 1 ? 's' : ''}`);
        if (nMembers > 0) bits.push(`${nMembers} membre${nMembers > 1 ? 's' : ''}`);
        tags.push(`overwrites: ${bits.join(', ')}`);
      }
      if (tags.length > 0) parts.push(`(${tags.join(' · ')})`);

      return {
        ok: true,
        summary: `Salon ${a.type} "${channel.name}" créé`,
        display: parts.join(' '),
        data: { id: channel.id, name: channel.name, type: a.type },
      };
    } catch (err) {
      return { ok: false, error: `Échec de la création: ${String(err)}` };
    }
  },
};
