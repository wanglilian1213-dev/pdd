import OpenAI from 'openai';
import { env } from './runtimeEnv';

export const openai = new OpenAI({
  apiKey: env.openaiApiKey,
});
