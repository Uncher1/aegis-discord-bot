import type { ToolDefinition } from './types.js';

export const listRolesTool: ToolDefinition = {
  name: 'list_roles',
  description: 'Liste tous les rôles du serveur dans l\'ordre hiérarchique (du plus haut au plus bas). Exclut @everyone et les rôles gérés par des bots/intégrations.',
  parameters: { type: 'object', properties: {}, required: [] },
  requiredPermission: null,
  execute: async (_args, ctx) => {
    const roles = Array.from(ctx.guild.roles.cache.values())
      .filter((r) => r.name !== '@everyone')
      .filter((r) => r.tags?.botId === undefined)
      .filter((r) => !r.managed)
      .sort((a, b) => b.position - a.position);

    const lines: string[] = [];
    lines.push(`### Rôles du serveur ${ctx.guild.name} (${roles.length})`);
    lines.push('');

    if (roles.length === 0) {
      lines.push('-# *(aucun rôle personnalisé)*');
    } else {
      for (const r of roles) {
        const memberCount = r.members.size;
        const suffix = memberCount === 0
          ? '-# *(aucun membre)*'
          : `-# ${memberCount} membre${memberCount > 1 ? 's' : ''}`;
        lines.push(`- <@&${r.id}> ${suffix}`);
      }
    }

    return {
      ok: true,
      summary: `${roles.length} rôles listés (bots et @everyone exclus)`,
      display: lines.join('\n'),
      data: roles.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.hexColor,
        position: r.position,
        memberCount: r.members.size,
      })),
    };
  },
};
