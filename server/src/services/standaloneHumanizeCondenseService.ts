import { streamResponseText } from '../lib/openai';
import { env } from '../lib/runtimeEnv';
import { countWords } from './scoringMaterialService';

// 独立降 AI 专用工具：
//   1. splitBodyAndReserved —— 把上传文档分成「正文」和「保护区」（引用/附录）
//      分离后只把正文送 Undetectable 降 AI，保护区原样保留
//   2. condenseHumanizedBody —— 降 AI 后字数膨胀太多时，用 GPT-5.4 只删不改地压字数
//
// 和工作台 humanizeService.condensePaper 的区别：
//   - 工作台：降 AI **前**压缩（允许改写），目标靠 condense + humanize 两步叠加
//   - 独立版：降 AI **后**压缩（严格只删不改），对用户原始内容的改动最小

// ---------------------------------------------------------------------------
// 1. Body / Reserved 切分
// ---------------------------------------------------------------------------

/**
 * 判断某一行是否是「保护区」标题（引用列表 / 附录）。
 * 严格：标题行独立成行，长度 ≤ 40 字，忽略大小写。
 * 覆盖中英文常见标题：
 *   英文：References / Reference List / Bibliography / Works Cited / Appendix / Appendices
 *   中文：参考文献 / 附录
 * "引用"单独作为标题太容易误伤正文（文中经常出现"引用了 xxx"），故不识别。
 * Appendix 可后带编号（Appendix A / Appendix 1 / 附录一），末尾可带 : 或 ：
 */
export function isReservedHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (trimmed.length > 40) return false; // 太长不可能是标题

  // 英文引用列表标题
  if (/^(references?|reference list|bibliography|works cited)\s*:?$/i.test(trimmed)) {
    return true;
  }
  // 英文附录标题（可带单个编号 A/B/1/2 等）
  if (/^(appendix|appendices)(\s+[a-z0-9]+)?\s*:?$/i.test(trimmed)) {
    return true;
  }
  // 中文参考文献 / 附录（可带编号：附录一 / 附录 A / 附录 1）
  if (/^(参考文献|附录)(\s*[a-z0-9一二三四五六七八九十]+)?\s*[:：]?$/i.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * 把全文切成「正文 body」和「保护区 reserved」。
 * 扫描第一个匹配的保护标题，从那行开始到文末全部是 reserved。
 * 没匹配到标题 → body = 全文，reserved = 空。
 */
export function splitBodyAndReserved(text: string): { body: string; reserved: string } {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const headingIndex = lines.findIndex((line) => isReservedHeading(line));

  if (headingIndex === -1) {
    return { body: text, reserved: '' };
  }

  const body = lines.slice(0, headingIndex).join('\n').trimEnd();
  const reserved = lines.slice(headingIndex).join('\n').trimEnd();
  return { body, reserved };
}

// ---------------------------------------------------------------------------
// 2. GPT-5.4 删减
// ---------------------------------------------------------------------------

const MAX_CONDENSE_ATTEMPTS = 3;
// 单次 3 分钟（不是 5 分钟）—— 时间预算：
//   Undetectable 降 AI 基线 ~10 min + condense 3 次 × 3 min = 19 min
//   < 前端轮询总超时 20 min（POLL_TIMEOUT_HUMANIZE_MS）
//   < cleanupRuntime 兜底 45 min
// 如果改成 5 min（原默认），3 次重试 = 15 min，加 Undetectable 10 min = 25 min，
// 会撑爆前端轮询上限，用户看到"降 AI 超时"但后端还在跑。
const CONDENSE_SINGLE_TIMEOUT_MS = 3 * 60 * 1000;

function buildCondenseSystemPrompt(
  currentWords: number,
  minTargetWords: number,
  maxTargetWords: number,
): string {
  return `You are an editor whose ONLY allowed operation is DELETING whole sentences.

CURRENT TEXT: ${currentWords} words.
REDUCE to: between ${minTargetWords} and ${maxTargetWords} words.

HARD RULES (any violation = failure):
1. You MUST only delete WHOLE sentences (from one sentence terminator . ! ? 。！？ to the next).
2. You MUST NOT modify ANY remaining character — not a word, not punctuation, not capitalization, not spacing, not a comma, nothing.
3. You MUST NOT add any new content, transitions, connectives, or rewrites.
4. You MUST preserve ALL in-text citations verbatim, e.g. (Author, Year), [N], (Smith et al. 2024).
5. You MUST preserve ALL section headings verbatim (short lines like "Introduction", "Methodology", etc.).
6. You MUST preserve paragraph breaks. Remove sentences within paragraphs; do not merge paragraphs.

WHICH SENTENCES TO DELETE (in priority order):
- Redundant restatements that repeat a point already made in the previous sentence
- Transitional sentences that merely restate the previous sentence with different wording
- Verbose examples or padding that do not add new information
- Sentences beginning with filler like "It is important to note that…" / "It should be mentioned that…"
- DO NOT delete sentences that carry unique factual claims, evidence, or citations

OUTPUT:
The complete shortened text only. No Markdown. No preamble. No commentary. No JSON.`;
}

// ---------------------------------------------------------------------------
// DI 接口（便于单测 mock）
// ---------------------------------------------------------------------------

export interface CondenseDeps {
  runGpt: (input: {
    systemPrompt: string;
    text: string;
    timeoutMs: number;
  }) => Promise<{ text: string }>;
}

export const defaultCondenseDeps: CondenseDeps = {
  runGpt: async ({ systemPrompt, text, timeoutMs }) => {
    const result = await Promise.race([
      streamResponseText({
        model: env.openaiModel,
        instructions: systemPrompt,
        reasoning: { effort: 'high' as any },
        input: text,
      } as any),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('condense attempt timeout')), timeoutMs),
      ),
    ]);
    return { text: (result as { text: string }).text };
  },
};

/**
 * 只删不改地把 text 压到 [minTargetWords, maxTargetWords] 范围。
 * 重试最多 3 次：每次以上一轮输出作为新输入继续删。
 * 成功（落在范围内）→ 立即返回。
 * 3 次后仍超范围 → 返回**字数最接近目标中值**的那一轮结果（"尽力而为"）。
 *
 * 任何 GPT 异常（超时 / 返回空）会抛给调用方，由 executeStandaloneHumanize
 * 降级为"交付未删减版 B_humanized"，不让整条任务失败。
 */
export async function condenseHumanizedBody(
  text: string,
  minTargetWords: number,
  maxTargetWords: number,
  deps: CondenseDeps = defaultCondenseDeps,
): Promise<string> {
  const initialWords = countWords(text);
  const targetCenter = (minTargetWords + maxTargetWords) / 2;

  console.log(
    `[standalone-humanize-condense] start: ${initialWords} words, target ${minTargetWords}-${maxTargetWords}`,
  );

  let currentText = text;
  let bestText = text;
  let bestDistance = Math.abs(initialWords - targetCenter);
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= MAX_CONDENSE_ATTEMPTS; attempt += 1) {
    const currentWords = countWords(currentText);
    try {
      const { text: raw } = await deps.runGpt({
        systemPrompt: buildCondenseSystemPrompt(currentWords, minTargetWords, maxTargetWords),
        text: currentText,
        timeoutMs: CONDENSE_SINGLE_TIMEOUT_MS,
      });

      const resultText = (raw || '').trim();
      if (!resultText) {
        console.warn(`[standalone-humanize-condense] attempt ${attempt}: empty result`);
        lastError = new Error('GPT returned empty text');
        continue;
      }

      const resultWords = countWords(resultText);
      console.log(
        `[standalone-humanize-condense] attempt ${attempt}: ${currentWords} → ${resultWords}`,
      );

      // 在范围内 → 成功
      if (resultWords >= minTargetWords && resultWords <= maxTargetWords) {
        return resultText;
      }

      // 记录最优（距离 center 最近）
      const distance = Math.abs(resultWords - targetCenter);
      if (distance < bestDistance) {
        bestText = resultText;
        bestDistance = distance;
      }

      // 下一轮以本轮结果为输入继续删
      currentText = resultText;
    } catch (err) {
      console.warn(
        `[standalone-humanize-condense] attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      lastError = err;
      // 继续下一轮尝试，除非是最后一次
    }
  }

  // 3 次都失败
  // 如果 3 次都没产生任何有效结果（bestText === text 且 initialWords 超范围），
  // 抛错让上层降级交付未删减版。
  if (bestText === text && (initialWords < minTargetWords || initialWords > maxTargetWords)) {
    throw lastError instanceof Error ? lastError : new Error('condense failed after all retries');
  }

  console.warn(
    `[standalone-humanize-condense] 3 attempts failed range, returning best (dist=${bestDistance.toFixed(0)})`,
  );
  return bestText;
}

// ---------------------------------------------------------------------------
// 测试工具
// ---------------------------------------------------------------------------

export const standaloneHumanizeCondenseTestUtils = {
  MAX_CONDENSE_ATTEMPTS,
  CONDENSE_SINGLE_TIMEOUT_MS,
  buildCondenseSystemPrompt,
  isReservedHeading,
};
