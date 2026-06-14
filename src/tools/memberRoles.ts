import { PermissionFlagsBits, type Role } from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';
import { roleManageError } from './hierarchy.js';

interface Args {
  member_id: string;
  role_id: string;
}

async function resolve(
  rawArgs: unknown,
  ctx: { guild: import('discord.js').Guild; owner: import('discord.js').User },
): Promise<
  | { ok: false; error: string }
  | { ok: true; member: import('discord.js').GuildMember; role: Role }
> {
  const a = rawArgs as Args;
  if (!a.member_id || typeof a.member_id !== 'string') {
    return { ok: false, error: 'member_id (string) requis. Il vient de la @mention du membre dans le message.' };
  }
  if (!a.role_id || typeof a.role_id !== 'string') {
    return { ok: false, error: 'role_id (string) requis.' };
  }
  const role = ctx.guild.roles.cache.get(a.role_id) as Role | undefined;
  if (!role) return { ok: false, error: `Role ID "${a.role_id}" introuvable.` };

  const member = await ctx.guild.members.fetch(a.member_id).catch(() => null);
  if (!member) return { ok: false, error: `Membre ID "${a.member_id}" introuvable sur le serveur.` };

  const hierErr = roleManageError(ctx.guild, role);
  if (hierErr) return { ok: false, error: hierErr };

  return { ok: true, member, role };
}

export const assignRoleTool: ToolDefinition = {
  name: 'assign_role',
  description:
    "Attribue un role a un membre. member_id vient de la @mention du membre dans le message; role_id se resout via le Contexte. Le role doit etre sous ton rang et sous le mien dans la hierarchie.",
  parameters: {
    type: 'object',
    properties: {
      member_id: { type: 'string', description: "ID du membre (issu du <@ID> de la mention)." },
      role_id: { type: 'string', description: 'ID du role a attribuer.' },
    },
    required: ['member_id', 'role_id'],
  },
  requiredPermission: PermissionFlagsBits.ManageRoles,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const r = await resolve(rawArgs, ctx);
    if (!r.ok) return r;
    if (r.member.roles.cache.has(r.role.id)) {
      return {
        ok: true,
        summary: `${r.member.user.tag} a deja le role`,
        display: `<@${r.member.id}> a deja le role <@&${r.role.id}>.`,
        data: { member_id: r.member.id, role_id: r.role.id, noop: true },
      };
    }
    try {
      await r.member.roles.add(r.role, `A.E.G.I.S: attribution demandee par ${ctx.owner.tag}`);
      return {
        ok: true,
        summary: `Role "${r.role.name}" attribue a ${r.member.user.tag}`,
        display: `Role <@&${r.role.id}> attribue a <@${r.member.id}>.`,
        data: { member_id: r.member.id, role_id: r.role.id },
      };
    } catch (err) {
      return { ok: false, error: `Echec de l'attribution: ${String(err)}` };
    }
  },
};

export const removeRoleTool: ToolDefinition = {
  name: 'remove_role',
  description:
    "Retire un role a un membre. Memes regles que assign_role. member_id vient de la @mention du membre.",
  parameters: {
    type: 'object',
    properties: {
      member_id: { type: 'string', description: "ID du membre (issu du <@ID> de la mention)." },
      role_id: { type: 'string', description: 'ID du role a retirer.' },
    },
    required: ['member_id', 'role_id'],
  },
  requiredPermission: PermissionFlagsBits.ManageRoles,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const r = await resolve(rawArgs, ctx);
    if (!r.ok) return r;
    if (!r.member.roles.cache.has(r.role.id)) {
      return {
        ok: true,
        summary: `${r.member.user.tag} n'a pas ce role`,
        display: `<@${r.member.id}> n'avait deja pas le role <@&${r.role.id}>.`,
        data: { member_id: r.member.id, role_id: r.role.id, noop: true },
      };
    }
    try {
      await r.member.roles.remove(r.role, `A.E.G.I.S: retrait demande par ${ctx.owner.tag}`);
      return {
        ok: true,
        summary: `Role "${r.role.name}" retire a ${r.member.user.tag}`,
        display: `Role <@&${r.role.id}> retire a <@${r.member.id}>.`,
        data: { member_id: r.member.id, role_id: r.role.id },
      };
    } catch (err) {
      return { ok: false, error: `Echec du retrait: ${String(err)}` };
    }
  },
};
