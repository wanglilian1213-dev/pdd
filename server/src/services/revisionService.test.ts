import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRevisionFileTypes } from './revisionService';
import { AppError } from '../lib/errors';

function file(name: string): Express.Multer.File {
  return { originalname: name } as Express.Multer.File;
}

test('validateRevisionFileTypes 拒绝 docx', () => {
  assert.throws(
    () => validateRevisionFileTypes([file('paper.docx')]),
    (err: unknown) => err instanceof AppError && err.statusCode === 400 && /不支持的文件类型/.test(err.userMessage),
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
    () => validateRevisionFileTypes([file('ok.pdf'), file('bad.docx')]),
    /不支持的文件类型：bad\.docx/,
  );
});

test('validateRevisionFileTypes 拒绝无扩展名文件', () => {
  assert.throws(
    () => validateRevisionFileTypes([file('README')]),
    /不支持的文件类型/,
  );
});
