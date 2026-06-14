# A.E.G.I.S

**Advanced Executive Guild Interactive System** — an autonomous AI agent that administers a Discord server from natural language. Its owner just describes what they want ("crée un salon annonces en lecture seule", "supprime ces deux rôles", "bannis ce membre"), and A.E.G.I.S turns it into the correct, minimal Discord actions.

It is a personal executive assistant for one server owner, not a public chatbot or a moderator that everyone can talk to. It only ever obeys its owner, and it stays silent on everything else.

## What it can do

| Domain | Tools |
| --- | --- |
| Read | `list_channels`, `list_roles` |
| Channels & categories | `create_channel`, `create_category`, `modify_channel`, `modify_category`, `delete_channel`, `delete_category` |
| Roles | `create_role`, `modify_role`, `delete_role`, `assign_role`, `remove_role` |
| Moderation | `kick_member`, `ban_member`, `unban_member`, `timeout_member` |

The agent understands permissions, overwrites, category synchronisation, voice settings (bitrate, region, user limit), slowmode, NSFW, role colors and hierarchy, and more. It resolves fuzzy references the way a human owner types them (typos, missing accents, leet spellings, "ici" / "cette catégorie").

## Safety model

A.E.G.I.S can delete channels and ban members, so it is built to be careful:

- **Irreversible actions require confirmation.** Deletions, kicks and bans are queued, not executed. The bot lists what is about to happen and waits for a single "oui" to run the whole batch (or "non" to cancel everything).
- **Audit trail.** Every executed action is written to `aegis-audit.log`.
- **The bot only does what it is physically allowed to.** It acts on its own Discord permissions and respects the role hierarchy (it can never touch a role above its own, and the server owner is untouchable). The owner of the bot is trusted; their personal server permissions are not used to gate actions.
- **Single guild.** The bot binds to exactly one server and leaves any other it is invited to.
- **Discretion.** It never reacts visibly (typing indicator, reactions) to messages it ends up ignoring.

## Architecture

```
Discord message (owner only)
  -> prefilter        cheap, no LLM: drop obvious chatter, flag clear commands
  -> intent gate      one cheap LLM call for ambiguous messages (respond / ignore)
  -> agent            tool-calling loop: turns intent into Discord actions
  -> confirmation     irreversible actions wait for "oui" before running
```

- **Language:** TypeScript (ESM, strict), Node 20+.
- **Discord:** discord.js v14.
- **LLM:** Google Gemini 2.5 Flash via its OpenAI-compatible endpoint, driven with the `openai` SDK. The provider lives behind a single thin module (`src/llm/client.ts`), so swapping it is a one-line change.

## Setup

1. Install dependencies:
   ```
   npm install
   ```
2. Copy `.env.example` to `.env` and fill it in:
   ```
   DISCORD_TOKEN=...        # Discord developer portal
   GEMINI_API_KEY=...       # free key at https://aistudio.google.com/apikey
   LLM_MODEL=gemini-2.5-flash
   ```
3. Run it:
   ```
   npm run dev      # watch mode
   npm run build    # compile to dist/
   npm start        # run the compiled build
   ```

The bot needs the privileged **Message Content** and **Server Members** gateway intents enabled in the developer portal, and a role placed high enough (with Manage Channels / Manage Roles / Kick / Ban / Moderate Members) to perform the actions you ask of it.

## Development

- `npm run typecheck` — type-check without emitting.
- `npx tsx scripts/test-logic.ts` — fast deterministic tests (no network) for the gate, the confirmation queue and the helpers.
- `npx tsx scripts/test-agent.ts` — dry-run the live model against the real prompt and tool schemas to check tool selection (uses the LLM quota, nothing is executed on Discord).

## Project layout

```
src/
  index.ts            message handling, confirmation flow
  config.ts           env-driven configuration
  llm/                client, intent gate, tool-calling agent, prompts
  tools/              one file per capability, plus the registry and helpers
  bot/                owner resolution, guild binding, prefilter, pending queue, audit
  discord/            client, intents, mention rendering, message chunking
```
