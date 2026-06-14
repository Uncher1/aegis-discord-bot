import type { PermissionResolvable } from 'discord.js';
import type { ToolResult } from '../tools/types.js';

/**
 * One irreversible action waiting for confirmation, captured as a closure so
 * the confirmation handler can run it without going back through the LLM.
 */
export interface PendingAction {
  /** Name of the tool that queued this action, kept for the audit trail. */
  toolName: string;
  description: string;
  requiredPermission: PermissionResolvable | null;
  run: () => Promise<ToolResult>;
}

interface PendingBatch {
  actions: PendingAction[];
  expiresAt: number;
}

// Generous window: the owner may take a while to answer "oui". The batch is
// also dropped as soon as a new command supersedes it (see index.ts), so a
// long TTL here does not mean a stale action lingers dangerously.
const TTL_MS = 600_000;
const store = new Map<string, PendingBatch>();

function liveBatch(ownerId: string): PendingBatch | null {
  const b = store.get(ownerId);
  if (!b) return null;
  if (Date.now() > b.expiresAt) {
    store.delete(ownerId);
    return null;
  }
  return b;
}

/**
 * Queues an action for the owner. Several destructive tool calls in a single
 * request accumulate into one batch, so the owner confirms the whole lot with
 * a single "oui". The expiry is refreshed on each addition.
 */
export function addPending(ownerId: string, action: PendingAction): void {
  const existing = liveBatch(ownerId);
  if (existing) {
    existing.expiresAt = Date.now() + TTL_MS;
    // Never queue the same action twice (e.g. a model re-issuing the same call
    // across iterations); that would run it twice on a single "oui".
    if (existing.actions.some((a) => a.description === action.description)) return;
    existing.actions.push(action);
  } else {
    store.set(ownerId, { actions: [action], expiresAt: Date.now() + TTL_MS });
  }
}

export function hasPending(ownerId: string): boolean {
  return liveBatch(ownerId) !== null;
}

/** Descriptions of the queued actions, in order, for building the confirm prompt. */
export function pendingDescriptions(ownerId: string): string[] {
  const b = liveBatch(ownerId);
  return b ? b.actions.map((a) => a.description) : [];
}

/** Returns and removes the whole queued batch (empty array if none/expired). */
export function takePendingBatch(ownerId: string): PendingAction[] {
  const b = liveBatch(ownerId);
  store.delete(ownerId);
  return b ? b.actions : [];
}

export function clearPending(ownerId: string): void {
  store.delete(ownerId);
}
