import { ChannelType, PermissionFlagsBits, type GuildChannel } from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';
import { addPending } from '../bot/pendingAction.js';

interface Args {
  channel_id: string;
}

export const deleteChannelTool: ToolDefinition = {
  name: 'delete_channel',
  description:
    "Supprime DEFINITIVEMENT un salon textuel ou vocal. Action irreversible: au lieu d'agir tout de suite, cet outil enregistre la suppression et renvoie une demande de confirmation. Le salon n'est reellement supprime que si le proprietaire confirme par 'oui'. Pour une categorie, utilise delete_category.",
  parameters: {
    type: 'object',
    properties: {
      channel_id: {
        type: 'string',
        description: 'ID du salon a supprimer (salon textuel ou vocal, pas une categorie).',
      },
    },
    required: ['channel_id'],
  },
  requiredPermission: PermissionFlagsBits.ManageChannels,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as Args;
    if (!a.channel_id || typeof a.channel_id !== 'string') {
      return { ok: false, error: 'channel_id (string) requis.' };
    }
    const ch = ctx.guild.channels.cache.get(a.channel_id);
    if (!ch) {
      return { ok: false, error: `Salon ID "${a.channel_id}" introuvable.` };
    }
    if (ch.type === ChannelType.GuildCategory) {
      return {
        ok: false,
        error: `"${ch.name}" est une categorie. Utilise delete_category pour la supprimer.`,
      };
    }
    const target = ch as GuildChannel;
    const name = target.name;

    addPending(ctx.owner.id, {
      toolName: 'delete_channel',
      requiredPermission: PermissionFlagsBits.ManageChannels,
      description: `Supprimer le salon #${name}`,
      run: async (): Promise<ToolResult> => {
        // Re-fetch at execution time: the confirmation may arrive minutes later.
        const fresh = ctx.guild.channels.cache.get(a.channel_id);
        if (!fresh) {
          return { ok: false, error: `Le salon #${name} n'existe plus (deja supprime ?).` };
        }
        try {
          await fresh.delete(`A.E.G.I.S: suppression demandee par ${ctx.owner.tag}`);
          return {
            ok: true,
            summary: `Salon "${name}" supprime`,
            display: `Salon **#${name}** supprime definitivement.`,
            data: { id: a.channel_id, name },
          };
        } catch (err) {
          return { ok: false, error: `Echec de la suppression: ${String(err)}` };
        }
      },
    });

    return {
      ok: true,
      summary: `Suppression de #${name} mise en attente de confirmation`,
      display: '',
      data: { pending: true, target: name },
    };
  },
};
