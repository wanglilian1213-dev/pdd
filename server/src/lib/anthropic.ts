import Anthropic from '@anthropic-ai/sdk';
import { env } from './runtimeEnv';

export const anthropic = new Anthropic({
  apiKey: env.anthropicApiKey,
  ...(env.anthropicBaseUrl ? { baseURL: env.anthropicBaseUrl } : {}),
});
