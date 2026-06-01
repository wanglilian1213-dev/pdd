import JSZip from 'jszip';
import { supabaseAdmin } from '../lib/supabase';
import type { StoredMaterialFile } from './materialInputService';

export interface NumericColumnSummary {
  count: number;
  min: number;
  max: number;
  mean: number;
  sum?: number;
  median?: number;
  standardDeviation?: number;
  outlierCount?: number;
  unit?: string;
  mixedUnits?: string[];
}

export interface DateColumnSummary {
  count: number;
  min: string;
  max: string;
  invalidCount?: number;
}

export interface GroupedNumericColumnSummary {
  groupColumn: string;
  valueColumn: string;
  groups: Record<string, NumericColumnSummary>;
}

export interface WeightedAverageSummary {
  valueColumn: string;
  weightColumn: string;
  weightedMean: number;
  totalWeight: number;
  usedRows: number;
  skippedRows: number;
  zeroOrNegativeWeightRows: number;
  unit?: string;
}

export interface RatioMetricSummary {
  numeratorColumn: string;
  denominatorColumn: string;
  ratio: NumericColumnSummary;
  zeroDenominatorRows: number;
  usedRows: number;
  skippedRows: number;
}

export type StructuredDataAnalysisResult =
  | { status: 'not_required' }
  | { status: 'missing_data_file'; reason: string }
  | { status: 'failed'; filename?: string; reason: string }
  | {
      status: 'completed';
      filename: string;
      rowCount: number;
      columns: string[];
      numericColumns: Record<string, NumericColumnSummary>;
      dateColumns?: Record<string, DateColumnSummary>;
      groupedNumericColumns?: Record<string, GroupedNumericColumnSummary>;
      weightedAverages?: WeightedAverageSummary[];
      ratioMetrics?: RatioMetricSummary[];
      missingValues: Record<string, number>;
      invalidNumericValues: Record<string, number>;
      resultJson: string;
      summary: string;
      files?: Array<{
        filename: string;
        rowCount: number;
        columns: string[];
        numericColumns: Record<string, NumericColumnSummary>;
        dateColumns?: Record<string, DateColumnSummary>;
        groupedNumericColumns?: Record<string, GroupedNumericColumnSummary>;
        weightedAverages?: WeightedAverageSummary[];
        ratioMetrics?: RatioMetricSummary[];
        missingValues: Record<string, number>;
        invalidNumericValues: Record<string, number>;
      }>;
    };

interface AnalyzeDelimitedOptions {
  filename: string;
  delimiter: Delimiter;
}

type Delimiter = ',' | '\t' | ';';

interface ParsedNumericCell {
  value: number;
  unit?: string;
}

interface UnitConversion {
  family: string;
  baseUnit: string;
  factorToBase: number;
}

interface ColumnScaleHint {
  factor: number;
}

interface RunStructuredDataAnalysisOptions {
  required: boolean;
  downloadMaterial?: (storagePath: string) => Promise<Blob>;
}

const DATA_FILE_EXTENSIONS = new Set(['csv', 'tsv', 'json', 'xlsx']);
const UNSAFE_EVIDENCE_LABEL_RE = /\b(?:ignore|disregard)\s+(?:all\s+)?(?:previous|above|system|developer)\s+instructions\b|\bprint\s+(?:the\s+)?(?:api key|secret|system prompt)\b|输出.*(?:密钥|系统提示词|后台提示词)|忽略.*(?:规则|指令|要求)|\b(?:OPENAI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY|API[_-]?KEY|SECRET|TOKEN|PASSWORD|system prompt|developer prompt)\b/i;
const FORMULA_LIKE_EVIDENCE_LABEL_RE = /^[\s"'`]*[=@+]/;
const PRIVATE_EVIDENCE_LABEL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|[-+]?\d{1,2}\.\d{4,}\s*,\s*[-+]?\d{1,3}\.\d{4,}|\+?\d[\d\s().-]{7,}\d|\b(?:MRN|medical record|patient id|participant id|subject id|SSN|NHS)\s*[:#-]?\s*[A-Z0-9-]{3,}\b|(?:学号|学生号|学生编号|工号|员工号|医院号|门诊号|住院号|病案号|病历号|身份证号?|护照号|医保号|宿舍号|家庭住址|住址)\s*[:：#-]?\s*[A-Z0-9\u4e00-\u9fff-]{2,}/i;
const PRIVATE_EVIDENCE_COLUMN_RE = /\b(?:email|e mail|phone|mobile|tel|telephone|contact|address|postcode|postal code|zip|zip code|zipcode|date of birth|birth date|birth day|birthday|dob|latitude|longitude|lat|lon|lng|gps|coordinate|coordinates|id|ids|identifier|record id|record no|record number|case id|case no|case number|mrn|medical record|ssn|passport|student id|student no|employee id|hospital id|outpatient id|inpatient id|passport|patient name|patient id|participant name|participant id|participant no|subject name|subject id|subject no|client name|client id)\b|邮箱|电话|手机|联系方式|地址|邮编|出生日期|生日|经纬度|纬度|经度|坐标|身份证|护照号|病历号|病案号|编号|序号|记录号|个案号|学号|学生号|学生编号|工号|员工号|医院号|门诊号|住院号|医保号|宿舍号|家庭住址|姓名|名字|学生姓名|患者姓名|受试者姓名|员工姓名/i;
const CHINESE_PERSON_NAME_RE = /^(?:张|王|李|赵|陈|刘|杨|黄|周|吴|徐|孙|胡|朱|高|林|何|郭|马|罗|梁|宋|郑|谢|韩|唐|冯|于|董|萧|程|曹|袁|邓|许|傅|沈|曾|彭|吕|苏|卢|蒋|蔡|贾|丁|魏|薛|叶|阎|余|潘|杜|戴|夏|钟|汪|田|任|姜|范|方|石|姚|谭|廖|邹|熊|金|陆|郝|孔|白|崔|康|毛|邱|秦|江|史|顾|侯|邵|孟|龙|万|段|雷|钱|汤|尹|黎|易|常|武|乔|贺|赖|龚|文)[\u4e00-\u9fff]{1,2}$/;

function normalizeEvidenceText(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F]/g, '')
    .trim();
}

function isUnsafeEvidenceLabel(value: string) {
  const normalized = normalizeEvidenceText(value);
  return UNSAFE_EVIDENCE_LABEL_RE.test(normalized)
    || FORMULA_LIKE_EVIDENCE_LABEL_RE.test(normalized)
    || PRIVATE_EVIDENCE_LABEL_RE.test(normalized)
    || CHINESE_PERSON_NAME_RE.test(normalized);
}

function isPrivateEvidenceColumn(column: string) {
  return PRIVATE_EVIDENCE_COLUMN_RE.test(normalizeEvidenceText(column).replace(/[_-]+/g, ' '));
}

function publicEvidenceColumns(columns: string[]) {
  return columns.filter((column) => !isPrivateEvidenceColumn(column) && !isUnsafeEvidenceLabel(column));
}

function safeEvidenceName(value: string, fallback: string) {
  const normalized = normalizeEvidenceText(value)
    .split(/[\\/]+/)
    .pop()
    ?.replace(/\s+/g, ' ')
    .trim() || '';

  if (!normalized || isUnsafeEvidenceLabel(normalized) || isPrivateEvidenceColumn(normalized)) {
    return fallback;
  }

  return normalized;
}

function getExtension(filename: string) {
  return filename.toLowerCase().split('.').pop() || '';
}

function safeDataFilename(filename: string) {
  const ext = getExtension(filename);
  return safeEvidenceName(filename, ext ? `redacted-data-file.${ext}` : 'redacted-data-file');
}

function safeWorksheetName(sheetName: string, index: number) {
  return safeEvidenceName(sheetName, `redacted-sheet-${index + 1}`);
}

function isStructuredDataFile(file: StoredMaterialFile) {
  const ext = getExtension(file.original_name);
  if (DATA_FILE_EXTENSIONS.has(ext)) return true;
  const mime = String(file.mime_type || '').toLowerCase();
  return mime === 'text/csv'
    || mime === 'text/tab-separated-values'
    || mime === 'application/json'
    || mime === 'text/json'
    || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
}

function isLegacyExcelFile(file: StoredMaterialFile) {
  const ext = getExtension(file.original_name);
  const mime = String(file.mime_type || '').toLowerCase();
  return ext === 'xls' || mime === 'application/vnd.ms-excel';
}

function splitDelimitedLine(line: string, delimiter: Delimiter) {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    const next = line[i + 1];

    if (char === '"' && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function splitDelimitedRecords(text: string) {
  const records: string[] = [];
  let current = '';
  let inQuotes = false;
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]!;
    const next = normalized[index + 1];

    if (char === '"' && next === '"') {
      current += '""';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      current += char;
      continue;
    }

    if (char === '\n' && !inQuotes) {
      const record = current.trim();
      if (record) records.push(record);
      current = '';
      continue;
    }

    current += char;
  }

  const record = current.trim();
  if (record) records.push(record);
  return records;
}

function roundMetric(value: number) {
  return Number(value.toFixed(4));
}

function medianOf(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function standardDeviationOf(values: number[], mean: number) {
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(variance);
}

function countExtremeOutliers(values: number[], median: number) {
  const spread = Math.max(100, Math.abs(median) * 10);
  return values.filter((value) => Math.abs(value - median) > spread).length;
}

function summarizeNumericValues(values: number[], unit?: string): NumericColumnSummary {
  const total = values.reduce((sum, value) => sum + value, 0);
  const mean = total / values.length;
  const median = medianOf(values);
  const summary: NumericColumnSummary = {
    count: values.length,
    min: roundMetric(Math.min(...values)),
    max: roundMetric(Math.max(...values)),
    mean: roundMetric(mean),
    sum: roundMetric(total),
    median: roundMetric(median),
    standardDeviation: roundMetric(standardDeviationOf(values, mean)),
    outlierCount: countExtremeOutliers(values, median),
  };
  if (unit) summary.unit = unit;
  return summary;
}

function parseLocalizedNumber(value: string) {
  const trimmed = value.replace(/\s+/g, '');
  const sign = trimmed.startsWith('-') ? '-' : '';
  const unsigned = trimmed.replace(/^[-+]/, '');
  let normalized = unsigned;

  if (/^\d{1,3}(?:\.\d{3})+,\d+$/.test(unsigned)) {
    normalized = unsigned.replace(/\./g, '').replace(',', '.');
  } else if (/^\d+,\d+$/.test(unsigned)) {
    const decimalPart = unsigned.split(',')[1] || '';
    normalized = decimalPart.length === 3 ? unsigned.replace(/,/g, '') : unsigned.replace(',', '.');
  } else if (/^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(unsigned)) {
    normalized = unsigned.replace(/,/g, '');
  } else {
    normalized = unsigned.replace(/,/g, '');
  }

  if (!/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(normalized)) return null;
  return Number(`${sign}${normalized}`);
}

function canonicalUnit(unit: string) {
  const normalized = unit.trim().toLowerCase();
  const map: Record<string, string> = {
    'mg/l': 'mg/L',
    kwh: 'kWh',
    kg: 'kg',
    g: 'g',
    mg: 'mg',
    ppm: 'ppm',
    ms: 'ms',
    kn: 'kN',
    n: 'N',
    mpa: 'MPa',
    kpa: 'kPa',
    gpa: 'GPa',
    mm: 'mm',
    cm: 'cm',
    m: 'm',
    psi: 'psi',
    ksi: 'ksi',
    kip: 'kip',
    kips: 'kips',
    lb: 'lb',
    lbs: 'lbs',
    ton: 'ton',
    tons: 'tons',
    tonne: 'tonne',
    tonnes: 'tonnes',
    inch: 'inch',
    inches: 'inches',
    in: 'in',
    '°c': '°C',
    c: 'C',
    '%': '%',
  };
  return map[normalized] || unit.trim();
}

function parseNumericCell(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  if (/^(?:true|false)$/i.test(raw)) {
    return { value: /^true$/i.test(raw) ? 1 : 0, unit: '%' };
  }

  const accountingNegative = raw.match(/^\((.*)\)$/);
  const signedRaw = accountingNegative ? `-${accountingNegative[1]}` : raw;
  const percentValue = /%$/.test(signedRaw.trim());

  let withoutCurrency = signedRaw
    .replace(/^([+-]?)\s*[$£€¥￥]+/, '$1')
    .replace(/(?:元|usd|rmb|cny|%)$/i, '')
    .trim();

  const multiplierMatch = withoutCurrency.match(/^([-+]?\d+(?:\.\d+)?)\s*([kK]|M|万|万元|百万|[Mm]illion)$/);
  if (multiplierMatch) {
    const multiplier = multiplierMatch[2]!.toLowerCase();
    const factor = multiplier === 'k'
      ? 1000
      : multiplier === '万' || multiplier === '万元'
        ? 10_000
        : 1_000_000;
    return { value: Number(multiplierMatch[1]) * factor };
  }

  const unitMatch = withoutCurrency.match(/^(.+?)\s*(kg|g|mg\/l|mg|kwh|ppm|ms|kn|n|kpa|mpa|gpa|mm|cm|m|psi|ksi|kips?|lbs?|tons?|tonnes?|inches|inch|in|°c|c)$/i);
  let unit: string | undefined;
  if (unitMatch) {
    withoutCurrency = unitMatch[1]!.trim();
    unit = canonicalUnit(unitMatch[2]!);
  }

  const uncertaintyMatch = withoutCurrency.match(/^([-+]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?)\s*(?:±|\+\/-)\s*[-+]?\d+(?:[.,]\d+)?(?:e[+-]?\d+)?$/i);
  if (uncertaintyMatch) {
    withoutCurrency = uncertaintyMatch[1]!;
  }

  const parsed = parseLocalizedNumber(withoutCurrency);
  if (parsed === null || !Number.isFinite(parsed)) {
    return null;
  }

  return { value: percentValue ? parsed / 100 : parsed, unit: percentValue ? '%' : unit };
}

function isSuppressedNumericCell(value: string) {
  return /^(?:<|>|<=|>=|≤|≥)\s*[-+]?\d+(?:[.,]\d+)?\s*$/u.test(String(value || '').trim());
}

function columnScaleHint(column: string): ColumnScaleHint | null {
  const normalized = column
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .toLowerCase();

  if (/\b百万\b|百万|(?:\((?=[^)]*(?:[$£€¥￥]|usd|rmb|cny)?\s*(?:m|million))[^)]*\))|\bin\s+millions?\b/.test(normalized)) {
    return { factor: 1_000_000 };
  }

  if (/万元|万\s*元/.test(normalized)) {
    return { factor: 10_000 };
  }

  if (/(?:\((?=[^)]*(?:[$£€¥￥]|usd|rmb|cny)?\s*(?:0{3}|'000|000s|k|thousand))[^)]*\))|\bin\s+thousands?\b/.test(normalized)) {
    return { factor: 1000 };
  }

  return null;
}

function isPlainHeaderScaledNumber(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return false;

  const accountingNegative = raw.match(/^\((.*)\)$/);
  const signedRaw = accountingNegative ? `-${accountingNegative[1]}` : raw;
  const withoutCurrency = signedRaw
    .replace(/^([+-]?)\s*[$£€¥￥]+/, '$1')
    .replace(/(?:元|usd|rmb|cny)$/i, '')
    .trim();

  return parseLocalizedNumber(withoutCurrency) !== null;
}

function applyColumnScaleHint(parsedValues: Array<ParsedNumericCell | null>, rawValues: string[], hint: ColumnScaleHint | null) {
  if (!hint) return parsedValues;
  return parsedValues.map((parsed, index) => {
    if (!parsed || !isPlainHeaderScaledNumber(rawValues[index] || '')) return parsed;
    return { ...parsed, value: parsed.value * hint.factor };
  });
}

function unitConversionFor(unit: string | undefined): UnitConversion | null {
  const conversions: Record<string, UnitConversion> = {
    kg: { family: 'mass', baseUnit: 'kg', factorToBase: 1 },
    g: { family: 'mass', baseUnit: 'kg', factorToBase: 0.001 },
    mg: { family: 'mass', baseUnit: 'kg', factorToBase: 0.000001 },
    m: { family: 'length', baseUnit: 'm', factorToBase: 1 },
    cm: { family: 'length', baseUnit: 'm', factorToBase: 0.01 },
    mm: { family: 'length', baseUnit: 'm', factorToBase: 0.001 },
    N: { family: 'force', baseUnit: 'N', factorToBase: 1 },
    kN: { family: 'force', baseUnit: 'N', factorToBase: 1000 },
    kip: { family: 'force', baseUnit: 'N', factorToBase: 4448.2216 },
    kips: { family: 'force', baseUnit: 'N', factorToBase: 4448.2216 },
    lb: { family: 'mass', baseUnit: 'kg', factorToBase: 0.45359237 },
    lbs: { family: 'mass', baseUnit: 'kg', factorToBase: 0.45359237 },
    ton: { family: 'mass', baseUnit: 'kg', factorToBase: 1000 },
    tons: { family: 'mass', baseUnit: 'kg', factorToBase: 1000 },
    tonne: { family: 'mass', baseUnit: 'kg', factorToBase: 1000 },
    tonnes: { family: 'mass', baseUnit: 'kg', factorToBase: 1000 },
    in: { family: 'length', baseUnit: 'm', factorToBase: 0.0254 },
    inch: { family: 'length', baseUnit: 'm', factorToBase: 0.0254 },
    inches: { family: 'length', baseUnit: 'm', factorToBase: 0.0254 },
    MPa: { family: 'stress', baseUnit: 'MPa', factorToBase: 1 },
    kPa: { family: 'stress', baseUnit: 'MPa', factorToBase: 0.001 },
    GPa: { family: 'stress', baseUnit: 'MPa', factorToBase: 1000 },
    psi: { family: 'stress', baseUnit: 'MPa', factorToBase: 0.00689476 },
    ksi: { family: 'stress', baseUnit: 'MPa', factorToBase: 6.89476 },
  };
  return unit ? conversions[unit] || null : null;
}

function normalizeCompatibleUnits(parsedValues: Array<ParsedNumericCell | null>) {
  const valuesWithUnits = parsedValues.filter((value): value is ParsedNumericCell => !!value?.unit);
  const valuesWithoutUnits = parsedValues.filter((value): value is ParsedNumericCell => !!value && !value.unit);
  if (valuesWithUnits.length < 2 || valuesWithoutUnits.length > 0) return null;

  const conversions = valuesWithUnits.map((value) => unitConversionFor(value.unit));
  if (conversions.some((conversion) => !conversion)) return null;
  const family = conversions[0]!.family;
  const baseUnit = conversions[0]!.baseUnit;
  if (!conversions.every((conversion) => conversion!.family === family && conversion!.baseUnit === baseUnit)) {
    return null;
  }

  const mixedUnits = Array.from(new Set(valuesWithUnits.map((value) => value.unit!))).sort();
  if (mixedUnits.length < 2) return null;

  return {
    baseUnit,
    mixedUnits,
    parsedValues: parsedValues.map((value) => {
      if (!value?.unit) return value;
      const conversion = unitConversionFor(value.unit)!;
      return { value: value.value * conversion.factorToBase, unit: baseUnit };
    }),
  };
}

function isDateLikeColumn(column: string) {
  return /\b(date|time|month|year|period|created|updated|dob|birth(?:day)?|week\s+ending|visit\s+(?:day|date)|admission|discharge|timestamp|day)\b|日期|时间|月份|年份|出生|入院|出院/i.test(column);
}

function formatDateOnly(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parseDateCell(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const isoTimestamp = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/);
  if (isoTimestamp) {
    const year = Number(isoTimestamp[1]);
    const month = Number(isoTimestamp[2]);
    const day = Number(isoTimestamp[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return formatDateOnly(date);
    }
  }

  const iso = raw.match(/^(\d{4})[-/](\d{1,2})(?:[-/](\d{1,2}))?$/);
  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3] || '1');
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return formatDateOnly(date);
    }
  }

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = Number(slash[3]!.length === 2 ? `20${slash[3]}` : slash[3]);
    if (first <= 12 && second <= 12) return null;
    const month = first > 12 ? second : first;
    const day = first > 12 ? first : second;
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) {
      return formatDateOnly(date);
    }
  }

  const parsedNumber = parseLocalizedNumber(raw);
  if (parsedNumber !== null && parsedNumber >= 20_000 && parsedNumber <= 60_000) {
    const excelEpoch = Date.UTC(1899, 11, 30);
    return formatDateOnly(new Date(excelEpoch + parsedNumber * 86_400_000));
  }

  return null;
}

function countDelimiter(line: string, delimiter: Delimiter) {
  return splitDelimitedLine(line, delimiter).length - 1;
}

function detectDelimitedTextDelimiter(lines: string[], preferred: Delimiter): Delimiter {
  if (preferred !== ',') return preferred;
  const header = lines[0] || '';
  const commaCount = countDelimiter(header, ',');
  const semicolonCount = countDelimiter(header, ';');
  return semicolonCount > commaCount ? ';' : preferred;
}

function makeUniqueColumnNames(columns: string[]) {
  const counts = new Map<string, number>();
  return columns.map((column, index) => {
    const trimmed = column.trim();
    const base = !trimmed || UNSAFE_EVIDENCE_LABEL_RE.test(normalizeEvidenceText(trimmed)) ? `column_${index + 1}` : trimmed;
    const count = counts.get(base) || 0;
    counts.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function summarizeDateColumn(rawValues: string[]): DateColumnSummary | null {
  const parsed = rawValues.map(parseDateCell);
  const values = parsed.filter((value): value is string => !!value).sort();
  if (values.length === 0) return null;
  const invalidCount = rawValues.filter((value, index) => value.trim() && parsed[index] === null).length;
  return {
    count: values.length,
    min: values[0]!,
    max: values[values.length - 1]!,
    ...(invalidCount > 0 ? { invalidCount } : {}),
  };
}

function isSummaryRow(row: string[]) {
  const firstNonEmpty = row.find((cell) => String(cell || '').trim().length > 0);
  const normalized = String(firstNonEmpty || '').trim();
  return /^(?:grand\s+total|subtotal|total|sum|summary)(?:$|\b|[\s:：([（])/i.test(normalized)
    || /(?:^|[\s:：([（])(?:grand\s+total|subtotal|total|sum|summary)(?:$|\b|[\s:：)\]）])/i.test(normalized)
    || /^(?:notes?|sources?|remarks?)(?:$|\b|[\s:：([（])/i.test(normalized)
    || /^(?:总计|合计|小计|汇总)(?:$|\b|[\s:：([（])/i.test(normalized)
    || /(?:总计|合计|小计|汇总)(?:$|\b|[\s:：)\]）])/i.test(normalized)
    || /^(?:备注|说明|来源)(?:$|\b|[\s:：([（])/i.test(normalized);
}

function buildGroupedNumericColumns(
  columns: string[],
  rows: string[][],
  numericColumns: Record<string, NumericColumnSummary>,
  parsedByColumn: Record<string, Array<ParsedNumericCell | null>>,
) {
  const grouped: Record<string, GroupedNumericColumnSummary> = {};
  const numericColumnSet = new Set(Object.keys(numericColumns));

  columns.forEach((groupColumn, groupIndex) => {
    if (isPrivateEvidenceColumn(groupColumn) || isUnsafeEvidenceLabel(groupColumn)) return;
    if (numericColumnSet.has(groupColumn) || isDateLikeColumn(groupColumn)) return;

    const groupValues = rows
      .map((row) => String(row[groupIndex] ?? '').trim())
      .filter((value) => value && !isUnsafeEvidenceLabel(value));
    const uniqueGroups = Array.from(new Set(groupValues));
    if (uniqueGroups.length < 1 || uniqueGroups.length > 20 || uniqueGroups.length > rows.length * 0.8) return;

    for (const valueColumn of Object.keys(numericColumns)) {
      const buckets = new Map<string, number[]>();
      const parsedValues = parsedByColumn[valueColumn] || [];

      rows.forEach((row, rowIndex) => {
        const group = String(row[groupIndex] ?? '').trim();
        const parsed = parsedValues[rowIndex];
        if (!group || isUnsafeEvidenceLabel(group) || !parsed) return;
        const values = buckets.get(group) || [];
        values.push(parsed.value);
        buckets.set(group, values);
      });

    if (buckets.size < 1) continue;
    const groups: Record<string, NumericColumnSummary> = {};
    const unit = numericColumns[valueColumn]?.unit;
      for (const [group, values] of buckets.entries()) {
        groups[group] = summarizeNumericValues(values, unit);
      }
      grouped[`${groupColumn}:${valueColumn}`] = { groupColumn, valueColumn, groups };
    }
  });

  return grouped;
}

function looksLikeWeightColumn(column: string) {
  return /\b(weight|weights|count|counts|sample\s+size|sample[_-]?size|sample\s+count|samples\s+count|n|volume|volumes)\b|权重|样本量|人数|数量/i.test(column);
}

function buildWeightedAverages(
  numericColumns: Record<string, NumericColumnSummary>,
  parsedByColumn: Record<string, Array<ParsedNumericCell | null>>,
) {
  const numericNames = Object.keys(numericColumns);
  const weightColumns = numericNames.filter(looksLikeWeightColumn);
  const summaries: WeightedAverageSummary[] = [];

  for (const weightColumn of weightColumns) {
    for (const valueColumn of numericNames) {
      if (valueColumn === weightColumn || looksLikeWeightColumn(valueColumn)) continue;
      const values = parsedByColumn[valueColumn] || [];
      const weights = parsedByColumn[weightColumn] || [];
      let weightedTotal = 0;
      let totalWeight = 0;
      let usedRows = 0;
      let skippedRows = 0;
      let zeroOrNegativeWeightRows = 0;

      for (let index = 0; index < Math.max(values.length, weights.length); index += 1) {
        const value = values[index];
        const weight = weights[index];
        if (!value || !weight) {
          skippedRows += 1;
          continue;
        }
        if (weight.value <= 0) {
          zeroOrNegativeWeightRows += 1;
          continue;
        }
        weightedTotal += value.value * weight.value;
        totalWeight += weight.value;
        usedRows += 1;
      }

      if (usedRows > 0 && totalWeight > 0) {
        summaries.push({
          valueColumn,
          weightColumn,
          weightedMean: roundMetric(weightedTotal / totalWeight),
          totalWeight: roundMetric(totalWeight),
          usedRows,
          skippedRows,
          zeroOrNegativeWeightRows,
          ...(numericColumns[valueColumn]?.unit ? { unit: numericColumns[valueColumn]!.unit } : {}),
        });
      }
    }
  }

  return summaries;
}

function looksLikeNumeratorColumn(column: string) {
  return /\b(conversion|conversions|converted|sale|sales|order|orders|success|successes|event|events|click|clicks|numerator)\b|转化|订单|成功|分子|点击/i.test(column);
}

function looksLikeDenominatorColumn(column: string) {
  return /\b(visit|visits|visitor|visitors|impression|impressions|view|views|session|sessions|lead|leads|denominator|total|base|attempt|attempts|population)\b|访问|访客|曝光|浏览|分母|总数|基数|人数/i.test(column);
}

function buildRatioMetrics(
  numericColumns: Record<string, NumericColumnSummary>,
  parsedByColumn: Record<string, Array<ParsedNumericCell | null>>,
) {
  const numericNames = Object.keys(numericColumns);
  const numerators = numericNames.filter(looksLikeNumeratorColumn);
  const denominators = numericNames.filter(looksLikeDenominatorColumn);
  const summaries: RatioMetricSummary[] = [];

  for (const numeratorColumn of numerators) {
    for (const denominatorColumn of denominators) {
      if (numeratorColumn === denominatorColumn) continue;
      const numeratorsForColumn = parsedByColumn[numeratorColumn] || [];
      const denominatorsForColumn = parsedByColumn[denominatorColumn] || [];
      const ratios: number[] = [];
      let numeratorTotal = 0;
      let denominatorTotal = 0;
      let zeroDenominatorRows = 0;
      let skippedRows = 0;

      for (let index = 0; index < Math.max(numeratorsForColumn.length, denominatorsForColumn.length); index += 1) {
        const numerator = numeratorsForColumn[index];
        const denominator = denominatorsForColumn[index];
        if (!numerator || !denominator) {
          skippedRows += 1;
          continue;
        }
        if (denominator.value === 0) {
          zeroDenominatorRows += 1;
          continue;
        }
        numeratorTotal += numerator.value;
        denominatorTotal += denominator.value;
        ratios.push(numerator.value / denominator.value);
      }

      if (ratios.length > 0 && denominatorTotal > 0) {
        const ratio = summarizeNumericValues(ratios);
        ratio.mean = roundMetric(numeratorTotal / denominatorTotal);
        summaries.push({
          numeratorColumn,
          denominatorColumn,
          ratio,
          zeroDenominatorRows,
          usedRows: ratios.length,
          skippedRows,
        });
      }
    }
  }

  return summaries;
}

function combineNumericSummaries(summaries: NumericColumnSummary[]): NumericColumnSummary | null {
  const usable = summaries.filter((summary) => summary.count > 0);
  if (usable.length < 2) return null;

  const units = Array.from(new Set(usable.map((summary) => summary.unit || '').filter(Boolean)));
  if (units.length > 1) return null;
  if (units.length === 1 && usable.some((summary) => !summary.unit)) return null;

  const totalCount = usable.reduce((sum, summary) => sum + summary.count, 0);
  if (totalCount === 0) return null;

  const mean = usable.reduce((sum, summary) => sum + summary.mean * summary.count, 0) / totalCount;
  const combined: NumericColumnSummary = {
    count: totalCount,
    min: roundMetric(Math.min(...usable.map((summary) => summary.min))),
    max: roundMetric(Math.max(...usable.map((summary) => summary.max))),
    mean: roundMetric(mean),
    sum: roundMetric(usable.reduce((sum, summary) => sum + (summary.sum ?? summary.mean * summary.count), 0)),
  };
  const outlierCount = usable.reduce((sum, summary) => sum + (summary.outlierCount || 0), 0);
  if (outlierCount > 0) combined.outlierCount = outlierCount;
  if (units[0]) combined.unit = units[0];
  const mixedUnits = Array.from(new Set(usable.flatMap((summary) => summary.mixedUnits || []))).sort();
  if (mixedUnits.length > 0) combined.mixedUnits = mixedUnits;
  return combined;
}

function addOverallNumericSummaries(
  results: Array<Extract<StructuredDataAnalysisResult, { status: 'completed' }>>,
  numericColumns: Record<string, NumericColumnSummary>,
) {
  const byLocalName = new Map<string, NumericColumnSummary[]>();

  for (const result of results) {
    for (const [column, summary] of Object.entries(result.numericColumns)) {
      const localName = column.split(':').pop() || column;
      const summaries = byLocalName.get(localName) || [];
      summaries.push(summary);
      byLocalName.set(localName, summaries);
    }
  }

  for (const [localName, summaries] of byLocalName.entries()) {
    const combined = combineNumericSummaries(summaries);
    if (combined) {
      numericColumns[`overall:${localName}`] = combined;
    }
  }
}

function buildAnalysisResult(filename: string, columns: string[], rows: string[][]): Extract<StructuredDataAnalysisResult, { status: 'completed' }> {
  const numericColumns: Record<string, NumericColumnSummary> = {};
  const dateColumns: Record<string, DateColumnSummary> = {};
  const missingValues: Record<string, number> = {};
  const invalidNumericValues: Record<string, number> = {};
  const parsedByColumn: Record<string, Array<ParsedNumericCell | null>> = {};

  columns.forEach((column, index) => {
    const rawValues = rows.map((row) => String(row[index] ?? '').trim());
    if (isPrivateEvidenceColumn(column) || isUnsafeEvidenceLabel(column)) return;

    const missingCount = rawValues.filter((value) => value.length === 0).length;
    if (missingCount > 0) {
      missingValues[column] = missingCount;
    }

    if (isDateLikeColumn(column)) {
      const dateSummary = summarizeDateColumn(rawValues);
      if (dateSummary) {
        dateColumns[column] = dateSummary;
        return;
      }
    }

    if (rawValues.some(isSuppressedNumericCell)) {
      invalidNumericValues[column] = rawValues.filter((value) => value.length > 0).length;
      return;
    }

    const rawParsedValues = rawValues.map(parseNumericCell);
    const normalizedUnits = normalizeCompatibleUnits(rawParsedValues);
    const parsedValues = applyColumnScaleHint(normalizedUnits?.parsedValues || rawParsedValues, rawValues, columnScaleHint(column));
    parsedByColumn[column] = parsedValues;
    const values = parsedValues
      .filter((value): value is ParsedNumericCell => !!value && Number.isFinite(value.value))
      .map((value) => value.value);

    const invalidCount = rawValues.filter((value, valueIndex) => value.length > 0 && rawParsedValues[valueIndex] === null).length;
    if (values.length === 0) {
      if (invalidCount > 0 && isDateLikeColumn(column)) {
        invalidNumericValues[column] = invalidCount;
      }
      return;
    }

    if (invalidCount > 0) {
      invalidNumericValues[column] = invalidCount;
    }

    const total = values.reduce((sum, value) => sum + value, 0);
    const mean = total / values.length;
    const median = medianOf(values);
    const standardDeviation = standardDeviationOf(values, mean);
    const outlierCount = countExtremeOutliers(values, median);
    const unitCounts = new Map<string, number>();
    for (const parsed of parsedValues) {
      if (parsed?.unit) unitCounts.set(parsed.unit, (unitCounts.get(parsed.unit) || 0) + 1);
    }
    const units = Array.from(unitCounts.keys()).sort();
    const unitTaggedCount = Array.from(unitCounts.values()).reduce((sum, count) => sum + count, 0);
    if (!normalizedUnits && ((units.length > 1) || (units.length === 1 && unitTaggedCount !== values.length))) {
      invalidNumericValues[column] = values.length;
      return;
    }
    const columnSummary: NumericColumnSummary = {
      count: values.length,
      min: roundMetric(Math.min(...values)),
      max: roundMetric(Math.max(...values)),
      mean: roundMetric(mean),
      median: roundMetric(median),
      standardDeviation: roundMetric(standardDeviation),
      outlierCount,
    };
    if (normalizedUnits) {
      columnSummary.unit = normalizedUnits.baseUnit;
      columnSummary.mixedUnits = normalizedUnits.mixedUnits;
    } else if (units.length === 1 && unitCounts.get(units[0]!) === values.length) {
      columnSummary.unit = units[0]!;
    } else if (units.length > 0) {
      columnSummary.mixedUnits = units;
    }
    numericColumns[column] = columnSummary;
  });
  const groupedNumericColumns = buildGroupedNumericColumns(columns, rows, numericColumns, parsedByColumn);
  const weightedAverages = buildWeightedAverages(numericColumns, parsedByColumn);
  const ratioMetrics = buildRatioMetrics(numericColumns, parsedByColumn);
  const hasDateColumns = Object.keys(dateColumns).length > 0;
  const hasGroupedNumericColumns = Object.keys(groupedNumericColumns).length > 0;
  const hasWeightedAverages = weightedAverages.length > 0;
  const hasRatioMetrics = ratioMetrics.length > 0;
  const publicColumns = publicEvidenceColumns(columns);

  const payload = {
    filename,
    rowCount: rows.length,
    columns: publicColumns,
    numericColumns,
    ...(hasDateColumns ? { dateColumns } : {}),
    ...(hasGroupedNumericColumns ? { groupedNumericColumns } : {}),
    ...(hasWeightedAverages ? { weightedAverages } : {}),
    ...(hasRatioMetrics ? { ratioMetrics } : {}),
    missingValues,
    invalidNumericValues,
  };

  const numericNames = Object.keys(numericColumns);
  const missingNames = Object.keys(missingValues);
  const invalidNames = Object.keys(invalidNumericValues);
  const unitNotes = Object.entries(numericColumns)
    .map(([column, summary]) => {
      if (summary.unit) return `${column} ${summary.unit}`;
      if (summary.mixedUnits?.length) return `${column} mixed units (${summary.mixedUnits.join(', ')})`;
      return '';
    })
    .filter(Boolean);
  const dataQualityNotes = [
    missingNames.length > 0 ? `missing values in ${missingNames.join(', ')}` : '',
    invalidNames.length > 0 ? `non-numeric values in numeric-looking columns ${invalidNames.join(', ')}` : '',
    unitNotes.length > 0 ? `units: ${unitNotes.join(', ')}` : '',
    hasDateColumns ? `date columns: ${Object.keys(dateColumns).join(', ')}` : '',
    hasGroupedNumericColumns ? `grouped summaries: ${Object.keys(groupedNumericColumns).join(', ')}` : '',
    hasWeightedAverages ? `weighted averages: ${weightedAverages.map((entry) => `${entry.valueColumn} by ${entry.weightColumn}`).join(', ')}` : '',
    hasRatioMetrics ? `ratio metrics: ${ratioMetrics.map((entry) => `${entry.numeratorColumn}/${entry.denominatorColumn}${entry.zeroDenominatorRows > 0 ? ` (${entry.zeroDenominatorRows} zero denominators)` : ''}`).join(', ')}` : '',
    Object.entries(numericColumns).filter(([, summary]) => (summary.outlierCount || 0) > 0).map(([column]) => column).length > 0
      ? `possible extreme outliers in ${Object.entries(numericColumns).filter(([, summary]) => (summary.outlierCount || 0) > 0).map(([column]) => column).join(', ')}`
      : '',
  ].filter(Boolean);
  const summary = [
    numericNames.length > 0
      ? `Structured data analysis completed for ${filename}: ${rows.length} rows, numeric columns: ${numericNames.join(', ')}.`
      : `Structured data analysis completed for ${filename}: ${rows.length} rows, no numeric columns detected.`,
    dataQualityNotes.length > 0 ? `Data quality notes: ${dataQualityNotes.join('; ')}.` : '',
  ].filter(Boolean).join(' ');

  return {
    status: 'completed',
    filename,
    rowCount: rows.length,
    columns: publicColumns,
    numericColumns,
    ...(hasDateColumns ? { dateColumns } : {}),
    ...(hasGroupedNumericColumns ? { groupedNumericColumns } : {}),
    ...(hasWeightedAverages ? { weightedAverages } : {}),
    ...(hasRatioMetrics ? { ratioMetrics } : {}),
    missingValues,
    invalidNumericValues,
    resultJson: JSON.stringify(payload),
    summary,
  };
}

function mergeAnalysisResults(
  results: Array<Extract<StructuredDataAnalysisResult, { status: 'completed' }>>,
): Extract<StructuredDataAnalysisResult, { status: 'completed' }> {
  if (results.length === 1) {
    return results[0]!;
  }

  const numericColumns: Record<string, NumericColumnSummary> = {};
  const dateColumns: Record<string, DateColumnSummary> = {};
  const groupedNumericColumns: Record<string, GroupedNumericColumnSummary> = {};
  const weightedAverages: WeightedAverageSummary[] = [];
  const ratioMetrics: RatioMetricSummary[] = [];
  const missingValues: Record<string, number> = {};
  const invalidNumericValues: Record<string, number> = {};
  const columns: string[] = [];

  for (const result of results) {
    for (const column of result.columns) {
      columns.push(`${result.filename}:${column}`);
    }

    for (const [column, summary] of Object.entries(result.numericColumns)) {
      numericColumns[`${result.filename}:${column}`] = summary;
    }

    for (const [column, summary] of Object.entries(result.dateColumns || {})) {
      dateColumns[`${result.filename}:${column}`] = summary;
    }

    for (const [key, summary] of Object.entries(result.groupedNumericColumns || {})) {
      groupedNumericColumns[`${result.filename}:${key}`] = {
        groupColumn: `${result.filename}:${summary.groupColumn}`,
        valueColumn: `${result.filename}:${summary.valueColumn}`,
        groups: summary.groups,
      };
    }

    for (const summary of result.weightedAverages || []) {
      weightedAverages.push({
        ...summary,
        valueColumn: `${result.filename}:${summary.valueColumn}`,
        weightColumn: `${result.filename}:${summary.weightColumn}`,
      });
    }

    for (const summary of result.ratioMetrics || []) {
      ratioMetrics.push({
        ...summary,
        numeratorColumn: `${result.filename}:${summary.numeratorColumn}`,
        denominatorColumn: `${result.filename}:${summary.denominatorColumn}`,
      });
    }

    for (const [column, count] of Object.entries(result.missingValues)) {
      missingValues[`${result.filename}:${column}`] = count;
    }

    for (const [column, count] of Object.entries(result.invalidNumericValues)) {
      invalidNumericValues[`${result.filename}:${column}`] = count;
    }
  }

  addOverallNumericSummaries(results, numericColumns);

  const files = results.map((result) => ({
    filename: result.filename,
    rowCount: result.rowCount,
    columns: publicEvidenceColumns(result.columns),
    numericColumns: result.numericColumns,
    ...(result.dateColumns ? { dateColumns: result.dateColumns } : {}),
    ...(result.groupedNumericColumns ? { groupedNumericColumns: result.groupedNumericColumns } : {}),
    ...(result.weightedAverages ? { weightedAverages: result.weightedAverages } : {}),
    ...(result.ratioMetrics ? { ratioMetrics: result.ratioMetrics } : {}),
    missingValues: result.missingValues,
    invalidNumericValues: result.invalidNumericValues,
  }));
  const rowCount = results.reduce((total, result) => total + result.rowCount, 0);
  const filename = results.map((result) => result.filename).join(', ');
  const numericNames = Object.keys(numericColumns);
  const hasDateColumns = Object.keys(dateColumns).length > 0;
  const hasGroupedNumericColumns = Object.keys(groupedNumericColumns).length > 0;
  const hasWeightedAverages = weightedAverages.length > 0;
  const hasRatioMetrics = ratioMetrics.length > 0;
  const payload = {
    files,
    totalRowCount: rowCount,
    numericColumns,
    ...(hasDateColumns ? { dateColumns } : {}),
    ...(hasGroupedNumericColumns ? { groupedNumericColumns } : {}),
    ...(hasWeightedAverages ? { weightedAverages } : {}),
    ...(hasRatioMetrics ? { ratioMetrics } : {}),
    missingValues,
    invalidNumericValues,
  };
  const missingNames = Object.keys(missingValues);
  const invalidNames = Object.keys(invalidNumericValues);
  const unitNotes = Object.entries(numericColumns)
    .map(([column, summary]) => {
      if (summary.unit) return `${column} ${summary.unit}`;
      if (summary.mixedUnits?.length) return `${column} mixed units (${summary.mixedUnits.join(', ')})`;
      return '';
    })
    .filter(Boolean);
  const dataQualityNotes = [
    missingNames.length > 0 ? `missing values in ${missingNames.join(', ')}` : '',
    invalidNames.length > 0 ? `non-numeric values in numeric-looking columns ${invalidNames.join(', ')}` : '',
    unitNotes.length > 0 ? `units: ${unitNotes.join(', ')}` : '',
    hasDateColumns ? `date columns: ${Object.keys(dateColumns).join(', ')}` : '',
    hasGroupedNumericColumns ? `grouped summaries: ${Object.keys(groupedNumericColumns).join(', ')}` : '',
    hasWeightedAverages ? `weighted averages: ${weightedAverages.map((entry) => `${entry.valueColumn} by ${entry.weightColumn}`).join(', ')}` : '',
    hasRatioMetrics ? `ratio metrics: ${ratioMetrics.map((entry) => `${entry.numeratorColumn}/${entry.denominatorColumn}${entry.zeroDenominatorRows > 0 ? ` (${entry.zeroDenominatorRows} zero denominators)` : ''}`).join(', ')}` : '',
    Object.entries(numericColumns).filter(([, summary]) => (summary.outlierCount || 0) > 0).map(([column]) => column).length > 0
      ? `possible extreme outliers in ${Object.entries(numericColumns).filter(([, summary]) => (summary.outlierCount || 0) > 0).map(([column]) => column).join(', ')}`
      : '',
  ].filter(Boolean);
  const summary = [
    numericNames.length > 0
      ? `Structured data analysis completed for ${results.length} files: ${files.map((file) => `${file.filename} (${file.rowCount} rows)`).join(', ')}. Numeric columns: ${numericNames.join(', ')}.`
      : `Structured data analysis completed for ${results.length} files: ${files.map((file) => `${file.filename} (${file.rowCount} rows)`).join(', ')}. No numeric columns detected.`,
    dataQualityNotes.length > 0 ? `Data quality notes: ${dataQualityNotes.join('; ')}.` : '',
  ].filter(Boolean).join(' ');

  return {
    status: 'completed',
    filename,
    rowCount,
    columns,
    numericColumns,
    ...(hasDateColumns ? { dateColumns } : {}),
    ...(hasGroupedNumericColumns ? { groupedNumericColumns } : {}),
    ...(hasWeightedAverages ? { weightedAverages } : {}),
    ...(hasRatioMetrics ? { ratioMetrics } : {}),
    missingValues,
    invalidNumericValues,
    resultJson: JSON.stringify(payload),
    summary,
    files,
  };
}

export function analyzeDelimitedText(
  text: string,
  options: AnalyzeDelimitedOptions,
): Extract<StructuredDataAnalysisResult, { status: 'completed' }> {
  const lines = splitDelimitedRecords(text);

  if (lines.length < 2) {
    throw new Error('Dataset must include a header row and at least one data row.');
  }

  const delimiter = detectDelimitedTextDelimiter(lines, options.delimiter);
  const rawRows = lines.map((line) => splitDelimitedLine(line, delimiter));
  const headerRowIndex = chooseHeaderRowIndex(rawRows);
  const headerRowsUsed = shouldCombineHeaderRows(rawRows[headerRowIndex] || [], rawRows[headerRowIndex + 1] || [], rawRows.slice(headerRowIndex + 2)) ? 2 : 1;
  const maxColumns = Math.max(
    (rawRows[headerRowIndex] || []).length,
    headerRowsUsed === 2 ? (rawRows[headerRowIndex + 1] || []).length : 0,
  );
  const header = headerRowsUsed === 2
    ? combineHeaderRows(rawRows[headerRowIndex] || [], rawRows[headerRowIndex + 1] || [], maxColumns)
    : rawRows[headerRowIndex] || [];
  const columns = makeUniqueColumnNames(Array.from({ length: maxColumns }, (_, index) => {
    const column = header[index]?.trim();
    return column || `column_${index + 1}`;
  }));
  const rows = rawRows.slice(headerRowIndex + headerRowsUsed).map((cells) => {
    if (cells.length > columns.length) {
      throw new Error(`CSV row has too many cells for ${columns.length} columns; quote comma thousands or normalize the delimiter before analysis.`);
    }
    return [...cells, ...Array(Math.max(0, columns.length - cells.length)).fill('')].slice(0, columns.length);
  }).filter((row) => !isSummaryRow(row));

  return buildAnalysisResult(options.filename, columns, rows);
}

function flattenJsonObject(value: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const output: Record<string, unknown> = {};

  for (const [key, child] of Object.entries(value)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(child)) {
      output[name] = null;
    } else if (child && typeof child === 'object') {
      Object.assign(output, flattenJsonObject(child as Record<string, unknown>, name));
    } else {
      output[name] = child;
    }
  }

  return output;
}

function analyzeJsonText(text: string, filename: string): Extract<StructuredDataAnalysisResult, { status: 'completed' }> {
  const parsed = JSON.parse(text) as unknown;
  const rows = extractJsonRows(parsed);
  const objects = rows.filter((row): row is Record<string, unknown> => !!row && typeof row === 'object' && !Array.isArray(row));

  if (objects.length === 0) {
    throw new Error('JSON dataset must be an object or an array of objects.');
  }

  const flattened = objects.map((row) => flattenJsonObject(row));
  const columns = Array.from(new Set(flattened.flatMap((row) => Object.keys(row))));
  const tableRows = flattened.map((row) => columns.map((column) => String(row[column] ?? '')));
  return buildAnalysisResult(filename, columns, tableRows);
}

function extractJsonRows(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (!parsed || typeof parsed !== 'object') return [parsed];

  for (const key of ['records', 'data', 'rows', 'items', 'results']) {
    const value = (parsed as Record<string, unknown>)[key];
    if (Array.isArray(value) && value.some((row) => !!row && typeof row === 'object' && !Array.isArray(row))) {
      return value;
    }
  }

  return [parsed];
}

function decodeXmlEntities(value: string) {
  return value.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (match, entity: string) => {
    const normalized = entity.toLowerCase();
    if (normalized === 'amp') return '&';
    if (normalized === 'lt') return '<';
    if (normalized === 'gt') return '>';
    if (normalized === 'quot') return '"';
    if (normalized === 'apos') return "'";
    if (normalized.startsWith('#x')) return String.fromCodePoint(Number.parseInt(normalized.slice(2), 16));
    if (normalized.startsWith('#')) return String.fromCodePoint(Number.parseInt(normalized.slice(1), 10));
    return match;
  });
}

function getXmlAttribute(tag: string, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = tag.match(new RegExp(`\\b${escaped}=["']([^"']+)["']`, 'i'));
  return match ? decodeXmlEntities(match[1]!) : '';
}

function columnIndexFromCellRef(ref: string) {
  const letters = ref.match(/^[A-Z]+/i)?.[0].toUpperCase() || '';
  if (!letters) return -1;
  return letters.split('').reduce((index, letter) => index * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function columnNameFromIndex(index: number) {
  let value = index + 1;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function cellPositionFromRef(ref: string) {
  const match = ref.match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  const columnIndex = columnIndexFromCellRef(match[1]!);
  const rowNumber = Number.parseInt(match[2]!, 10);
  if (columnIndex < 0 || !Number.isFinite(rowNumber)) return null;
  return { columnIndex, rowNumber };
}

async function getZipText(zip: JSZip, path: string) {
  return zip.file(path)?.async('text') ?? null;
}

function normalizeWorksheetPath(target: string) {
  if (!target) return '';
  const normalized = target.replace(/^\/+/, '');
  return normalized.startsWith('xl/') ? normalized : `xl/${normalized}`;
}

async function findWorksheetPaths(zip: JSZip) {
  const workbookXml = await getZipText(zip, 'xl/workbook.xml');
  const relsXml = await getZipText(zip, 'xl/_rels/workbook.xml.rels');
  const sheetTags = workbookXml?.match(/<sheet\b[^>]*>/gi) || [];
  const relationshipTags = relsXml?.match(/<Relationship\b[^>]*>/gi) || [];
  const relationshipTargets = new Map<string, string>();

  for (const tag of relationshipTags) {
    const id = getXmlAttribute(tag, 'Id');
    const target = normalizeWorksheetPath(getXmlAttribute(tag, 'Target'));
    if (id && target && zip.file(target)) {
      relationshipTargets.set(id, target);
    }
  }

  const worksheets: Array<{ name: string; path: string }> = [];
  sheetTags.forEach((tag, index) => {
    const state = getXmlAttribute(tag, 'state').toLowerCase();
    if (state === 'hidden' || state === 'veryhidden') return;
    const relationshipId = getXmlAttribute(tag, 'r:id');
    const relationshipPath = relationshipTargets.get(relationshipId);
    const fallbackPath = `xl/worksheets/sheet${index + 1}.xml`;
    const path = relationshipPath || (zip.file(fallbackPath) ? fallbackPath : '');
    if (path) {
      worksheets.push({
        name: safeWorksheetName(getXmlAttribute(tag, 'name') || `Sheet${index + 1}`, index),
        path,
      });
    }
  });

  if (sheetTags.length > 0) return worksheets;
  return zip.file('xl/worksheets/sheet1.xml')
    ? [{ name: 'Sheet1', path: 'xl/worksheets/sheet1.xml' }]
    : [];
}

async function findHiddenWorksheetNames(zip: JSZip) {
  const workbookXml = await getZipText(zip, 'xl/workbook.xml');
  const sheetTags = workbookXml?.match(/<sheet\b[^>]*>/gi) || [];
  const hiddenWorksheetNames = new Set<string>();

  sheetTags.forEach((tag) => {
    const state = getXmlAttribute(tag, 'state').toLowerCase();
    if (state !== 'hidden' && state !== 'veryhidden') return;
    const name = getXmlAttribute(tag, 'name');
    if (name) hiddenWorksheetNames.add(name);
  });

  return hiddenWorksheetNames;
}

type RiskyDefinedNames = {
  hidden: Set<string>;
  external: Set<string>;
};

async function findRiskyDefinedNames(zip: JSZip, hiddenWorksheetNames: Set<string>): Promise<RiskyDefinedNames> {
  const workbookXml = await getZipText(zip, 'xl/workbook.xml');
  const riskyDefinedNames: RiskyDefinedNames = {
    hidden: new Set<string>(),
    external: new Set<string>(),
  };
  const definedNameTags = workbookXml?.matchAll(/<definedName\b[^>]*>[\s\S]*?<\/definedName>/gi) || [];

  for (const match of definedNameTags) {
    const tag = match[0];
    const openTag = tag.match(/^<definedName\b[^>]*>/i)?.[0] || '';
    const name = getXmlAttribute(openTag, 'name');
    const ref = decodeXmlEntities(tag.match(/<definedName\b[^>]*>([\s\S]*?)<\/definedName>/i)?.[1] || '');
    if (!name || !ref) continue;

    if (formulaExternalWorkbookReference(ref)) {
      riskyDefinedNames.external.add(name);
    } else if (formulaHiddenWorksheetReference(ref, hiddenWorksheetNames)) {
      riskyDefinedNames.hidden.add(name);
    }
  }

  return riskyDefinedNames;
}

function parseSharedStrings(xml: string | null) {
  if (!xml) return [];
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)).map((match) => {
    const textParts = Array.from(match[1]!.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi))
      .map((textMatch) => decodeXmlEntities(textMatch[1] || ''));
    return textParts.join('');
  });
}

function parsePercentStyleIndexes(stylesXml: string | null) {
  const percentNumFmtIds = new Set(['9', '10']);
  const customFormatTags = stylesXml?.matchAll(/<numFmt\b[^>]*\/?>/gi) || [];
  for (const match of customFormatTags) {
    const tag = match[0];
    const formatCode = getXmlAttribute(tag, 'formatCode');
    if (formatCode.includes('%')) {
      const numFmtId = getXmlAttribute(tag, 'numFmtId');
      if (numFmtId) percentNumFmtIds.add(numFmtId);
    }
  }

  const percentStyleIndexes = new Set<number>();
  const cellXfs = stylesXml?.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i)?.[1] || '';
  Array.from(cellXfs.matchAll(/<xf\b[^>]*\/?>/gi)).forEach((match, index) => {
    if (percentNumFmtIds.has(getXmlAttribute(match[0], 'numFmtId'))) {
      percentStyleIndexes.add(index);
    }
  });
  return percentStyleIndexes;
}

function extractCellValue(cellTag: string, sharedStrings: string[], percentStyleIndexes: Set<number>) {
  const openTag = cellTag.match(/^<c\b[^>]*>/i)?.[0] || '';
  const type = getXmlAttribute(openTag, 't');
  const value = cellTag.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] || '';

  if (type === 'inlineStr') {
    return Array.from(cellTag.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi))
      .map((match) => decodeXmlEntities(match[1] || ''))
      .join('');
  }

  if (type === 's') {
    return sharedStrings[Number.parseInt(value, 10)] || '';
  }

  if (type === 'b') {
    return value === '1' ? 'TRUE' : 'FALSE';
  }

  const styleIndex = Number.parseInt(getXmlAttribute(openTag, 's'), 10);
  if (percentStyleIndexes.has(styleIndex)) {
    const numericValue = Number(decodeXmlEntities(value));
    if (Number.isFinite(numericValue)) {
      return `${numericValue * 100}%`;
    }
  }

  return decodeXmlEntities(value);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formulaHiddenColumnReference(formula: string, hiddenColumnIndexes: Set<number>) {
  if (hiddenColumnIndexes.size === 0) return '';

  for (const match of formula.matchAll(/(?:^|[^A-Z0-9_.])\$?([A-Z]{1,3})\$?:\$?([A-Z]{1,3})(?=$|[^A-Z0-9_.])/gi)) {
    const start = columnIndexFromCellRef(match[1]!);
    const end = columnIndexFromCellRef(match[2]!);
    if (start < 0 || end < 0) continue;
    for (let index = Math.min(start, end); index <= Math.max(start, end); index += 1) {
      if (hiddenColumnIndexes.has(index)) {
        return columnNameFromIndex(index);
      }
    }
  }

  for (const match of formula.matchAll(/\$?([A-Z]{1,3})\$?\d+/gi)) {
    const column = match[1]!.toUpperCase();
    if (hiddenColumnIndexes.has(columnIndexFromCellRef(column))) {
      return column;
    }
  }

  return '';
}

function formulaHiddenRowReference(formula: string, hiddenRowNumbers: Set<number>) {
  if (hiddenRowNumbers.size === 0) return '';

  for (const match of formula.matchAll(/(?:^|[^A-Z0-9_.])\$?(\d+)\$?:\$?(\d+)(?=$|[^A-Z0-9_.])/g)) {
    const start = Number.parseInt(match[1]!, 10);
    const end = Number.parseInt(match[2]!, 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    for (let rowNumber = Math.min(start, end); rowNumber <= Math.max(start, end); rowNumber += 1) {
      if (hiddenRowNumbers.has(rowNumber)) {
        return String(rowNumber);
      }
    }
  }

  for (const match of formula.matchAll(/\$?[A-Z]{1,3}\$?(\d+)/gi)) {
    const rowNumber = Number.parseInt(match[1]!, 10);
    if (hiddenRowNumbers.has(rowNumber)) {
      return String(rowNumber);
    }
  }

  return '';
}

function formulaExternalWorkbookReference(formula: string) {
  return /\[[^\]]+\][^!]*!/i.test(formula);
}

function formulaHiddenWorksheetReference(formula: string, hiddenWorksheetNames: Set<string>) {
  if (hiddenWorksheetNames.size === 0) return false;

  for (const name of hiddenWorksheetNames) {
    const quotedName = `'${name.replace(/'/g, "''")}'!`;
    if (formula.toLowerCase().includes(quotedName.toLowerCase())) return true;

    if (/^[A-Za-z0-9_.]+$/.test(name)) {
      const pattern = new RegExp(`(?:^|[^A-Za-z0-9_.'])${escapeRegExp(name)}!`, 'i');
      if (pattern.test(formula)) return true;
    }
  }

  return false;
}

function formulaDefinedNameReference(formula: string, definedNames: Set<string>) {
  if (definedNames.size === 0) return '';

  for (const name of definedNames) {
    const pattern = new RegExp(`(?:^|[^A-Za-z0-9_.])${escapeRegExp(name)}(?:$|[^A-Za-z0-9_.])`, 'i');
    if (pattern.test(formula)) return name;
  }

  return '';
}

function formulaCellIssue(
  cellTag: string,
  hiddenColumnIndexes: Set<number>,
  hiddenRowNumbers: Set<number>,
  hiddenWorksheetNames: Set<string>,
  riskyDefinedNames: RiskyDefinedNames,
) {
  const openTag = cellTag.match(/^<c\b[^>]*>/i)?.[0] || '';
  const type = getXmlAttribute(openTag, 't');
  const ref = getXmlAttribute(openTag, 'r') || 'unknown cell';
  const value = cellTag.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] || '';
  const formula = cellTag.match(/<f\b[^>]*>([\s\S]*?)<\/f>/i)?.[1] || '';

  if (type === 'e') {
    return `XLSX error cell ${ref} contains ${decodeXmlEntities(value) || 'an error value'}.`;
  }

  if (formula) {
    const decodedFormula = decodeXmlEntities(formula);
    if (formulaExternalWorkbookReference(decodedFormula)) {
      return `XLSX formula cell ${ref} references an external workbook; upload the source workbook or paste visible values before analysis.`;
    }
    if (formulaHiddenWorksheetReference(decodedFormula, hiddenWorksheetNames)) {
      return `XLSX formula cell ${ref} references a hidden worksheet; unhide or paste visible values before analysis.`;
    }
    if (formulaDefinedNameReference(decodedFormula, riskyDefinedNames.external)) {
      return `XLSX formula cell ${ref} references a defined name that points to external data; upload the source workbook or paste visible values before analysis.`;
    }
    if (formulaDefinedNameReference(decodedFormula, riskyDefinedNames.hidden)) {
      return `XLSX formula cell ${ref} references a defined name that points to hidden data; unhide or paste visible values before analysis.`;
    }
    const hiddenColumn = formulaHiddenColumnReference(decodedFormula, hiddenColumnIndexes);
    if (hiddenColumn) {
      return `XLSX formula cell ${ref} references hidden column ${hiddenColumn}; unhide or paste visible values before analysis.`;
    }
    const hiddenRow = formulaHiddenRowReference(decodedFormula, hiddenRowNumbers);
    if (hiddenRow) {
      return `XLSX formula cell ${ref} references hidden row ${hiddenRow}; unhide or paste visible values before analysis.`;
    }
  }

  if (/<f\b/i.test(cellTag) && !/<v\b/i.test(cellTag)) {
    return `XLSX formula cell ${ref} has no cached result; recalculate or paste values before analysis.`;
  }

  return null;
}

function parseMergeRanges(worksheetXml: string) {
  return Array.from(worksheetXml.matchAll(/<mergeCell\b[^>]*\bref=["']([A-Z]+\d+):([A-Z]+\d+)["'][^>]*\/?>/gi))
    .map((match) => {
      const start = cellPositionFromRef(match[1]!);
      const end = cellPositionFromRef(match[2]!);
      if (!start || !end) return null;
      return {
        startRow: Math.min(start.rowNumber, end.rowNumber),
        endRow: Math.max(start.rowNumber, end.rowNumber),
        startColumn: Math.min(start.columnIndex, end.columnIndex),
        endColumn: Math.max(start.columnIndex, end.columnIndex),
      };
    })
    .filter((range): range is NonNullable<typeof range> => !!range);
}

function parseHiddenColumnIndexes(worksheetXml: string) {
  const hiddenColumns = new Set<number>();

  for (const match of worksheetXml.matchAll(/<col\b[^>]*\/?>/gi)) {
    const tag = match[0];
    const hidden = getXmlAttribute(tag, 'hidden').toLowerCase();
    if (hidden !== '1' && hidden !== 'true') continue;

    const min = Number.parseInt(getXmlAttribute(tag, 'min'), 10);
    const max = Number.parseInt(getXmlAttribute(tag, 'max'), 10);
    if (!Number.isFinite(min) || !Number.isFinite(max) || min < 1 || max < min) continue;

    for (let columnIndex = min - 1; columnIndex <= Math.min(max - 1, 16_383); columnIndex += 1) {
      hiddenColumns.add(columnIndex);
    }
  }

  return hiddenColumns;
}

function parseHiddenRowNumbers(worksheetXml: string) {
  const hiddenRows = new Set<number>();

  for (const match of worksheetXml.matchAll(/<row\b[^>]*>/gi)) {
    const tag = match[0];
    const hidden = getXmlAttribute(tag, 'hidden').toLowerCase();
    if (hidden !== '1' && hidden !== 'true') continue;

    const rowNumber = Number.parseInt(getXmlAttribute(tag, 'r'), 10);
    if (Number.isFinite(rowNumber)) {
      hiddenRows.add(rowNumber);
    }
  }

  return hiddenRows;
}

function removeHiddenColumns(cells: string[], hiddenColumnIndexes: Set<number>) {
  if (hiddenColumnIndexes.size === 0) return cells.map((cell) => cell || '');

  const visibleCells: string[] = [];
  for (let index = 0; index < cells.length; index += 1) {
    if (!hiddenColumnIndexes.has(index)) visibleCells.push(cells[index] || '');
  }
  return visibleCells;
}

function nonEmptyCellCount(row: string[]) {
  return row.filter((cell) => String(cell || '').trim()).length;
}

function chooseHeaderRowIndex(rawRows: string[][]) {
  for (let index = 0; index < rawRows.length - 1; index += 1) {
    if (nonEmptyCellCount(rawRows[index] || []) < 2) continue;
    const dataRowsAfterHeader = rawRows
      .slice(index + 1)
      .filter((row) => nonEmptyCellCount(row) >= 2);
    if (dataRowsAfterHeader.length > 0) {
      return index;
    }
  }
  return 0;
}

function isNumericOrDateCell(value: string) {
  return !!parseNumericCell(value) || !!parseDateCell(value) || isSuppressedNumericCell(value);
}

function shouldCombineHeaderRows(topRow: string[], secondRow: string[], followingRows: string[][]) {
  const secondNonEmpty = secondRow.filter((cell) => String(cell || '').trim());
  if (nonEmptyCellCount(topRow) < 2 || secondNonEmpty.length < 2) return false;
  if (secondNonEmpty.some(isNumericOrDateCell)) return false;
  return followingRows.some((row) => row.some(isNumericOrDateCell));
}

function combineHeaderRows(topRow: string[], secondRow: string[], maxColumns: number) {
  return Array.from({ length: maxColumns }, (_, index) => {
    const top = String(topRow[index] || '').trim();
    const second = String(secondRow[index] || '').trim();
    if (top && second && top !== second) return `${top} ${second}`;
    return top || second;
  });
}

async function analyzeWorksheetXml(
  zip: JSZip,
  worksheetPath: string,
  filename: string,
  sheetName: string,
  sharedStrings: string[],
  percentStyleIndexes: Set<number>,
  hiddenWorksheetNames: Set<string>,
  riskyDefinedNames: RiskyDefinedNames,
): Promise<Extract<StructuredDataAnalysisResult, { status: 'completed' }>> {
  const worksheetXml = await getZipText(zip, worksheetPath);
  if (!worksheetXml) {
    throw new Error(`XLSX worksheet ${sheetName} could not be read.`);
  }

  const rowsWithNumbers: Array<{ rowNumber: number; cells: string[] }> = [];
  const hiddenColumnIndexes = parseHiddenColumnIndexes(worksheetXml);
  const hiddenRowNumbers = parseHiddenRowNumbers(worksheetXml);
  const rowMatches = worksheetXml.matchAll(/<row\b[^>]*>[\s\S]*?<\/row>/gi);

  for (const rowMatch of rowMatches) {
    const rowTag = rowMatch[0];
    const rowOpenTag = rowTag.match(/^<row\b[^>]*>/i)?.[0] || '';
    const rowNumber = Number.parseInt(getXmlAttribute(rowOpenTag, 'r'), 10) || rowsWithNumbers.length + 1;
    const hidden = getXmlAttribute(rowOpenTag, 'hidden').toLowerCase();
    if (hidden === '1' || hidden === 'true') {
      hiddenRowNumbers.add(rowNumber);
      continue;
    }
    const cells: string[] = [];
    const cellMatches = rowTag.matchAll(/<c\b[^>]*>[\s\S]*?<\/c>/gi);

    for (const cellMatch of cellMatches) {
      const cellTag = cellMatch[0];
      const openTag = cellTag.match(/^<c\b[^>]*>/i)?.[0] || '';
      const columnIndex = columnIndexFromCellRef(getXmlAttribute(openTag, 'r'));
      const targetIndex = columnIndex >= 0 ? columnIndex : cells.length;
      if (hiddenColumnIndexes.has(targetIndex)) continue;
      const issue = formulaCellIssue(cellTag, hiddenColumnIndexes, hiddenRowNumbers, hiddenWorksheetNames, riskyDefinedNames);
      if (issue) throw new Error(issue);
      cells[targetIndex] = extractCellValue(cellTag, sharedStrings, percentStyleIndexes);
    }

    if (removeHiddenColumns(cells, hiddenColumnIndexes).some((cell) => String(cell || '').trim())) {
      rowsWithNumbers.push({ rowNumber, cells: cells.map((cell) => cell || '') });
    }
  }

  const rowByNumber = new Map(rowsWithNumbers.map((row) => [row.rowNumber, row.cells]));
  for (const range of parseMergeRanges(worksheetXml)) {
    const topLeftValue = rowByNumber.get(range.startRow)?.[range.startColumn] || '';
    if (!topLeftValue) continue;
    for (let rowNumber = range.startRow; rowNumber <= range.endRow; rowNumber += 1) {
      const cells = rowByNumber.get(rowNumber);
      if (!cells) continue;
      for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex += 1) {
        if (hiddenColumnIndexes.has(columnIndex)) continue;
        if (!cells[columnIndex]) cells[columnIndex] = topLeftValue;
      }
    }
  }

  const rawRows = rowsWithNumbers.map((row) => removeHiddenColumns(row.cells, hiddenColumnIndexes));

  if (rawRows.length < 2) {
    throw new Error(`XLSX worksheet ${sheetName} must include a header row and at least one data row.`);
  }

  const maxColumns = Math.max(...rawRows.map((row) => row.length));
  const headerRowIndex = chooseHeaderRowIndex(rawRows);
  const headerRowsUsed = shouldCombineHeaderRows(rawRows[headerRowIndex] || [], rawRows[headerRowIndex + 1] || [], rawRows.slice(headerRowIndex + 2)) ? 2 : 1;
  const header = headerRowsUsed === 2
    ? combineHeaderRows(rawRows[headerRowIndex] || [], rawRows[headerRowIndex + 1] || [], maxColumns)
    : rawRows[headerRowIndex] || [];
  const columns = makeUniqueColumnNames(Array.from({ length: maxColumns }, (_, index) => {
    const column = header[index]?.trim();
    return column || `column_${index + 1}`;
  }));
  const rows = rawRows.slice(headerRowIndex + headerRowsUsed).map((row) => [
    ...row,
    ...Array(Math.max(0, columns.length - row.length)).fill(''),
  ].slice(0, columns.length)).filter((row) => !isSummaryRow(row));

  return buildAnalysisResult(`${filename}:${sheetName}`, columns, rows);
}

async function analyzeXlsxBlob(blob: Blob, filename: string): Promise<Extract<StructuredDataAnalysisResult, { status: 'completed' }>> {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const worksheets = await findWorksheetPaths(zip);
  const hiddenWorksheetNames = await findHiddenWorksheetNames(zip);
  const riskyDefinedNames = await findRiskyDefinedNames(zip, hiddenWorksheetNames);

  if (worksheets.length === 0) {
    throw new Error('XLSX workbook must contain at least one worksheet.');
  }

  const sharedStrings = parseSharedStrings(await getZipText(zip, 'xl/sharedStrings.xml'));
  const percentStyleIndexes = parsePercentStyleIndexes(await getZipText(zip, 'xl/styles.xml'));
  const results = [];

  for (const worksheet of worksheets) {
    try {
      results.push(await analyzeWorksheetXml(zip, worksheet.path, filename, worksheet.name, sharedStrings, percentStyleIndexes, hiddenWorksheetNames, riskyDefinedNames));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/XLSX (?:formula|error) cell/i.test(message)) throw error;
      if (worksheets.length === 1) throw error;
      console.warn(`[structured-data] skipped worksheet "${worksheet.name}" in ${filename}: ${message}`);
    }
  }

  if (results.length === 0) {
    throw new Error('XLSX workbook did not contain an analyzable worksheet.');
  }

  if (results.length === 1) {
    const result = results[0]!;
    return {
      ...result,
      filename,
      files: [{
        filename: result.filename,
        rowCount: result.rowCount,
        columns: result.columns,
        numericColumns: result.numericColumns,
        ...(result.dateColumns ? { dateColumns: result.dateColumns } : {}),
        ...(result.groupedNumericColumns ? { groupedNumericColumns: result.groupedNumericColumns } : {}),
        ...(result.weightedAverages ? { weightedAverages: result.weightedAverages } : {}),
        ...(result.ratioMetrics ? { ratioMetrics: result.ratioMetrics } : {}),
        missingValues: result.missingValues,
        invalidNumericValues: result.invalidNumericValues,
      }],
      resultJson: JSON.stringify({
        filename,
        sheets: [result.filename],
        rowCount: result.rowCount,
        columns: result.columns,
        numericColumns: result.numericColumns,
        ...(result.dateColumns ? { dateColumns: result.dateColumns } : {}),
        ...(result.groupedNumericColumns ? { groupedNumericColumns: result.groupedNumericColumns } : {}),
        ...(result.weightedAverages ? { weightedAverages: result.weightedAverages } : {}),
        ...(result.ratioMetrics ? { ratioMetrics: result.ratioMetrics } : {}),
        missingValues: result.missingValues,
        invalidNumericValues: result.invalidNumericValues,
      }),
    };
  }

  return mergeAnalysisResults(results);
}

async function downloadMaterialFromStorage(storagePath: string) {
  const { data, error } = await supabaseAdmin.storage
    .from('task-files')
    .download(storagePath);

  if (error || !data) {
    throw new Error('Failed to read structured data file from storage.');
  }

  return data;
}

async function analyzeStructuredDataFile(
  dataFile: StoredMaterialFile,
  downloadMaterial: (storagePath: string) => Promise<Blob>,
): Promise<Extract<StructuredDataAnalysisResult, { status: 'completed' }>> {
  const blob = await downloadMaterial(dataFile.storage_path);
  const ext = getExtension(dataFile.original_name);
  const mime = String(dataFile.mime_type || '').toLowerCase();
  const filename = safeDataFilename(dataFile.original_name);

  if (ext === 'xlsx' || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
    return await analyzeXlsxBlob(blob, filename);
  }

  const text = await blob.text();

  if (ext === 'json' || mime.includes('json')) {
    return analyzeJsonText(text, filename);
  }

  return analyzeDelimitedText(text, {
    filename,
    delimiter: ext === 'tsv' ? '\t' : ',',
  });
}

export async function runStructuredDataAnalysisForMaterials(
  files: StoredMaterialFile[],
  options: RunStructuredDataAnalysisOptions,
): Promise<StructuredDataAnalysisResult> {
  if (!options.required) {
    return { status: 'not_required' };
  }

  const legacyExcelFiles = files.filter(isLegacyExcelFile);
  if (legacyExcelFiles.length > 0) {
    return {
      status: 'failed',
      filename: legacyExcelFiles.map((file) => safeDataFilename(file.original_name)).join(', '),
      reason: 'Legacy .xls Excel files are unsupported; convert the workbook to .xlsx, CSV, TSV, or JSON before uploading.',
    };
  }

  const dataFiles = files.filter(isStructuredDataFile);
  if (dataFiles.length === 0) {
    return {
      status: 'missing_data_file',
      reason: 'Data analysis was required, but no CSV, TSV, JSON, or XLSX dataset was uploaded.',
    };
  }

  try {
    const downloadMaterial = options.downloadMaterial || downloadMaterialFromStorage;
    const results = [];

    for (const dataFile of dataFiles) {
      results.push(await analyzeStructuredDataFile(dataFile, downloadMaterial));
    }

    return mergeAnalysisResults(results);
  } catch (error) {
    return {
      status: 'failed',
      filename: dataFiles.map((file) => safeDataFilename(file.original_name)).join(', '),
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
