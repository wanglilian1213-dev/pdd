import test from 'node:test';
import assert from 'node:assert/strict';

import {
  runStealthwriterHumanizationLoop,
  STEALTHWRITER_MAX_HUMANIZE_MORE_ATTEMPTS,
  StealthwriterHumanizationLoopError,
} from './stealthwriterHumanizationService';

test('runStealthwriterHumanizationLoop retries Humanize More until V2 >= 90', async () => {
  const outputs = ['draft-1', 'draft-2', 'draft-3'];
  const scans = [84, 88, 93];
  let index = 0;

  const result = await runStealthwriterHumanizationLoop('original', {
    humanize: async () => ({
      originalText: 'original',
      output: outputs[0],
      sentences: [],
      resultId: 'result-1',
      raw: {},
    }),
    humanizeMore: async () => {
      index += 1;
      return {
        originalText: 'original',
        output: outputs[index],
        sentences: [],
        resultId: `result-${index + 1}`,
        raw: {},
      };
    },
    scanV2: async () => ({
      normalScore: scans[index],
      verdict: scans[index] >= 50 ? 'looks_human' : 'ai_detected',
      sentences: [],
      resultId: `scan-${index + 1}`,
      raw: {},
    }),
  });

  assert.equal(result.output, 'draft-3');
  assert.equal(result.finalHumanScore, 93);
  assert.equal(result.humanizeMoreAttempts, 2);
  assert.equal(result.scanVersion, 'v2');
  assert.equal(result.finalScan.normalScore, 93);
});

test('runStealthwriterHumanizationLoop fails after 3 unchanged Humanize More results', async () => {
  let scans = 0;

  await assert.rejects(
    () => runStealthwriterHumanizationLoop('original', {
      humanize: async () => ({
        originalText: 'original',
        output: 'same-output',
        sentences: [],
        resultId: 'result-1',
        raw: {},
      }),
      humanizeMore: async () => ({
        originalText: 'original',
        output: 'same-output',
        sentences: [],
        resultId: 'result-repeat',
        raw: {},
      }),
      scanV2: async () => {
        scans += 1;
        return {
          normalScore: 89,
          verdict: 'looks_human',
          sentences: [],
          resultId: `scan-${scans}`,
          raw: {},
        };
      },
    }),
    /连续 3 次没有给出新结果/,
  );
});

test('runStealthwriterHumanizationLoop fails after too many Humanize More attempts without reaching 90', async () => {
  let attempt = 0;

  await assert.rejects(
    () => runStealthwriterHumanizationLoop('original', {
      humanize: async () => ({
        originalText: 'original',
        output: 'draft-0',
        sentences: [],
        resultId: 'result-0',
        raw: {},
      }),
      humanizeMore: async () => {
        attempt += 1;
        return {
          originalText: 'original',
          output: `draft-${attempt}`,
          sentences: [],
          resultId: `result-${attempt}`,
          raw: {},
        };
      },
      scanV2: async () => ({
        normalScore: 42,
        verdict: 'ai_detected',
        sentences: [{ sentence: `draft-${attempt}`, score: 0.42, label: 'ai' }],
        resultId: `scan-${attempt}`,
        raw: {},
      }),
    }),
    (error: unknown) => {
      assert.ok(error instanceof StealthwriterHumanizationLoopError);
      assert.match(
        error.message,
        new RegExp(`连续 Humanize More ${STEALTHWRITER_MAX_HUMANIZE_MORE_ATTEMPTS} 次`),
      );
      assert.equal(error.lastScan.normalScore, 42);
      assert.equal(error.lastScan.sentences[0]?.label, 'ai');
      assert.equal(error.humanizeMoreAttempts, STEALTHWRITER_MAX_HUMANIZE_MORE_ATTEMPTS);
      return true;
    },
  );

  assert.equal(attempt, STEALTHWRITER_MAX_HUMANIZE_MORE_ATTEMPTS);
});
