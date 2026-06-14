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

console.log(`\nRESULTAT: ${passed} passes, ${failed} echecs`);
process.exit(failed > 0 ? 1 : 0);
