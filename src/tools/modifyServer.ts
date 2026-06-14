import {
  ChannelType,
  GuildExplicitContentFilter,
  GuildVerificationLevel,
  PermissionFlagsBits,
} from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';

interface Args {
  name?: string;
  afk_channel_id?: string | null;
  afk_timeout?: number;
  verification_level?: 'none' | 'low' | 'medium' | 'high' | 'very_high';
  system_channel_id?: string | null;
  explicit_content_filter?: 'disabled' | 'no_roles' | 'all';
}

const VERIF: Record<string, GuildVerificationLevel> = {
  none: GuildVerificationLevel.None,
  low: GuildVerificationLevel.Low,
  medium: GuildVerificationLevel.Medium,
  high: GuildVerificationLevel.High,
  very_high: GuildVerificationLevel.VeryHigh,
};

const FILTER: Record<string, GuildExplicitContentFilter> = {
  disabled: GuildExplicitContentFilter.Disabled,
  no_roles: GuildExplicitContentFilter.MembersWithoutRoles,
  all: GuildExplicitContentFilter.AllMembers,
};

const VALID_AFK_TIMEOUTS = new Set([60, 300, 900, 1800, 3600]);

export const modifyServerTool: ToolDefinition = {
  name: 'modify_server',
  description:
    "Modifie les parametres generaux du serveur. Ne passe que ce qui change. Couvre le nom, le salon vocal AFK et son delai, le niveau de verification, le salon systeme (messages de bienvenue) et le filtre de contenu explicite. Action directe.",
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'Nouveau nom du serveur.' },
      afk_channel_id: {
        type: ['string', 'null'],
        description: 'ID du salon vocal AFK. null = aucun salon AFK.',
      },
      afk_timeout: {
        type: 'number',
        description: 'Delai avant de basculer en AFK, en secondes. Valeurs valides: 60, 300, 900, 1800, 3600.',
      },
      verification_level: {
        type: 'string',
        enum: ['none', 'low', 'medium', 'high', 'very_high'],
        description: 'Niveau de verification requis pour les membres.',
      },
      system_channel_id: {
        type: ['string', 'null'],
        description: 'ID du salon systeme (arrivees, boosts). null = aucun.',
      },
      explicit_content_filter: {
        type: 'string',
        enum: ['disabled', 'no_roles', 'all'],
        description: 'Filtre de contenu explicite: disabled, no_roles (membres sans role) ou all.',
      },
    },
    required: [],
  },
  requiredPermission: PermissionFlagsBits.ManageGuild,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as Args;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const edit: Record<string, any> = {};
    const changes: string[] = [];

    if (a.name !== undefined) {
      if (typeof a.name !== 'string' || a.name.trim() === '') {
        return { ok: false, error: 'name doit etre une chaine non vide.' };
      }
      edit.name = a.name;
      changes.push(`nom -> \`${a.name}\``);
    }

    if (a.afk_channel_id !== undefined) {
      if (a.afk_channel_id === null) {
        edit.afkChannel = null;
        changes.push('salon AFK retire');
      } else {
        const ch = ctx.guild.channels.cache.get(a.afk_channel_id);
        if (!ch || ch.type !== ChannelType.GuildVoice) {
          return { ok: false, error: `Salon AFK "${a.afk_channel_id}" introuvable ou n'est pas un vocal.` };
        }
        edit.afkChannel = a.afk_channel_id;
        changes.push(`salon AFK -> #${ch.name}`);
      }
    }

    if (a.afk_timeout !== undefined) {
      if (!VALID_AFK_TIMEOUTS.has(a.afk_timeout)) {
        return { ok: false, error: 'afk_timeout doit valoir 60, 300, 900, 1800 ou 3600 secondes.' };
      }
      edit.afkTimeout = a.afk_timeout;
      changes.push(`delai AFK -> ${a.afk_timeout / 60} min`);
    }

    if (a.verification_level !== undefined) {
      const v = VERIF[a.verification_level];
      if (v === undefined) {
        return { ok: false, error: `verification_level invalide: "${a.verification_level}".` };
      }
      edit.verificationLevel = v;
      changes.push(`verification -> ${a.verification_level}`);
    }

    if (a.system_channel_id !== undefined) {
      if (a.system_channel_id === null) {
        edit.systemChannel = null;
        changes.push('salon systeme retire');
      } else {
        const ch = ctx.guild.channels.cache.get(a.system_channel_id);
        if (!ch || ch.type !== ChannelType.GuildText) {
          return { ok: false, error: `Salon systeme "${a.system_channel_id}" introuvable ou n'est pas textuel.` };
        }
        edit.systemChannel = a.system_channel_id;
        changes.push(`salon systeme -> #${ch.name}`);
      }
    }

    if (a.explicit_content_filter !== undefined) {
      const f = FILTER[a.explicit_content_filter];
      if (f === undefined) {
        return { ok: false, error: `explicit_content_filter invalide: "${a.explicit_content_filter}".` };
      }
      edit.explicitContentFilter = f;
      changes.push(`filtre de contenu -> ${a.explicit_content_filter}`);
    }

    if (Object.keys(edit).length === 0) {
      return {
        ok: true,
        summary: 'Aucun parametre serveur a changer',
        display: 'Rien a changer sur le serveur (aucun parametre fourni).',
        data: {},
      };
    }

    try {
      await ctx.guild.edit({ ...edit, reason: `A.E.G.I.S: parametres modifies par ${ctx.owner.tag}` });
      return {
        ok: true,
        summary: `Serveur "${ctx.guild.name}" modifie`,
        display: `Serveur mis a jour: ${changes.join(' · ')}.`,
        data: { changes: changes.length },
      };
    } catch (err) {
      return { ok: false, error: `Echec de la modification du serveur: ${String(err)}` };
    }
  },
};
