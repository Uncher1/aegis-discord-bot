import {
  ChannelType,
  GuildVerificationLevel,
  GuildExplicitContentFilter,
} from 'discord.js';
import type { ToolDefinition, ToolResult } from './types.js';

function verifLabel(level: GuildVerificationLevel): string {
  switch (level) {
    case GuildVerificationLevel.None: return 'aucune';
    case GuildVerificationLevel.Low: return 'faible';
    case GuildVerificationLevel.Medium: return 'moyenne';
    case GuildVerificationLevel.High: return 'haute';
    case GuildVerificationLevel.VeryHigh: return 'tres haute';
    default: return 'inconnue';
  }
}

function filterLabel(filter: GuildExplicitContentFilter): string {
  switch (filter) {
    case GuildExplicitContentFilter.Disabled: return 'desactive';
    case GuildExplicitContentFilter.MembersWithoutRoles: return 'membres sans role';
    case GuildExplicitContentFilter.AllMembers: return 'tous les membres';
    default: return 'inconnu';
  }
}

function boostLabel(tier: number): string {
  return tier === 0 ? 'aucun' : `niveau ${tier}`;
}

export const serverInfoTool: ToolDefinition = {
  name: 'server_info',
  description: "Affiche un resume du serveur: nom, proprietaire, membres, boost, nombre de salons/roles/emojis, et les principaux reglages (verification, filtre de contenu, salon AFK, salon systeme). Lecture seule.",
  parameters: { type: 'object', properties: {}, required: [] },
  requiredPermission: null,
  execute: async (_args, ctx): Promise<ToolResult> => {
    const g = ctx.guild;
    const channels = Array.from(g.channels.cache.values());
    const categories = channels.filter((c) => c.type === ChannelType.GuildCategory).length;
    const textChannels = channels.filter((c) => c.type === ChannelType.GuildText).length;
    const voiceChannels = channels.filter((c) => c.type === ChannelType.GuildVoice).length;
    const roles = g.roles.cache.size - 1; // exclude @everyone
    const owner = await g.fetchOwner().catch(() => null);

    const lines = [
      `### ${g.name}`,
      '',
      `- Proprietaire: ${owner ? owner.user.tag : 'inconnu'}`,
      `- Membres: ${g.memberCount}`,
      `- Boost: ${boostLabel(g.premiumTier)} (${g.premiumSubscriptionCount ?? 0} boosts)`,
      `- Salons: ${textChannels} textuels, ${voiceChannels} vocaux, ${categories} categories`,
      `- Roles: ${roles} (hors @everyone) | Emojis: ${g.emojis.cache.size}`,
      `- Verification: ${verifLabel(g.verificationLevel)} | Filtre de contenu: ${filterLabel(g.explicitContentFilter)}`,
      `- Salon AFK: ${g.afkChannelId ? `<#${g.afkChannelId}>` : 'aucun'} | Salon systeme: ${g.systemChannelId ? `<#${g.systemChannelId}>` : 'aucun'}`,
      `- Cree le: ${g.createdAt.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })}`,
    ];

    return {
      ok: true,
      summary: `Infos de ${g.name}`,
      display: lines.join('\n'),
      data: {
        id: g.id,
        name: g.name,
        members: g.memberCount,
        boostTier: g.premiumTier,
        roles,
        emojis: g.emojis.cache.size,
      },
    };
  },
};
