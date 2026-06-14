import {
  ChannelType,
  PermissionFlagsBits,
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
  private?: boolean;
  role_permissions?: Array<{ role_id: string; allow?: string[]; deny?: string[] }>;
  member_permissions?: Array<{ member_id: string; allow?: string[]; deny?: string[] }>;
}

export const createCategoryTool: ToolDefinition = {
  name: 'create_category',
  description:
    "Crée une nouvelle catégorie (conteneur de salons). Supporte visibilité publique/privée et overwrites explicites par rôle ou par membre - ces permissions seront héritées par les salons créés ensuite dans la catégorie si on active leur synchronisation.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nom de la catégorie' },
      private: {
        type: 'boolean',
        description:
          "Si true, le rôle @everyone n'a pas ViewChannel sur la catégorie (catégorie et ses futurs salons synchronisés sont cachés au public). Par défaut false.",
      },
      role_permissions: {
        type: 'array',
        description:
          "Overwrites par rôle sur la catégorie. Chaque entrée fixe (REMPLACE) l'overwrite du rôle.",
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
              description: "Noms de permissions à REFUSER (mêmes noms que 'allow').",
            },
          },
          required: ['role_id'],
        },
      },
      member_permissions: {
        type: 'array',
        description:
          'Overwrites par membre (via ID utilisateur). Mêmes noms PermissionFlagsBits que role_permissions.',
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
    },
    required: ['name'],
  },
  requiredPermission: PermissionFlagsBits.ManageChannels,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as Args;

    if (!a.name || typeof a.name !== 'string') {
      return { ok: false, error: 'Paramètre "name" (string) requis.' };
    }

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

    try {
      const cat = await ctx.guild.channels.create({
        name: a.name,
        type: ChannelType.GuildCategory,
        permissionOverwrites: overwrites.length > 0 ? overwrites : undefined,
      });

      const parts: string[] = [`Catégorie **${cat.name}** créée`];
      const tags: string[] = [];
      if (a.private) tags.push('privée');
      const nRoles = a.role_permissions?.length ?? 0;
      const nMembers = a.member_permissions?.length ?? 0;
      if (nRoles > 0 || nMembers > 0) {
        const bits: string[] = [];
        if (nRoles > 0) bits.push(`${nRoles} rôle${nRoles > 1 ? 's' : ''}`);
        if (nMembers > 0) bits.push(`${nMembers} membre${nMembers > 1 ? 's' : ''}`);
        tags.push(`overwrites: ${bits.join(', ')}`);
      }
      if (tags.length > 0) parts.push(`(${tags.join(' · ')})`);

      return {
        ok: true,
        summary: `Catégorie "${cat.name}" créée`,
        display: parts.join(' '),
        data: { id: cat.id, name: cat.name },
      };
    } catch (err) {
      return { ok: false, error: `Échec de la création: ${String(err)}` };
    }
  },
};
