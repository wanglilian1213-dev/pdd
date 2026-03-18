import { env } from './runtimeEnv';

const DEFAULT_BASE_URL = 'https://humanize.undetectable.ai';
const DEFAULT_READABILITY = 'University';
const DEFAULT_PURPOSE = 'Essay';
const DEFAULT_STRENGTH = 'More Human';
const DEFAULT_MODEL = 'v11sr';

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type SleepLike = (ms: number) => Promise<void>;

interface UndetectableDeps {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: FetchLike;
  sleepImpl?: SleepLike;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
}

interface SubmitResponse {
  id?: string;
  status?: string;
  error?: string;
}

interface DocumentResponse {
  id?: string;
  status?: string;
  output?: string;
  error?: string;
}

export interface HumanizeTextResult {
  documentId: string;
  output: string;
}

function defaultSleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  const rawText = await response.text();
  const data = rawText ? JSON.parse(rawText) as T : {} as T;

  if (!response.ok) {
    const message = (data as { error?: string; status?: string }).error
      || (data as { error?: string; status?: string }).status
      || `Undetectable 请求失败，状态码 ${response.status}`;
    throw new Error(message);
  }

  return data;
}

export function createUndetectableClient({
  apiKey,
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  sleepImpl = defaultSleep,
  pollIntervalMs = 5000,
  maxPollAttempts = 120,
}: UndetectableDeps) {
  async function postJson<T>(path: string, body: Record<string, unknown>) {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        apikey: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    return parseJsonResponse<T>(response);
  }

  async function humanizeText(content: string): Promise<HumanizeTextResult> {
    const submitResponse = await postJson<SubmitResponse>('/submit', {
      content,
      readability: DEFAULT_READABILITY,
      purpose: DEFAULT_PURPOSE,
      strength: DEFAULT_STRENGTH,
      model: DEFAULT_MODEL,
    });

    const documentId = submitResponse.id?.trim();
    if (!documentId) {
      throw new Error('Undetectable 提交成功，但没有返回文档 ID。');
    }

    for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
      const document = await postJson<DocumentResponse>('/document', { id: documentId });

      if (typeof document.output === 'string' && document.output.trim()) {
        return {
          documentId,
          output: document.output,
        };
      }

      const status = document.status?.toLowerCase() || '';
      if (status.includes('error') || status.includes('failed')) {
        throw new Error(document.error || document.status || 'Undetectable 返回了失败状态。');
      }

      if (attempt < maxPollAttempts - 1) {
        await sleepImpl(pollIntervalMs);
      }
    }

    throw new Error('Undetectable 处理超时，请稍后重试。');
  }

  return {
    humanizeText,
  };
}

export const undetectableClient = createUndetectableClient({
  apiKey: env.undetectableApiKey,
});
