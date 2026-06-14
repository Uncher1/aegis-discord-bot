import { PermissionFlagsBits, type Role } from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';
import { parsePermissionNames } from './permNames.js';
import { parseColor } from './colorParse.js';
import { roleManageError } from './hierarchy.js';

interface Args {
  role_id: string;
  name?: string;
  color?: string | null;
  hoist?: boolean;
  mentionable?: boolean;
  permissions?: string[];
  add_permissions?: string[];
  remove_permissions?: string[];
  position?: number;
}

export const modifyRoleTool: ToolDefinition = {
  name: 'modify_role',
  description:
    "Modifie un role existant. Ne passe que ce qui change. Couvre nom, couleur, hoist, mentionable, et les permissions globales du serveur. Pour les permissions: 'permissions' REMPLACE l'ensemble exact; sinon 'add_permissions' et 'remove_permissions' ajustent a partir de l'etat actuel.",
  parameters: {
    type: 'object',
    properties: {
      role_id: { type: 'string', description: 'ID du role a modifier.' },
      name: { type: 'string', description: 'Nouveau nom.' },
      color: {
        type: ['string', 'null'],
        description: 'Hex (#5865F2) ou nom simple (rouge, bleu...). null = retire la couleur (gris par defaut).',
      },
      hoist: { type: 'boolean', description: 'Afficher les membres separement.' },
      mentionable: { type: 'boolean', description: 'Role mentionnable par tous.' },
      permissions: {
        type: 'array',
        items: { type: 'string' },
        description: "Remplace l'ensemble EXACT des permissions globales (noms PermissionFlagsBits). Ignore add/remove si fourni.",
      },
      add_permissions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Permissions globales a ajouter a celles deja presentes.',
      },
      remove_permissions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Permissions globales a retirer de celles presentes.',
      },
      position: {
        type: 'number',
        description:
          "Position du role dans la hierarchie (1 = juste au-dessus de @everyone; plus haut = plus important). Discord plafonne automatiquement sous le role le plus haut du bot.",
      },
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
    if (a.name !== undefined && a.name.trim() === '') {
      return { ok: false, error: 'name doit etre une chaine non vide.' };
    }

    const hierErr = roleManageError(ctx.guild, role);
    if (hierErr) return { ok: false, error: hierErr };

    // Resolve target permission set.
    let newBits = role.permissions.bitfield;
    let permsTouched = false;
    if (a.permissions !== undefined) {
      const p = parsePermissionNames(a.permissions, 'permissions');
      if (!p.ok) return p;
      newBits = p.bits;
      permsTouched = true;
    } else {
      if (a.add_permissions !== undefined) {
        const p = parsePermissionNames(a.add_permissions, 'add_permissions');
        if (!p.ok) return p;
        newBits |= p.bits;
        permsTouched = true;
      }
      if (a.remove_permissions !== undefined) {
        const p = parsePermissionNames(a.remove_permissions, 'remove_permissions');
        if (!p.ok) return p;
        newBits &= ~p.bits;
        permsTouched = true;
      }
    }

    let colorValue: number | null | undefined;
    if (a.color !== undefined) {
      if (a.color === null) {
        colorValue = 0;
      } else {
        const c = parseColor(a.color);
        if (!c.ok) return c;
        colorValue = c.value;
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const editPayload: Record<string, any> = {
      reason: `A.E.G.I.S: modification demandee par ${ctx.owner.tag}`,
    };
    if (a.name !== undefined) editPayload.name = a.name;
    if (colorValue !== undefined) editPayload.color = colorValue;
    if (a.hoist !== undefined) editPayload.hoist = a.hoist;
    if (a.mentionable !== undefined) editPayload.mentionable = a.mentionable;
    if (permsTouched) editPayload.permissions = newBits;
    if (a.position !== undefined) {
      if (!Number.isInteger(a.position) || a.position < 1) {
        return { ok: false, error: 'position doit etre un entier >= 1 (@everyone occupe la position 0).' };
      }
      editPayload.position = a.position;
    }

    const meaningfulKeys = Object.keys(editPayload).filter((k) => k !== 'reason');
    if (meaningfulKeys.length === 0) {
      return {
        ok: true,
        summary: `Aucune modification sur "${role.name}"`,
        display: `Rien a changer sur <@&${role.id}>.`,
        data: { id: role.id },
      };
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await role.edit(editPayload as any);
    } catch (err) {
      return { ok: false, error: `Echec de la modification du role: ${String(err)}` };
    }

    const changes: string[] = [];
    if (a.name !== undefined) changes.push(`renomme en \`${a.name}\``);
    if (colorValue !== undefined) changes.push(a.color === null ? 'couleur retiree' : `couleur ${role.hexColor}`);
    if (a.hoist !== undefined) changes.push(a.hoist ? 'affiche separement' : 'plus affiche separement');
    if (a.mentionable !== undefined) changes.push(a.mentionable ? 'mentionnable' : 'non mentionnable');
    if (permsTouched) changes.push('permissions ajustees');
    if (a.position !== undefined) changes.push(`position ${a.position}`);

    return {
      ok: true,
      summary: `Role "${role.name}" modifie`,
      display: `<@&${role.id}> mis a jour: ${changes.join(' · ')}.`,
      data: { id: role.id, changes: changes.length },
    };
  },
};
