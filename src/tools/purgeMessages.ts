import { PermissionFlagsBits, type GuildTextBasedChannel } from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';
import { addPending } from '../bot/pendingAction.js';

interface Args {
  channel_id: string;
  count: number;
  user_id?: string;
}

function asTextChannel(
  guild: import('discord.js').Guild,
  id: string,
): GuildTextBasedChannel | null {
  const ch = guild.channels.cache.get(id);
  if (ch && 'bulkDelete' in ch && typeof (ch as { bulkDelete?: unknown }).bulkDelete === 'function') {
    return ch as GuildTextBasedChannel;
  }
  return null;
}

export const purgeMessagesTool: ToolDefinition = {
  name: 'purge_messages',
  description:
    "Supprime en masse les messages recents d'un salon (jusqu'a 100). Optionnellement, ne supprime que ceux d'un membre precis (user_id, issu de sa @mention). Action destructive: enregistre la demande et attend la confirmation 'oui'. Discord ne peut pas supprimer en masse des messages de plus de 14 jours (ils sont ignores).",
  parameters: {
    type: 'object',
    properties: {
      channel_id: { type: 'string', description: 'ID du salon textuel a nettoyer.' },
      count: {
        type: 'number',
        description: 'Nombre de messages a supprimer (1 a 100). Avec user_id, c\'est le nombre de messages DE CE MEMBRE a retirer parmi les 100 derniers.',
      },
      user_id: {
        type: 'string',
        description: 'Optionnel. Ne supprime que les messages de ce membre (ID issu de sa @mention).',
      },
    },
    required: ['channel_id', 'count'],
  },
  requiredPermission: PermissionFlagsBits.ManageMessages,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as Args;
    if (!a.channel_id || typeof a.channel_id !== 'string') {
      return { ok: false, error: 'channel_id (string) requis.' };
    }
    if (!Number.isInteger(a.count) || a.count < 1 || a.count > 100) {
      return { ok: false, error: 'count doit etre un entier entre 1 et 100.' };
    }
    if (a.user_id !== undefined && (typeof a.user_id !== 'string' || !/^\d{5,}$/.test(a.user_id))) {
      return { ok: false, error: 'user_id doit etre un ID Discord valide (chiffres) si fourni.' };
    }
    const channel = asTextChannel(ctx.guild, a.channel_id);
    if (!channel) {
      return { ok: false, error: `Salon ID "${a.channel_id}" introuvable ou ne supporte pas la purge de messages.` };
    }
    const channelName = 'name' in channel ? channel.name : a.channel_id;

    addPending(ctx.owner.id, {
      toolName: 'purge_messages',
      requiredPermission: PermissionFlagsBits.ManageMessages,
      description: `Purger ${a.count} message(s) dans #${channelName}${a.user_id ? ` de <@${a.user_id}>` : ''}`,
      run: async (): Promise<ToolResult> => {
        const fresh = asTextChannel(ctx.guild, a.channel_id);
        if (!fresh) return { ok: false, error: `Le salon #${channelName} n'existe plus.` };
        try {
          if (a.user_id) {
            const recent = await fresh.messages.fetch({ limit: 100 });
            const mine = Array.from(recent.values())
              .filter((m) => m.author.id === a.user_id)
              .slice(0, a.count);
            if (mine.length === 0) {
              return {
                ok: true,
                summary: 'Aucun message a supprimer',
                display: `Aucun message recent de <@${a.user_id}> trouve dans #${channelName}.`,
                data: { deleted: 0 },
              };
            }
            const deleted = await fresh.bulkDelete(mine, true);
            const tooOld = mine.length - deleted.size;
            const note = tooOld > 0 ? ` (${tooOld} trop ancien(s) pour une suppression de masse)` : '';
            return {
              ok: true,
              summary: `${deleted.size} message(s) de l'utilisateur supprime(s) dans "${channelName}"`,
              display: `${deleted.size} message(s) de <@${a.user_id}> supprime(s) dans <#${a.channel_id}>${note}.`,
              data: { deleted: deleted.size },
            };
          }
          const deleted = await fresh.bulkDelete(a.count, true);
          const skipped = a.count - deleted.size;
          const note = skipped > 0 ? ` (${skipped} ignore(s), trop anciens)` : '';
          return {
            ok: true,
            summary: `${deleted.size} message(s) supprime(s) dans "${channelName}"`,
            display: `${deleted.size} message(s) supprime(s) dans <#${a.channel_id}>${note}.`,
            data: { deleted: deleted.size },
          };
        } catch (err) {
          return { ok: false, error: `Echec de la purge: ${String(err)}` };
        }
      },
    });

    return {
      ok: true,
      summary: `Purge de ${a.count} message(s) dans ${channelName} en attente de confirmation`,
      display: '',
      data: { pending: true, target: channelName },
    };
  },
};
