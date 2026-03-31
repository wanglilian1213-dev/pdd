import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskRequirementExtractionPrompt,
  deriveUnifiedTaskRequirements,
  normalizeExtractedTaskRequirements,
  parseRequirementOverrides,
} from './taskRequirementService';

test('deriveUnifiedTaskRequirements defaults to 1000 words, APA 7, 5 references, and 3 sections', () => {
  const result = deriveUnifiedTaskRequirements({});

  assert.deepEqual(result, {
    targetWords: 1000,
    citationStyle: 'APA 7',
    requiredReferenceCount: 5,
    requiredSectionCount: 3,
  });
});

test('deriveUnifiedTaskRequirements scales references and sections by rounded-up 1000-word units', () => {
  const result = deriveUnifiedTaskRequirements({
    targetWords: 2500,
    citationStyle: 'Harvard',
  });

  assert.deepEqual(result, {
    targetWords: 2500,
    citationStyle: 'Harvard',
    requiredReferenceCount: 15,
    requiredSectionCount: 5,
  });
});

test('normalizeExtractedTaskRequirements keeps nulls when extraction prompt should not invent missing values', () => {
  const result = normalizeExtractedTaskRequirements('{"target_words":null,"citation_style":null}');

  assert.deepEqual(result, {
    targetWords: null,
    citationStyle: null,
  });
});

// --- parseRequirementOverrides tests ---

test('parseRequirementOverrides extracts Chinese word count', () => {
  assert.deepEqual(parseRequirementOverrides('写3000字吧'), { targetWords: 3000 });
  assert.deepEqual(parseRequirementOverrides('改成5000字'), { targetWords: 5000 });
  assert.deepEqual(parseRequirementOverrides('目标2000字左右'), { targetWords: 2000 });
});

test('parseRequirementOverrides extracts English word count', () => {
  assert.deepEqual(parseRequirementOverrides('change to 3000 words'), { targetWords: 3000 });
  assert.deepEqual(parseRequirementOverrides('word count: 2500'), { targetWords: 2500 });
  assert.deepEqual(parseRequirementOverrides('target words 4000'), { targetWords: 4000 });
});

test('parseRequirementOverrides extracts citation style in Chinese', () => {
  const result = parseRequirementOverrides('换成Harvard');
  assert.equal(result.citationStyle, 'Harvard');
});

test('parseRequirementOverrides extracts citation style in English', () => {
  const result = parseRequirementOverrides('use MLA 9');
  assert.ok(result.citationStyle?.startsWith('MLA'));
});

test('parseRequirementOverrides extracts both word count and citation style', () => {
  const result = parseRequirementOverrides('写3000字，用APA 7');
  assert.equal(result.targetWords, 3000);
  assert.ok(result.citationStyle?.startsWith('APA'));
});

test('parseRequirementOverrides returns empty for structural edits', () => {
  assert.deepEqual(parseRequirementOverrides('加一个章节'), {});
  assert.deepEqual(parseRequirementOverrides('第三部分需要更详细'), {});
  assert.deepEqual(parseRequirementOverrides('增加关于AI的讨论'), {});
});

test('parseRequirementOverrides rejects out-of-range word count', () => {
  assert.deepEqual(parseRequirementOverrides('写100字'), {});
  assert.deepEqual(parseRequirementOverrides('写50000字'), {});
});

test('parseRequirementOverrides returns empty for empty input', () => {
  assert.deepEqual(parseRequirementOverrides(''), {});
  assert.deepEqual(parseRequirementOverrides('  '), {});
});

test('parseRequirementOverrides does not match 字符 字母 字体 etc', () => {
  assert.deepEqual(parseRequirementOverrides('不少于500字符'), {});
  assert.deepEqual(parseRequirementOverrides('用12号字体'), {});
});

test('buildTaskRequirementExtractionPrompt asks for extraction only and defaults later in code', () => {
  const prompt = buildTaskRequirementExtractionPrompt({
    specialRequirements: 'Please use Harvard style and keep it around 2500 words.',
  });

  assert.match(prompt.systemPrompt, /extract only the explicitly stated target word count and citation style/i);
  assert.match(prompt.systemPrompt, /if a value is not clearly specified, return null/i);
  assert.match(prompt.userPrompt, /harvard style and keep it around 2500 words/i);
});
