import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.trim() !== '' ? value : fallback;
}

export const config = {
  discordToken: required('DISCORD_TOKEN'),
  geminiApiKey: required('GEMINI_API_KEY'),
  llmModel: optional('LLM_MODEL', 'gemini-2.5-flash'),
  logLevel: optional('LOG_LEVEL', 'info'),
} as const;
