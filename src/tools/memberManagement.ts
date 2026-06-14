import { ChannelType, PermissionFlagsBits, type VoiceBasedChannel } from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';
import { memberModerationError } from './hierarchy.js';

export const setNicknameTool: ToolDefinition = {
  name: 'set_nickname',
  description:
    "Change (ou retire) le pseudo de serveur d'un membre. member_id vient de la @mention du membre. nickname null ou vide retire le pseudo (retour au nom d'utilisateur). Action directe (reversible).",
  parameters: {
    type: 'object',
    properties: {
      member_id: { type: 'string', description: 'ID du membre (issu du <@ID> de la mention).' },
      nickname: {
        type: ['string', 'null'],
        description: 'Nouveau pseudo (max 32 caracteres). null ou chaine vide = retire le pseudo.',
      },
    },
    required: ['member_id'],
  },
  requiredPermission: PermissionFlagsBits.ManageNicknames,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as { member_id: string; nickname?: string | null };
    if (!a.member_id || typeof a.member_id !== 'string') {
      return { ok: false, error: 'member_id (string) requis. Il vient de la @mention du membre.' };
    }
    if (a.nickname != null && a.nickname.length > 32) {
      return { ok: false, error: 'Un pseudo Discord fait au maximum 32 caracteres.' };
    }
    const target = await ctx.guild.members.fetch(a.member_id).catch(() => null);
    if (!target) return { ok: false, error: `Membre ID "${a.member_id}" introuvable sur le serveur.` };

    const hierErr = memberModerationError(ctx.guild, target, 'renommer');
    if (hierErr) return { ok: false, error: hierErr };

    const nick = a.nickname && a.nickname.trim() !== '' ? a.nickname : null;
    try {
      await target.setNickname(nick, `A.E.G.I.S: pseudo modifie par ${ctx.owner.tag}`);
      return {
        ok: true,
        summary: nick ? `Pseudo de ${target.user.tag} change` : `Pseudo de ${target.user.tag} retire`,
        display: nick
          ? `Pseudo de <@${target.id}> change en **${nick}**.`
          : `Pseudo de <@${target.id}> retire.`,
        data: { member_id: target.id, nickname: nick },
      };
    } catch (err) {
      return { ok: false, error: `Echec du changement de pseudo: ${String(err)}` };
    }
  },
};

export const moveMemberTool: ToolDefinition = {
  name: 'move_member',
  description:
    "Deplace un membre vers un autre salon vocal, ou le deconnecte du vocal. Le membre doit deja etre connecte a un vocal. channel_id null = deconnexion. Action directe.",
  parameters: {
    type: 'object',
    properties: {
      member_id: { type: 'string', description: 'ID du membre (issu du <@ID>).' },
      channel_id: {
        type: ['string', 'null'],
        description: 'ID du salon vocal de destination. null = deconnecte le membre du vocal.',
      },
    },
    required: ['member_id'],
  },
  requiredPermission: PermissionFlagsBits.MoveMembers,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as { member_id: string; channel_id?: string | null };
    if (!a.member_id || typeof a.member_id !== 'string') {
      return { ok: false, error: 'member_id (string) requis. Il vient de la @mention du membre.' };
    }
    const target = await ctx.guild.members.fetch(a.member_id).catch(() => null);
    if (!target) return { ok: false, error: `Membre ID "${a.member_id}" introuvable sur le serveur.` };

    if (!target.voice.channel) {
      return { ok: false, error: `${target.user.tag} n'est connecte a aucun salon vocal.` };
    }

    const hierErr = memberModerationError(ctx.guild, target, 'deplacer');
    if (hierErr) return { ok: false, error: hierErr };

    let destination: VoiceBasedChannel | null = null;
    if (a.channel_id != null) {
      const raw = ctx.guild.channels.cache.get(a.channel_id);
      if (!raw || (raw.type !== ChannelType.GuildVoice && raw.type !== ChannelType.GuildStageVoice)) {
        return { ok: false, error: `Salon vocal ID "${a.channel_id}" introuvable ou n'est pas un vocal.` };
      }
      destination = raw as VoiceBasedChannel;
    }

    try {
      await target.voice.setChannel(destination, `A.E.G.I.S: deplacement par ${ctx.owner.tag}`);
      return {
        ok: true,
        summary: destination ? `${target.user.tag} deplace` : `${target.user.tag} deconnecte du vocal`,
        display: destination
          ? `<@${target.id}> deplace dans <#${destination.id}>.`
          : `<@${target.id}> deconnecte du vocal.`,
        data: { member_id: target.id, channel_id: destination?.id ?? null },
      };
    } catch (err) {
      return { ok: false, error: `Echec du deplacement: ${String(err)}` };
    }
  },
};
