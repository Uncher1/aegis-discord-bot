import OpenAI from 'openai';
import { config } from '../config.js';

/**
 * Google Gemini exposes an OpenAI-compatible chat completions API, so we drive
 * it through the standard OpenAI client. Keeping it behind this thin module
 * means adding or swapping a provider later is a one-line change here, with
 * nothing else in the codebase to touch.
 */
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

export const llm = new OpenAI({
  apiKey: config.geminiApiKey,
  baseURL: GEMINI_BASE_URL,
});

export const model = config.llmModel;
