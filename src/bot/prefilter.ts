/**
 * Cheap, LLM-free gate. Runs before any model call so casual owner chatter
 * ("lol", "ok", "bonne soiree") never costs a request and never leaks any
 * visible signal. Only messages that plausibly address the bot go further.
 *
 * A false negative just means the owner rephrases. A false positive only
 * costs one cheap intent call, which still resolves to ignore. So we keep
 * the net generous on the "looks like a command" side.
 */

// Tolerant match of the name "aegis", including common leet spellings.
const NAME_RE = /a[e3]g[i1]s/i;

// Admin ACTION verbs. Their presence is a strong signal that the message is a
// command, so we skip the LLM intent gate and go straight to the agent. Kept
// reasonably precise: a missed verb is harmless (the message falls through to
// the intent gate, never gets dropped).
const VERB_RE =
  /\b(cr[ée]+\w*|supprim\w*|efface\w*|effacer|retir\w*|enl[eè]v\w*|renomm\w*|d[ée]plac\w*|positionn\w*|modifi\w*|chang\w*|ajout\w*|donne\w*|attribu\w*|bloqu\w*|autoris\w*|interdi\w*|d[ée]sactiv\w*|configur\w*|synchron\w*|propag\w*|align\w*|[ée]pingl\w*|kick\w*|expuls\w*|bannir|banni\w*|ban\b|d[ée]bann\w*|exclu\w*|mute\w*|sourdine|timeout|liste?\b)\b/i;

// A channel or role mention in the raw content almost always means an admin
// command about that channel/role.
const MENTION_RE = /<#\d+>|<@&\d+>/;

// Clear casual openers. Only used to drop obvious chatter for free. Start-
// anchored, and checked AFTER the command signals, so "ok supprime #x" still
// counts as a command.
const CHATTER_RE =
  /^\s*(lol+|mdr+|ptdr+|haha+|hihi+|x[dp]+|ah+|oh+|ok+|okay|oui|ouais|ouaip|non|nan|merci\w*|mrc|de rien|salut|coucou|cc|hello|hey|yo|wesh|bonjour|bonsoir|bonne |re |[àa] plus|bye|gg|bravo|nice|cool|sympa|super|g[ée]nial|parfait|excellent|d'?accord|carr[ée]ment|exact|voil[àa]|bref|mouais|bof)/i;

export type AddressConfidence = 'strong' | 'weak' | 'none';

/**
 * Cheap, LLM-free read of whether (and how clearly) a message addresses the bot.
 * 'strong' -> bot @mentioned, a channel/role mention, the bot's name, or an
 *             action verb: skip the intent LLM call and go straight to the agent.
 * 'none'   -> obvious chatter: ignore silently, no API call, no visible signal.
 * 'weak'   -> anything else (the DEFAULT): ambiguous, so let the cheap intent
 *             gate decide. We never silently drop a message that might be a
 *             real command.
 */
export function addressConfidence(content: string, botMentioned: boolean): AddressConfidence {
  if (botMentioned) return 'strong';
  if (MENTION_RE.test(content)) return 'strong';
  const t = content.toLowerCase();
  if (NAME_RE.test(t) || VERB_RE.test(t)) return 'strong';
  if (CHATTER_RE.test(t)) return 'none';
  return 'weak';
}

export function looksLikeBotAddress(content: string, botMentioned: boolean): boolean {
  return addressConfidence(content, botMentioned) !== 'none';
}

const AFFIRM_RE =
  /^\s*(oui|ouais|ouaip|yes|yep|ok|okay|d'?accord|confirme?|confirmer|valide?|valider|vas[-\s]?y|go|c'?est\s*bon|fais[-\s]?le|exact|carr[ée]ment)\b/i;
const NEGATE_RE =
  /^\s*(non|nan|no|nope|annule[r]?|stop|laisse|laisse[-\s]?tomber|abandonne|oublie)\b/i;

/** True when a short reply reads as a clear yes (used to confirm pending actions). */
export function isAffirmation(content: string): boolean {
  return AFFIRM_RE.test(content);
}

/** True when a short reply reads as a clear no (used to cancel pending actions). */
export function isNegation(content: string): boolean {
  return NEGATE_RE.test(content);
}
