import OpenAI from 'openai';
import { env } from './runtimeEnv';

export const openai = new OpenAI({
  apiKey: env.openaiApiKey,
  ...(env.openaiBaseUrl ? { baseURL: env.openaiBaseUrl } : {}),
});

/**
 * Extract output text from an OpenAI Responses API response.
 *
 * With `openai.responses.create()` the server returns `output_text` directly.
 * With `openai.responses.stream().finalResponse()`, the SDK's
 * `maybeParseResponse()` skips `addOutputText()` when there is no
 * auto-parseable input (e.g. json_schema), leaving `output_text` undefined.
 * This helper falls back to manually extracting text from the `output` array.
 */
export function extractOutputText(response: {
  output_text?: string;
  output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }>;
}): string {
  if (typeof response.output_text === 'string') {
    return response.output_text;
  }
  if (Array.isArray(response.output)) {
    const texts: string[] = [];
    for (const item of response.output) {
      if (item.type !== 'message') continue;
      for (const part of item.content || []) {
        if (part.type === 'output_text' && typeof part.text === 'string') {
          texts.push(part.text);
        }
      }
    }
    return texts.join('');
  }
  return '';
}
