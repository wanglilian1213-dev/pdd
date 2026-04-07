/**
 * 解析 Claude 修改输出里的图表 DSL。
 *
 * Claude 被 system prompt 要求用以下分隔符把图表配置包起来：
 *   [CHART_BEGIN]
 *   { "title": "图 1：xxx", "width": 720, "height": 440, "chartjs": {...} }
 *   [CHART_END]
 *
 * 为什么不用 markdown fenced code block？
 *  - 用户明确禁止任何代码块出现在交付物里。
 *  - 即使渲染失败也要降级成纯文字段落，不能让 ```python 之类的东西泄漏到 docx。
 *  - 自定义分隔符在普通论文里出现概率为 0，正则匹配不会误伤。
 *
 * 这个 parser 做的事：
 *  1. 把所有合法的 chart 块替换成占位 token `[[CHART_PLACEHOLDER_N]]`，让占位独占一段
 *  2. 把所有解析失败的 chart 块降级成 caption 文字「图 N：xxx（图表数据解析失败）」
 *  3. 返回 charts 数组，包含 token + 原始 spec，供下游 chartRenderService 渲染
 */

import type { ChartSpec } from './chartRenderService';

export interface ParsedRevision {
  /** 已经把 chart 块替换成占位 token 的文本 */
  text: string;
  /** 解析成功的图表，按出现顺序 */
  charts: { token: string; spec: ChartSpec }[];
}

const CHART_BLOCK_RE = /\[CHART_BEGIN\]([\s\S]*?)\[CHART_END\]/g;

function buildPlaceholderToken(index: number): string {
  return `[[CHART_PLACEHOLDER_${index}]]`;
}

function tryParseSpec(jsonRaw: string): ChartSpec | null {
  try {
    const parsed = JSON.parse(jsonRaw.trim());
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.title !== 'string' || !parsed.title.trim()) return null;
    if (!parsed.chartjs || typeof parsed.chartjs !== 'object') return null;
    return {
      title: parsed.title,
      width: typeof parsed.width === 'number' ? parsed.width : 600,
      height: typeof parsed.height === 'number' ? parsed.height : 400,
      chartjs: parsed.chartjs,
    };
  } catch {
    return null;
  }
}

export function parseRevisionOutput(raw: string): ParsedRevision {
  const charts: { token: string; spec: ChartSpec }[] = [];
  let counter = 0;

  const text = raw.replace(CHART_BLOCK_RE, (_match, jsonRaw: string) => {
    counter += 1;
    const spec = tryParseSpec(jsonRaw);

    if (!spec) {
      console.warn(
        `[revision-parser] chart block #${counter} JSON parse failed, falling back to text`,
      );
      // 占位为纯文字段，前后空行让它独占一段
      return `\n\n图 ${counter}：图表数据解析失败\n\n`;
    }

    const token = buildPlaceholderToken(counter);
    charts.push({ token, spec });
    // 占位独占一段，前后空行
    return `\n\n${token}\n\n`;
  });

  return { text, charts };
}
