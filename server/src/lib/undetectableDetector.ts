import { WebSocket } from 'ws';
import { env } from './runtimeEnv';

// Undetectable.ai AI Detector API（REST + WebSocket 句子级两条通路）
//
// REST 篇章级：
//   POST https://ai-detect.undetectable.ai/detect   → 提交检测，拿 document id
//   POST https://ai-detect.undetectable.ai/query    → 轮询检测结果（整体分 + 8 家聚合）
//
// WebSocket 句子级（2026-04-19 新增）：
//   wss://ai-detect.undetectable.ai/ws/$USER_ID
//   流程: 建连 → send document_watch → recv document_id → REST /detect（带 id）
//        → recv document_chunk × N → recv document_done
//   chunk.result: 0-1 浮点（与 /query.result 的 0-100 刻度不同！前端显示时 × 100）
//
// 认证：REST 请求体里带 `key`；WebSocket 在 document_watch 消息体里带 api_key
// 计费：每字 0.1 credit（REST 和 WebSocket 一致，一次 submit 只扣一次）
// 最低/最高：建议 ≥200 词；硬上限 ≤30,000 词

const DEFAULT_BASE_URL = 'https://ai-detect.undetectable.ai';
const DEFAULT_WS_BASE_URL = 'wss://ai-detect.undetectable.ai';
const DEFAULT_MODEL = 'xlm_ud_detector';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type SleepLike = (ms: number) => Promise<void>;

interface DetectorDeps {
  apiKey: string;
  userId?: string;          // 可选：仅句子级 WebSocket 流程需要
  baseUrl?: string;
  wsBaseUrl?: string;
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  perCallTimeoutMs?: number;
  // 句子级总超时（从建连到 document_done）
  sentenceTotalTimeoutMs?: number;
}

export interface DetectedSentence {
  chunk: string;       // 句子原文
  result: number;      // AI 概率 0-1 浮点
  label?: string;      // 'Human' | 'AI'（Undetectable 附带的分类，前端可选用）
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
  /** 句子级结果（仅 detectAiWithSentences 返回非空；篇章级 detectAi 返回 undefined） */
  sentences?: DetectedSentence[];
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
  userId,
  baseUrl = DEFAULT_BASE_URL,
  wsBaseUrl = DEFAULT_WS_BASE_URL,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  // 检测 API 官方说 2-4 秒出结果，开始用 2s 间隔，最多 150 次 = 5 分钟上限
  pollIntervalMs = 2000,
  maxPollAttempts = 150,
  perCallTimeoutMs = 20_000,
  sentenceTotalTimeoutMs = 15 * 60 * 1000, // 句子级硬超时 15 min
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
   * 提交检测。
   * - 不传 clientDocumentId 走篇章级老行为：服务器生成 id 返回
   * - 传 clientDocumentId 走句子级 WebSocket 流程：服务器复用客户端从 WebSocket 拿到的 id
   */
  async function submitDetection(text: string, clientDocumentId?: string): Promise<string> {
    if (!text || text.trim().length === 0) {
      throw new Error('检测文本为空');
    }
    const payload: Record<string, unknown> = {
      text,
      key: apiKey,
      model: DEFAULT_MODEL,
      retry_count: 0,
    };
    if (clientDocumentId) {
      payload.id = clientDocumentId;
    }
    const data = await postJson<SubmitDetectionResponse>('/detect', payload);

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

  /**
   * 句子级检测：WebSocket 流程。
   * 步骤：
   *   1. 建 WebSocket wss://.../ws/$USER_ID
   *   2. send { event_type: 'document_watch', api_key }
   *   3. recv { event_type: 'document_id', document_id }
   *   4. 调 REST POST /detect，body 带上一步的 document_id
   *   5. recv { event_type: 'document_chunk', chunk, result, label } × N
   *   6. recv { event_type: 'document_done', result }
   *   7. 并行调 REST /query 拿整体分 + 8 家 detector scores
   *   8. 关闭 WebSocket
   *
   * 任何一步失败都抛错（调用方负责退款 + 标 failed）。
   */
  async function detectAiWithSentences(text: string): Promise<DetectAiResult> {
    if (!userId) {
      throw new Error(
        'Undetectable USER_ID 未配置，句子级检测不可用。请在服务端 env 补 UNDETECTABLE_USER_ID。',
      );
    }
    if (!text || text.trim().length === 0) {
      throw new Error('检测文本为空');
    }

    const wsUrl = `${wsBaseUrl}/ws/${userId}`;

    return new Promise<DetectAiResult>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      const sentences: DetectedSentence[] = [];
      let documentId: string | null = null;
      let settled = false;
      let totalTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (totalTimeoutTimer) {
          clearTimeout(totalTimeoutTimer);
          totalTimeoutTimer = null;
        }
        try {
          if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
            ws.close();
          }
        } catch {
          /* ignore */
        }
      };

      const settle = (result: DetectAiResult | null, error: Error | null) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (error) reject(error);
        else if (result) resolve(result);
        else reject(new Error('detectAiWithSentences internal error'));
      };

      totalTimeoutTimer = setTimeout(() => {
        settle(null, new Error(`Undetectable 句子级检测超时（${sentenceTotalTimeoutMs}ms）`));
      }, sentenceTotalTimeoutMs);

      ws.on('open', () => {
        try {
          ws.send(JSON.stringify({ event_type: 'document_watch', api_key: apiKey }));
        } catch (err) {
          settle(null, err instanceof Error ? err : new Error(String(err)));
        }
      });

      ws.on('message', async (data) => {
        let evt: Record<string, any>;
        try {
          evt = JSON.parse(data.toString());
        } catch (err) {
          settle(null, new Error('WebSocket 消息解析失败'));
          return;
        }

        try {
          if (evt.event_type === 'document_id') {
            if (!evt.success || !evt.document_id) {
              settle(null, new Error(evt.error || 'document_watch 失败'));
              return;
            }
            documentId = evt.document_id as string;

            // 用这个 documentId 调 REST /detect 提交检测
            await submitDetection(text, documentId);
          } else if (evt.event_type === 'document_chunk') {
            if (typeof evt.chunk === 'string' && typeof evt.result === 'number') {
              sentences.push({
                chunk: evt.chunk,
                result: evt.result,
                label: typeof evt.label === 'string' ? evt.label : undefined,
              });
            }
          } else if (evt.event_type === 'document_done') {
            if (!documentId) {
              settle(null, new Error('document_done 到达时 documentId 为空'));
              return;
            }

            // 调 /query 拿整体分 + 8 家 detector scores（字段格式和 REST 篇章级一样）
            const query = await queryDetection(documentId);
            const overall = typeof query.result === 'number' ? query.result : null;
            const hasDetails = query.result_details && Object.keys(query.result_details).length > 0;
            if (overall === null || !hasDetails) {
              // 退一步用 document_done 里的 result（0-1 浮点 → 转 0-100）
              const fallbackOverall = typeof evt.result === 'number' ? evt.result * 100 : null;
              if (fallbackOverall === null) {
                settle(null, new Error('Undetectable 返回数据不完整'));
                return;
              }
              settle({
                documentId,
                overallScore: fallbackOverall,
                resultDetails: {},
                raw: { result: fallbackOverall, result_details: {}, status: 'done' } as DetectorQueryResponse,
                sentences,
              }, null);
              return;
            }

            settle({
              documentId,
              overallScore: overall,
              resultDetails: query.result_details || {},
              raw: query,
              sentences,
            }, null);
          } else if (evt.event_type === 'error' || evt.error) {
            settle(null, new Error(evt.error || evt.message || 'Undetectable WebSocket 返回错误'));
          }
        } catch (err) {
          settle(null, err instanceof Error ? err : new Error(String(err)));
        }
      });

      ws.on('error', (err) => {
        settle(null, err instanceof Error ? err : new Error(String(err)));
      });

      ws.on('close', () => {
        if (!settled) {
          settle(null, new Error('Undetectable WebSocket 连接提前关闭'));
        }
      });
    });
  }

  return {
    submitDetection,
    queryDetection,
    detectAi,
    detectAiWithSentences,
  };
}

export const undetectableDetectorClient = createUndetectableDetectorClient({
  apiKey: env.undetectableApiKey,
  userId: env.undetectableUserId,
});
