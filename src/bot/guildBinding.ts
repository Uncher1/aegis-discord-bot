import type { Client, Guild, User } from 'discord.js';
import { logger } from '../logger.js';

/**
 * Security model: the bot operates on exactly ONE guild - the first guild it
 * joined where the owner is a member. Any other guild where the owner is
 * present gets left automatically. Guilds without the owner are left too.
 *
 * The "first joined" tiebreaker uses the bot's own joinedAt timestamp.
 */
export async function bindToOwnerGuild(client: Client, owner: User): Promise<Guild | null> {
  const guilds = await client.guilds.fetch();
  const detailed: Guild[] = [];
  for (const [, partial] of guilds) {
    const g = await partial.fetch();
    detailed.push(g);
  }

  const sorted = detailed
    .filter((g) => g.joinedTimestamp != null)
    .sort((a, b) => (a.joinedTimestamp ?? 0) - (b.joinedTimestamp ?? 0));

  let bound: Guild | null = null;

  for (const guild of sorted) {
    const ownerMember = await guild.members.fetch(owner.id).catch(() => null);
    if (!ownerMember) {
      logger.info('Leaving guild (owner not a member)', { guild: guild.name, id: guild.id });
      await guild.leave().catch((err) => logger.error('Failed to leave guild', { id: guild.id, err: String(err) }));
      continue;
    }

    if (!bound) {
      bound = guild;
      logger.info('Bound to guild', { guild: guild.name, id: guild.id, joinedAt: guild.joinedAt?.toISOString() });
    } else {
      logger.info('Leaving additional guild with owner present', { guild: guild.name, id: guild.id });
      await guild.leave().catch((err) => logger.error('Failed to leave guild', { id: guild.id, err: String(err) }));
    }
  }

  return bound;
}
