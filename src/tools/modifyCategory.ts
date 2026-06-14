import {
  ChannelType,
  PermissionFlagsBits,
  type CategoryChannel,
  type GuildChannel,
  type OverwriteResolvable,
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
  category_id: string;
  name?: string;
  position?: number;
  private?: boolean;
  sync_children?: boolean;
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

export const modifyCategoryTool: ToolDefinition = {
  name: 'modify_category',
  description:
    "Modifie une catégorie existante. Tous les champs sauf category_id sont optionnels; ne passe que ce qui doit changer. Couvre rename, position, édition fine des overwrites de permissions par rôle ou membre (mode merge/replace/remove + allow/deny/neutral), et propagation optionnelle (sync_children) qui force CHAQUE salon enfant à recopier les permissions de la catégorie (ce qui ÉCRASE les overwrites custom des salons enfants - n'utiliser que sur demande explicite de l'owner).",
  parameters: {
    type: 'object',
    properties: {
      category_id: {
        type: 'string',
        description: 'ID de la catégorie à modifier.',
      },
      name: { type: 'string', description: 'Nouveau nom de la catégorie.' },
      position: {
        type: 'number',
        description:
          "Position (0-based) parmi les catégories. 0 = tout en haut. Discord plafonne automatiquement au nombre de catégories.",
      },
      private: {
        type: 'boolean',
        description:
          "Raccourci. true: @everyone perd ViewChannel sur la catégorie (cache la catégorie ET tous ses salons enfants synchronisés). false: retire ViewChannel de allow ET deny pour @everyone (neutre). Omettre = ne touche pas à @everyone.",
      },
      sync_children: {
        type: 'boolean',
        description:
          "Si true, force CHAQUE salon enfant de la catégorie à recopier les permissions de la catégorie (équivalent du bouton 'Synchroniser les permissions' de Discord pour chaque enfant). ATTENTION: cela ÉCRASE les overwrites custom de chaque salon enfant. À ne mettre à true QUE si l'owner demande explicitement de propager / aligner / synchroniser les salons. Par défaut: false.",
      },
      role_permissions: {
        type: 'array',
        description:
          "Édite les overwrites par rôle sur la catégorie. Chaque entrée a un 'mode': 'merge' (défaut, modifie seulement les perms listées sans toucher aux autres), 'replace' (écrase l'overwrite avec exactement allow/deny - neutral ignoré), 'remove' (supprime entièrement l'overwrite - allow/deny/neutral ignorés).",
        items: {
          type: 'object',
          properties: {
            role_id: { type: 'string', description: 'ID du rôle' },
            mode: {
              type: 'string',
              enum: ['merge', 'replace', 'remove'],
              description:
                "merge (défaut): ajuste flag par flag à partir de l'état actuel. replace: écrase avec allow/deny exactement. remove: supprime l'overwrite.",
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
                "Mode merge uniquement. Permissions à retirer de allow ET deny (reviennent à l'héritage).",
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
            mode: { type: 'string', enum: ['merge', 'replace', 'remove'] },
            allow: { type: 'array', items: { type: 'string' } },
            deny: { type: 'array', items: { type: 'string' } },
            neutral: { type: 'array', items: { type: 'string' } },
          },
          required: ['member_id'],
        },
      },
    },
    required: ['category_id'],
  },
  requiredPermission: PermissionFlagsBits.ManageChannels,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as Args;

    // 1) Cible
    if (!a.category_id || typeof a.category_id !== 'string') {
      return { ok: false, error: 'category_id (string) requis.' };
    }
    if (a.name !== undefined && a.name.trim() === '') {
      return { ok: false, error: 'name doit etre une chaine non vide.' };
    }
    const raw = ctx.guild.channels.cache.get(a.category_id);
    if (!raw) {
      return { ok: false, error: `Catégorie ID "${a.category_id}" introuvable.` };
    }
    if (raw.type !== ChannelType.GuildCategory) {
      return {
        ok: false,
        error: `"${raw.name}" n'est pas une catégorie (type ${raw.type}). Utilise modify_channel pour un salon.`,
      };
    }
    const category = raw as CategoryChannel;

    // 2) Plages numériques
    if (a.position !== undefined && (!Number.isInteger(a.position) || a.position < 0)) {
      return { ok: false, error: 'position doit être un entier ≥ 0.' };
    }

    // 3) Validation des entrées de permissions (IDs + noms de perms)
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

    // 4) Accumulateur depuis l'état courant
    type Accum = { id: string; allow: bigint; deny: bigint };
    const accs = new Map<string, Accum>();
    for (const po of category.permissionOverwrites.cache.values()) {
      accs.set(po.id, {
        id: po.id,
        allow: po.allow.bitfield,
        deny: po.deny.bitfield,
      });
    }

    // 5) Raccourci private
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

    // 6) Overwrites explicites (logique merge/replace/remove dans overwrites.ts)
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

    // 7) Payload de edit()
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
    if (overwritePayload !== undefined) editPayload.permissionOverwrites = overwritePayload;

    const hasEditWork = Object.keys(editPayload).length > 0;

    if (!hasEditWork && a.sync_children !== true) {
      return {
        ok: true,
        summary: `Aucune modification appliquée sur "${category.name}"`,
        display: `Rien à changer sur la catégorie **${category.name}** (aucun paramètre fourni n'a produit d'action).`,
        data: { id: category.id },
      };
    }

    // 8) Edit de la catégorie
    try {
      if (hasEditWork) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await category.edit(editPayload as any);
      }
    } catch (err) {
      return { ok: false, error: `Échec de la modification de la catégorie: ${String(err)}` };
    }

    // 9) Propagation aux enfants
    let syncedCount = 0;
    let totalChildren = 0;
    const failedChildren: string[] = [];
    if (a.sync_children === true) {
      const children = Array.from(category.children.cache.values()) as GuildChannel[];
      totalChildren = children.length;
      for (const child of children) {
        try {
          await child.lockPermissions();
          syncedCount++;
        } catch (err) {
          failedChildren.push(`#${child.name} (${String(err)})`);
        }
      }
    }

    // 10) Display
    const changes: string[] = [];
    if (a.name !== undefined) changes.push(`renommée en \`${a.name}\``);
    if (a.position !== undefined) changes.push(`position ${a.position}`);
    if (a.private === true) changes.push('rendue privée (@everyone perd ViewChannel)');
    if (a.private === false) changes.push('@everyone remis en neutre sur ViewChannel');
    if (explicit.length > 0) {
      const nRoles = a.role_permissions?.length ?? 0;
      const nMembers = a.member_permissions?.length ?? 0;
      const bits: string[] = [];
      if (nRoles > 0) bits.push(`${nRoles} rôle${nRoles > 1 ? 's' : ''}`);
      if (nMembers > 0) bits.push(`${nMembers} membre${nMembers > 1 ? 's' : ''}`);
      changes.push(`overwrites édités (${bits.join(', ')})`);
    }

    let syncLine = '';
    if (a.sync_children === true) {
      if (totalChildren === 0) {
        syncLine = `\n-# Propagation demandée mais la catégorie n'a aucun salon enfant.`;
      } else if (failedChildren.length === 0) {
        syncLine = `\n-# ${syncedCount} salon${syncedCount > 1 ? 's' : ''} enfant${syncedCount > 1 ? 's' : ''} synchronisé${syncedCount > 1 ? 's' : ''} avec la catégorie.`;
      } else {
        syncLine = `\n-# ${syncedCount}/${totalChildren} salons enfants synchronisés. Échecs: ${failedChildren.join(', ')}.`;
      }
    }

    const head = changes.length > 0
      ? `Catégorie **${category.name}** mise à jour: ${changes.join(' · ')}.`
      : `Catégorie **${category.name}** : aucune modif d'attributs (sync uniquement).`;

    return {
      ok: true,
      summary: `Catégorie "${category.name}" modifiée`,
      display: `${head}${syncLine}`,
      data: {
        id: category.id,
        changes: changes.length,
        synced: syncedCount,
        total_children: totalChildren,
        failures: failedChildren.length,
      },
    };
  },
};
