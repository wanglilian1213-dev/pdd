/**
 * 图表渲染服务：把 AI 输出的 chart spec 转成 PNG buffer。
 *
 * 为什么要在 server 端渲染？
 *  - 网关不负责执行绘图工具，所以 AI 不能自己生成真实图像文件。
 *  - 所以唯一可行的就是让 AI 输出一个结构化的图表配置（[CHART_BEGIN]…[CHART_END]
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
  chartjs?: any;
  /** GraphViz 流程图 / 概念图结构 */
  diagram?: DiagramSpec;
}

export interface DiagramNodeSpec {
  id: string;
  label: string;
  shape?: 'box' | 'ellipse' | 'diamond';
}

export interface DiagramEdgeSpec {
  from: string;
  to: string;
  label?: string;
}

export interface DiagramSpec {
  type: 'flowchart' | 'concept_map' | 'mechanism';
  direction: 'TB' | 'LR';
  nodes: DiagramNodeSpec[];
  edges: DiagramEdgeSpec[];
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
const QUICKCHART_GRAPHVIZ_URL = 'https://quickchart.io/graphviz';
const FETCH_TIMEOUT_MS = 8000;
const RETRY_DELAY_MS = 2000;
const MAX_WIDTH = 720;
const MIN_WIDTH = 320;
const MAX_HEIGHT = 540;
const MIN_HEIGHT = 200;

// 容错归一化的硬性上限（与 system prompt 给 AI 的"硬规则清单"保持一致）
const ALLOWED_CHART_TYPES = new Set([
  'line', 'bar', 'pie', 'doughnut', 'radar', 'scatter', 'bubble', 'polarArea',
]);
const MAX_LABELS = 50;
const MAX_DATASETS = 5;
const MAX_DATA_POINTS_PER_DATASET = 100;
const MAX_LABEL_LEN = 80;
const MAX_TITLE_LEN = 200;
const MAX_PAYLOAD_BYTES = 30 * 1024;
const LONG_CATEGORY_LABEL_LEN = 24;
const MANY_CATEGORY_LABELS = 12;
const MAX_DIAGRAM_NODES = 30;
const MAX_DIAGRAM_EDGES = 60;
const SAFE_CHART_COLOR_NAMES = new Set([
  'black', 'white', 'gray', 'grey', 'red', 'blue', 'green', 'yellow', 'orange',
  'purple', 'pink', 'brown', 'cyan', 'magenta', 'transparent', 'navy', 'teal',
  'olive', 'lime', 'maroon', 'silver', 'gold',
]);
const SAFE_CHART_HEX_COLOR_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const SAFE_CHART_FUNCTION_COLOR_RE = /^(?:rgb|rgba|hsl|hsla)\(\s*[-+.\d%]+\s*,\s*[-+.\d%]+\s*,\s*[-+.\d%]+(?:\s*,\s*[-+.\d%]+)?\s*\)$/i;

function finiteNumber(value: unknown) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeChartText(value: unknown) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, '')
    .replace(/[_-]+/g, ' ')
    .trim();
}

function hasCoordinateDataContext(spec: ChartSpec, chartjs: any) {
  const datasets = Array.isArray(chartjs?.data?.datasets) ? chartjs.data.datasets : [];
  const text = [
    spec?.title,
    chartjs?.options?.plugins?.title?.text,
    chartjs?.options?.scales?.x?.title?.text,
    chartjs?.options?.scales?.y?.title?.text,
    ...datasets.map((dataset: any) => dataset?.label),
  ].map(normalizeChartText).join(' ');
  const hasLatitude = /\b(?:lat|latitude)\b|纬度/i.test(text);
  const hasLongitude = /\b(?:lon|lng|longitude)\b|经度/i.test(text);
  return (hasLatitude && hasLongitude) || /\b(?:gps|geo\s?location|coordinates?)\b|经纬度|坐标/i.test(text);
}

function looksLikeCoordinatePoint(x: number, y: number) {
  if (x === 0 && y === 0) return false;
  return (Math.abs(x) <= 90 && Math.abs(y) <= 180)
    || (Math.abs(x) <= 180 && Math.abs(y) <= 90);
}

function hasPreciseDecimal(value: unknown) {
  if (typeof value === 'number') {
    const [, decimals = ''] = String(value).split('.');
    return decimals.length >= 4;
  }
  if (typeof value === 'string') {
    const [, decimals = ''] = value.trim().split('.');
    return decimals.replace(/\D/g, '').length >= 4;
  }
  return false;
}

function looksLikePreciseCoordinatePoint(rawX: unknown, rawY: unknown, x: number, y: number) {
  return looksLikeCoordinatePoint(x, y) && hasPreciseDecimal(rawX) && hasPreciseDecimal(rawY);
}

function redactSensitiveChartText(value: unknown): string {
  let text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return '';

  text = text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, '[redacted secret]');
  text = text.replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[redacted secret]');
  text = text.replace(/\bsk-proj-[A-Za-z0-9_-]{10,}\b/gi, '[redacted secret]');
  text = text.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi, '[redacted secret]');
  text = text.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted secret]');
  text = text.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]');
  text = text.replace(/[-+]?\d{1,2}\.\d{4,}\s*,\s*[-+]?\d{1,3}\.\d{4,}/g, '[redacted coordinates]');
  text = text.replace(/\+?\d[\d\s().-]{7,}\d/g, (match) => {
    const digitCount = match.replace(/\D/g, '').length;
    return digitCount >= 8 ? '[redacted phone]' : match;
  });
  text = text.replace(/\b(?:MRN|medical record|patient id|participant id|subject id|SSN|NHS)\s*[:#-]?\s*[A-Z0-9-]{3,}\b/gi, '[redacted identifier]');
  text = text.replace(/(?:学号|学生号|学生编号|工号|员工号|医院号|门诊号|住院号|病案号|病历号|身份证号?|护照号|医保号|宿舍号|家庭住址|住址)\s*[:：#-]?\s*[A-Z0-9\u4e00-\u9fff-]{2,}/gi, '[已遮盖编号]');
  text = text.replace(/\b(patient|participant|subject|client)\s+(?:name\s*)?[:#-]?\s*[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3}\b/gi, '$1 [redacted name]');
  text = text.replace(/(?:学生|患者|病人|受试者|客户|员工|姓名)\s*[:：]?\s*[\u4e00-\u9fff]{2,4}/g, '[已遮盖姓名]');
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}\b/gi, '[redacted credential]');
  text = text.replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gi, '[redacted secret]');
  text = text.replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted access key]');
  text = text.replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, '[redacted secret]');
  text = text.replace(/\bsk-proj-[A-Za-z0-9_-]{10,}\b/gi, '[redacted secret]');
  text = text.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/gi, '[redacted secret]');
  text = text.replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[redacted secret]');
  text = text.replace(/\bapi\s*key\b\s*[:=]?\s*[A-Za-z0-9._~+/=-]{3,}/gi, '[redacted secret]');
  text = text.replace(/\b(?:OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|SERVICE_ROLE_KEY|API[_-]?KEY|SECRET|TOKEN|PASSWORD)\b\s*[:=]?\s*[A-Za-z0-9._~+/=-]{6,}/gi, '[redacted secret]');
  text = text.replace(/\b(?:OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|SUPABASE_ANON_KEY|SERVICE_ROLE_KEY|API[_-]?KEY|SECRET|TOKEN|PASSWORD)\b/gi, '[redacted secret]');
  text = text.replace(/\b(?:system|developer)\s+prompt\b/gi, '[redacted prompt]');

  return text;
}

function publicChartText(value: unknown, maxLength: number, fallback = ''): string {
  const redacted = redactSensitiveChartText(value).slice(0, maxLength);
  return redacted || fallback;
}

function safeChartColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const trimmed = value.replace(/\s+/g, ' ').trim();
  if (!trimmed || redactSensitiveChartText(trimmed) !== trimmed) return null;

  const lower = trimmed.toLowerCase();
  if (
    SAFE_CHART_HEX_COLOR_RE.test(trimmed) ||
    SAFE_CHART_FUNCTION_COLOR_RE.test(trimmed) ||
    SAFE_CHART_COLOR_NAMES.has(lower)
  ) {
    return trimmed.slice(0, 80);
  }

  return null;
}

/**
 * 容错归一化：保证发给 quickchart 的 chart 配置永远合法。
 *
 * 设计原则：**绝不抛错、绝不返回 null**。AI 输出再离谱也要尽最大努力修正
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
 *  - 隐私收益：邮箱、电话、病历号、受试者/客户姓名和精确坐标会在外发渲染前遮盖
 *  - 可靠性收益：超大数据集会被截断，不会撞 quickchart 的请求大小限制
 */
export function sanitizeChartSpec(spec: ChartSpec): ChartSpec {
  if (isDiagramLikeSpec(spec)) {
    return sanitizeDiagramChartSpec(spec);
  }

  const cj = (spec as any)?.chartjs ?? {};

  // 1. type 白名单
  const rawType = typeof cj.type === 'string' ? cj.type : '';
  let type = ALLOWED_CHART_TYPES.has(rawType) ? rawType : 'bar';

  // 2. labels：截到 MAX_LABELS，每个字符串截到 MAX_LABEL_LEN
  const rawLabels = Array.isArray(cj?.data?.labels) ? cj.data.labels : [];
  let labels = rawLabels
    .slice(0, MAX_LABELS)
    .map((label: any) => publicChartText(label, MAX_LABEL_LEN));
  const labelsWereTruncated = rawLabels.length > labels.length;
  const coordinateDataContext = hasCoordinateDataContext(spec, cj);

  // 3. datasets：截到 MAX_DATASETS，data 强制 number 化，截到 MAX_DATA_POINTS_PER_DATASET
  const rawDatasets = Array.isArray(cj?.data?.datasets) ? cj.data.datasets : [];
  const datasets = rawDatasets.slice(0, MAX_DATASETS).map((ds: any) => {
    const rawData = Array.isArray(ds?.data) ? ds.data : [];
    const maxDataPoints = labelsWereTruncated && labels.length > 0
      ? Math.min(MAX_DATA_POINTS_PER_DATASET, labels.length)
      : MAX_DATA_POINTS_PER_DATASET;
    const data = rawData.slice(0, maxDataPoints).map((v: any) => {
      // scatter/bubble 的 {x, y} / {x, y, r} 对象点保留
      if (v && typeof v === 'object') {
        const x = finiteNumber(v.x);
        const y = finiteNumber(v.y);
        if (x !== null && y !== null) {
          const shouldRedactPoint = (coordinateDataContext && looksLikeCoordinatePoint(x, y))
            || looksLikePreciseCoordinatePoint(v.x, v.y, x, y);
          const point: any = shouldRedactPoint
            ? { x: 0, y: 0 }
            : { x, y };
          const r = finiteNumber((v as any).r);
          if (r !== null) point.r = r;
          return point;
        }
      }
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string') {
        const n = finiteNumber(v);
        if (n !== null) return n;
      }
      return 0;
    });

    const cleaned: any = {
      label: publicChartText(ds?.label, MAX_LABEL_LEN),
      data,
    };
    // 颜色等可选样式字段：只保留字符串/简单值，丢弃任何 callback/对象
    const backgroundColor = safeChartColor(ds?.backgroundColor);
    if (backgroundColor) cleaned.backgroundColor = backgroundColor;
    if (Array.isArray(ds?.backgroundColor)) {
      const backgroundColors = ds.backgroundColor
        .map((color: any) => safeChartColor(color))
        .filter((color: string | null): color is string => Boolean(color))
        .slice(0, labelsWereTruncated && labels.length > 0 ? labels.length : MAX_LABELS);
      if (backgroundColors.length > 0) cleaned.backgroundColor = backgroundColors;
    }
    const borderColor = safeChartColor(ds?.borderColor);
    if (borderColor) cleaned.borderColor = borderColor;
    if (typeof ds?.fill === 'boolean') cleaned.fill = ds.fill;
    if (typeof ds?.borderWidth === 'number') cleaned.borderWidth = ds.borderWidth;
    if (typeof ds?.tension === 'number') cleaned.tension = ds.tension;
    return cleaned;
  });

  if (labels.length > 0 && type !== 'scatter' && type !== 'bubble') {
    const datasetLengths = datasets
      .map((dataset: any) => Array.isArray(dataset.data) ? dataset.data.length : 0)
      .filter((length: number) => length > 0);
    const alignedLength = datasetLengths.length > 0 ? Math.min(labels.length, ...datasetLengths) : labels.length;
    labels = labels.slice(0, alignedLength);
    datasets.forEach((dataset: any) => {
      if (Array.isArray(dataset.data)) dataset.data = dataset.data.slice(0, alignedLength);
      if (Array.isArray(dataset.backgroundColor)) dataset.backgroundColor = dataset.backgroundColor.slice(0, alignedLength);
    });
  }

  if (isShareChartType(type) && hasNegativeChartValue(datasets)) {
    type = 'bar';
  } else if (isShareChartType(type) && labelsLookLikeTimeSeries(labels)) {
    type = 'line';
  }

  // 4. options：只保留 plugins.{title,legend} + scales 的安全子集
  const opts = cj?.options ?? {};
  const safeOptions: any = {};
  const titleText = opts?.plugins?.title?.text;
  if (titleText) {
    safeOptions.plugins = {
      title: {
        display: true,
        text: publicChartText(titleText, MAX_TITLE_LEN),
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
    const safeYScale = sanitizeAxisScale(opts.scales.y);
    const safeXScale = sanitizeAxisScale(opts.scales.x);
    if (safeYScale) safeScales.y = safeYScale;
    if (safeXScale) safeScales.x = safeXScale;
    if (Object.keys(safeScales).length > 0) safeOptions.scales = safeScales;
  }
  if (opts?.indexAxis === 'x' || opts?.indexAxis === 'y') {
    safeOptions.indexAxis = opts.indexAxis;
  }

  const hardToReadCategoryLabels =
    labels.length > MANY_CATEGORY_LABELS ||
    labels.some((label: string) => label.length > LONG_CATEGORY_LABEL_LEN);
  const requestedHeight =
    typeof spec?.height === 'number' && Number.isFinite(spec.height) ? spec.height : 400;
  const readableHeight =
    type === 'bar' && hardToReadCategoryLabels
      ? Math.min(MAX_HEIGHT, Math.max(requestedHeight, 440, 220 + labels.length * 16))
      : requestedHeight;
  if (type === 'bar' && hardToReadCategoryLabels) {
    safeOptions.indexAxis = 'y';
  }

  const sanitized: ChartSpec = {
    title: publicChartText(spec?.title, MAX_TITLE_LEN, '图表'),
    width: typeof spec?.width === 'number' && Number.isFinite(spec.width) ? spec.width : 600,
    height: readableHeight,
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

function isShareChartType(type: string) {
  return type === 'pie' || type === 'doughnut' || type === 'polarArea';
}

function hasNegativeChartValue(datasets: Array<{ data?: unknown[] }>) {
  return datasets.some((dataset) => (dataset.data || []).some((value: any) => {
    if (typeof value === 'number') return value < 0;
    if (value && typeof value === 'object' && typeof value.y === 'number') return value.y < 0;
    return false;
  }));
}

function labelsLookLikeTimeSeries(labels: string[]) {
  if (labels.length < 3) return false;
  const timeLikeCount = labels.filter((label) => /^(?:\d{4}(?:[-/]\d{1,2})?|q[1-4]\s*\d{4}|jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec|一月|二月|三月|四月|五月|六月|七月|八月|九月|十月|十一月|十二月)/i.test(label.trim())).length;
  return timeLikeCount >= Math.ceil(labels.length * 0.7);
}

function isDiagramLikeSpec(spec: ChartSpec) {
  const diagram = (spec as any)?.diagram;
  return !!diagram && typeof diagram === 'object';
}

function sanitizeDiagramChartSpec(spec: ChartSpec): ChartSpec {
  const diagram = (spec as any).diagram ?? {};
  const rawNodes = Array.isArray(diagram.nodes) ? diagram.nodes.slice(0, MAX_DIAGRAM_NODES) : [];
  const rawEdges = Array.isArray(diagram.edges) ? diagram.edges.slice(0, MAX_DIAGRAM_EDGES) : [];
  const idMap = new Map<string, string>();

  const nodes = rawNodes
    .map((node: any, index: number) => {
      const rawId = String(node?.id ?? '').trim();
      const labelSource = (node?.label ?? rawId) || `Step ${index + 1}`;
      const label = publicChartText(labelSource, MAX_LABEL_LEN);
      if (!label) return null;

      const safeId = `n${index + 1}`;
      if (rawId) idMap.set(rawId, safeId);
      idMap.set(label, safeId);

      const shape = node?.shape === 'ellipse' || node?.shape === 'diamond' ? node.shape : 'box';
      return { id: safeId, label, shape };
    })
    .filter((node: DiagramNodeSpec | null): node is DiagramNodeSpec => !!node);

  const edges = rawEdges
    .map((edge: any) => {
      const from = idMap.get(String(edge?.from ?? '').trim());
      const to = idMap.get(String(edge?.to ?? '').trim());
      if (!from || !to || from === to) return null;

      const label = publicChartText(edge?.label, MAX_LABEL_LEN);
      return label ? { from, to, label } : { from, to };
    })
    .filter((edge: DiagramEdgeSpec | null): edge is DiagramEdgeSpec => !!edge);

  const direction = diagram.direction === 'LR' ? 'LR' : 'TB';
  const type =
    diagram.type === 'concept_map' || diagram.type === 'mechanism'
      ? diagram.type
      : 'flowchart';

  return {
    title: publicChartText(spec?.title, MAX_TITLE_LEN, '图示'),
    width: typeof spec?.width === 'number' && Number.isFinite(spec.width) ? spec.width : 720,
    height: typeof spec?.height === 'number' && Number.isFinite(spec.height) ? spec.height : 440,
    diagram: { type, direction, nodes, edges },
  };
}

function sanitizeAxisScale(scale: any): any | null {
  if (!scale || typeof scale !== 'object') return null;

  const safeScale: any = {};
  if (scale.beginAtZero !== undefined) {
    safeScale.beginAtZero = !!scale.beginAtZero;
  }

  const titleText = scale?.title?.text;
  if (titleText) {
    safeScale.title = {
      display: scale.title.display !== false,
      text: publicChartText(titleText, MAX_LABEL_LEN),
    };
  }

  const safeTicks = sanitizeAxisTicks(scale.ticks);
  if (safeTicks) safeScale.ticks = safeTicks;

  return Object.keys(safeScale).length > 0 ? safeScale : null;
}

function sanitizeAxisTicks(ticks: any): any | null {
  if (!ticks || typeof ticks !== 'object') return null;

  const safeTicks: any = {};
  if (typeof ticks.autoSkip === 'boolean') safeTicks.autoSkip = ticks.autoSkip;
  if (typeof ticks.maxRotation === 'number' && Number.isFinite(ticks.maxRotation)) {
    safeTicks.maxRotation = clampRotation(ticks.maxRotation);
  }
  if (typeof ticks.minRotation === 'number' && Number.isFinite(ticks.minRotation)) {
    safeTicks.minRotation = clampRotation(ticks.minRotation);
  }

  return Object.keys(safeTicks).length > 0 ? safeTicks : null;
}

function clampRotation(value: number): number {
  return Math.min(90, Math.max(0, Math.round(value)));
}

function clampDimensions(spec: ChartSpec): { width: number; height: number } {
  const width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(spec.width || 600)));
  const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(spec.height || 400)));
  return { width, height };
}

function escapeDotLabel(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, ' ');
}

function buildGraphvizDot(diagram: DiagramSpec): string {
  if (diagram.nodes.length < 2 || diagram.edges.length < 1) {
    throw new Error('diagram has too few nodes or edges');
  }

  const nodeLines = diagram.nodes.map((node) => {
    const attrs = [
      `label="${escapeDotLabel(node.label)}"`,
      `shape="${node.shape || 'box'}"`,
      'style="rounded,filled"',
      'color="#334155"',
      'fillcolor="#f8fafc"',
    ];
    return `  ${node.id} [${attrs.join(', ')}];`;
  });

  const edgeLines = diagram.edges.map((edge) => {
    const attrs = edge.label ? ` [label="${escapeDotLabel(edge.label)}"]` : '';
    return `  ${edge.from} -> ${edge.to}${attrs};`;
  });

  return [
    'digraph G {',
    `  graph [rankdir=${diagram.direction}, bgcolor="white", pad="0.2", nodesep="0.5", ranksep="0.7"];`,
    '  node [fontname="Arial", fontsize=18];',
    '  edge [fontname="Arial", fontsize=14, color="#334155", arrowsize=0.8];',
    ...nodeLines,
    ...edgeLines,
    '}',
  ].join('\n');
}

async function fetchOnce(url: string, payload: object): Promise<Buffer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
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

  const url = safeSpec.diagram ? QUICKCHART_GRAPHVIZ_URL : QUICKCHART_URL;
  let payload: object;
  try {
    payload = safeSpec.diagram
      ? {
        graph: buildGraphvizDot(safeSpec.diagram),
        layout: 'dot',
        format: 'png',
        width,
        height,
      }
      : {
        chart: safeSpec.chartjs,
        width,
        height,
        format: 'png',
        backgroundColor: 'white',
        devicePixelRatio: 2,
      };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[chart-render] failed for "${safeSpec.title}": ${message}`);
    return { spec: safeSpec, png: null, width, height, error: message };
  }

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const png = await fetchOnce(url, payload);
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
