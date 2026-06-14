import 'dotenv/config';
import OpenAI from 'openai';

const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error('GEMINI_API_KEY manquante dans .env');
  process.exit(1);
}

const llm = new OpenAI({
  apiKey: key,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});
const model = process.env.LLM_MODEL?.trim() || 'gemini-2.5-flash';

async function run(label, params) {
  try {
    const r = await llm.chat.completions.create({ model, ...params });
    const msg = r.choices[0]?.message;
    console.log(`\n=== ${label} ===`);
    console.log('finish_reason:', r.choices[0]?.finish_reason);
    console.log('content:', JSON.stringify(msg?.content));
    if (msg?.tool_calls) {
      console.log('tool_calls:', JSON.stringify(msg.tool_calls.map((t) => ({ name: t.function?.name, args: t.function?.arguments }))));
    }
    console.log('usage:', JSON.stringify(r.usage));
  } catch (err) {
    console.log(`\n=== ${label} ===`);
    console.log('ERROR:', err?.status ?? '', err?.message ?? String(err));
  }
}

const intentMessages = [
  { role: 'system', content: 'Tu tries un message. Reponds uniquement en JSON: {"type":"respond"} ou {"type":"ignore"}.' },
  { role: 'user', content: 'Message: cree trois salons news, regles et bienvenue. JSON:' },
];

const toolMessages = [
  { role: 'system', content: 'Tu crees des salons Discord en appelant create_channel. Cree exactement les salons demandes.' },
  { role: 'user', content: 'Cree trois salons textuels: news, regles, bienvenue.' },
];
const tools = [
  {
    type: 'function',
    function: {
      name: 'create_channel',
      description: 'Cree un salon',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          type: { type: 'string', enum: ['text', 'voice'] },
        },
        required: ['name', 'type'],
      },
    },
  },
];

// A) Reproduce the bug: tiny max_tokens + json_object
await run('A. json max_tokens=20 (repro)', {
  messages: intentMessages,
  response_format: { type: 'json_object' },
  temperature: 0,
  max_tokens: 20,
});

// B) json_object with reasoning disabled
await run('B. json reasoning_effort=none max_tokens=40', {
  messages: intentMessages,
  response_format: { type: 'json_object' },
  temperature: 0,
  max_tokens: 40,
  reasoning_effort: 'none',
});

// C) json_object with generous max_tokens, thinking left on
await run('C. json max_tokens=800 (thinking on)', {
  messages: intentMessages,
  response_format: { type: 'json_object' },
  temperature: 0,
  max_tokens: 800,
});

// D) tool calling with reasoning disabled
await run('D. tools reasoning_effort=none max_tokens=800', {
  messages: toolMessages,
  tools,
  tool_choice: 'auto',
  temperature: 0,
  max_tokens: 800,
  reasoning_effort: 'none',
});

// E) tool calling with thinking on, generous tokens
await run('E. tools max_tokens=2000 (thinking on)', {
  messages: toolMessages,
  tools,
  tool_choice: 'auto',
  temperature: 0,
  max_tokens: 2000,
});
