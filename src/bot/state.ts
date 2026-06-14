import type { Guild, User } from 'discord.js';

/**
 * Runtime state of the bot - resolved once at startup and used for
 * every subsequent message filter / permission check.
 */
export interface BotState {
  owner: User;
  guild: Guild;
}

let state: BotState | null = null;

export function setBotState(next: BotState): void {
  state = next;
}

export function getBotState(): BotState {
  if (!state) throw new Error('Bot state accessed before initialization');
  return state;
}

export function tryGetBotState(): BotState | null {
  return state;
}
