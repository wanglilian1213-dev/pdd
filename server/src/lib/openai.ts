import OpenAI from 'openai';
import { env } from './runtimeEnv';

export const openai = new OpenAI({
  apiKey: env.openaiApiKey,
  ...(env.openaiBaseUrl ? { baseURL: env.openaiBaseUrl } : {}),
});

/**
 * Thrown when the upstream returns status=completed with output_tokens > 0
 * but no actual text content — a silent failure that must be surfaced.
 */
export class EmptyResponseError extends Error {
  constructor(public detail: Record<string, unknown>) {
    super('上游 AI 返回空内容');
    this.name = 'EmptyResponseError';
  }
}

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

/**
 * Stream an OpenAI Responses API call and accumulate output text from SSE
 * events. Since ~2026-04-07 the ChatGPT codex backend no longer populates
 * `response.output` in the terminal `response.completed` SSE event, so
 * `finalResponse().output_text` is always undefined. This helper listens
 * for `response.output_text.done` events during the stream to capture the
 * actual generated text.
 */
export async function streamResponseText(
  params: Parameters<typeof openai.responses.stream>[0],
): Promise<{ text: string; response: any }> {
  const stream = openai.responses.stream(params);
  let doneText = '';
  let deltaText = '';
  // Primary: accumulate from 'done' events (canonical complete text per content part)
  stream.on('response.output_text.done', (ev: any) => {
    doneText += ev.text;
  });
  // Fallback: accumulate from 'delta' events (incremental chunks, more universally
  // forwarded by SSE gateways like sub2api)
  stream.on('response.output_text.delta', (ev: any) => {
    deltaText += ev.delta;
  });
  const response = await stream.finalResponse();
  // Prefer done (authoritative), fall back to delta, then to response.output
  let text = doneText || deltaText;
  if (!text) {
    text = extractOutputText(response);
  }
  // Guard: upstream claims tokens produced but no text captured
  if (!text && (response as any).usage?.output_tokens > 0) {
    throw new EmptyResponseError({
      id: (response as any).id,
      status: (response as any).status,
      output_tokens: (response as any).usage?.output_tokens,
    });
  }
  return { text, response };
}
