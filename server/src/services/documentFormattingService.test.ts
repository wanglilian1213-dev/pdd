import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaperLayoutModel } from './documentFormattingService';

test('buildPaperLayoutModel turns raw article text into formal Word layout rules', () => {
  const model = buildPaperLayoutModel(`The Impact of Electric Buses on Urban Planning

## Introduction

Electric buses are changing how cities plan transport infrastructure.

References

Smith, J. (2024). Urban transit reform. Journal of Mobility Studies, 12(3), 14-20.
Doe, A. (2023). Battery infrastructure and cities. Transport Review, 8(1), 33-49.`);

  assert.equal(model.paragraphs[0]?.kind, 'title');
  assert.equal(model.paragraphs[0]?.text, 'The Impact of Electric Buses on Urban Planning');
  assert.equal(model.paragraphs[0]?.fontFamily, 'Times New Roman');
  assert.equal(model.paragraphs[0]?.fontSize, 12);
  assert.equal(model.paragraphs[0]?.bold, true);
  assert.equal(model.paragraphs[0]?.alignment, 'center');

  const bodyParagraph = model.paragraphs.find((paragraph) => paragraph.kind === 'body');
  assert.ok(bodyParagraph);
  assert.equal(bodyParagraph?.fontFamily, 'Times New Roman');
  assert.equal(bodyParagraph?.fontSize, 12);
  assert.equal(bodyParagraph?.lineSpacing, 1.5);

  const referenceHeading = model.paragraphs.find((paragraph) => paragraph.kind === 'reference_heading');
  assert.ok(referenceHeading);
  assert.equal(referenceHeading?.text, 'References');

  const references = model.paragraphs.filter((paragraph) => paragraph.kind === 'reference');
  assert.equal(references.length, 2);
  assert.equal(references[0]?.hangingIndent, true);
  assert.equal(references[0]?.lineSpacing, 1.5);
});

test('buildPaperLayoutModel removes markdown-like heading markers from final Word content', () => {
  const model = buildPaperLayoutModel(`# Clean Energy Policy

### Literature Review

- This paragraph should not keep markdown bullets in the exported paper.`);

  assert.equal(model.paragraphs[0]?.text, 'Clean Energy Policy');
  const heading = model.paragraphs.find((paragraph) => paragraph.kind === 'heading');
  assert.equal(heading?.text, 'Literature Review');

  const body = model.paragraphs.find((paragraph) => paragraph.kind === 'body');
  assert.equal(body?.text, 'This paragraph should not keep markdown bullets in the exported paper.');
});
