import { Client, Partials } from 'discord.js';
import { ALL_INTENTS } from './intents.js';

export function createDiscordClient(): Client {
  return new Client({
    intents: ALL_INTENTS,
    partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember],
  });
}
