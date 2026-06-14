import { ChannelType, type GuildChannel } from 'discord.js';
import type { ToolDefinition } from './types.js';

const VOICE_TYPES: ReadonlySet<ChannelType> = new Set([
  ChannelType.GuildVoice,
  ChannelType.GuildStageVoice,
]);

function isVoice(type: ChannelType): boolean {
  return VOICE_TYPES.has(type);
}

export const listChannelsTool: ToolDefinition = {
  name: 'list_channels',
  description: 'Liste tous les salons et catégories du serveur, regroupés par catégorie et triés comme dans Discord.',
  parameters: { type: 'object', properties: {}, required: [] },
  requiredPermission: null,
  execute: async (_args, ctx) => {
    const all = Array.from(ctx.guild.channels.cache.values()) as GuildChannel[];

    const categories = all
      .filter((c) => c.type === ChannelType.GuildCategory)
      .sort((a, b) => a.rawPosition - b.rawPosition);

    const nonCategory = all.filter((c) => c.type !== ChannelType.GuildCategory);

    const sortSiblings = (a: GuildChannel, b: GuildChannel): number => {
      const av = isVoice(a.type);
      const bv = isVoice(b.type);
      if (av !== bv) return av ? 1 : -1;
      return a.rawPosition - b.rawPosition;
    };

    const orphans = nonCategory.filter((c) => !c.parentId).sort(sortSiblings);

    const lines: string[] = [];
    lines.push(`### Salons du serveur ${ctx.guild.name}`);

    if (orphans.length > 0) {
      lines.push('');
      lines.push('**(Sans catégorie)**');
      for (const c of orphans) {
        lines.push(`- <#${c.id}>`);
      }
    }

    for (const cat of categories) {
      const kids = nonCategory.filter((c) => c.parentId === cat.id).sort(sortSiblings);
      lines.push('');
      lines.push(`**${cat.name}**`);
      if (kids.length === 0) {
        lines.push('-# *(aucun salon)*');
      } else {
        for (const c of kids) {
          lines.push(`- <#${c.id}>`);
        }
      }
    }

    return {
      ok: true,
      summary: `${all.length} salons/catégories au total (${categories.length} catégories)`,
      display: lines.join('\n'),
      data: all.map((c) => ({
        id: c.id,
        name: c.name,
        type: c.type,
        parentId: c.parentId,
      })),
    };
  },
};
