import { PermissionFlagsBits } from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';
import { parsePermissionNames } from './permNames.js';
import { parseColor } from './colorParse.js';

interface Args {
  name: string;
  color?: string;
  hoist?: boolean;
  mentionable?: boolean;
  permissions?: string[];
}

export const createRoleTool: ToolDefinition = {
  name: 'create_role',
  description:
    "Cree un nouveau role sur le serveur. Supporte couleur, affichage separe dans la liste des membres (hoist), possibilite d'etre mentionne, et permissions globales du serveur. Le role est cree tout en bas de la hierarchie par defaut; l'owner peut ensuite demander de le remonter.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nom du role.' },
      color: {
        type: 'string',
        description: "Couleur du role: hex (#5865F2) ou nom simple (rouge, bleu, vert, violet, or...). Omettre = pas de couleur.",
      },
      hoist: {
        type: 'boolean',
        description: 'Si true, les membres de ce role sont affiches separement dans la liste des membres. Defaut false.',
      },
      mentionable: {
        type: 'boolean',
        description: 'Si true, n\'importe qui peut mentionner ce role. Defaut false.',
      },
      permissions: {
        type: 'array',
        items: { type: 'string' },
        description:
          "Permissions GLOBALES du serveur a accorder au role (noms PermissionFlagsBits exacts): Administrator, ManageGuild, ManageRoles, ManageChannels, KickMembers, BanMembers, ModerateMembers, ManageMessages, ManageNicknames, ManageWebhooks, ManageEvents, ViewAuditLog, MentionEveryone, ViewChannel, SendMessages, Connect, Speak, etc. Omettre = aucune permission speciale.",
      },
    },
    required: ['name'],
  },
  requiredPermission: PermissionFlagsBits.ManageRoles,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as Args;
    if (!a.name || typeof a.name !== 'string') {
      return { ok: false, error: 'Parametre "name" (string) requis.' };
    }

    const permParse = parsePermissionNames(a.permissions, 'permissions');
    if (!permParse.ok) return permParse;

    let colorValue: number | undefined;
    if (a.color !== undefined) {
      const c = parseColor(a.color);
      if (!c.ok) return c;
      colorValue = c.value;
    }

    try {
      const role = await ctx.guild.roles.create({
        name: a.name,
        color: colorValue,
        hoist: a.hoist,
        mentionable: a.mentionable,
        permissions: permParse.bits,
        reason: `A.E.G.I.S: creation demandee par ${ctx.owner.tag}`,
      });

      const tags: string[] = [];
      if (a.color !== undefined) tags.push(`couleur ${role.hexColor}`);
      if (a.hoist) tags.push('affiche separement');
      if (a.mentionable) tags.push('mentionnable');
      const nPerms = a.permissions?.length ?? 0;
      if (nPerms > 0) tags.push(`${nPerms} permission${nPerms > 1 ? 's' : ''}`);

      const suffix = tags.length > 0 ? ` (${tags.join(' · ')})` : '';
      return {
        ok: true,
        summary: `Role "${role.name}" cree`,
        display: `Role <@&${role.id}> cree${suffix}.`,
        data: { id: role.id, name: role.name },
      };
    } catch (err) {
      return { ok: false, error: `Echec de la creation du role: ${String(err)}` };
    }
  },
};
