import { type Guild, type GuildMember, type Role } from 'discord.js';

/**
 * Discord role hierarchy is a hard constraint: the bot can only manage a role
 * that sits BELOW its own highest role. We mirror only the BOT's limit here (not
 * the owner's), so A.E.G.I.S never attempts something Discord would reject and
 * can explain it cleanly. The owner is trusted and is never gated on their rank.
 *
 * Returns a human-friendly error string, or null when the action is allowed.
 */
export function roleManageError(guild: Guild, role: Role): string | null {
  if (role.id === guild.roles.everyone.id) {
    return 'Le rôle @everyone ne peut pas être géré comme un rôle normal.';
  }
  if (role.managed) {
    return `Le rôle @${role.name} est géré par un bot ou une intégration, il ne se modifie pas à la main.`;
  }
  const me = guild.members.me;
  if (!me) return 'Je ne retrouve pas mes propres infos sur le serveur.';
  if (me.roles.highest.comparePositionTo(role) <= 0) {
    return `Je ne peux pas toucher à @${role.name}: il est au-dessus (ou au même niveau) que mon rôle le plus haut. Remonte mon rôle dans la hiérarchie pour que je puisse agir.`;
  }
  return null;
}

/**
 * Same idea for moderating a member (kick/ban/timeout): the target must sit
 * below the bot in the role hierarchy, and the guild owner is untouchable (a
 * Discord rule). Only the bot's limit is enforced. Returns a friendly error
 * string, or null when allowed.
 */
export function memberModerationError(
  guild: Guild,
  target: GuildMember,
  action: string,
): string | null {
  if (target.id === guild.ownerId) {
    return `Impossible: ${target.user.tag} est le propriétaire du serveur, intouchable.`;
  }
  const me = guild.members.me;
  if (!me) return 'Je ne retrouve pas mes propres infos sur le serveur.';
  if (target.id === me.id) {
    return 'Je ne vais pas me cibler moi-même.';
  }
  if (me.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    return `Je ne peux pas ${action} ${target.user.tag}: son rôle le plus haut est au-dessus (ou égal) au mien.`;
  }
  return null;
}
