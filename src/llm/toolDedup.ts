/**
 * Helpers to recognise duplicate tool calls within a single model response.
 * Weaker models sometimes emit the exact same call twice (e.g. creating a
 * channel in duplicate); the agent uses these to skip the redundant one.
 *
 * Kept dependency-free so it can be unit-tested without loading the LLM client
 * or any environment configuration.
 */

/** Order-independent serialization, so two values that differ only by object
 * key order produce the same string. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(',')}}`;
}

/** Dedup key for a tool call: tool name + canonical (order-independent) args. */
export function toolCallKey(name: string, rawArgs: string): string {
  try {
    return `${name}:${stableStringify(JSON.parse(rawArgs))}`;
  } catch {
    return `${name}:${rawArgs}`;
  }
}
