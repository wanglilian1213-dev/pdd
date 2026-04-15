import test from 'node:test';
import assert from 'node:assert/strict';

import {
  detectScenario,
  buildScoringSystemPrompt,
  buildScoringUserMessage,
  buildScoringRetryHint,
  parseScoringJson,
  validateScoringJson,
  SCORING_SYSTEM_PROMPT_EN,
} from './scoringPromptService';

// --- detectScenario --------------------------------------------------------

test('detectScenario: rubric present → rubric', () => {
  assert.equal(detectScenario(['rubric']), 'rubric');
  assert.equal(detectScenario(['article', 'rubric']), 'rubric');
  assert.equal(detectScenario(['rubric', 'brief', 'article']), 'rubric');
});

test('detectScenario: no rubric but brief present → brief_only', () => {
  assert.equal(detectScenario(['brief']), 'brief_only');
  assert.equal(detectScenario(['article', 'brief']), 'brief_only');
  assert.equal(detectScenario(['unknown', 'brief']), 'brief_only');
});

test('detectScenario: only article or unknown → article_only', () => {
  assert.equal(detectScenario(['article']), 'article_only');
  assert.equal(detectScenario(['unknown']), 'article_only');
  assert.equal(detectScenario([]), 'article_only');
});

// --- buildScoringSystemPrompt ----------------------------------------------

test('buildScoringSystemPrompt: contains 75-84 anchor and mentor framing', () => {
  const p = buildScoringSystemPrompt();
  assert.equal(p, SCORING_SYSTEM_PROMPT_EN);
  assert.match(p, /75–84/);
  assert.match(p, /belongs in this band/i);
  assert.match(p, /seasoned academic mentor/i);
});

test('buildScoringSystemPrompt: contains tolerance list and JSON schema marker', () => {
  const p = buildScoringSystemPrompt();
  assert.match(p, /Tolerance list/i);
  assert.match(p, /typos \/ punctuation slips/i);
  assert.match(p, /output only valid json/i);
  assert.match(p, /"overall_score"/);
  assert.match(p, /"detected_files"/);
});

test('buildScoringSystemPrompt: specifies default 5 dimensions and weights', () => {
  const p = buildScoringSystemPrompt();
  assert.match(p, /Content & argument — 30%/);
  assert.match(p, /Argumentation & evidence — 25%/);
  assert.match(p, /Structure & logic — 20%/);
  assert.match(p, /Language & expression — 15%/);
  assert.match(p, /Citation format — 10%/);
});

// --- buildScoringUserMessage -----------------------------------------------

test('buildScoringUserMessage: rubric scenario adds strict-against-rubric suffix', () => {
  const msg = buildScoringUserMessage({
    scenario: 'rubric',
    files: [
      { filename: 'rubric.pdf', hintedRole: 'rubric' },
      { filename: 'essay.docx', hintedRole: 'article' },
    ],
  });
  assert.match(msg, /rubric has been uploaded/i);
  assert.match(msg, /do not add dimensions the rubric does not mention/i);
  assert.match(msg, /rubric\.pdf/);
  assert.match(msg, /essay\.docx/);
  assert.match(msg, /hinted role: rubric/);
  assert.match(msg, /hinted role: article/);
});

test('buildScoringUserMessage: brief_only scenario uses default skeleton + weight adjustment', () => {
  const msg = buildScoringUserMessage({
    scenario: 'brief_only',
    files: [
      { filename: 'task.pdf', hintedRole: 'brief' },
      { filename: 'my paper.docx', hintedRole: 'article' },
    ],
  });
  assert.match(msg, /assignment brief has been uploaded but no rubric/i);
  assert.match(msg, /sum to 100/i);
});

test('buildScoringUserMessage: article_only scenario locks default weights', () => {
  const msg = buildScoringUserMessage({
    scenario: 'article_only',
    files: [{ filename: 'essay.docx', hintedRole: 'article' }],
  });
  assert.match(msg, /Only the article itself is provided/i);
  assert.match(msg, /30\/25\/20\/15\/10/);
});

test('buildScoringUserMessage: handles empty file list gracefully', () => {
  const msg = buildScoringUserMessage({ scenario: 'article_only', files: [] });
  assert.match(msg, /\(no files listed\)/);
});

// --- buildScoringRetryHint -------------------------------------------------

test('buildScoringRetryHint: surfaces error summary and concision instruction', () => {
  const hint = buildScoringRetryHint([
    'overall_score missing',
    'dimensions[0].weight invalid',
  ]);
  assert.match(hint, /Your previous response was not valid JSON/i);
  assert.match(hint, /overall_score missing/);
  assert.match(hint, /dimensions\[0\]\.weight invalid/);
  assert.match(hint, /avoid truncation/i);
});

// --- parseScoringJson ------------------------------------------------------

test('parseScoringJson: plain JSON parses', () => {
  const parsed = parseScoringJson('{"a": 1, "b": "x"}');
  assert.deepEqual(parsed, { a: 1, b: 'x' });
});

test('parseScoringJson: strips ```json fences', () => {
  const parsed = parseScoringJson('```json\n{"ok": true}\n```');
  assert.deepEqual(parsed, { ok: true });
});

test('parseScoringJson: strips bare ``` fences', () => {
  const parsed = parseScoringJson('```\n{"ok": true}\n```');
  assert.deepEqual(parsed, { ok: true });
});

test('parseScoringJson: extracts first { to last } with prose surround', () => {
  const text = 'Here is the result:\n{"score": 80}\nThanks!';
  assert.deepEqual(parseScoringJson(text), { score: 80 });
});

test('parseScoringJson: returns null for empty or unparseable text', () => {
  assert.equal(parseScoringJson(''), null);
  assert.equal(parseScoringJson('not json at all'), null);
  assert.equal(parseScoringJson('{not: valid}'), null);
});

// --- validateScoringJson ---------------------------------------------------

function buildValidResult() {
  return {
    overall_score: 80,
    overall_comment: 'Solid paper that meets the brief.',
    dimensions: [
      {
        name: 'Content & argument',
        weight: 30,
        score: 80,
        strengths: ['Clear central argument.'],
        weaknesses: ['No substantive weaknesses identified.'],
        suggestions: ['Consider one more counter-argument.'],
      },
      {
        name: 'Argumentation & evidence',
        weight: 25,
        score: 78,
        strengths: ['Post-2020 sources are well integrated.'],
        weaknesses: [],
        suggestions: ['Quantify the impact in section 3.'],
      },
      {
        name: 'Structure & logic',
        weight: 20,
        score: 82,
        strengths: ['Logical flow.'],
        weaknesses: [],
        suggestions: ['Tighten the conclusion.'],
      },
      {
        name: 'Language & expression',
        weight: 15,
        score: 80,
        strengths: ['Readable prose.'],
        weaknesses: [],
        suggestions: ['Vary sentence openers.'],
      },
      {
        name: 'Citation format',
        weight: 10,
        score: 82,
        strengths: ['APA 7 is consistent.'],
        weaknesses: [],
        suggestions: ['Double-check DOI links.'],
      },
    ],
    top_suggestions: [
      'Add one counter-argument in section 2.',
      'Quantify findings where possible.',
      'Tighten the conclusion.',
    ],
    detected_files: [
      { filename: 'essay.docx', role: 'article', note: '' },
    ],
  };
}

test('validateScoringJson: valid payload passes', () => {
  const result = validateScoringJson(buildValidResult());
  assert.equal(result.ok, true);
});

test('validateScoringJson: non-object input fails', () => {
  assert.equal(validateScoringJson(null).ok, false);
  assert.equal(validateScoringJson('string').ok, false);
  assert.equal(validateScoringJson([]).ok, false);
});

test('validateScoringJson: overall_score out of range fails', () => {
  const bad = buildValidResult();
  bad.overall_score = 150;
  const result = validateScoringJson(bad);
  assert.equal(result.ok, false);
  assert.ok(
    !result.ok && result.errors.some((e) => /overall_score/.test(e)),
    'should report overall_score error',
  );
});

test('validateScoringJson: overall_comment empty fails', () => {
  const bad = buildValidResult();
  bad.overall_comment = '';
  const result = validateScoringJson(bad);
  assert.equal(result.ok, false);
});

test('validateScoringJson: empty dimensions fails', () => {
  const bad = buildValidResult();
  bad.dimensions = [];
  const result = validateScoringJson(bad);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.some((e) => /dimensions/.test(e)));
});

test('validateScoringJson: weight sum outside [95, 105] fails', () => {
  const bad = buildValidResult();
  bad.dimensions[0].weight = 60; // sum now 110
  const result = validateScoringJson(bad);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.some((e) => /weights must sum/.test(e)));
});

test('validateScoringJson: weight sum 101 still passes (rounding tolerance)', () => {
  const ok = buildValidResult();
  ok.dimensions[0].weight = 31; // sum 101
  const result = validateScoringJson(ok);
  assert.equal(result.ok, true);
});

test('validateScoringJson: dimension missing strengths fails', () => {
  const bad = buildValidResult() as any;
  bad.dimensions[0].strengths = [];
  const result = validateScoringJson(bad);
  assert.equal(result.ok, false);
});

test('validateScoringJson: dimension weaknesses may be empty array', () => {
  const ok = buildValidResult();
  ok.dimensions.forEach((d) => {
    d.weaknesses = [];
  });
  const result = validateScoringJson(ok);
  assert.equal(result.ok, true);
});

test('validateScoringJson: top_suggestions fewer than 3 fails', () => {
  const bad = buildValidResult();
  bad.top_suggestions = ['only one'];
  const result = validateScoringJson(bad);
  assert.equal(result.ok, false);
});

test('validateScoringJson: top_suggestions more than 6 fails', () => {
  const bad = buildValidResult();
  bad.top_suggestions = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const result = validateScoringJson(bad);
  assert.equal(result.ok, false);
});

test('validateScoringJson: detected_files empty fails', () => {
  const bad = buildValidResult();
  bad.detected_files = [];
  const result = validateScoringJson(bad);
  assert.equal(result.ok, false);
});

test('validateScoringJson: detected_files with invalid role fails', () => {
  const bad = buildValidResult() as any;
  bad.detected_files[0].role = 'teacher';
  const result = validateScoringJson(bad);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.errors.some((e) => /role/.test(e)));
});

test('validateScoringJson: missing detected_files filename fails', () => {
  const bad = buildValidResult() as any;
  bad.detected_files[0].filename = '';
  const result = validateScoringJson(bad);
  assert.equal(result.ok, false);
});
