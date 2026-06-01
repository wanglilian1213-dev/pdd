import test from 'node:test';
import assert from 'node:assert/strict';
import { assessWritingQualityRequirements } from './writingQualityGateService';
import {
  assertFinalWritingQualityReview,
  finalWritingQualityReviewTestUtils,
  parseFinalWritingQualityReview,
} from './finalWritingQualityReviewService';

test('parseFinalWritingQualityReview accepts fenced JSON verdicts', () => {
  const review = parseFinalWritingQualityReview([
    '```json',
    '{"format_pass":true,"requirement_pass":true,"rubric_pass":true,"reasons":["ok"]}',
    '```',
  ].join('\n'));

  assert.deepEqual(review, {
    format_pass: true,
    requirement_pass: true,
    rubric_pass: true,
    reasons: ['ok'],
  });
});

test('parseFinalWritingQualityReview rejects malformed verdicts', () => {
  assert.equal(parseFinalWritingQualityReview('{"format_pass":true}'), null);
});

test('assertFinalWritingQualityReview passes when all required review areas pass', () => {
  const profile = assessWritingQualityRequirements({
    specialRequirements: 'Use the uploaded rubric and include one chart.',
    outline: 'Introduction\nAnalysis\nConclusion',
    materialFiles: [{ original_name: 'rubric.pdf', mime_type: 'application/pdf', storage_path: 'task/rubric.pdf' }],
  });

  assertFinalWritingQualityReview({
    format_pass: true,
    requirement_pass: true,
    rubric_pass: true,
    reasons: [],
  }, profile);
});

test('assertFinalWritingQualityReview blocks format and requirement failures', () => {
  const profile = assessWritingQualityRequirements({
    specialRequirements: 'Normal essay.',
  });

  assert.throws(
    () => assertFinalWritingQualityReview({
      format_pass: false,
      requirement_pass: false,
      rubric_pass: true,
      reasons: ['raw JSON block remains'],
    }, profile),
    /quality_gate_failed:final_format_review_failed,final_requirement_review_failed:raw JSON block remains/,
  );
});

test('assertFinalWritingQualityReview blocks rubric failures only when a rubric was detected', () => {
  const rubricProfile = assessWritingQualityRequirements({
    specialRequirements: 'Follow the uploaded marking rubric.',
    materialFiles: [{ original_name: 'marking-rubric.pdf', mime_type: 'application/pdf', storage_path: 'task/rubric.pdf' }],
  });
  const normalProfile = assessWritingQualityRequirements({
    specialRequirements: 'Normal essay.',
  });

  assert.throws(
    () => assertFinalWritingQualityReview({
      format_pass: true,
      requirement_pass: true,
      rubric_pass: false,
      reasons: ['missed rubric criterion'],
    }, rubricProfile),
    /quality_gate_failed:final_rubric_review_failed:missed rubric criterion/,
  );

  assert.doesNotThrow(() => assertFinalWritingQualityReview({
    format_pass: true,
    requirement_pass: true,
    rubric_pass: false,
    reasons: ['not applicable'],
  }, normalProfile));
});

test('final review prompt requires an item-by-item assignment and rubric checklist', () => {
  const profile = assessWritingQualityRequirements({
    specialRequirements: 'Use the uploaded rubric, include one chart, and do not use external sources.',
    outline: 'Introduction\nAnalysis\nConclusion',
    materialFiles: [{ original_name: 'rubric.pdf', mime_type: 'application/pdf', storage_path: 'task/rubric.pdf' }],
  });

  const prompt = finalWritingQualityReviewTestUtils.buildFinalWritingQualityReviewPrompt({
    finalText: 'Final paper text.',
    specialRequirements: 'Use the uploaded rubric, include one chart, and do not use external sources.',
    outline: 'Introduction\nAnalysis\nConclusion',
    profile,
  });

  assert.match(prompt, /internal checklist from every explicit user requirement/i);
  assert.match(prompt, /assignment brief requirement/i);
  assert.match(prompt, /rubric criterion/i);
  assert.match(prompt, /If any item is missing/i);
  assert.match(prompt, /requirement_pass=false/i);
  assert.match(prompt, /rubric_pass=false/i);
  assert.match(prompt, /include one chart/);
  assert.match(prompt, /do not use external sources/);
});

test('final review prompt calls out legal citation, quote, and Word-format edge cases', () => {
  const profile = assessWritingQualityRequirements({
    specialRequirements: 'Use OSCOLA footnotes, page numbers for direct quotes, and a table of contents.',
    outline: 'Introduction\nAnalysis\nConclusion',
    materialFiles: [{ original_name: 'case-list.pdf', mime_type: 'application/pdf', storage_path: 'task/case-list.pdf' }],
  });

  const prompt = finalWritingQualityReviewTestUtils.buildFinalWritingQualityReviewPrompt({
    finalText: 'Final paper text.',
    specialRequirements: 'Use OSCOLA footnotes, page numbers for direct quotes, and a table of contents.',
    outline: 'Introduction\nAnalysis\nConclusion',
    profile,
  });

  assert.match(prompt, /footnotes/);
  assert.match(prompt, /page\/slide numbers/);
  assert.match(prompt, /direct quote authenticity/);
  assert.match(prompt, /table of contents/);
  assert.match(prompt, /Bluebook/);
  assert.match(prompt, /case\/statute citation/);
});

test('final review prompt calls out ethics, privacy, current-law, finance, and knockout-rule edge cases', () => {
  const profile = assessWritingQualityRequirements({
    specialRequirements: 'Use current law, anonymize interviewees, include IRB evidence, and follow the rubric automatic-fail rule.',
    outline: 'Introduction\nAnalysis\nConclusion',
    materialFiles: [{ original_name: 'rubric.pdf', mime_type: 'application/pdf', storage_path: 'task/rubric.pdf' }],
  });

  const prompt = finalWritingQualityReviewTestUtils.buildFinalWritingQualityReviewPrompt({
    finalText: 'Final paper text.',
    specialRequirements: 'Use current law, anonymize interviewees, include IRB evidence, and follow the rubric automatic-fail rule.',
    outline: 'Introduction\nAnalysis\nConclusion',
    profile,
  });

  assert.match(prompt, /current official sources/);
  assert.match(prompt, /exact dates/);
  assert.match(prompt, /jurisdiction boundaries/);
  assert.match(prompt, /IRB\/ethics approval/);
  assert.match(prompt, /consent/);
  assert.match(prompt, /private coordinates\/exact locations/);
  assert.match(prompt, /TAM\/SAM\/SOM/);
  assert.match(prompt, /guaranteed returns/);
  assert.match(prompt, /Automatic-fail, knockout, cap/);
});

test('final writing quality review timeout rejects instead of hanging forever', async () => {
  await assert.rejects(
    () => finalWritingQualityReviewTestUtils.withFinalReviewTimeout(new Promise<string>(() => {}), 5),
    /quality_gate_failed:final_review_timeout:5ms/,
  );
});
