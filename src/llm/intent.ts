import type { Guild, Message, User } from 'discord.js';
import { llm, model } from './client.js';
import { buildSystemPrompt } from './systemPrompt.js';
import { logger } from '../logger.js';

export type IntentResult = { type: 'ignore' } | { type: 'respond' };

interface NormalizedContext {
  text: string;
  botMentioned: boolean;
  otherMentions: string[];
}

function normalizeContent(message: Message, botUserId: string): NormalizedContext {
  const botMentioned = message.mentions.users.has(botUserId);
  const otherMentions: string[] = [];

  let text = message.content;

  for (const [id, user] of message.mentions.users) {
    const label = id === botUserId ? '@A.E.G.I.S(toi)' : `@${user.username}(membre)`;
    if (id !== botUserId) otherMentions.push(user.username);
    text = text.replaceAll(`<@${id}>`, label).replaceAll(`<@!${id}>`, label);
  }

  for (const [id, role] of message.mentions.roles) {
    text = text.replaceAll(`<@&${id}>`, `@${role.name}(role)`);
  }

  for (const [id, channel] of message.mentions.channels) {
    const name = 'name' in channel && typeof channel.name === 'string' ? channel.name : id;
    text = text.replaceAll(`<#${id}>`, `#${name}`);
  }

  return { text, botMentioned, otherMentions };
}

export async function analyzeOwnerMessage(
  message: Message,
  owner: User,
  guild: Guild,
  channelName: string,
): Promise<IntentResult> {
  const botUserId = message.client.user.id;
  const { text, botMentioned, otherMentions } = normalizeContent(message, botUserId);

  const systemPrompt = buildSystemPrompt(owner, guild);
  const userPrompt = `Salon: #${channelName}
Auteur: ${owner.tag} (proprietaire)
Mentionne toi-meme: ${botMentioned ? 'OUI' : 'NON'}
Autres membres mentionnes: ${otherMentions.length > 0 ? otherMentions.join(', ') : 'aucun'}

Message: ${text}

Decide si ce message est une demande d'action pour toi. Reponds en JSON.`;

  try {
    const completion = await llm.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      max_tokens: 64,
      // Gemini 2.5 Flash is a thinking model: without this, internal reasoning
      // tokens eat the whole budget and the JSON answer comes back truncated.
      // This is a deterministic yes/no triage, so no reasoning is needed.
      reasoning_effort: 'none',
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    logger.debug('Intent raw response', { raw });

    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'type' in parsed &&
      (parsed as { type: unknown }).type === 'respond'
    ) {
      return { type: 'respond' };
    }
    return { type: 'ignore' };
  } catch (err) {
    logger.error('Intent analysis failed', { err: String(err) });
    return { type: 'ignore' };
  }
}
