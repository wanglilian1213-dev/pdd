import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaperLayoutModel, extractBodyHeadingLines } from './documentFormattingService';

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

test('buildPaperLayoutModel treats Chinese reference headings as the references section', () => {
  const model = buildPaperLayoutModel(`新能源汽车政策分析

引言

正文讨论城市交通政策变化。

参考文献

Smith, J. (2024). Urban transit reform. Journal of Mobility Studies, 12(3), 14-20.
Doe, A. (2023). Battery infrastructure and cities. Transport Review, 8(1), 33-49.`);

  const referenceHeading = model.paragraphs.find((paragraph) => paragraph.kind === 'reference_heading');
  const bodyText = model.paragraphs
    .filter((paragraph) => paragraph.kind === 'body' || paragraph.kind === 'heading')
    .map((paragraph) => paragraph.text)
    .join('\n');

  assert.equal(referenceHeading?.text, '参考文献');
  assert.equal(referenceHeading?.pageBreakBefore, true);
  assert.equal(model.paragraphs.filter((paragraph) => paragraph.kind === 'reference').length, 2);
  assert.doesNotMatch(bodyText, /参考文献/);
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

test('buildPaperLayoutModel removes hidden control characters from exported text', () => {
  const model = buildPaperLayoutModel(`Hidden Character Test

Introduction

This paragraph has clean\u0001 text and bad\u0007 controls.

References

Smith, J. (2024). Example\u001F Study.`);

  const exportedText = model.paragraphs.map((paragraph) => paragraph.text).join('\n');

  assert.doesNotMatch(exportedText, /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/);
  assert.match(exportedText, /clean text and bad controls/);
  assert.match(exportedText, /Example Study/);
});

test('buildPaperLayoutModel preserves leading numbering inside markdown table cells when enableMedia is on', () => {
  const model = buildPaperLayoutModel(
    `研究方法步骤

| 步骤 | 描述 |
| --- | --- |
| 1. 准备 | 收集材料 |
| 2. 执行 | 实施方案 |`,
    { enableMedia: true },
  );

  const tableParagraph = model.paragraphs.find((paragraph) => paragraph.kind === 'table');
  assert.ok(tableParagraph, 'expected a table paragraph');
  assert.deepEqual(tableParagraph?.tableRows, [
    ['步骤', '描述'],
    ['1. 准备', '收集材料'],
    ['2. 执行', '实施方案'],
  ]);
});

test('buildPaperLayoutModel recognizes a markdown table with a caption directly above it', () => {
  const model = buildPaperLayoutModel(
    `研究方法步骤

Table 1: Summary
| Metric | Value |
| --- | --- |
| Growth | 12% |`,
    { enableMedia: true },
  );

  const tableParagraph = model.paragraphs.find((paragraph) => paragraph.kind === 'table');
  const exportedText = model.paragraphs.map((paragraph) => paragraph.text).join('\n');

  assert.ok(tableParagraph, 'expected a table paragraph');
  assert.deepEqual(tableParagraph?.tableRows, [
    ['Metric', 'Value'],
    ['Growth', '12%'],
  ]);
  assert.doesNotMatch(exportedText, /\| Metric \| Value \|/);
});

test('extractBodyHeadingLines keeps the first heading when there is no separate title line', () => {
  assert.deepEqual(
    extractBodyHeadingLines(`Introduction

This essay compares policy choices.

Methodology

The method is a literature review.

References

Smith, J. (2024). Example article.`),
    ['Introduction', 'Methodology'],
  );
});

test('extractBodyHeadingLines counts outline-style numbered headings', () => {
  assert.deepEqual(
    extractBodyHeadingLines(`Essay Title

1. Introduction

The essay starts here.

2. Body Paragraphs

The argument develops here.

3. Conclusion

The essay ends here.

References

Smith, J. (2024). Example. https://example.com`),
    ['Introduction', 'Body Paragraphs', 'Conclusion'],
  );
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
