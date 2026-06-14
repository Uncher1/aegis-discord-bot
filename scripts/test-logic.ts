import {
  addPending,
  hasPending,
  pendingDescriptions,
  takePendingBatch,
  clearPending,
} from '../src/bot/pendingAction.js';
import { looksLikeBotAddress, addressConfidence, isAffirmation, isNegation } from '../src/bot/prefilter.js';
import { parseColor } from '../src/tools/colorParse.js';
import { parsePermissionNames, permissionNamesOf } from '../src/tools/permNames.js';
import { applyOverwriteEdit, bitsOf } from '../src/tools/overwrites.js';
import { splitForDiscord } from '../src/discord/sendChunked.js';
import { toolCallKey, stableStringify } from '../src/llm/toolDedup.js';
import { PermissionFlagsBits } from 'discord.js';
import type { ToolResult } from '../src/tools/types.js';

let passed = 0;
let failed = 0;
function check(label: string, cond: boolean): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log(`  FAIL: ${label}`);
  }
}

const noop = async (): Promise<ToolResult> => ({ ok: true, summary: 'x' });
const mk = (description: string) => ({ toolName: 'test', description, requiredPermission: null, run: noop });

// --- pendingAction: batch accumulation ---
const owner = 'owner1';
clearPending(owner);
check('no pending initially', hasPending(owner) === false);
addPending(owner, mk('Supprimer #a'));
addPending(owner, mk('Supprimer #b'));
addPending(owner, mk('Bannir X'));
check('hasPending true after adds', hasPending(owner) === true);
check('descriptions in order', JSON.stringify(pendingDescriptions(owner)) === JSON.stringify(['Supprimer #a', 'Supprimer #b', 'Bannir X']));
const batch = takePendingBatch(owner);
check('batch length 3', batch.length === 3);
check('hasPending false after take', hasPending(owner) === false);
check('descriptions empty after take', pendingDescriptions(owner).length === 0);
check('second take is empty', takePendingBatch(owner).length === 0);

// --- pendingAction: owner isolation ---
clearPending('o2');
clearPending('o3');
addPending('o2', mk('action o2'));
addPending('o3', mk('action o3'));
check('o2 isolated', JSON.stringify(pendingDescriptions('o2')) === JSON.stringify(['action o2']));
check('o3 isolated', JSON.stringify(pendingDescriptions('o3')) === JSON.stringify(['action o3']));
clearPending('o2');
check('clearPending works', hasPending('o2') === false);
check('o3 untouched by o2 clear', hasPending('o3') === true);
clearPending('o3');

// --- pendingAction: duplicate description is not queued twice ---
clearPending('o4');
addPending('o4', mk('Supprimer #x'));
addPending('o4', mk('Supprimer #x'));
check('addPending dedups identical descriptions', pendingDescriptions('o4').length === 1);
addPending('o4', mk('Supprimer #y'));
check('addPending still adds distinct descriptions', pendingDescriptions('o4').length === 2);
clearPending('o4');

// --- prefilter: addressing ---
check('admin verb addresses', looksLikeBotAddress('crée un salon news', false) === true);
check('name addresses', looksLikeBotAddress('aegis tu fais quoi', false) === true);
check('mention addresses', looksLikeBotAddress('salut', true) === true);
check('casual chatter ignored', looksLikeBotAddress('lol trop drole', false) === false);
check('plain greeting ignored', looksLikeBotAddress('bonne soiree les gars', false) === false);
check('supprime addresses', looksLikeBotAddress('supprime ce salon', false) === true);
check('ban addresses', looksLikeBotAddress('ban ce type', false) === true);
check('role addresses', looksLikeBotAddress('donne le role vip a Jean', false) === true);

// --- prefilter: confidence tiers ---
check('verb is strong', addressConfidence('crée un salon news', false) === 'strong');
check('delete verb is strong', addressConfidence('supprime ce salon', false) === 'strong');
check('mention is strong', addressConfidence('salut', true) === 'strong');
check('name is strong', addressConfidence('aegis tu fais quoi', false) === 'strong');
check('channel mention is strong', addressConfidence('mets <#123> tout en haut', false) === 'strong');
check('ambiguous defaults to weak', addressConfidence('ce truc est bizarre', false) === 'weak');
check('chatter is none', addressConfidence('lol trop drole', false) === 'none');
check('greeting is none', addressConfidence('bonne soiree les gars', false) === 'none');

// --- prefilter: affirmation / negation ---
check('oui affirms', isAffirmation('oui') === true);
check('oui vas-y affirms', isAffirmation('oui vas-y') === true);
check('ok affirms', isAffirmation('ok') === true);
check('confirme affirms', isAffirmation('confirme') === true);
check("d'accord affirms", isAffirmation("d'accord") === true);
check('vas-y affirms', isAffirmation('vas-y') === true);
check('non does not affirm', isAffirmation('non') === false);
check('random does not affirm', isAffirmation('peut-etre plus tard') === false);
check('non negates', isNegation('non') === true);
check('annule negates', isNegation('annule') === true);
check('laisse tomber negates', isNegation('laisse tomber') === true);
check('oui does not negate', isNegation('oui') === false);

// --- colorParse ---
const cHex = parseColor('#5865F2');
check('hex color parses', cHex.ok === true && cHex.ok && cHex.value === 0x5865f2);
const cHexNoHash = parseColor('5865F2');
check('hex without # parses', cHexNoHash.ok === true && cHexNoHash.ok && cHexNoHash.value === 0x5865f2);
const cNamed = parseColor('rouge');
check('named color parses', cNamed.ok === true && cNamed.ok && cNamed.value === 0xed4245);
check('named color bleu parses', parseColor('bleu').ok === true);
check('uppercase named color parses', parseColor('ROUGE').ok === true);
check('invalid color rejected', parseColor('pasunecouleur').ok === false);
check('bad hex rejected', parseColor('#GGGGGG').ok === false);

// --- permNames ---
const pOk = parsePermissionNames(['ViewChannel', 'SendMessages'], 'test');
check('valid perms parse', pOk.ok === true && pOk.ok && pOk.bits === (PermissionFlagsBits.ViewChannel | PermissionFlagsBits.SendMessages));
check('empty perms = 0n', (() => { const r = parsePermissionNames([], 'test'); return r.ok && r.bits === 0n; })());
check('undefined perms = 0n', (() => { const r = parsePermissionNames(undefined, 'test'); return r.ok && r.bits === 0n; })());
check('unknown perm rejected', parsePermissionNames(['NotAPermission'], 'test').ok === false);
check('permissionNamesOf round-trips', (() => {
  const bits = PermissionFlagsBits.BanMembers | PermissionFlagsBits.KickMembers;
  const names = permissionNamesOf(bits);
  return names.includes('BanMembers') && names.includes('KickMembers');
})());

// --- overwrites: bitsOf ---
const V = PermissionFlagsBits.ViewChannel;
const S = PermissionFlagsBits.SendMessages;
check('bitsOf resolves names', bitsOf(['ViewChannel', 'SendMessages']) === (V | S));
check('bitsOf skips unknown', bitsOf(['ViewChannel', 'Bogus']) === V);
check('bitsOf undefined = 0n', bitsOf(undefined) === 0n);

// --- overwrites: applyOverwriteEdit ---
const zero = { allow: 0n, deny: 0n };
check('merge adds allow', (() => { const r = applyOverwriteEdit(zero, 'merge', V, 0n, 0n); return !!r && r.allow === V && r.deny === 0n; })());
check('merge adds deny', (() => { const r = applyOverwriteEdit(zero, 'merge', 0n, S, 0n); return !!r && r.allow === 0n && r.deny === S; })());
check('merge allow overrides deny', (() => { const r = applyOverwriteEdit({ allow: 0n, deny: S }, 'merge', S, 0n, 0n); return !!r && r.allow === S && r.deny === 0n; })());
check('merge deny overrides allow', (() => { const r = applyOverwriteEdit({ allow: S, deny: 0n }, 'merge', 0n, S, 0n); return !!r && r.allow === 0n && r.deny === S; })());
check('merge neutral clears both -> null', applyOverwriteEdit({ allow: V, deny: 0n }, 'merge', 0n, 0n, V) === null);
check('merge neutral on one flag keeps others', (() => { const r = applyOverwriteEdit({ allow: V | S, deny: 0n }, 'merge', 0n, 0n, V); return !!r && r.allow === S; })());
check('replace sets exact bits', (() => { const r = applyOverwriteEdit({ allow: V, deny: S }, 'replace', S, 0n, 0n); return !!r && r.allow === S && r.deny === 0n; })());
check('replace with nothing -> null', applyOverwriteEdit({ allow: V, deny: 0n }, 'replace', 0n, 0n, 0n) === null);
check('remove -> null', applyOverwriteEdit({ allow: V, deny: S }, 'remove', 0n, 0n, 0n) === null);

// --- sendChunked: splitForDiscord ---
check('short text stays one chunk', (() => { const c = splitForDiscord('abc', 10); return c.length === 1 && c[0] === 'abc'; })());
check('text at limit stays one chunk', splitForDiscord('a'.repeat(10), 10).length === 1);
check('long text splits', splitForDiscord('a'.repeat(25), 10).length === 3);
check('every chunk within limit', (() => splitForDiscord('a'.repeat(95), 10).every((c) => c.length <= 10))());
check('splits on line boundaries', (() => { const c = splitForDiscord('aaa\nbbb\nccc', 5); return c.length === 3 && c[0] === 'aaa'; })());
check('groups lines under limit', (() => { const c = splitForDiscord('ab\ncd\nef', 5); return c[0] === 'ab\ncd'; })());
check('hard-splits an oversized line', (() => splitForDiscord('x'.repeat(30), 10).every((c) => c.length <= 10))());
check('no empty chunks produced', (() => splitForDiscord('aa\n\nbb', 5).every((c) => c.length > 0))());

// --- toolDedup (prevents duplicate tool calls in one response) ---
check('stableStringify is key-order independent', stableStringify({ a: 1, b: 2 }) === stableStringify({ b: 2, a: 1 }));
check('stableStringify recurses into nested objects', stableStringify({ x: { p: 1, q: 2 } }) === stableStringify({ x: { q: 2, p: 1 } }));
check('stableStringify keeps array order', stableStringify([1, 2]) !== stableStringify([2, 1]));
check('same call different key order = same dedup key', toolCallKey('create_channel', '{"name":"x","type":"text"}') === toolCallKey('create_channel', '{"type":"text","name":"x"}'));
check('different args = different dedup key', toolCallKey('create_channel', '{"name":"a"}') !== toolCallKey('create_channel', '{"name":"b"}'));
check('different tool = different dedup key', toolCallKey('delete_channel', '{"channel_id":"1"}') !== toolCallKey('modify_channel', '{"channel_id":"1"}'));
check('invalid json falls back to raw', toolCallKey('x', 'not json') === 'x:not json');

console.log(`\nRESULTAT: ${passed} passes, ${failed} echecs`);
process.exit(failed > 0 ? 1 : 0);
