import { PermissionFlagsBits } from 'discord.js';

type PermName = keyof typeof PermissionFlagsBits;

export type OverwriteMode = 'merge' | 'replace' | 'remove';

export interface OverwriteBits {
  allow: bigint;
  deny: bigint;
}

/**
 * Resolves permission names into a bitfield, silently skipping unknown names.
 * Callers validate names up front (with parsePermissionNames); by the time this
 * runs the names are known-good, so leniency here is safe and convenient.
 */
export function bitsOf(names: string[] | undefined): bigint {
  if (!names) return 0n;
  let b = 0n;
  for (const n of names) {
    const flag = PermissionFlagsBits[n as PermName];
    if (flag !== undefined) b |= flag;
  }
  return b;
}

/**
 * Applies one permission-overwrite edit to the current (allow, deny) bits and
 * returns the new pair, or null when the overwrite should be removed entirely
 * (no allow/deny bits left, or an explicit remove).
 *
 * - merge   (default): adjust only the listed flags. allow wins over deny on
 *   conflict; neutral clears a flag from both (back to inherited).
 * - replace: overwrite with exactly allow/deny; neutral is ignored.
 * - remove:  drop the overwrite entirely.
 */
export function applyOverwriteEdit(
  current: OverwriteBits,
  mode: OverwriteMode,
  allowBits: bigint,
  denyBits: bigint,
  neutralBits: bigint,
): OverwriteBits | null {
  if (mode === 'remove') return null;

  if (mode === 'replace') {
    if (allowBits === 0n && denyBits === 0n) return null;
    return { allow: allowBits, deny: denyBits };
  }

  // merge
  let allow = current.allow;
  let deny = current.deny;
  allow &= ~denyBits;
  deny |= denyBits;
  deny &= ~allowBits;
  allow |= allowBits;
  allow &= ~neutralBits;
  deny &= ~neutralBits;
  if (allow === 0n && deny === 0n) return null;
  return { allow, deny };
}
