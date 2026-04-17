import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateRevisionFileTypes,
  estimateRevisionForFile,
  estimateRevisionTotal,
} from './revisionService';
import { AppError } from '../lib/errors';

function file(name: string): Express.Multer.File {
  return { originalname: name } as Express.Multer.File;
}

// 工具：构造一个 Express.Multer.File-like 对象（estimateRevisionForFile 只用 originalname + buffer）
function fakeFile(name: string, content: Buffer | string): Express.Multer.File {
  const buffer = typeof content === 'string' ? Buffer.from(content, 'utf8') : content;
  return {
    fieldname: 'file',
    originalname: name,
    encoding: '7bit',
    mimetype: 'application/octet-stream',
    size: buffer.length,
    buffer,
    destination: '',
    filename: '',
    path: '',
    stream: null as never,
  };
}

test('validateRevisionFileTypes 接受 docx', () => {
  assert.doesNotThrow(
    () => validateRevisionFileTypes([file('paper.docx')]),
    'should accept docx after mammoth support was added',
  );
});

test('validateRevisionFileTypes 拒绝 doc/rtf/odt', () => {
  for (const name of ['paper.doc', 'paper.rtf', 'paper.odt']) {
    assert.throws(
      () => validateRevisionFileTypes([file(name)]),
      /不支持的文件类型/,
      `should reject ${name}`,
    );
  }
});

test('validateRevisionFileTypes 接受 pdf/png/jpg/webp/gif/txt/md/markdown', () => {
  const accepted = [
    'a.pdf',
    'b.png',
    'c.JPG',
    'd.jpeg',
    'e.webp',
    'f.gif',
    'g.txt',
    'h.MD',
    'i.markdown',
  ];
  for (const name of accepted) {
    assert.doesNotThrow(
      () => validateRevisionFileTypes([file(name)]),
      `should accept ${name}`,
    );
  }
});

test('validateRevisionFileTypes 混合输入：一个不支持的就整组拒绝', () => {
  assert.throws(
    () => validateRevisionFileTypes([file('ok.pdf'), file('bad.odt')]),
    /不支持的文件类型：bad\.odt/,
  );
});

test('validateRevisionFileTypes 拒绝无扩展名文件', () => {
  assert.throws(
    () => validateRevisionFileTypes([file('README')]),
    /不支持的文件类型/,
  );
});

// ===========================================================================
// estimateRevisionForFile / estimateRevisionTotal
// ===========================================================================

// --- 图片：每张固定 100 字 ----------------------------------------------------

test('estimateRevisionForFile: jpg 算 100 字', async () => {
  const r = await estimateRevisionForFile(fakeFile('photo.jpg', Buffer.alloc(500_000)));
  assert.equal(r.words, 100);
  assert.equal(r.isScannedPdf, false);
});

test('estimateRevisionForFile: png/webp/gif/heic 都按 100 字', async () => {
  for (const ext of ['png', 'webp', 'gif', 'bmp', 'tiff', 'heic']) {
    const r = await estimateRevisionForFile(fakeFile(`x.${ext}`, Buffer.alloc(100)));
    assert.equal(r.words, 100, `ext=${ext} 应该是 100 字`);
    assert.equal(r.isScannedPdf, false);
  }
});

// --- TXT / MD：utf8 真解析 ----------------------------------------------------

test('estimateRevisionForFile: txt 按真实字数（无 1.2 缓冲）', async () => {
  const r = await estimateRevisionForFile(fakeFile('a.txt', 'hello world foo bar'));
  assert.equal(r.words, 4);
  assert.equal(r.isScannedPdf, false);
});

test('estimateRevisionForFile: md 按真实字数', async () => {
  const r = await estimateRevisionForFile(fakeFile('a.md', '# title\n\nhello world'));
  assert.equal(r.isScannedPdf, false);
  assert.equal(r.words, 4); // # title hello world → 4 token
});

// --- PDF：解析失败的 buffer 必须按扫描件兜底（不抛错）------------------------

test('estimateRevisionForFile: 损坏的 PDF buffer → isScannedPdf=true 不抛错', async () => {
  const r = await estimateRevisionForFile(fakeFile('x.pdf', 'not a real pdf'));
  assert.equal(r.isScannedPdf, true);
  assert.equal(r.words, 0);
});

// --- 不支持的扩展名（理论上 validateRevisionFileTypes 已拦截）----------------

test('estimateRevisionForFile: 不支持的扩展名 → 抛 AppError', async () => {
  await assert.rejects(
    () => estimateRevisionForFile(fakeFile('x.exe', Buffer.alloc(10))),
    (err: unknown) => err instanceof AppError && (err as AppError).statusCode === 400,
  );
});

// --- 汇总：多文件并行 + 扫描件汇总 -------------------------------------------

test('estimateRevisionTotal: 多文件总字数 = 各文件字数之和', async () => {
  const result = await estimateRevisionTotal([
    fakeFile('photo.jpg', Buffer.alloc(100)),
    fakeFile('a.txt', 'hello world'),
    fakeFile('b.md', 'foo bar baz'),
  ]);
  assert.equal(result.totalWords, 100 + 2 + 3);
  assert.equal(result.scannedFilenames.length, 0);
  assert.equal(result.perFile.length, 3);
});

test('estimateRevisionTotal: 扫描件 PDF 出现在 scannedFilenames', async () => {
  const result = await estimateRevisionTotal([
    fakeFile('a.txt', 'hello world'),
    fakeFile('scan.pdf', 'broken pdf'),
  ]);
  assert.deepEqual(result.scannedFilenames, ['scan.pdf']);
  // 扫描件不计入总字数（words=0）
  assert.equal(result.totalWords, 2);
});

// --- 关键回归：文件大小不再影响估算（旧公式 file.size/6 的 bug）---------------

test('estimateRevisionForFile: 大图片不会被估成大字数（修复 bug 的核心）', async () => {
  // 旧 bug：图片硬编码 2000 字 → 400 积分；新逻辑统一 100 字 → 20 积分
  const r = await estimateRevisionForFile(fakeFile('big.jpg', Buffer.alloc(6_500_000)));
  assert.equal(r.words, 100);
});

test('estimateRevisionForFile: 损坏 PDF 不会被按 file.size/6 估成百万字', async () => {
  // 旧 bug：6.5MB PDF 按 file.size/6 = 108 万字 → 21 万积分
  // 新逻辑：解析失败 → words=0 + isScannedPdf=true（上层会拒绝）
  const big = Buffer.alloc(6_500_000);
  const r = await estimateRevisionForFile(fakeFile('big.pdf', big));
  assert.ok(r.words < 200_000, `估算字数不该超过 20 万：实际 ${r.words}`);
});
