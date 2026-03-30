import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaperLayoutModel } from './documentFormattingService';

test('buildPaperLayoutModel adds a cover page, body page, and separate references page', () => {
  const model = buildPaperLayoutModel(`The Impact of Electric Buses on Urban Planning

## Introduction

Electric buses are changing how cities plan transport infrastructure.

References

Smith, J. (2024). Urban transit reform. Journal of Mobility Studies, 12(3), 14-20.
Doe, A. (2023). Battery infrastructure and cities. Transport Review, 8(1), 33-49.`);

  const coverCourseCode = model.paragraphs[0];
  const coverTitle = model.paragraphs[1];
  const firstContentParagraph = model.paragraphs.find((paragraph) => paragraph.kind !== 'cover_course_code' && paragraph.kind !== 'cover_title');
  const referenceHeading = model.paragraphs.find((paragraph) => paragraph.kind === 'reference_heading');

  assert.equal(coverCourseCode?.kind, 'cover_course_code');
  assert.equal(coverCourseCode?.text, '');
  assert.equal(coverCourseCode?.fontFamily, 'Times New Roman');
  assert.equal(coverCourseCode?.fontSize, 12);
  assert.equal(coverCourseCode?.alignment, 'center');

  assert.equal(coverTitle?.kind, 'cover_title');
  assert.equal(coverTitle?.text, 'The Impact of Electric Buses on Urban Planning');
  assert.equal(coverTitle?.fontFamily, 'Times New Roman');
  assert.equal(coverTitle?.fontSize, 12);
  assert.equal(coverTitle?.bold, true);
  assert.equal(coverTitle?.alignment, 'center');

  assert.ok(firstContentParagraph);
  assert.equal(firstContentParagraph?.fontFamily, 'Times New Roman');
  assert.equal(firstContentParagraph?.fontSize, 12);
  assert.equal(firstContentParagraph?.lineSpacing, 1.5);
  assert.equal(firstContentParagraph?.pageBreakBefore, true);

  assert.ok(referenceHeading);
  assert.equal(referenceHeading?.text, 'References');
  assert.equal(referenceHeading?.pageBreakBefore, true);

  const references = model.paragraphs.filter((paragraph) => paragraph.kind === 'reference');
  assert.equal(references.length, 2);
  assert.equal(references[0]?.hangingIndent, true);
  assert.equal(references[0]?.lineSpacing, 1.5);
  assert.equal(references[0]?.fontFamily, 'Times New Roman');
  assert.equal(references[0]?.fontSize, 12);
});

test('buildPaperLayoutModel removes markdown-like heading markers and drops a duplicated title block from the body', () => {
  const model = buildPaperLayoutModel(`# Clean Energy Policy

### Literature Review

- This paragraph should not keep markdown bullets in the exported paper.`);

  assert.equal(model.paragraphs[1]?.text, 'Clean Energy Policy');
  const heading = model.paragraphs.find((paragraph) => paragraph.kind === 'heading');
  assert.equal(heading?.text, 'Literature Review');

  const body = model.paragraphs.find((paragraph) => paragraph.kind === 'body');
  assert.equal(body?.text, 'This paragraph should not keep markdown bullets in the exported paper.');
});

test('buildPaperLayoutModel keeps a multi-line reference as one entry and auto-inserts a references heading when needed', () => {
  const model = buildPaperLayoutModel(`Energy Transition Policy

Introduction

The argument develops here.

Smith, J. (2024). A very long article title that wraps
onto a second line because the model inserted a line break. https://doi.org/10.1234/example

Doe, A. (2023). Another article with a long retrieval link
https://example.com/full-text-entry`, {
    paperTitle: 'Energy Transition Policy',
    courseCode: 'BUSI1001',
  });

  const referenceHeading = model.paragraphs.find((paragraph) => paragraph.kind === 'reference_heading');
  const references = model.paragraphs.filter((paragraph) => paragraph.kind === 'reference');

  assert.equal(referenceHeading?.text, 'References');
  assert.equal(referenceHeading?.pageBreakBefore, true);
  assert.equal(references.length, 2);
  assert.match(references[0]?.text ?? '', /wraps onto a second line because the model inserted a line break/i);
  assert.match(references[1]?.text ?? '', /another article with a long retrieval link https:\/\/example\.com\/full-text-entry/i);
});

test('buildPaperLayoutModel converts inline markdown emphasis into formatted runs instead of leaving raw symbols', () => {
  const model = buildPaperLayoutModel(`Essay Topic

# Discussion

This paragraph keeps *book titles* in italics and **core claims** in bold.

References

Smith, J. (2024). *Journal of Strategy*. https://example.com/source`);

  const heading = model.paragraphs.find((paragraph) => paragraph.kind === 'heading');
  const body = model.paragraphs.find((paragraph) => paragraph.kind === 'body');
  const reference = model.paragraphs.find((paragraph) => paragraph.kind === 'reference');

  assert.equal(heading?.text, 'Discussion');
  assert.ok(body?.runs);
  assert.ok(reference?.runs);
  assert.deepEqual(
    body?.runs,
    [
      { text: 'This paragraph keeps ', bold: false, italics: false },
      { text: 'book titles', bold: false, italics: true },
      { text: ' in italics and ', bold: false, italics: false },
      { text: 'core claims', bold: true, italics: false },
      { text: ' in bold.', bold: false, italics: false },
    ],
  );
  assert.equal(body?.text.includes('*'), false);
  assert.equal(reference?.text.includes('*'), false);
  assert.deepEqual(
    reference?.runs,
    [
      { text: 'Smith, J. (2024). ', bold: false, italics: false },
      { text: 'Journal of Strategy', bold: false, italics: true },
      { text: '. https://example.com/source', bold: false, italics: false },
    ],
  );
});

test('buildPaperLayoutModel strips file extensions from an explicit paper title before building the cover and body layout', () => {
  const model = buildPaperLayoutModel(`BUSI1001 Essay Topic

Introduction

This is the first real body paragraph.`, {
    paperTitle: 'BUSI1001 Essay Topic.txt',
    courseCode: 'BUSI1001',
  });

  assert.equal(model.paragraphs[1]?.kind, 'cover_title');
  assert.equal(model.paragraphs[1]?.text, 'BUSI1001 Essay Topic');

  const firstBodyParagraph = model.paragraphs.find((paragraph) => paragraph.kind === 'body');
  assert.equal(firstBodyParagraph?.text, 'This is the first real body paragraph.');
  assert.equal(model.paragraphs.some((paragraph) => paragraph.text.includes('.txt')), false);
});

test('buildPaperLayoutModel removes a duplicated first body title even when punctuation style differs slightly', () => {
  const model = buildPaperLayoutModel(`The Impact of Social Media Use on University Students’ Mental Health

Introduction

This is the first real body paragraph.`, {
    paperTitle: "The Impact of Social Media Use on University Students' Mental Health",
    courseCode: 'BUSI1001',
  });

  const headingsAndBodies = model.paragraphs.filter((paragraph) => paragraph.kind === 'heading' || paragraph.kind === 'body');

  assert.equal(headingsAndBodies[0]?.text, 'Introduction');
  assert.equal(headingsAndBodies[1]?.text, 'This is the first real body paragraph.');
  assert.equal(
    model.paragraphs.some((paragraph) => paragraph.kind !== 'cover_title' && /Social Media Use on University Students.? Mental Health/.test(paragraph.text)),
    false,
  );
});
