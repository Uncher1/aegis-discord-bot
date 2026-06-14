import type { Message } from 'discord.js';
import { logger } from '../logger.js';

const DISCORD_LIMIT = 2000;

/**
 * Splits text into Discord-sized chunks (max 2000 chars), preferring to break
 * on line boundaries so formatted lists stay readable. A single line longer
 * than the limit is hard-split as a last resort.
 */
export function splitForDiscord(text: string, limit = DISCORD_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let current = '';

  const flush = (): void => {
    if (current.length > 0) {
      chunks.push(current);
      current = '';
    }
  };

  for (const line of text.split('\n')) {
    if (line.length > limit) {
      flush();
      let rest = line;
      while (rest.length > limit) {
        chunks.push(rest.slice(0, limit));
        rest = rest.slice(limit);
      }
      current = rest;
      continue;
    }
    const candidate = current.length > 0 ? `${current}\n${line}` : line;
    if (candidate.length > limit) {
      flush();
      current = line;
    } else {
      current = candidate;
    }
  }
  flush();
  return chunks;
}

/**
 * Replies to the owner, splitting long answers across several messages.
 * The first chunk is a reply (falls back to a plain send if the original
 * message vanished), the rest are follow-up sends in the same channel.
 */
export async function replyChunked(message: Message, text: string): Promise<void> {
  const chunks = splitForDiscord(text);
  const channel = message.channel;
  const canSend = channel.isTextBased() && 'send' in channel;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    try {
      if (i === 0) {
        await message.reply(chunk);
      } else if (canSend) {
        await channel.send(chunk);
      }
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (i === 0 && code === 50035 && canSend) {
        logger.warn('Reply target gone, falling back to channel.send()', { err: String(err) });
        await channel.send(chunk).catch((sendErr) => {
          logger.error('Fallback send failed', { err: String(sendErr) });
        });
      } else {
        logger.error('Failed to send message chunk', { index: i, err: String(err) });
      }
    }
  }
}
