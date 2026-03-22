import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../lib/errors';
import { mapOutlineGenerationError } from './outlineService';
import { normalizeCitationStyle } from './citationStyleService';

test('mapOutlineGenerationError keeps existing AppError untouched', () => {
  const error = new AppError(400, '原始错误');
  assert.equal(mapOutlineGenerationError(error), error);
});

test('mapOutlineGenerationError turns unsupported file errors into a clear user message', () => {
  const mapped = mapOutlineGenerationError(new Error('400 Unsupported file type: .pages'));
  assert.equal(mapped.statusCode, 400);
  assert.match(mapped.userMessage, /暂时无法读取|换一个常见格式/);
  assert.match(mapped.detail || '', /Unsupported file type/);
});

test('mapOutlineGenerationError turns oversized input errors into a clear user message', () => {
  const mapped = mapOutlineGenerationError(new Error('Request too large for model input'));
  assert.equal(mapped.statusCode, 400);
  assert.match(mapped.userMessage, /文件太大|拆分/);
});

test('normalizeCitationStyle collapses mixed APA and Harvard wording into one final style', () => {
  assert.equal(
    normalizeCitationStyle('APA 7th edition (Harvard-style)'),
    'APA 7',
  );
});

test('normalizeCitationStyle keeps a plain single style unchanged', () => {
  assert.equal(normalizeCitationStyle('Harvard'), 'Harvard');
});
