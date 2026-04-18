import test from 'node:test';
import assert from 'node:assert/strict';

import {
  aiDetectionServiceTestUtils,
  validateAiDetectionFiles,
  AI_DETECTION_MIN_WORDS,
  AI_DETECTION_MAX_WORDS,
} from './aiDetectionService';

const { computeFrozenAmount, DEFAULT_AI_DETECTION_PRICE_PER_WORD } = aiDetectionServiceTestUtils;

// ---------------------------------------------------------------------------
// computeFrozenAmount
// ---------------------------------------------------------------------------

test('computeFrozenAmount: 精确整数', () => {
  assert.equal(computeFrozenAmount(2000, 0.05), 100);
  assert.equal(computeFrozenAmount(200, 0.05), 10);
});

test('computeFrozenAmount: 分数金额向上取整', () => {
  // 231 × 0.05 = 11.55 → 12
  assert.equal(computeFrozenAmount(231, 0.05), 12);
  // 1 × 0.05 = 0.05 → 1
  assert.equal(computeFrozenAmount(1, 0.05), 1);
});

test('computeFrozenAmount: 零字数 → 零', () => {
  assert.equal(computeFrozenAmount(0, 0.05), 0);
});

// ---------------------------------------------------------------------------
// 常量暴露正确
// ---------------------------------------------------------------------------

test('AI_DETECTION_MIN_WORDS = 200', () => {
  assert.equal(AI_DETECTION_MIN_WORDS, 200);
});

test('AI_DETECTION_MAX_WORDS = 30,000', () => {
  assert.equal(AI_DETECTION_MAX_WORDS, 30_000);
});

test('默认单价 0.05', () => {
  assert.equal(DEFAULT_AI_DETECTION_PRICE_PER_WORD, 0.05);
});

// ---------------------------------------------------------------------------
// validateAiDetectionFiles
// ---------------------------------------------------------------------------

function makeFile(name: string, size = 1024): Express.Multer.File {
  return {
    fieldname: 'files',
    originalname: name,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size,
    buffer: Buffer.from(''),
    destination: '',
    filename: name,
    path: '',
    stream: undefined as any,
  };
}

test('validateAiDetectionFiles: 空数组抛错', () => {
  assert.throws(() => validateAiDetectionFiles([]), /请上传一个文件/);
});

test('validateAiDetectionFiles: 多文件抛错', () => {
  assert.throws(
    () => validateAiDetectionFiles([makeFile('a.pdf'), makeFile('b.pdf')]),
    /一次只能处理一个文件/,
  );
});

test('validateAiDetectionFiles: 不支持的扩展名抛错', () => {
  assert.throws(() => validateAiDetectionFiles([makeFile('a.doc')]), /不支持的文件类型/);
  assert.throws(() => validateAiDetectionFiles([makeFile('a.jpg')]), /不支持的文件类型/);
});

test('validateAiDetectionFiles: 超过 20MB 抛错', () => {
  assert.throws(
    () => validateAiDetectionFiles([makeFile('a.pdf', 21 * 1024 * 1024)]),
    /超过 20MB/,
  );
});

test('validateAiDetectionFiles: 通过 PDF / DOCX / TXT', () => {
  assert.doesNotThrow(() => validateAiDetectionFiles([makeFile('a.pdf')]));
  assert.doesNotThrow(() => validateAiDetectionFiles([makeFile('a.docx')]));
  assert.doesNotThrow(() => validateAiDetectionFiles([makeFile('a.txt')]));
  assert.doesNotThrow(() => validateAiDetectionFiles([makeFile('a.md')]));
});
