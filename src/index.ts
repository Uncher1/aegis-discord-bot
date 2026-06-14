import { Events } from 'discord.js';
import { config } from './config.js';
import { logger } from './logger.js';
import { createDiscordClient } from './discord/client.js';
import { resolveBotOwner } from './bot/owner.js';
import { bindToOwnerGuild } from './bot/guildBinding.js';
import { setBotState, tryGetBotState } from './bot/state.js';
import { analyzeOwnerMessage } from './llm/intent.js';
import { runAgent } from './llm/agent.js';
import { renderDiscordMentions } from './discord/mentionRenderer.js';
import { looksLikeBotAddress, addressConfidence, isAffirmation, isNegation } from './bot/prefilter.js';
import { replyChunked } from './discord/sendChunked.js';
import { hasPending, takePendingBatch, pendingDescriptions, clearPending } from './bot/pendingAction.js';
import { botHasPermission } from './tools/permissions.js';
import type { ToolResult } from './tools/types.js';
import { recordAudit } from './bot/audit.js';

async function main(): Promise<void> {
  const client = createDiscordClient();

  client.once(Events.ClientReady, async (ready) => {
    logger.info('Connected to Discord', { tag: ready.user.tag, id: ready.user.id });

    try {
      const owner = await resolveBotOwner(client);
      const guild = await bindToOwnerGuild(client, owner);

      if (!guild) {
        logger.warn('No guild with owner present - bot is idle until invited to one');
        return;
      }

      setBotState({ owner, guild });
      logger.info('A.E.G.I.S ready', { owner: owner.tag, guild: guild.name });
    } catch (err) {
      logger.error('Startup failed', { err: String(err) });
    }
  });

  client.on(Events.GuildCreate, async (guild) => {
    const state = tryGetBotState();
    if (!state) {
      logger.info('Joined guild before state initialized - will be re-evaluated at startup', { id: guild.id });
      return;
    }
    if (guild.id === state.guild.id) return;
    logger.info('Leaving newly-joined guild (bot is already bound)', { guild: guild.name, id: guild.id });
    await guild.leave().catch((err) => logger.error('Failed to leave guild', { id: guild.id, err: String(err) }));
  });

  // Per-owner serialization: the owner id maps to the tail of their in-flight
  // message-processing chain, so their messages are handled strictly one at a
  // time, in arrival order.
  const ownerLocks = new Map<string, Promise<void>>();

  client.on(Events.MessageCreate, async (message) => {
    const state = tryGetBotState();
    if (!state) return;
    if (message.author.bot) return;
    if (message.guild === null) return;
    if (message.guild.id !== state.guild.id) return;
    if (message.author.id !== state.owner.id) return;
    if (!message.content || message.content.trim() === '') return;

    // Chain this message after the owner's previous one. The body below runs
    // only once the prior message finished, so runAgent is never concurrent for
    // the same owner (which could merge unrelated destructive actions).
    const ownerId = state.owner.id;
    const run = (ownerLocks.get(ownerId) ?? Promise.resolve()).then(async () => {
    const botMentioned = message.mentions.users.has(message.client.user.id);

    // Pending irreversible actions waiting for confirmation. Handle yes/no
    // deterministically, with no LLM call. A single "oui" runs the whole batch.
    if (hasPending(state.owner.id)) {
      if (isAffirmation(message.content)) {
        const actions = takePendingBatch(state.owner.id);
        if (actions.length === 0) {
          logger.info('Pending batch expired before confirmation');
          await replyChunked(message, 'La demande a expiré (trop de temps écoulé). Reformule-la si tu veux toujours la faire.');
          return;
        }
        logger.info('Confirmed pending batch', { count: actions.length });
        const lines: string[] = [];
        for (const action of actions) {
          if (action.requiredPermission !== null && !botHasPermission(state.guild, action.requiredPermission)) {
            recordAudit({ owner: state.owner.tag, action: action.toolName, target: action.description, ok: false, detail: 'bot sans permission' });
            lines.push(`Je n'ai pas la permission Discord requise pour: ${action.description}`);
            continue;
          }
          let result: ToolResult;
          try {
            result = await action.run();
          } catch (err) {
            // Defensive: a tool should return ok:false, but never let a throw
            // abort the rest of a confirmed batch.
            logger.error('Pending action threw', { description: action.description, err: String(err) });
            result = { ok: false, error: `Exception: ${String(err)}` };
          }
          recordAudit({
            owner: state.owner.tag,
            action: action.toolName,
            target: action.description,
            ok: result.ok,
            detail: result.ok ? result.summary : result.error,
          });
          lines.push(result.ok ? (result.display ?? result.summary) : `Échec: ${result.error}`);
        }
        const text = lines.length > 0 ? lines.join('\n') : 'Rien à confirmer.';
        await replyChunked(message, renderDiscordMentions(text, state.guild));
        return;
      }
      if (isNegation(message.content)) {
        clearPending(state.owner.id);
        logger.info('Pending batch cancelled by owner');
        await replyChunked(message, 'Annulé, je ne touche à rien.');
        return;
      }
      // Neither yes nor no. A fresh command supersedes the pending batch;
      // anything else leaves the batch intact and is ignored, so an irreversible
      // action is never silently lost just because the owner said something else.
      if (!looksLikeBotAddress(message.content, botMentioned)) {
        logger.debug('Unrelated message while awaiting confirmation, keeping pending batch');
        return;
      }
      clearPending(state.owner.id);
      logger.info('New command supersedes pending batch');
    }

    // Cheap, silent gate: no LLM call and no visible signal for casual chatter.
    const confidence = addressConfidence(message.content, botMentioned);
    if (confidence === 'none') {
      logger.debug('Prefilter: message not addressed to bot, ignoring silently');
      return;
    }

    const channelName =
      'name' in message.channel && typeof message.channel.name === 'string'
        ? message.channel.name
        : 'unknown';

    logger.debug('Owner message received', {
      channel: channelName,
      preview: message.content.slice(0, 80),
      confidence,
    });

    // Weak signal (just the name or an admin noun): spend one cheap intent call
    // to avoid replying to casual chatter. Strong signal (action verb or
    // @mention): skip it and go straight to the agent, saving an API request.
    if (confidence === 'weak') {
      const intent = await analyzeOwnerMessage(
        message,
        state.owner,
        state.guild,
        channelName,
      );
      if (intent.type === 'ignore') {
        logger.debug('Intent gate: ignore');
        return;
      }
    }

    logger.info('Invoking agent', { confidence });

    if (message.channel.isTextBased() && 'sendTyping' in message.channel) {
      message.channel.sendTyping().catch(() => {});
    }

    let finalText: string;
    try {
      finalText = await runAgent(message, state.owner, state.guild);
    } catch (err) {
      logger.error('Agent failed', { err: String(err) });
      finalText = 'Désolé, une erreur est survenue lors du traitement de ta demande.';
    }

    // If the agent queued irreversible actions, append one consolidated
    // confirmation prompt listing the whole batch (confirmed by a single "oui").
    let outText = finalText;
    const pending = pendingDescriptions(state.owner.id);
    if (pending.length > 0) {
      const list = pending.map((d, i) => `${i + 1}. ${d}`).join('\n');
      const header =
        pending.length === 1
          ? '**Confirmation requise** (action irréversible) :'
          : `**Confirmation requise** (${pending.length} actions irréversibles) :`;
      const ask =
        pending.length === 1
          ? 'Réponds **oui** pour valider, **non** pour annuler.'
          : 'Réponds **oui** pour tout valider, **non** pour tout annuler.';
      const block = `${header}\n${list}\n\n${ask}`;
      outText = finalText && finalText.trim().length > 0 ? `${finalText}\n\n${block}` : block;
    }

    // Discord rejects empty messages: fall back to a minimal acknowledgement.
    if (!outText || outText.trim() === '') outText = 'Ok.';

    const rendered = renderDiscordMentions(outText, state.guild);
    logger.info('Responding to owner', { preview: rendered.slice(0, 80), pending: pending.length });
    await replyChunked(message, rendered);
    });
    // The stored tail swallows errors so a failure never breaks the next
    // message's chain; the await is also guarded so the handler never rejects.
    ownerLocks.set(ownerId, run.catch(() => {}));
    await run.catch((err) => logger.error('Message handling failed', { err: String(err) }));
  });

  await client.login(config.discordToken);
}

main().catch((err) => {
  logger.error('Fatal error', { err: String(err) });
  process.exit(1);
});
