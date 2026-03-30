import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../lib/errors';
import { mapOutlineGenerationError } from './outlineService';
import { normalizeCitationStyle } from './citationStyleService';
import * as outlineService from './outlineService';

test('mapOutlineGenerationError keeps existing AppError untouched', () => {
  const error = new AppError(400, '原始错误');
  assert.equal(mapOutlineGenerationError(error), error);
});

test('mapOutlineGenerationError turns unsupported file errors into a clear user message', () => {
  const mapped = mapOutlineGenerationError(new Error('400 Unsupported file type: .pages'));
  assert.equal(mapped.statusCode, 400);
  assert.match(mapped.userMessage, /暂时无法读取|换一个常见格式/);
  assert.match(mapped.detail || '', /Unsupported file type/);
});

test('mapOutlineGenerationError turns oversized input errors into a clear user message', () => {
  const mapped = mapOutlineGenerationError(new Error('Request too large for model input'));
  assert.equal(mapped.statusCode, 400);
  assert.match(mapped.userMessage, /文件太大|拆分/);
});

test('normalizeCitationStyle collapses mixed APA and Harvard wording into one final style', () => {
  assert.equal(
    normalizeCitationStyle('APA 7th edition (Harvard-style)'),
    'APA 7',
  );
});

test('normalizeCitationStyle keeps a plain single style unchanged', () => {
  assert.equal(normalizeCitationStyle('Harvard'), 'Harvard');
});

test('outline results with placeholder research questions or rubric-style titles are treated as invalid', () => {
  const assess = (outlineService as Record<string, unknown>).assessOutlineReadiness as ((payload: {
    paper_title?: string;
    research_question?: string;
    outline?: string;
  }) => { valid: boolean; reasons: string[] }) | undefined;

  assert.equal(typeof assess, 'function');

  const result = assess!({
    paper_title: 'Report Marking Criteria',
    research_question: '[Research Question]',
    outline: 'Introduction\n- Explain the issue\nBody\n- Discuss the factors',
  });

  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((reason) => /title/i.test(reason)));
  assert.ok(result.reasons.some((reason) => /research question/i.test(reason)));
});

test('outline results with a concrete title and research question are treated as valid', () => {
  const assess = (outlineService as Record<string, unknown>).assessOutlineReadiness as ((payload: {
    paper_title?: string;
    research_question?: string;
    outline?: string;
  }) => { valid: boolean; reasons: string[] }) | undefined;

  assert.equal(typeof assess, 'function');

  const result = assess!({
    paper_title: 'Should Small Businesses Use AI for Strategy Writing?',
    research_question: 'To what extent should small businesses rely on AI for strategic writing tasks?',
    outline: 'Introduction\n- Define strategic writing\n- Explain the small-business context\n- State the thesis',
  });

  assert.equal(result.valid, true);
  assert.deepEqual(result.reasons, []);
});

test('outline results that only repeat an uploaded filename without extension are treated as invalid', () => {
  const assess = (outlineService as Record<string, unknown>).assessOutlineReadiness as ((payload: {
    paper_title?: string;
    research_question?: string;
    outline?: string;
  }, options?: { blockedFileTitles?: string[] }) => { valid: boolean; reasons: string[] }) | undefined;

  assert.equal(typeof assess, 'function');

  const result = assess!(
    {
      paper_title: 'Task Brief',
      research_question: 'How should small businesses use AI in strategic writing tasks?',
      outline: 'Introduction\n- Define the topic\n- Explain the context\n- State the thesis',
    },
    { blockedFileTitles: ['Task Brief.pdf'] },
  );

  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((reason) => /title/i.test(reason)));
});

test('outline results with three multiline sections stay valid when three sections are required', () => {
  const assess = (outlineService as Record<string, unknown>).assessOutlineReadiness as ((payload: {
    paper_title?: string;
    research_question?: string;
    outline?: string;
  }, options?: { requiredSectionCount?: number }) => { valid: boolean; reasons: string[] }) | undefined;

  assert.equal(typeof assess, 'function');

  const result = assess!(
    {
      paper_title: 'Social Media Use and Adolescent Mental Health: Risks, Benefits, and Policy Responses',
      research_question: 'To what extent does social media use affect adolescent mental health, and what measures can families, schools, platforms, and policymakers take to reduce harm?',
      outline: [
        'Introduction',
        '- Explain why adolescent mental health is a growing public concern.',
        '- Introduce social media as both a risk factor and a source of support.',
        '- State the thesis and the focus of the discussion.',
        'Main Body: Effects, Causes, and Responses',
        '- Analyse the negative mental health risks associated with intensive social media use.',
        '- Consider arguments about the benefits of social media for connection and support.',
        '- Evaluate policy, family, school, and platform responses that may reduce harm.',
        'Conclusion',
        '- Summarise the overall argument about risks, benefits, and responses.',
        '- Reaffirm the thesis in relation to the research question.',
        '- Highlight the most effective practical response.',
      ].join('\n'),
    },
    { requiredSectionCount: 3 },
  );

  assert.equal(result.valid, true);
  assert.deepEqual(result.reasons, []);
});
