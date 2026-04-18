import { env } from './runtimeEnv';

// Undetectable.ai AI Detector REST API
// 端点:
//   POST https://ai-detect.undetectable.ai/detect   → 提交检测，拿 document id
//   POST https://ai-detect.undetectable.ai/query    → 轮询检测结果
// 认证：请求体里带 `key` 字段（而不是 apikey header，和 humanize API 不一样）
// 计费：每字 0.1 credit（和同账户降 AI 共用同一个字数池）
// 最低/最高：建议 ≥200 词；硬上限 ≤30,000 词

const DEFAULT_BASE_URL = 'https://ai-detect.undetectable.ai';
const DEFAULT_MODEL = 'xlm_ud_detector';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type SleepLike = (ms: number) => Promise<void>;

interface DetectorDeps {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  perCallTimeoutMs?: number;
}

interface SubmitDetectionResponse {
  id?: string;
  status?: string;
  error?: string;
  message?: string;
}

export interface DetectorResultDetails {
  scoreGptZero?: number;
  scoreOpenAI?: number;
  scoreWriter?: number;
  scoreCrossPlag?: number;
  scoreCopyLeaks?: number;
  scoreSapling?: number;
  scoreContentAtScale?: number;
  scoreZeroGPT?: number;
  /** 综合人工编写百分比（~= 100 - result） */
  human?: number;
  [key: string]: number | undefined;
}

export interface DetectorQueryResponse {
  id?: string;
  status?: string;
  /** 综合 AI 概率 0-100（越高越像 AI） */
  result?: number;
  /** 子检测器 & 人工综合分数（注意方向：scoreXxx 是"人工%"，和 result 相反） */
  result_details?: DetectorResultDetails;
  error?: string;
  message?: string;
  text?: string;
}

export interface DetectAiResult {
  documentId: string;
  /** 综合 AI 概率 0-100 */
  overallScore: number;
  resultDetails: DetectorResultDetails;
  /** 原始返回，便于排查和存库 */
  raw: DetectorQueryResponse;
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${timeoutMs}ms）`)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const rawText = await response.text();
  const data = rawText ? (JSON.parse(rawText) as T) : ({} as T);

  if (!response.ok) {
    const payload = data as { error?: string; message?: string; status?: string };
    const message =
      payload.error
      || payload.message
      || payload.status
      || `Undetectable Detector 请求失败，状态码 ${response.status}`;
    throw new Error(message);
  }

  return data;
}

export function createUndetectableDetectorClient({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  // 检测 API 官方说 2-4 秒出结果，开始用 2s 间隔，最多 150 次 = 5 分钟上限
  pollIntervalMs = 2000,
  maxPollAttempts = 150,
  perCallTimeoutMs = 20_000,
}: DetectorDeps) {
  async function postJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await withTimeout(
      fetchImpl(`${baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }),
      perCallTimeoutMs,
      `Undetectable Detector ${path}`,
    );
    return parseJsonResponse<T>(response);
  }

  /**
   * 提交检测。返回 document id 用于后续轮询。
   */
  async function submitDetection(text: string): Promise<string> {
    if (!text || text.trim().length === 0) {
      throw new Error('检测文本为空');
    }
    const data = await postJson<SubmitDetectionResponse>('/detect', {
      text,
      key: apiKey,
      model: DEFAULT_MODEL,
      retry_count: 0,
    });

    const documentId = data.id?.trim();
    if (!documentId) {
      throw new Error(
        data.error
          || data.message
          || 'Undetectable Detector 提交成功但没有返回 document id。',
      );
    }
    return documentId;
  }

  /**
   * 单次查询（不轮询）。用于调试或自己做轮询节奏的上层。
   */
  async function queryDetection(documentId: string): Promise<DetectorQueryResponse> {
    return postJson<DetectorQueryResponse>('/query', { id: documentId, key: apiKey });
  }

  /**
   * 完整"提交 → 轮询 → 返回"流程。
   * 超时/出错都会抛，由上层决定全额退款 + 标 failed。
   */
  async function detectAi(text: string): Promise<DetectAiResult> {
    const documentId = await submitDetection(text);

    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      const doc = await queryDetection(documentId);

      const status = (doc.status || '').toLowerCase();
      if (status.includes('error') || status.includes('failed')) {
        throw new Error(doc.error || doc.message || doc.status || 'Undetectable Detector 返回失败状态。');
      }

      const result = typeof doc.result === 'number' ? doc.result : null;
      const hasDetails = doc.result_details && Object.keys(doc.result_details).length > 0;

      if (status === 'done' || (result !== null && hasDetails)) {
        if (result === null || !hasDetails) {
          throw new Error('Undetectable Detector 返回数据不完整。');
        }
        return {
          documentId,
          overallScore: result,
          resultDetails: doc.result_details || {},
          raw: doc,
        };
      }

      if (attempt < maxPollAttempts - 1) {
        await sleepImpl(pollIntervalMs);
      }
    }

    throw new Error('Undetectable Detector 轮询超时，请稍后重试。');
  }

  return {
    submitDetection,
    queryDetection,
    detectAi,
  };
}

export const undetectableDetectorClient = createUndetectableDetectorClient({
  apiKey: env.undetectableApiKey,
});
