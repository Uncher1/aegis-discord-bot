import { PermissionFlagsBits, type Role } from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';
import { addPending } from '../bot/pendingAction.js';
import { roleManageError } from './hierarchy.js';

interface Args {
  role_id: string;
}

export const deleteRoleTool: ToolDefinition = {
  name: 'delete_role',
  description:
    "Supprime DEFINITIVEMENT un role. Action irreversible: enregistre la suppression et renvoie une demande de confirmation; le role n'est supprime que si le proprietaire confirme par 'oui'. Les membres perdent le role. @everyone et les roles geres par des bots ne sont pas supprimables.",
  parameters: {
    type: 'object',
    properties: {
      role_id: { type: 'string', description: 'ID du role a supprimer.' },
    },
    required: ['role_id'],
  },
  requiredPermission: PermissionFlagsBits.ManageRoles,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as Args;
    if (!a.role_id || typeof a.role_id !== 'string') {
      return { ok: false, error: 'role_id (string) requis.' };
    }
    const role = ctx.guild.roles.cache.get(a.role_id) as Role | undefined;
    if (!role) return { ok: false, error: `Role ID "${a.role_id}" introuvable.` };

    const hierErr = roleManageError(ctx.guild, role);
    if (hierErr) return { ok: false, error: hierErr };

    const name = role.name;
    const memberCount = role.members.size;

    const who = memberCount > 0 ? ` (${memberCount} membre${memberCount > 1 ? 's' : ''} le perdront)` : '';

    addPending(ctx.owner.id, {
      toolName: 'delete_role',
      requiredPermission: PermissionFlagsBits.ManageRoles,
      description: `Supprimer le role @${name}${who}`,
      run: async (): Promise<ToolResult> => {
        // Re-fetch and re-check hierarchy at execution time.
        const fresh = ctx.guild.roles.cache.get(a.role_id);
        if (!fresh) return { ok: false, error: `Le role @${name} n'existe plus (deja supprime ?).` };
        const hier = roleManageError(ctx.guild, fresh);
        if (hier) return { ok: false, error: hier };
        try {
          await fresh.delete(`A.E.G.I.S: suppression demandee par ${ctx.owner.tag}`);
          return {
            ok: true,
            summary: `Role "${name}" supprime`,
            display: `Role **@${name}** supprime definitivement.`,
            data: { id: a.role_id, name },
          };
        } catch (err) {
          return { ok: false, error: `Echec de la suppression du role: ${String(err)}` };
        }
      },
    });

    return {
      ok: true,
      summary: `Suppression du role @${name} mise en attente de confirmation`,
      display: '',
      data: { pending: true, target: name },
    };
  },
};
