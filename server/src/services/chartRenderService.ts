/**
 * 图表渲染服务：把 Claude 输出的 chart spec 转成 PNG buffer。
 *
 * 为什么要在 server 端渲染？
 *  - sub2api 网关的 normalizeClaudeOAuthRequestBody 会强制把 tools 字段清空，
 *    所以 Claude 通过 sub2api 这条路根本没有 Code Execution 工具可用，自己生成不了图。
 *  - sub2api 也不代理 /v1/files，Files API 的路径同样断掉。
 *  - 所以唯一可行的就是让 Claude 输出一个结构化的图表配置（[CHART_BEGIN]…[CHART_END]
 *    包起来的 Chart.js v3 JSON），server 端解析后调外部渲染服务出 PNG，再嵌进 docx。
 *
 * 为什么用 QuickChart.io 而不是 chartjs-node-canvas？
 *  - chartjs-node-canvas 依赖 native canvas（cairo/pango/jpeg/gif），Railway Nixpacks
 *    构建慢，镜像多 ~150MB。价值/代价不对。
 *  - QuickChart 是 2018 年开始的公开服务，免费、无 API key、Chart.js 配置原生支持，
 *    POST /chart 直接返回 PNG buffer，对中文字符自动 fallback。开源可自托管。
 */

export interface ChartSpec {
  /** 图表 caption（"图 1：xxx" 或 "Figure 1: xxx"） */
  title: string;
  /** 期望宽度（像素），会被钳制到 [320, 720] */
  width: number;
  /** 期望高度（像素），会被钳制到 [200, 540] */
  height: number;
  /** Chart.js v3 配置对象 */
  chartjs: any;
}

export interface RenderedChart {
  spec: ChartSpec;
  /** 渲染成功的 PNG buffer，失败为 null */
  png: Buffer | null;
  /** 实际使用的宽度（钳制后） */
  width: number;
  /** 实际使用的高度（钳制后） */
  height: number;
  error?: string;
}

const QUICKCHART_URL = 'https://quickchart.io/chart';
const FETCH_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 2000;
const MAX_WIDTH = 720;
const MIN_WIDTH = 320;
const MAX_HEIGHT = 540;
const MIN_HEIGHT = 200;

function clampDimensions(spec: ChartSpec): { width: number; height: number } {
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(spec.width || 600)));
  const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(spec.height || 400)));
  return { width, height };
}

async function fetchOnce(payload: object): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(QUICKCHART_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      throw new Error(`quickchart http ${res.status}`);
    }

    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('image/png')) {
      throw new Error(`quickchart non-png content-type: ${ct}`);
    }

    const arr = await res.arrayBuffer();
    const buf = Buffer.from(arr);
    if (buf.length < 200) {
      throw new Error(`quickchart png too small: ${buf.length} bytes`);
    }
    return buf;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 渲染单张图表。失败时 retry 一次（2s 后），仍失败返回 png=null（整篇文档不 fail）。
 */
export async function renderChart(spec: ChartSpec): Promise<RenderedChart> {
  const { width, height } = clampDimensions(spec);

  const payload = {
    chart: spec.chartjs,
    width,
    height,
    format: 'png',
    backgroundColor: 'white',
    devicePixelRatio: 2,
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const png = await fetchOnce(payload);
      return { spec, png, width, height };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === 2) {
        console.warn(`[chart-render] failed for "${spec.title}": ${message}`);
        return { spec, png: null, width, height, error: message };
      }
      console.warn(
        `[chart-render] attempt 1 failed for "${spec.title}", retrying in ${RETRY_DELAY_MS}ms: ${message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  // unreachable
  return { spec, png: null, width, height, error: 'unreachable' };
}

/**
 * 并发渲染多张图表。每张独立 retry，互不影响。
 */
export async function renderCharts(specs: ChartSpec[]): Promise<RenderedChart[]> {
  if (specs.length === 0) return [];
  return Promise.all(specs.map((spec) => renderChart(spec)));
}
