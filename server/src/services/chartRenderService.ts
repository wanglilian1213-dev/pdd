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

// 容错归一化的硬性上限（与 system prompt 给 Claude 的"硬规则清单"保持一致）
const ALLOWED_CHART_TYPES = new Set([
  'line', 'bar', 'pie', 'doughnut', 'radar', 'scatter', 'bubble', 'polarArea',
]);
const MAX_LABELS = 50;
const MAX_DATASETS = 5;
const MAX_DATA_POINTS_PER_DATASET = 100;
const MAX_LABEL_LEN = 80;
const MAX_TITLE_LEN = 200;
const MAX_PAYLOAD_BYTES = 30 * 1024;

/**
 * 容错归一化：保证发给 quickchart 的 chart 配置永远合法。
 *
 * 设计原则：**绝不抛错、绝不返回 null**。Claude 输出再离谱也要尽最大努力修正
 * 出一个能渲染的合法 spec。这是用户的硬约束（"不准失败！把规则讲清楚避免非法 chart"）。
 *
 * 修正策略：
 *  - 非法 type → 退回 'bar'
 *  - 超长 labels / datasets → 截断
 *  - 非数字 data 点 → 尝试 Number()，失败则 0
 *  - 未知字段 → 丢弃（白名单）
 *  - callbacks / 函数字符串 → 丢弃
 *
 * 副作用：
 *  - 隐私收益：unknown 字段、xss payload 不会发出
 *  - 可靠性收益：超大数据集会被截断，不会撞 quickchart 的请求大小限制
 *
 * 不修正：title / label 里的中文字符。这些是用户论文的真实数据，
 * 用户已确认接受发到 quickchart 公网（不在前端加任何提示）。
 */
export function sanitizeChartSpec(spec: ChartSpec): ChartSpec {
  const cj = (spec as any)?.chartjs ?? {};

  // 1. type 白名单
  const rawType = typeof cj.type === 'string' ? cj.type : '';
  const type = ALLOWED_CHART_TYPES.has(rawType) ? rawType : 'bar';

  // 2. labels：截到 MAX_LABELS，每个字符串截到 MAX_LABEL_LEN
  const rawLabels = Array.isArray(cj?.data?.labels) ? cj.data.labels : [];
  const labels = rawLabels
    .slice(0, MAX_LABELS)
    .map((l: any) => String(l ?? '').slice(0, MAX_LABEL_LEN));

  // 3. datasets：截到 MAX_DATASETS，data 强制 number 化，截到 MAX_DATA_POINTS_PER_DATASET
  const rawDatasets = Array.isArray(cj?.data?.datasets) ? cj.data.datasets : [];
  const datasets = rawDatasets.slice(0, MAX_DATASETS).map((ds: any) => {
    const rawData = Array.isArray(ds?.data) ? ds.data : [];
    const data = rawData.slice(0, MAX_DATA_POINTS_PER_DATASET).map((v: any) => {
      // scatter/bubble 的 {x, y} / {x, y, r} 对象点保留
      if (v && typeof v === 'object' && typeof v.x === 'number' && typeof v.y === 'number') {
        const point: any = { x: v.x, y: v.y };
        if (typeof (v as any).r === 'number') point.r = (v as any).r;
        return point;
      }
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    });

    const cleaned: any = {
      label: String(ds?.label ?? '').slice(0, MAX_LABEL_LEN),
      data,
    };
    // 颜色等可选样式字段：只保留字符串/简单值，丢弃任何 callback/对象
    if (typeof ds?.backgroundColor === 'string') cleaned.backgroundColor = ds.backgroundColor;
    if (Array.isArray(ds?.backgroundColor)) {
      cleaned.backgroundColor = ds.backgroundColor
        .filter((c: any) => typeof c === 'string')
        .slice(0, MAX_LABELS);
    }
    if (typeof ds?.borderColor === 'string') cleaned.borderColor = ds.borderColor;
    if (typeof ds?.fill === 'boolean') cleaned.fill = ds.fill;
    if (typeof ds?.borderWidth === 'number') cleaned.borderWidth = ds.borderWidth;
    if (typeof ds?.tension === 'number') cleaned.tension = ds.tension;
    return cleaned;
  });

  // 4. options：只保留 plugins.{title,legend} + scales 的安全子集
  const opts = cj?.options ?? {};
  const safeOptions: any = {};
  const titleText = opts?.plugins?.title?.text;
  if (titleText) {
    safeOptions.plugins = {
      title: {
        display: true,
        text: String(titleText).slice(0, MAX_LABEL_LEN),
      },
    };
  }
  if (opts?.plugins?.legend) {
    safeOptions.plugins = safeOptions.plugins ?? {};
    safeOptions.plugins.legend = {
      display: opts.plugins.legend.display !== false,
    };
  }
  if (opts?.scales && typeof opts.scales === 'object') {
    const safeScales: any = {};
    if (opts.scales.y && typeof opts.scales.y === 'object') {
      safeScales.y = {};
      if (opts.scales.y.beginAtZero !== undefined) {
        safeScales.y.beginAtZero = !!opts.scales.y.beginAtZero;
      }
    }
    if (opts.scales.x && typeof opts.scales.x === 'object') {
      safeScales.x = {};
      if (opts.scales.x.beginAtZero !== undefined) {
        safeScales.x.beginAtZero = !!opts.scales.x.beginAtZero;
      }
    }
    if (Object.keys(safeScales).length > 0) safeOptions.scales = safeScales;
  }

  const sanitized: ChartSpec = {
    title: String(spec?.title ?? '').slice(0, MAX_TITLE_LEN) || '图表',
    width: typeof spec?.width === 'number' ? spec.width : 600,
    height: typeof spec?.height === 'number' ? spec.height : 400,
    chartjs: {
      type,
      data: { labels, datasets },
      options: safeOptions,
    },
  };

  // 5. 30KB 兜底（理论上前面截断后已不可能超）
  if (JSON.stringify(sanitized).length > MAX_PAYLOAD_BYTES) {
    sanitized.chartjs.data.datasets = sanitized.chartjs.data.datasets.slice(0, 2);
    sanitized.chartjs.data.labels = sanitized.chartjs.data.labels.slice(0, 20);
    sanitized.chartjs.data.datasets.forEach((ds: any) => {
      if (Array.isArray(ds.data)) ds.data = ds.data.slice(0, 20);
    });
  }

  return sanitized;
}

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
  // 关键：所有外发到 quickchart 公网的 chart 配置都必须先经 sanitize 归一化。
  // 这是隐私 + 可靠性双重防线，sanitize 永远返回合法 spec、绝不抛错。
  const safeSpec = sanitizeChartSpec(spec);
  const { width, height } = clampDimensions(safeSpec);

  const payload = {
    chart: safeSpec.chartjs,
    width,
    height,
    format: 'png',
    backgroundColor: 'white',
    devicePixelRatio: 2,
  };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const png = await fetchOnce(payload);
      return { spec: safeSpec, png, width, height };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (attempt === 2) {
        console.warn(`[chart-render] failed for "${safeSpec.title}": ${message}`);
        return { spec: safeSpec, png: null, width, height, error: message };
      }
      console.warn(
        `[chart-render] attempt 1 failed for "${safeSpec.title}", retrying in ${RETRY_DELAY_MS}ms: ${message}`,
      );
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }

  // unreachable
  return { spec: safeSpec, png: null, width, height, error: 'unreachable' };
}

/**
 * 并发渲染多张图表。每张独立 retry，互不影响。
 */
export async function renderCharts(specs: ChartSpec[]): Promise<RenderedChart[]> {
  if (specs.length === 0) return [];
  return Promise.all(specs.map((spec) => renderChart(spec)));
}
