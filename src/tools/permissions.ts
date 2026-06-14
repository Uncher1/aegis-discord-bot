import type { Guild, PermissionResolvable } from 'discord.js';

/**
 * A.E.G.I.S acts on its OWN Discord permissions, not the bot owner's. The owner
 * is trusted (assumed to be the server owner), so the bot never gates actions
 * on what the owner could do by hand. This only checks that the BOT itself
 * holds the permission an action needs, so we can surface a friendly message
 * instead of a raw Discord 403 when the bot is under-permissioned.
 */
export function botHasPermission(guild: Guild, permission: PermissionResolvable): boolean {
  const me = guild.members.me;
  if (!me) return false;
  return me.permissions.has(permission);
}
