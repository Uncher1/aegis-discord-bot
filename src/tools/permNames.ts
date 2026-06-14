import { PermissionFlagsBits } from 'discord.js';

type PermName = keyof typeof PermissionFlagsBits;

/** Resolves an array of PermissionFlagsBits names into a single bitfield. */
export function parsePermissionNames(
  names: string[] | undefined,
  context: string,
): { ok: true; bits: bigint } | { ok: false; error: string } {
  if (!names || names.length === 0) return { ok: true, bits: 0n };
  let bits = 0n;
  for (const n of names) {
    const flag = PermissionFlagsBits[n as PermName];
    if (flag === undefined) {
      return {
        ok: false,
        error: `Permission inconnue dans ${context}: "${n}". Utilise un nom exact de PermissionFlagsBits (ex: KickMembers, BanMembers, ManageChannels, ManageRoles, ManageMessages, Administrator, ViewChannel, SendMessages, Connect, Speak...).`,
      };
    }
    bits |= flag;
  }
  return { ok: true, bits };
}

/** Lists the PermissionFlagsBits names contained in a bitfield (for messages). */
export function permissionNamesOf(bits: bigint): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(PermissionFlagsBits)) {
    if ((bits & (value as bigint)) === (value as bigint)) out.push(name);
  }
  return out;
}
