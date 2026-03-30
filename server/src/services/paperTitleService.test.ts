import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveTaskTitle,
  normalizeDeliveryPaperTitle,
  buildDocxFileName,
} from './paperTitleService';

test('deriveTaskTitle uses the uploaded filename without its extension when no explicit title is provided', () => {
  assert.equal(
    deriveTaskTitle('', 'BUSI1001 Should Small Businesses Use AI for Strategy Writing.txt'),
    'BUSI1001 Should Small Businesses Use AI for Strategy Writing',
  );
});

test('deriveTaskTitle keeps an explicit title untouched', () => {
  assert.equal(
    deriveTaskTitle('A Custom Essay Title', 'ignored.txt'),
    'A Custom Essay Title',
  );
});

test('normalizeDeliveryPaperTitle strips repeated known file suffixes from old dirty titles', () => {
  assert.equal(
    normalizeDeliveryPaperTitle('BUSI1001 Essay Topic.txt.docx', 'Academic Essay'),
    'BUSI1001 Essay Topic',
  );
  assert.equal(
    normalizeDeliveryPaperTitle('Written Project Assessment Task Information (.pdf)(1).pdf', 'Academic Essay'),
    'Written Project Assessment Task Information',
  );
});

test('buildDocxFileName uses the cleaned delivery title', () => {
  assert.equal(
    buildDocxFileName('Essay Topic.txt', 'Academic Essay'),
    'Essay Topic.docx',
  );
});
