import { resolveColor, type ColorResolvable } from 'discord.js';

const NAMED: Record<string, string> = {
  rouge: '#ED4245',
  vert: '#57F287',
  bleu: '#3498DB',
  jaune: '#FEE75C',
  orange: '#E67E22',
  violet: '#9B59B6',
  rose: '#EB459E',
  turquoise: '#1ABC9C',
  cyan: '#1ABC9C',
  magenta: '#E91E63',
  noir: '#23272A',
  blanc: '#FFFFFF',
  gris: '#95A5A6',
  'gris fonce': '#607D8B',
  blurple: '#5865F2',
  or: '#F1C40F',
  dore: '#F1C40F',
};

/**
 * Accepts a hex string (with or without #), or a small set of plain color names
 * in French, and returns the resolved integer Discord expects. Returns an error
 * for anything it cannot make sense of.
 */
export function parseColor(input: string): { ok: true; value: number } | { ok: false; error: string } {
  const raw = input.trim().toLowerCase();
  let candidate = NAMED[raw] ?? input.trim();
  if (/^[0-9a-f]{6}$/i.test(candidate)) candidate = `#${candidate}`;
  try {
    return { ok: true, value: resolveColor(candidate as ColorResolvable) };
  } catch {
    return {
      ok: false,
      error: `Couleur invalide: "${input}". Donne un hex (ex: #5865F2) ou un nom simple (rouge, bleu, vert, violet, or...).`,
    };
  }
}
