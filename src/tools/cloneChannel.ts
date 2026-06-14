import { ChannelType, PermissionFlagsBits, type GuildChannel } from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';

const THREAD_TYPES: ReadonlySet<ChannelType> = new Set([
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
]);

export const cloneChannelTool: ToolDefinition = {
  name: 'clone_channel',
  description:
    "Duplique un salon existant (memes permissions, type et reglages) dans la meme categorie. Pratique pour creer un salon identique a un autre. Optionnellement, donne un nom au clone. Action directe.",
  parameters: {
    type: 'object',
    properties: {
      channel_id: { type: 'string', description: 'ID du salon a dupliquer (pas une categorie ni un fil).' },
      name: { type: 'string', description: 'Nom du clone (optionnel). Par defaut, Discord reprend le nom source.' },
    },
    required: ['channel_id'],
  },
  requiredPermission: PermissionFlagsBits.ManageChannels,
  execute: async (rawArgs, ctx): Promise<ToolResult> => {
    const a = rawArgs as { channel_id: string; name?: string };
    if (!a.channel_id || typeof a.channel_id !== 'string') {
      return { ok: false, error: 'channel_id (string) requis.' };
    }
    const raw = ctx.guild.channels.cache.get(a.channel_id);
    if (!raw) return { ok: false, error: `Salon ID "${a.channel_id}" introuvable.` };
    if (raw.type === ChannelType.GuildCategory) {
      return { ok: false, error: 'Une categorie ne se clone pas avec cet outil.' };
    }
    if (THREAD_TYPES.has(raw.type) || !('clone' in raw)) {
      return { ok: false, error: 'Ce type de salon ne peut pas etre clone.' };
    }
    const channel = raw as GuildChannel & { clone: (o?: { name?: string }) => Promise<GuildChannel> };

    try {
      const cloned = await channel.clone(a.name ? { name: a.name } : undefined);
      return {
        ok: true,
        summary: `Salon "${channel.name}" cloné en "${cloned.name}"`,
        display: `Salon <#${cloned.id}> créé en copie de <#${channel.id}>.`,
        data: { id: cloned.id, name: cloned.name, source: channel.id },
      };
    } catch (err) {
      return { ok: false, error: `Echec du clonage: ${String(err)}` };
    }
  },
};
