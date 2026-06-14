import { PermissionFlagsBits } from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';
import { addPending } from '../bot/pendingAction.js';
import { memberModerationError } from './hierarchy.js';

const MAX_TIMEOUT_MINUTES = 28 * 24 * 60; // Discord hard cap: 28 days.

export const listBansTool: ToolDefinition = {
  name: 'list_bans',
  description: 'Liste les utilisateurs bannis du serveur, avec la raison si elle existe. Utile avant un unban_member.',
  parameters: { type: 'object', properties: {}, required: [] },
  requiredPermission: PermissionFlagsBits.BanMembers,
  execute: async (_args, ctx): Promise<ToolResult> => {
    try {
      const bans = await ctx.guild.bans.fetch();
      const lines: string[] = [`### Bannis de ${ctx.guild.name} (${bans.size})`, ''];
      if (bans.size === 0) {
        lines.push('-# *(personne n\'est banni)*');
      } else {
        for (const ban of bans.values()) {
          const reason = ban.reason ? ` - ${ban.reason}` : '';
          lines.push(`- **${ban.user.tag}** (\`${ban.user.id}\`)${reason}`);
        }
      }
      return {
        ok: true,
        summary: `${bans.size} banni(s)`,
        display: lines.join('\n'),
        data: bans.map((b) => ({ id: b.user.id, tag: b.user.tag, reason: b.reason })),
      };
    } catch (err) {
      return { ok: false, error: `Echec de la lecture des bannissements: ${String(err)}` };
    }
  },
};

export const kickMemberTool: ToolDefinition = {
  name: 'kick_member',
  description:
    "Expulse un membre du serveur (il peut revenir avec une invitation). Action sensible: enregistre l'expulsion et renvoie une demande de confirmation; rien ne se passe tant que le proprietaire n'a pas confirme par 'oui'. member_id vient de la @mention dans le message.",
  parameters: {
    type: 'object',
    properties: {
      member_id: { type: 'string', description: 'ID du membre a expulser (issu du <@ID>).' },
      reason: { type: 'string', description: 'Raison (optionnelle), visible dans le journal d\'audit Discord.' },
    },
    required: ['member_id'],
  },
  requiredPermission: PermissionFlagsBits.KickMembers,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as { member_id: string; reason?: string };
    if (!a.member_id || typeof a.member_id !== 'string') {
      return { ok: false, error: 'member_id (string) requis. Il vient de la @mention du membre.' };
    }
    const target = await ctx.guild.members.fetch(a.member_id).catch(() => null);
    if (!target) return { ok: false, error: `Membre ID "${a.member_id}" introuvable sur le serveur.` };

    const modErr = memberModerationError(ctx.guild, target, 'expulser');
    if (modErr) return { ok: false, error: modErr };

    const tag = target.user.tag;
    const reason = a.reason ? `${a.reason} (via A.E.G.I.S, ${ctx.owner.tag})` : `A.E.G.I.S: expulsion demandee par ${ctx.owner.tag}`;

    addPending(ctx.owner.id, {
      toolName: 'kick_member',
      requiredPermission: PermissionFlagsBits.KickMembers,
      description: `Expulser ${tag}`,
      run: async (): Promise<ToolResult> => {
        // Re-fetch and re-check hierarchy at execution time.
        const freshTarget = await ctx.guild.members.fetch(a.member_id).catch(() => null);
        if (!freshTarget) return { ok: false, error: `${tag} n'est plus sur le serveur.` };
        const modErr = memberModerationError(ctx.guild, freshTarget, 'expulser');
        if (modErr) return { ok: false, error: modErr };
        try {
          await freshTarget.kick(reason);
          return {
            ok: true,
            summary: `${tag} expulse`,
            display: `**${tag}** a ete expulse du serveur.`,
            data: { member_id: a.member_id, tag },
          };
        } catch (err) {
          return { ok: false, error: `Echec de l'expulsion: ${String(err)}` };
        }
      },
    });

    return {
      ok: true,
      summary: `Expulsion de ${tag} mise en attente de confirmation`,
      display: '',
      data: { pending: true, target: tag },
    };
  },
};

export const banMemberTool: ToolDefinition = {
  name: 'ban_member',
  description:
    "Bannit un utilisateur du serveur (il ne peut plus revenir tant qu'il n'est pas debanni). Fonctionne meme sur quelqu'un qui a deja quitte. Action grave: enregistre le bannissement et renvoie une demande de confirmation; rien ne se passe sans 'oui' du proprietaire. user_id vient de la @mention (ou d'un ID fourni).",
  parameters: {
    type: 'object',
    properties: {
      user_id: { type: 'string', description: 'ID de l\'utilisateur a bannir (issu du <@ID> ou ID brut).' },
      reason: { type: 'string', description: 'Raison (optionnelle).' },
      delete_message_days: {
        type: 'number',
        description: "Nombre de jours de messages recents de l'utilisateur a supprimer (0 a 7). Defaut 0.",
      },
    },
    required: ['user_id'],
  },
  requiredPermission: PermissionFlagsBits.BanMembers,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as { user_id: string; reason?: string; delete_message_days?: number };
    if (!a.user_id || typeof a.user_id !== 'string') {
      return { ok: false, error: 'user_id (string) requis. Il vient de la @mention.' };
    }
    const days = a.delete_message_days ?? 0;
    if (!Number.isInteger(days) || days < 0 || days > 7) {
      return { ok: false, error: 'delete_message_days doit etre un entier entre 0 et 7.' };
    }

    // Hierarchy check only if the target is still a member.
    const target = await ctx.guild.members.fetch(a.user_id).catch(() => null);
    let label = a.user_id;
    if (target) {
      const modErr = memberModerationError(ctx.guild, target, 'bannir');
      if (modErr) return { ok: false, error: modErr };
      label = target.user.tag;
    }

    const reason = a.reason ? `${a.reason} (via A.E.G.I.S, ${ctx.owner.tag})` : `A.E.G.I.S: bannissement demande par ${ctx.owner.tag}`;

    addPending(ctx.owner.id, {
      toolName: 'ban_member',
      requiredPermission: PermissionFlagsBits.BanMembers,
      description: `Bannir ${label}${days > 0 ? ` (supprime ${days}j de messages)` : ''}`,
      run: async (): Promise<ToolResult> => {
        // If still a member, re-check hierarchy at execution time.
        const freshTarget = await ctx.guild.members.fetch(a.user_id).catch(() => null);
        if (freshTarget) {
          const modErr = memberModerationError(ctx.guild, freshTarget, 'bannir');
          if (modErr) return { ok: false, error: modErr };
        }
        try {
          await ctx.guild.bans.create(a.user_id, {
            reason,
            deleteMessageSeconds: days * 24 * 60 * 60,
          });
          return {
            ok: true,
            summary: `${label} banni`,
            display: `**${label}** a ete banni du serveur.`,
            data: { user_id: a.user_id, label },
          };
        } catch (err) {
          return { ok: false, error: `Echec du bannissement: ${String(err)}` };
        }
      },
    });

    return {
      ok: true,
      summary: `Bannissement de ${label} mis en attente de confirmation`,
      display: '',
      data: { pending: true, target: label },
    };
  },
};

export const unbanMemberTool: ToolDefinition = {
  name: 'unban_member',
  description: "Leve le bannissement d'un utilisateur (il pourra revenir avec une invitation). Action directe.",
  parameters: {
    type: 'object',
    properties: {
      user_id: { type: 'string', description: "ID de l'utilisateur a debannir." },
      reason: { type: 'string', description: 'Raison (optionnelle).' },
    },
    required: ['user_id'],
  },
  requiredPermission: PermissionFlagsBits.BanMembers,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as { user_id: string; reason?: string };
    if (!a.user_id || typeof a.user_id !== 'string') {
      return { ok: false, error: 'user_id (string) requis.' };
    }
    const ban = await ctx.guild.bans.fetch(a.user_id).catch(() => null);
    if (!ban) {
      return { ok: false, error: `Aucun bannissement trouve pour l'ID "${a.user_id}".` };
    }
    try {
      await ctx.guild.bans.remove(a.user_id, a.reason ?? `A.E.G.I.S: deban demande par ${ctx.owner.tag}`);
      const label = ban.user?.tag ?? a.user_id;
      return {
        ok: true,
        summary: `${label} debanni`,
        display: `Bannissement de **${label}** leve.`,
        data: { user_id: a.user_id },
      };
    } catch (err) {
      return { ok: false, error: `Echec du deban: ${String(err)}` };
    }
  },
};

export const timeoutMemberTool: ToolDefinition = {
  name: 'timeout_member',
  description:
    "Met un membre en exclusion temporaire (timeout): il ne peut plus parler ni rejoindre les vocaux pendant la duree donnee. Reversible, donc action directe (pas de confirmation). duration_minutes=0 retire l'exclusion en cours. Max 28 jours (40320 minutes).",
  parameters: {
    type: 'object',
    properties: {
      member_id: { type: 'string', description: 'ID du membre (issu du <@ID>).' },
      duration_minutes: {
        type: 'number',
        description: "Duree de l'exclusion en minutes (1 a 40320). 0 = retire l'exclusion en cours.",
      },
      reason: { type: 'string', description: 'Raison (optionnelle).' },
    },
    required: ['member_id', 'duration_minutes'],
  },
  requiredPermission: PermissionFlagsBits.ModerateMembers,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as { member_id: string; duration_minutes: number; reason?: string };
    if (!a.member_id || typeof a.member_id !== 'string') {
      return { ok: false, error: 'member_id (string) requis. Il vient de la @mention.' };
    }
    if (typeof a.duration_minutes !== 'number' || !Number.isFinite(a.duration_minutes) || a.duration_minutes < 0) {
      return { ok: false, error: 'duration_minutes doit etre un nombre >= 0 (0 retire le timeout).' };
    }
    if (a.duration_minutes > MAX_TIMEOUT_MINUTES) {
      return { ok: false, error: `duration_minutes ne peut pas depasser ${MAX_TIMEOUT_MINUTES} (28 jours).` };
    }

    const target = await ctx.guild.members.fetch(a.member_id).catch(() => null);
    if (!target) return { ok: false, error: `Membre ID "${a.member_id}" introuvable sur le serveur.` };

    const modErr = memberModerationError(ctx.guild, target, 'exclure');
    if (modErr) return { ok: false, error: modErr };

    const tag = target.user.tag;
    const reason = a.reason ? `${a.reason} (via A.E.G.I.S, ${ctx.owner.tag})` : `A.E.G.I.S: timeout demande par ${ctx.owner.tag}`;

    try {
      if (a.duration_minutes === 0) {
        await target.timeout(null, reason);
        return {
          ok: true,
          summary: `Timeout retire pour ${tag}`,
          display: `Exclusion temporaire de **${tag}** levee.`,
          data: { member_id: a.member_id, tag },
        };
      }
      await target.timeout(a.duration_minutes * 60 * 1000, reason);
      const h = Math.floor(a.duration_minutes / 60);
      const m = a.duration_minutes % 60;
      const dur = h > 0 ? `${h}h${m > 0 ? String(m).padStart(2, '0') : ''}` : `${m} min`;
      return {
        ok: true,
        summary: `${tag} en timeout ${dur}`,
        display: `**${tag}** est en exclusion temporaire pour ${dur}.`,
        data: { member_id: a.member_id, tag, minutes: a.duration_minutes },
      };
    } catch (err) {
      return { ok: false, error: `Echec du timeout: ${String(err)}` };
    }
  },
};
