import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { parseAiDetectionFiles } from './aiDetection';

async function buildMultipartReq(files: Array<{ name: string; body: string }>) {
  const fd = new FormData();
  for (const file of files) {
    fd.append('files', new Blob([file.body]), file.name);
  }

  const request = new Request('http://pindaidai.test/create', { method: 'POST', body: fd });
  const body = Buffer.from(await request.arrayBuffer());
  const req = Readable.from(body) as any;
  req.headers = Object.fromEntries(request.headers.entries());
  req.headers['content-length'] = String(body.length);
  req.method = 'POST';
  req.url = '/create';
  return req;
}

async function parseUpload(files: Array<{ name: string; body: string }>) {
  const req = await buildMultipartReq(files);
  let statusCode = 200;
  let jsonBody: unknown = null;

  const outcome = await new Promise<'next' | 'json'>((resolve, reject) => {
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(body: unknown) {
        jsonBody = body;
        resolve('json');
        return this;
      },
    } as any;

    parseAiDetectionFiles(req, res, (error?: unknown) => {
      if (error) reject(error);
      else resolve('next');
    });
  });

  return {
    outcome,
    statusCode,
    jsonBody,
    files: req.files as Express.Multer.File[] | undefined,
  };
}

test('AI detection upload parser accepts one file', async () => {
  const result = await parseUpload([{ name: 'paper.txt', body: 'hello world' }]);

  assert.equal(result.outcome, 'next');
  assert.equal(result.statusCode, 200);
  assert.equal(result.files?.length, 1);
  assert.equal(result.files?.[0]?.originalname, 'paper.txt');
});

test('AI detection upload parser rejects multiple files with a user-facing 400', async () => {
  const result = await parseUpload([
    { name: 'first.txt', body: 'first' },
    { name: 'second.txt', body: 'second' },
  ]);
  const body = result.jsonBody as { success: boolean; error: string };

  assert.equal(result.outcome, 'json');
  assert.equal(result.statusCode, 400);
  assert.equal(body.success, false);
  assert.match(body.error, /一次只能处理一个文件/);
});
