import { env } from './runtimeEnv';
import {
  getActiveStealthwriterSession,
  markStealthwriterSessionBroken,
  refreshStealthwriterSessionFromWorker,
  touchStealthwriterSessionVerified,
  type StealthwriterSession,
} from '../services/stealthwriterSessionService';

const DEFAULT_BASE_URL = env.stealthwriterBaseUrl;
export const STEALTHWRITER_MODEL = 'Ghost5.2Pro';
export const STEALTHWRITER_LEVEL = 8;
export const STEALTHWRITER_SCAN_VERSION = 'v2';
export const STEALTHWRITER_FALLBACK_SCAN_VERSION = 'v1';
export const STEALTHWRITER_NUM_ALTERNATIVES = 3;
const STEALTHWRITER_PAYLOAD_KEY_PREFIX = 'sw_r3sp0ns3_k3y_2024!xQ9';
const STEALTHWRITER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';
const STEALTHWRITER_SEC_CH_UA =
  '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface StealthwriterAlternative {
  sentence?: string;
  rank?: number | null;
  [key: string]: unknown;
}

export interface StealthwriterHumanizeSentence {
  id?: string | number;
  original?: string;
  alternatives?: StealthwriterAlternative[];
  [key: string]: unknown;
}

export interface StealthwriterHumanizeResult {
  originalText: string;
  output: string;
  sentences: StealthwriterHumanizeSentence[];
  resultId: string | null;
  raw: Record<string, unknown>;
}

export interface StealthwriterScanSentence {
  sentence?: string;
  score?: number | null;
  label?: string;
  [key: string]: unknown;
}

export interface StealthwriterScanResult {
  normalScore: number;
  verdict: 'looks_human' | 'ai_detected';
  scanVersion?: string;
  sentences: StealthwriterScanSentence[];
  resultId: string | null;
  raw: Record<string, unknown>;
}

export interface StealthwriterResultJson {
  human_score: number;
  ai_score: number;
  verdict: StealthwriterScanResult['verdict'];
  scan_version: string;
  stealthwriter_result_id: string | null;
  display_text?: string;
  original_text?: string;
  sentences: StealthwriterScanSentence[];
  raw: Record<string, unknown>;
}

interface BuildStealthwriterResultJsonOptions {
  displayText?: string | null;
  originalText?: string | null;
}

export class StealthwriterAuthError extends Error {
  constructor(message = 'StealthWriter 会话已失效。') {
    super(message);
    this.name = 'StealthwriterAuthError';
  }
}

export class StealthwriterRateLimitError extends Error {
  constructor(message = 'StealthWriter 当前不可用或配额已耗尽。') {
    super(message);
    this.name = 'StealthwriterRateLimitError';
  }
}

export class StealthwriterStructureError extends Error {
  constructor(message = 'StealthWriter 返回结构发生变化。') {
    super(message);
    this.name = 'StealthwriterStructureError';
  }
}

interface StealthwriterDeps {
  baseUrl?: string;
  fetchImpl?: FetchLike;
  loadSession?: () => Promise<StealthwriterSession | null>;
  refreshSession?: () => Promise<StealthwriterSession>;
  markSessionBroken?: (notes: string) => Promise<void>;
  touchSessionVerified?: () => Promise<void>;
  encodePayload?: (payload: Record<string, unknown>) => Record<string, unknown>;
  decodePayload?: (payload: Record<string, unknown>) => Record<string, unknown>;
}

interface EncodedStealthwriterPayload {
  d: string;
  s: string;
}

function xorStealthwriterBytes(input: Uint8Array, salt: string) {
  const key = `${STEALTHWRITER_PAYLOAD_KEY_PREFIX}${salt}`;
  const result = new Uint8Array(input.length);

  for (let index = 0; index < input.length; index += 1) {
    result[index] = input[index] ^ key.charCodeAt(index % key.length);
  }

  return result;
}

export function encodeStealthwriterPayload(payload: Record<string, unknown>) {
  const salt = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const plain = new TextEncoder().encode(JSON.stringify(payload));
  const encoded = xorStealthwriterBytes(plain, salt);

  return {
    d: Buffer.from(encoded).toString('base64'),
    s: salt,
  };
}

export function decodeStealthwriterPayload(payload: Record<string, unknown>) {
  const encoded = payload as Partial<EncodedStealthwriterPayload>;
  if (typeof encoded.d !== 'string' || typeof encoded.s !== 'string') {
    return payload;
  }

  try {
    const decodedBytes = xorStealthwriterBytes(
      Uint8Array.from(Buffer.from(encoded.d, 'base64')),
      encoded.s,
    );
    return JSON.parse(new TextDecoder().decode(decodedBytes)) as Record<string, unknown>;
  } catch {
    throw new StealthwriterStructureError('StealthWriter 返回内容无法解码。');
  }
}

function extractResultId(raw: Record<string, unknown>): string | null {
  const candidates = [
    raw.id,
    raw.result_id,
    raw.resultId,
    raw.document_id,
    raw.documentId,
  ];

  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function bestAlternative(sentence: StealthwriterHumanizeSentence) {
  const alternatives = Array.isArray(sentence.alternatives) ? sentence.alternatives : [];
  if (alternatives.length === 0) {
    return sentence.original?.trim() || '';
  }

  const sorted = [...alternatives].sort((a, b) => {
    const rankA = typeof a.rank === 'number' ? a.rank : -1;
    const rankB = typeof b.rank === 'number' ? b.rank : -1;
    return rankB - rankA;
  });

  return (typeof sorted[0]?.sentence === 'string' ? sorted[0].sentence : sentence.original || '').trim();
}

function maxSentenceRank(sentence: StealthwriterHumanizeSentence): number {
  const alternatives = Array.isArray(sentence.alternatives) ? sentence.alternatives : [];
  return alternatives.reduce((best, alt) => {
    const rank = typeof alt.rank === 'number' ? alt.rank : -1;
    return rank > best ? rank : best;
  }, -1);
}

function mapSentencePositions(text: string, sentences: StealthwriterHumanizeSentence[]) {
  const positioned: Array<StealthwriterHumanizeSentence & { start: number; end: number }> = [];
  let cursor = 0;

  for (const sentence of sentences) {
    const original = typeof sentence.original === 'string' ? sentence.original : '';
    if (!original) continue;

    const start = text.indexOf(original, cursor);
    if (start === -1) continue;

    const end = start + original.length;
    positioned.push({ ...sentence, start, end });
    cursor = end;
  }

  return positioned;
}

export function buildStealthwriterResultJson(
  scanResult: StealthwriterScanResult,
  options: BuildStealthwriterResultJsonOptions = {},
): StealthwriterResultJson {
  const humanScore = Math.round(scanResult.normalScore);
  const displayText = typeof options.displayText === 'string' ? options.displayText.trim() : '';
  const originalText = typeof options.originalText === 'string' ? options.originalText.trim() : '';

  return {
    human_score: humanScore,
    ai_score: Math.max(0, Math.min(100, 100 - humanScore)),
    verdict: scanResult.verdict,
    scan_version: scanResult.scanVersion || STEALTHWRITER_SCAN_VERSION,
    stealthwriter_result_id: scanResult.resultId,
    ...(displayText ? { display_text: displayText } : {}),
    ...(originalText ? { original_text: originalText } : {}),
    sentences: scanResult.sentences,
    raw: scanResult.raw,
  };
}

export function buildHumanizedText(
  originalText: string,
  sentences: StealthwriterHumanizeSentence[],
): string {
  const positioned = mapSentencePositions(originalText, sentences);
  if (positioned.length === 0) {
    const fallback = sentences
      .map((sentence) => bestAlternative(sentence))
      .filter(Boolean)
      .join(' ')
      .trim();

    if (!fallback) {
      throw new StealthwriterStructureError('StealthWriter humanize 返回里没有可用句子。');
    }

    return fallback;
  }

  let result = '';
  let cursor = 0;

  for (const sentence of positioned) {
    result += originalText.slice(cursor, sentence.start);
    result += bestAlternative(sentence);
    cursor = sentence.end;
  }

  result += originalText.slice(cursor);
  return result.trim();
}

export function mergeHumanizeMoreResult(
  previous: StealthwriterHumanizeResult,
  fresh: StealthwriterHumanizeResult,
): StealthwriterHumanizeResult {
  const previousByOriginal = new Map<string, StealthwriterHumanizeSentence>();
  for (const sentence of previous.sentences) {
    const key = typeof sentence.original === 'string' ? sentence.original.trim() : '';
    if (key) previousByOriginal.set(key, sentence);
  }

  const mergedSentences = fresh.sentences.map((sentence) => {
    const key = typeof sentence.original === 'string' ? sentence.original.trim() : '';
    const previousSentence = key ? previousByOriginal.get(key) : undefined;
    if (!previousSentence) return sentence;

    return maxSentenceRank(sentence) > maxSentenceRank(previousSentence)
      ? sentence
      : {
        ...sentence,
        alternatives: previousSentence.alternatives,
      };
  });

  return {
    originalText: previous.originalText,
    output: buildHumanizedText(previous.originalText, mergedSentences),
    sentences: mergedSentences,
    resultId: fresh.resultId || previous.resultId,
    raw: fresh.raw,
  };
}

function extractHumanizeResult(
  originalText: string,
  decoded: Record<string, unknown>,
): StealthwriterHumanizeResult {
  const sentences = Array.isArray(decoded.sentences)
    ? decoded.sentences as StealthwriterHumanizeSentence[]
    : [];

  if (sentences.length === 0) {
    throw new StealthwriterStructureError('StealthWriter humanize 返回缺少 sentences。');
  }

  return {
    originalText,
    output: buildHumanizedText(originalText, sentences),
    sentences,
    resultId: extractResultId(decoded),
    raw: decoded,
  };
}

function extractScanResult(
  decoded: Record<string, unknown>,
  scanVersion = STEALTHWRITER_SCAN_VERSION,
): StealthwriterScanResult {
  const normalScoreValue =
    typeof decoded.normal_score === 'number'
      ? decoded.normal_score
      : typeof decoded.normalScore === 'number'
        ? decoded.normalScore
        : typeof decoded.human_score === 'number'
          ? decoded.human_score
          : null;

  if (normalScoreValue === null) {
    throw new StealthwriterStructureError('StealthWriter scan 返回缺少 normal_score。');
  }

  const scaledScore = normalScoreValue >= 0 && normalScoreValue <= 1
    ? normalScoreValue * 100
    : normalScoreValue;
  const normalScore = Math.max(0, Math.min(100, Math.round(scaledScore)));
  const verdict = normalScore >= 50 ? 'looks_human' : 'ai_detected';

  return {
    normalScore,
    verdict,
    scanVersion,
    sentences: Array.isArray(decoded.sentences)
      ? decoded.sentences as StealthwriterScanSentence[]
      : [],
    resultId: extractResultId(decoded),
    raw: decoded,
  };
}

function isV2CudaFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return /Scan failed: CUDA error: unknown error|cudaErrorUnknown/i.test(message);
}

function extractErrorMessage(payload: Record<string, unknown>, response: Response) {
  const candidates = [payload.error, payload.message, payload.code, payload.status];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }
  return `StealthWriter 请求失败，状态码 ${response.status}`;
}

function buildBrowserLikeHeaders(baseUrl: string) {
  const origin = baseUrl.replace(/\/$/, '');

  return {
    Origin: origin,
    Referer: `${origin}/`,
    'Sec-CH-UA': STEALTHWRITER_SEC_CH_UA,
    'Sec-CH-UA-Mobile': '?0',
    'Sec-CH-UA-Platform': '"macOS"',
    'User-Agent': STEALTHWRITER_USER_AGENT,
  };
}

function mapHttpError(response: Response, payload: Record<string, unknown>) {
  const message = extractErrorMessage(payload, response);

  const code = typeof payload.code === 'string' ? payload.code.toUpperCase() : '';
  if (
    response.status === 429
    || code.includes('LIMIT')
    || code.includes('FP_LIMIT')
    || code.includes('IP_LIMIT')
  ) {
    return new StealthwriterRateLimitError(message);
  }

  if (response.status === 401 || response.status === 403) {
    return new StealthwriterAuthError(message);
  }

  const error = new Error(message) as Error & { statusCode?: number };
  error.statusCode = response.status;
  return error;
}

function isRetryableRequestError(error: unknown) {
  if (error instanceof StealthwriterAuthError || error instanceof StealthwriterRateLimitError) {
    return false;
  }
  if (isV2CudaFailure(error)) {
    return false;
  }

  const statusCode = typeof (error as { statusCode?: unknown })?.statusCode === 'number'
    ? (error as { statusCode: number }).statusCode
    : null;
  if (statusCode !== null) {
    return statusCode >= 500;
  }

  const message = error instanceof Error ? error.message : String(error || '');
  return /fetch failed|network|timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN/i.test(message);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function parseJsonResponse(response: Response) {
  const rawText = await response.text();
  if (!rawText.trim()) {
    if (!response.ok) {
      throw mapHttpError(response, {});
    }
    return {};
  }

  const payload = JSON.parse(rawText) as Record<string, unknown>;
  if (!response.ok) {
    throw mapHttpError(response, payload);
  }

  return payload;
}

export function createStealthwriterClient({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  loadSession = getActiveStealthwriterSession,
  refreshSession = refreshStealthwriterSessionFromWorker,
  markSessionBroken = markStealthwriterSessionBroken,
  touchSessionVerified = touchStealthwriterSessionVerified,
  encodePayload = encodeStealthwriterPayload,
  decodePayload = decodeStealthwriterPayload,
}: StealthwriterDeps = {}) {
  async function performRequest(
    path: string,
    payload: Record<string, unknown>,
    allowRefresh = true,
    attempt = 0,
  ): Promise<Record<string, unknown>> {
    const session = await loadSession();
    const fp = session?.fp?.trim() || '';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...buildBrowserLikeHeaders(baseUrl),
    };

    if (session?.cookieHeader?.trim()) {
      headers.Cookie = session.cookieHeader.trim();
    }

    try {
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(encodePayload({
          ...payload,
          fp,
        })),
      });

      const parsed = await parseJsonResponse(response);
      await touchSessionVerified().catch(() => undefined);
      return decodePayload(parsed);
    } catch (error) {
      if (error instanceof StealthwriterAuthError) {
        await markSessionBroken(error.message).catch(() => undefined);

        if (allowRefresh) {
          await refreshSession();
          return performRequest(path, payload, false);
        }
      }

      if (attempt < 2 && isRetryableRequestError(error)) {
        await sleep(750 * (attempt + 1));
        return performRequest(path, payload, allowRefresh, attempt + 1);
      }

      throw error;
    }
  }

  return {
    async humanize(text: string): Promise<StealthwriterHumanizeResult> {
      const decoded = await performRequest('/api/humanize', {
        text,
        level: STEALTHWRITER_LEVEL,
        model: STEALTHWRITER_MODEL,
        num_alternatives: STEALTHWRITER_NUM_ALTERNATIVES,
        is_rehumanize: false,
      });

      return extractHumanizeResult(text, decoded);
    },

    async humanizeMore(previous: StealthwriterHumanizeResult): Promise<StealthwriterHumanizeResult> {
      const decoded = await performRequest('/api/humanize', {
        text: previous.originalText,
        level: STEALTHWRITER_LEVEL,
        model: STEALTHWRITER_MODEL,
        num_alternatives: STEALTHWRITER_NUM_ALTERNATIVES,
        is_rehumanize: true,
      });

      const fresh = extractHumanizeResult(previous.originalText, decoded);
      return mergeHumanizeMoreResult(previous, fresh);
    },

    async scanV2(text: string): Promise<StealthwriterScanResult> {
      try {
        const decoded = await performRequest('/api/scan', {
          text,
          version: STEALTHWRITER_SCAN_VERSION,
          rescan: true,
        });

        return extractScanResult(decoded, STEALTHWRITER_SCAN_VERSION);
      } catch (error) {
        if (!isV2CudaFailure(error)) throw error;

        console.warn('[stealthwriter] scan v2 CUDA failure; falling back to scan v1');
        const decoded = await performRequest('/api/scan', {
          text,
          version: STEALTHWRITER_FALLBACK_SCAN_VERSION,
        });

        return extractScanResult(decoded, STEALTHWRITER_FALLBACK_SCAN_VERSION);
      }
    },
  };
}

export const stealthwriterClient = createStealthwriterClient();
