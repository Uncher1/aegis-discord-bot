import type { Client, User } from 'discord.js';
import { logger } from '../logger.js';

/**
 * Resolves the bot's owner via Discord application info.
 * Handles both single-user and team-owned applications.
 * For team applications, the team owner is returned.
 */
export async function resolveBotOwner(client: Client): Promise<User> {
  const app = await client.application?.fetch();
  if (!app) throw new Error('Could not fetch Discord application info');

  if (app.owner && 'id' in app.owner && !('members' in app.owner)) {
    logger.info('Bot owner resolved (user)', { id: app.owner.id, tag: app.owner.tag });
    return app.owner as User;
  }

  if (app.owner && 'ownerId' in app.owner) {
    const teamOwnerId = (app.owner as { ownerId: string | null }).ownerId;
    if (!teamOwnerId) throw new Error('Team has no owner set');
    const user = await client.users.fetch(teamOwnerId);
    logger.info('Bot owner resolved (team owner)', { id: user.id, tag: user.tag });
    return user;
  }

  throw new Error('Could not determine bot owner from application');
}
