import { GatewayIntentBits } from 'discord.js';

/**
 * All gateway intents enabled.
 * Note: privileged intents (GuildMembers, GuildPresences, MessageContent)
 * must ALSO be enabled in the Discord Developer Portal for the bot application.
 */
export const ALL_INTENTS: number[] = Object.values(GatewayIntentBits).filter(
  (value): value is number => typeof value === 'number',
);
