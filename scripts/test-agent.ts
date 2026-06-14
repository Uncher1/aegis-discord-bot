import 'dotenv/config';
import { llm, model } from '../src/llm/client.js';
import { buildAgentSystemPrompt } from '../src/llm/agent.js';
import { toolsAsLlmFormat } from '../src/tools/registry.js';
import type { Guild, User } from 'discord.js';

/**
 * Dry-run harness: drives the REAL agent prompt + tool schemas against the live
 * model with a fake server context, and checks which tools it picks and with
 * what arguments. Nothing is executed on Discord. Uses the LLM (counts against
 * the quota), so cases are spaced out.
 */

const owner = { tag: 'uncher' } as unknown as User;
const guild = { name: 'Cozy Land' } as unknown as Guild;
const systemPrompt = buildAgentSystemPrompt(owner, guild);
const tools = toolsAsLlmFormat();

const CONTEXT = `Contexte:
Date: 14 juin 2026 a 05:30 (Europe/Paris)
Serveur: "Cozy Land", 5 membres, boost=aucun (0), locale=fr, cree le 19 avril 2026. Stats: 1 cat, 4 salons hors-cat, 3 roles (@everyone inclus).
Moi (A.E.G.I.S): pseudo "A.E.G.I.S", roles [Admin]
Salon actuel: #hub=100(textuel), parent=aucun

Categories (1): "General"=200

Salons (4, format "#nom=id(type)"):
  sans-categorie: #hub=100(texte)
  "General"=200: #news=101(texte), #regles=102(texte), #bienvenue=103(texte)

Roles (3, format "@nom=id"): @Admin=300, @Staff=301, @everyone=399

Message de uncher: `;

interface Call {
  name: string;
  args: Record<string, unknown>;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function ask(phrase: string): Promise<{ calls: Call[]; content: string | null }> {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await llm.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: CONTEXT + phrase },
        ],
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        tools: tools as any,
        tool_choice: 'auto',
        temperature: 0,
        max_tokens: 2048,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        reasoning_effort: 'none' as any,
      });
      const msg = r.choices[0]?.message;
      const calls: Call[] = (msg?.tool_calls ?? []).map((tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {
          /* leave empty */
        }
        return { name: tc.function.name, args };
      });
      return { calls, content: msg?.content ?? null };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 429 && attempt < 4) {
        await sleep(4000 * (attempt + 1));
        continue;
      }
      throw err;
    }
  }
}

function has(calls: Call[], name: string): Call | undefined {
  return calls.find((c) => c.name === name);
}

// role_permissions entry that denies SendMessages for @everyone (id 399).
function deniesEveryoneSend(args: Record<string, unknown>): boolean {
  const rp = args.role_permissions as Array<{ role_id?: string; deny?: string[] }> | undefined;
  if (!Array.isArray(rp)) return false;
  return rp.some((e) => e.role_id === '399' && Array.isArray(e.deny) && e.deny.includes('SendMessages'));
}

interface TestCase {
  phrase: string;
  expect: string;
  check: (calls: Call[]) => boolean;
}

const cases: TestCase[] = [
  {
    phrase: 'cree trois salons : news2, regles2 et bienvenue2',
    expect: '3x create_channel (texte)',
    check: (c) => c.length === 3 && c.every((x) => x.name === 'create_channel'),
  },
  {
    phrase: 'cree un salon annonces en lecture seule sauf pour les admins',
    expect: 'create_channel avec deny SendMessages @everyone',
    check: (c) => c.length === 1 && c[0].name === 'create_channel' && deniesEveryoneSend(c[0].args),
  },
  {
    phrase: 'supprime #news',
    expect: 'delete_channel channel_id=101',
    check: (c) => c.length === 1 && c[0].name === 'delete_channel' && c[0].args.channel_id === '101',
  },
  {
    phrase: 'supprime #news et #regles',
    expect: '2x delete_channel (101 et 102)',
    check: (c) => c.length === 2 && c.every((x) => x.name === 'delete_channel'),
  },
  {
    phrase: 'renomme #news en actualites',
    expect: 'modify_channel name=actualites channel_id=101',
    check: (c) => {
      const m = has(c, 'modify_channel');
      return c.length === 1 && !!m && m.args.channel_id === '101' && /actualit/i.test(String(m.args.name ?? ''));
    },
  },
  {
    phrase: 'mets #news tout en haut',
    expect: 'modify_channel position=0 channel_id=101',
    check: (c) => {
      const m = has(c, 'modify_channel');
      return c.length === 1 && !!m && m.args.channel_id === '101' && m.args.position === 0;
    },
  },
  {
    phrase: 'cree un role VIP en violet',
    expect: 'create_role name=VIP + couleur',
    check: (c) => {
      const m = has(c, 'create_role');
      return c.length === 1 && !!m && /vip/i.test(String(m.args.name ?? '')) && m.args.color !== undefined;
    },
  },
  {
    phrase: 'donne le role Staff au membre <@500>',
    expect: 'assign_role role_id=301 member_id=500',
    check: (c) => {
      const m = has(c, 'assign_role');
      return !!m && m.args.role_id === '301' && m.args.member_id === '500';
    },
  },
  {
    phrase: 'bannis le membre <@500>',
    expect: 'ban_member user_id=500',
    check: (c) => {
      const m = has(c, 'ban_member');
      return !!m && m.args.user_id === '500';
    },
  },
];

let pass = 0;
let fail = 0;
console.log(`Harnais agent (modele: ${model}) - ${cases.length} cas\n`);
for (const tc of cases) {
  let calls: Call[] = [];
  try {
    ({ calls } = await ask(tc.phrase));
  } catch (err) {
    console.log(`FAIL  "${tc.phrase}"\n      erreur: ${(err as { message?: string }).message ?? String(err)}\n`);
    fail++;
    await sleep(6000);
    continue;
  }
  const ok = tc.check(calls);
  const summary = calls.map((c) => `${c.name}(${JSON.stringify(c.args)})`).join(' | ') || '(aucun appel)';
  console.log(`${ok ? 'PASS' : 'FAIL'}  "${tc.phrase}"`);
  console.log(`      attendu: ${tc.expect}`);
  console.log(`      obtenu : ${summary}\n`);
  if (ok) pass++;
  else fail++;
  await sleep(6000); // space out to respect the free-tier rate limit
}

console.log(`\nRESULTAT: ${pass} pass, ${fail} fail`);
process.exit(fail > 0 ? 1 : 0);
