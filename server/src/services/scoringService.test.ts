import test from 'node:test';
import assert from 'node:assert/strict';

import {
  computeSettledWords,
  scoringServiceTestUtils,
} from './scoringService';
import type { ScoringResult } from './scoringPromptService';

const { computeFrozenAmount, sanitizeForFilename } = scoringServiceTestUtils;

// ---------------------------------------------------------------------------
// computeFrozenAmount
// ---------------------------------------------------------------------------

test('computeFrozenAmount: pure integer when exact', () => {
  assert.equal(computeFrozenAmount(1500, 0.1), 150);
  assert.equal(computeFrozenAmount(1000, 0.1), 100);
});

test('computeFrozenAmount: rounds up fractional credits', () => {
  // 1234 * 0.1 = 123.4 → 124
  assert.equal(computeFrozenAmount(1234, 0.1), 124);
  // 1 * 0.1 = 0.1 → 1
  assert.equal(computeFrozenAmount(1, 0.1), 1);
});

test('computeFrozenAmount: zero words → zero', () => {
  assert.equal(computeFrozenAmount(0, 0.1), 0);
});

// ---------------------------------------------------------------------------
// computeSettledWords
// ---------------------------------------------------------------------------

function makeResult(
  articleFilenames: string[],
  extraFilenames: Array<{ filename: string; role: 'rubric' | 'brief' | 'other' }> = [],
): ScoringResult {
  return {
    overall_score: 80,
    overall_comment: 'ok',
    dimensions: [],
    top_suggestions: [],
    detected_files: [
      ...articleFilenames.map((f) => ({ filename: f, role: 'article' as const, note: '' })),
      ...extraFilenames.map((f) => ({ ...f, note: '' })),
    ],
  };
}

test('computeSettledWords: exact filename match sums article word counts', () => {
  const result = makeResult(['essay.docx']);
  const settled = computeSettledWords(
    result,
    [
      { originalName: 'essay.docx', extractedWordCount: 1500 },
      { originalName: 'rubric.pdf', extractedWordCount: 300 },
    ],
    1800,
  );
  assert.equal(settled, 1500);
});

test('computeSettledWords: case-insensitive match — GPT lowercases filename', () => {
  // 回归保证：原始上传是 Report_FINAL.docx，GPT 回写为 report_final.docx 仍然命中
  const result = makeResult(['report_final.docx']);
  const settled = computeSettledWords(
    result,
    [
      { originalName: 'Report_FINAL.docx', extractedWordCount: 1200 },
      { originalName: 'rubric.pdf', extractedWordCount: 200 },
    ],
    1400,
  );
  assert.equal(settled, 1200);
});

test('computeSettledWords: whitespace + path prefix stripped before match', () => {
  // GPT 偶尔会带路径前缀或首尾空格
  const result = makeResult([' /tmp/uploads/Essay.DOCX ']);
  const settled = computeSettledWords(
    result,
    [{ originalName: 'essay.docx', extractedWordCount: 900 }],
    900,
  );
  assert.equal(settled, 900);
});

test('computeSettledWords: no article detected → fallback to inputWordCount', () => {
  // GPT 把所有文件都标成 rubric/brief/other，没识别出 article
  const result = makeResult([], [
    { filename: 'rubric.pdf', role: 'rubric' },
    { filename: 'brief.pdf', role: 'brief' },
  ]);
  const settled = computeSettledWords(
    result,
    [
      { originalName: 'rubric.pdf', extractedWordCount: 300 },
      { originalName: 'brief.pdf', extractedWordCount: 400 },
    ],
    700,
  );
  assert.equal(settled, 700);
});

test('computeSettledWords: clamped to inputWordCount (GPT miscounts)', () => {
  // 极端保护：即使 extracted 值被脏数据调大过也不能超冻结依据
  const result = makeResult(['essay.docx']);
  const settled = computeSettledWords(
    result,
    [{ originalName: 'essay.docx', extractedWordCount: 99999 }],
    1000,
  );
  assert.equal(settled, 1000);
});

test('computeSettledWords: multiple articles summed', () => {
  const result = makeResult(['part1.docx', 'part2.docx']);
  const settled = computeSettledWords(
    result,
    [
      { originalName: 'part1.docx', extractedWordCount: 600 },
      { originalName: 'part2.docx', extractedWordCount: 500 },
      { originalName: 'rubric.pdf', extractedWordCount: 200 },
    ],
    1300,
  );
  assert.equal(settled, 1100);
});

test('computeSettledWords: filename mismatch entirely → fallback', () => {
  // GPT 编了一个不存在的 filename（比如把 "essay.docx" 回成 "student_essay.docx"）
  const result = makeResult(['student_essay.docx']);
  const settled = computeSettledWords(
    result,
    [{ originalName: 'essay.docx', extractedWordCount: 900 }],
    900,
  );
  assert.equal(settled, 900); // fallback to input
});

// ---------------------------------------------------------------------------
// sanitizeForFilename
// ---------------------------------------------------------------------------

test('sanitizeForFilename: strips illegal path chars', () => {
  assert.equal(sanitizeForFilename('A/B:C?D*E'), 'A_B_C_D_E');
  assert.equal(sanitizeForFilename('Report "Draft"<v2>'), 'Report _Draft__v2_');
});

test('sanitizeForFilename: collapses whitespace and trims', () => {
  assert.equal(sanitizeForFilename('  My   Report  '), 'My Report');
});

test('sanitizeForFilename: truncates extra-long titles', () => {
  const long = 'a'.repeat(200);
  const cleaned = sanitizeForFilename(long);
  assert.ok(cleaned.length <= 120);
});

// ---------------------------------------------------------------------------
// withScoringTimeout
// ---------------------------------------------------------------------------

test('withScoringTimeout: resolves when inner resolves before timeout', async () => {
  const result = await scoringServiceTestUtils.withScoringTimeout(
    Promise.resolve('ok'),
    10_000,
  );
  assert.equal(result, 'ok');
});

test('withScoringTimeout: rejects with ScoringTimeoutError past deadline', async () => {
  const slow = new Promise((resolve) => setTimeout(resolve, 200));
  await assert.rejects(
    scoringServiceTestUtils.withScoringTimeout(slow, 20),
    (err: unknown) =>
      err instanceof scoringServiceTestUtils.ScoringTimeoutError &&
      (err as Error).message.includes('评审处理超时'),
  );
});

// ---------------------------------------------------------------------------
// constants sanity
// ---------------------------------------------------------------------------

test('scoring constants: 20 minute timeout, 2 retry attempts', () => {
  assert.equal(scoringServiceTestUtils.SCORING_STAGE_TIMEOUT_MS, 20 * 60 * 1000);
  assert.equal(scoringServiceTestUtils.SCORING_JSON_RETRY_MAX_ATTEMPTS, 2);
});
