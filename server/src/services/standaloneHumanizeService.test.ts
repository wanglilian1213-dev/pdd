import test from 'node:test';
import assert from 'node:assert/strict';

import {
  standaloneHumanizeServiceTestUtils,
  validateStandaloneHumanizeFiles,
  STANDALONE_HUMANIZE_MIN_WORDS,
  STANDALONE_HUMANIZE_MAX_WORDS,
} from './standaloneHumanizeService';

const { computeFrozenAmount, extractArticleTitle, sanitizeForFilename } =
  standaloneHumanizeServiceTestUtils;

// ---------------------------------------------------------------------------
// computeFrozenAmount
// ---------------------------------------------------------------------------

test('computeFrozenAmount: 精确整数', () => {
  assert.equal(computeFrozenAmount(1000, 0.4), 400);
  assert.equal(computeFrozenAmount(500, 0.4), 200);
});

test('computeFrozenAmount: 分数金额向上取整', () => {
  // 1234 × 0.4 = 493.6 → 494
  assert.equal(computeFrozenAmount(1234, 0.4), 494);
  // 1 × 0.4 = 0.4 → 1
  assert.equal(computeFrozenAmount(1, 0.4), 1);
});

// ---------------------------------------------------------------------------
// 常量
// ---------------------------------------------------------------------------

test('STANDALONE_HUMANIZE_MIN_WORDS = 500', () => {
  assert.equal(STANDALONE_HUMANIZE_MIN_WORDS, 500);
});

test('STANDALONE_HUMANIZE_MAX_WORDS = 30,000', () => {
  assert.equal(STANDALONE_HUMANIZE_MAX_WORDS, 30_000);
});

// ---------------------------------------------------------------------------
// extractArticleTitle
// ---------------------------------------------------------------------------

test('extractArticleTitle: 去掉扩展名', () => {
  assert.equal(extractArticleTitle('my essay.docx'), 'my essay');
  assert.equal(extractArticleTitle('Report_FINAL.pdf'), 'Report_FINAL');
});

test('extractArticleTitle: 空 / 无扩展名回退到默认', () => {
  assert.equal(extractArticleTitle(''), '降 AI 结果');
  assert.equal(extractArticleTitle('plain'), 'plain');
});

// ---------------------------------------------------------------------------
// sanitizeForFilename
// ---------------------------------------------------------------------------

test('sanitizeForFilename: 替换非法字符为下划线', () => {
  // 9 illegal chars between a 和 d: /, \, :, *, ?, ", <, >, |
  assert.equal(sanitizeForFilename('a/b\\c:*?"<>|d'), 'a_b_c_______d');
});

test('sanitizeForFilename: 合并多空白 + trim', () => {
  assert.equal(sanitizeForFilename('  my    title  '), 'my title');
});

test('sanitizeForFilename: 空字符串回退默认', () => {
  assert.equal(sanitizeForFilename(''), '降 AI 结果');
  assert.equal(sanitizeForFilename('   '), '降 AI 结果');
});

// ---------------------------------------------------------------------------
// validateStandaloneHumanizeFiles
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

test('validateStandaloneHumanizeFiles: 空 / 多文件 / 不支持扩展名 / 超 20MB 都抛', () => {
  assert.throws(() => validateStandaloneHumanizeFiles([]), /请上传一个文件/);
  assert.throws(
    () => validateStandaloneHumanizeFiles([makeFile('a.pdf'), makeFile('b.pdf')]),
    /一次只能处理一个文件/,
  );
  assert.throws(() => validateStandaloneHumanizeFiles([makeFile('a.jpg')]), /不支持的文件类型/);
  assert.throws(
    () => validateStandaloneHumanizeFiles([makeFile('a.pdf', 21 * 1024 * 1024)]),
    /超过 20MB/,
  );
});

test('validateStandaloneHumanizeFiles: 通过 PDF / DOCX / TXT / MD', () => {
  assert.doesNotThrow(() => validateStandaloneHumanizeFiles([makeFile('a.pdf')]));
  assert.doesNotThrow(() => validateStandaloneHumanizeFiles([makeFile('a.docx')]));
  assert.doesNotThrow(() => validateStandaloneHumanizeFiles([makeFile('a.txt')]));
  assert.doesNotThrow(() => validateStandaloneHumanizeFiles([makeFile('a.md')]));
});
