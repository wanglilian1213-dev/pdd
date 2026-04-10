import { EmptyResponseError } from './openai';

// ─── Transient upstream error classification ────────────────────────────────
// Shared between writing and outline pipelines. Errors matching these criteria
// are worth retrying because they are caused by upstream gateway / network
// instability, not by our request being wrong.

const TRANSIENT_OPENAI_ERROR_CODES = new Set([
  'stream_read_error',
  'upstream_error',
  'ECONNRESET',
  'ETIMEDOUT',
  'EPIPE',
  'ENOTFOUND',
  'EAI_AGAIN',
]);

const TRANSIENT_HTTP_STATUS = new Set([408, 425, 429, 500, 502, 503, 504, 520, 522, 524]);

const TRANSIENT_MESSAGE_RE =
  /stream_read_error|upstream_error|socket hang up|ECONNRESET|ETIMEDOUT|EPIPE|fetch failed|premature close|aborted|Cloudflare|\b5\d\d\b/i;

/**
 * Optional predicate that callers can pass to exclude specific error types
 * from being classified as transient (e.g. WritingStageTimeoutError).
 */
export type NonTransientPredicate = (error: unknown) => boolean;

export function isTransientUpstreamError(
  error: unknown,
  isNonTransient?: NonTransientPredicate,
): boolean {
  if (isNonTransient && isNonTransient(error)) return false;
  if (!error || typeof error !== 'object') return false;

  // EmptyResponseError = gateway delivered tokens but no text; always worth retrying
  if (error instanceof EmptyResponseError) return true;

  const e = error as {
    code?: unknown;
    type?: unknown;
    status?: unknown;
    message?: unknown;
    cause?: unknown;
  };

  if (typeof e.code === 'string' && TRANSIENT_OPENAI_ERROR_CODES.has(e.code)) return true;
  if (typeof e.type === 'string' && e.type === 'upstream_error') return true;
  if (typeof e.status === 'number' && TRANSIENT_HTTP_STATUS.has(e.status)) return true;
  if (typeof e.message === 'string') {
    if (e.message.startsWith('draft_invalid:')) return false;
    if (/Invalid key|Unauthorized|forbidden|invalid_api_key/i.test(e.message)) return false;
    if (TRANSIENT_MESSAGE_RE.test(e.message)) return true;
  }
  if (e.cause && isTransientUpstreamError(e.cause, isNonTransient)) return true;
  return false;
}

/**
 * Generic retry wrapper for upstream OpenAI / sub2api calls.
 * Uses linear backoff (5s * attempt) to avoid eating the stage budget.
 */
export async function callWithUpstreamRetry<T>(
  label: string,
  build: () => Promise<T>,
  maxAttempts: number,
  isNonTransient?: NonTransientPredicate,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await build();
    } catch (error) {
      lastError = error;
      if (!isTransientUpstreamError(error, isNonTransient) || attempt === maxAttempts) throw error;
      const backoffMs = 5_000 * attempt;
      const reason = (error as { message?: string })?.message || String(error);
      console.warn(
        `[${label}] transient upstream error on attempt ${attempt}/${maxAttempts}, retrying in ${backoffMs}ms: ${reason}`,
      );
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
  }
  throw lastError;
}
