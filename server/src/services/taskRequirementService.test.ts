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
    requiredSectionCount: null,
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

// --- requiredSectionCount priority tests ---

test('deriveUnifiedTaskRequirements uses document-specified section count over word-count formula', () => {
  const result = deriveUnifiedTaskRequirements({
    targetWords: 2500,
    citationStyle: 'Harvard',
    requiredSectionCount: 6,
  });

  assert.equal(result.requiredSectionCount, 6); // document says 6, formula would give 5
  assert.equal(result.requiredReferenceCount, 15); // references still computed from word count
});

test('deriveUnifiedTaskRequirements falls back to formula when requiredSectionCount is null', () => {
  const result = deriveUnifiedTaskRequirements({
    targetWords: 2500,
    requiredSectionCount: null,
  });

  assert.equal(result.requiredSectionCount, 5); // formula: 3 + (3 - 1) = 5
});

test('deriveUnifiedTaskRequirements falls back to formula when requiredSectionCount is below minimum', () => {
  const result = deriveUnifiedTaskRequirements({
    targetWords: 2500,
    requiredSectionCount: 1,
  });

  assert.equal(result.requiredSectionCount, 5); // 1 is below min of 2, use formula
});

test('deriveUnifiedTaskRequirements falls back to formula when requiredSectionCount exceeds maximum', () => {
  const result = deriveUnifiedTaskRequirements({
    targetWords: 2500,
    requiredSectionCount: 25,
  });

  assert.equal(result.requiredSectionCount, 5); // 25 is above max of 20, use formula
});

test('normalizeExtractedTaskRequirements parses required_section_count from JSON', () => {
  const result = normalizeExtractedTaskRequirements(
    '{"target_words":2000,"citation_style":"APA 7","required_section_count":6}',
  );

  assert.equal(result.requiredSectionCount, 6);
});

test('normalizeExtractedTaskRequirements returns null for missing required_section_count', () => {
  const result = normalizeExtractedTaskRequirements(
    '{"target_words":2000,"citation_style":"APA 7"}',
  );

  assert.equal(result.requiredSectionCount, null);
});

// --- parseRequirementOverrides section count tests ---

test('parseRequirementOverrides extracts Chinese section count', () => {
  assert.deepEqual(parseRequirementOverrides('改成6个章节'), { requiredSectionCount: 6 });
  assert.deepEqual(parseRequirementOverrides('分5个部分'), { requiredSectionCount: 5 });
  assert.deepEqual(parseRequirementOverrides('写4章'), { requiredSectionCount: 4 });
});

test('parseRequirementOverrides extracts English section count', () => {
  assert.deepEqual(parseRequirementOverrides('change to 6 sections'), { requiredSectionCount: 6 });
  assert.deepEqual(parseRequirementOverrides('use 4 sections'), { requiredSectionCount: 4 });
});

test('parseRequirementOverrides rejects out-of-range section count', () => {
  assert.deepEqual(parseRequirementOverrides('1 section'), {});
  assert.deepEqual(parseRequirementOverrides('25 sections'), {});
});

test('parseRequirementOverrides extracts both word count and section count', () => {
  const result = parseRequirementOverrides('写3000字，分6个章节');
  assert.equal(result.targetWords, 3000);
  assert.equal(result.requiredSectionCount, 6);
});

test('buildTaskRequirementExtractionPrompt asks for extraction only and defaults later in code', () => {
  const prompt = buildTaskRequirementExtractionPrompt({
    specialRequirements: 'Please use Harvard style and keep it around 2500 words.',
  });

  assert.match(prompt.systemPrompt, /extract only the explicitly stated target word count and citation style/i);
  assert.match(prompt.systemPrompt, /if a value is not clearly specified, return null/i);
  assert.match(prompt.userPrompt, /harvard style and keep it around 2500 words/i);
});
