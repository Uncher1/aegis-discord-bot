import type { Guild } from 'discord.js';

/**
 * Converts plain-text Discord conventions (#channelname, @rolename, @username)
 * into proper Discord mention syntax (<#id>, <@&id>, <@id>) so they render
 * as clickable mentions in the client.
 *
 * Names are resolved against the guild's caches. Unknown names are left as-is.
 * Known Discord keywords (@everyone, @here) are preserved untouched.
 */
export function renderDiscordMentions(text: string, guild: Guild): string {
  let result = text;

  result = result.replace(/#([a-z0-9][a-z0-9\-_]{0,99})/gi, (match, name: string) => {
    const channel = guild.channels.cache.find(
      (c) =>
        'name' in c &&
        typeof c.name === 'string' &&
        c.name.toLowerCase() === name.toLowerCase(),
    );
    return channel ? `<#${channel.id}>` : match;
  });

  result = result.replace(
    /(^|[^\w<])@([a-z0-9][a-z0-9\-_\.]{0,99})/gi,
    (match, prefix: string, name: string) => {
      const lower = name.toLowerCase();
      if (lower === 'everyone' || lower === 'here') return match;

      const role = guild.roles.cache.find((r) => r.name.toLowerCase() === lower);
      if (role) return `${prefix}<@&${role.id}>`;

      const member = guild.members.cache.find(
        (m) =>
          m.user.username.toLowerCase() === lower ||
          m.displayName.toLowerCase() === lower,
      );
      if (member) return `${prefix}<@${member.id}>`;

      return match;
    },
  );

  return result;
}
