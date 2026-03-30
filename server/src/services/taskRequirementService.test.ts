import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskRequirementExtractionPrompt,
  deriveUnifiedTaskRequirements,
  normalizeExtractedTaskRequirements,
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

test('buildTaskRequirementExtractionPrompt asks for extraction only and defaults later in code', () => {
  const prompt = buildTaskRequirementExtractionPrompt({
    specialRequirements: 'Please use Harvard style and keep it around 2500 words.',
  });

  assert.match(prompt.systemPrompt, /extract only the explicitly stated target word count and citation style/i);
  assert.match(prompt.systemPrompt, /if a value is not clearly specified, return null/i);
  assert.match(prompt.userPrompt, /harvard style and keep it around 2500 words/i);
});
