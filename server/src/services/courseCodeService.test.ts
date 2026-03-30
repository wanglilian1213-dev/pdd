import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCourseCodeExtractionPrompt,
  extractCourseCodeByRegex,
  parseCourseCodeExtraction,
} from './courseCodeService';

test('extractCourseCodeByRegex matches common course code formats', () => {
  assert.equal(extractCourseCodeByRegex(
    'Please follow BUSI1001 instructions.',
  ), 'BUSI1001');

  assert.equal(extractCourseCodeByRegex(
    'Module code: BUSI-1001',
  ), 'BUSI-1001');

  assert.equal(extractCourseCodeByRegex(
    'Course code BUSI 1001 appears in the brief.',
  ), 'BUSI 1001');
});

test('buildCourseCodeExtractionPrompt asks for one structured course code result', () => {
  const prompt = buildCourseCodeExtractionPrompt({
    taskTitle: 'Final Essay',
    specialRequirements: 'Please follow BUSI1001 requirements.',
  });

  assert.match(prompt.systemPrompt, /extract a single course code/i);
  assert.match(prompt.systemPrompt, /return valid json only/i);
  assert.match(prompt.userPrompt, /Final Essay/);
  assert.match(prompt.userPrompt, /BUSI1001/);
});

test('parseCourseCodeExtraction returns null when nothing usable is found', () => {
  assert.equal(parseCourseCodeExtraction('{"course_code":""}'), null);
  assert.equal(parseCourseCodeExtraction('No course code found.'), null);
});
