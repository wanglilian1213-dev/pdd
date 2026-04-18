import test from 'node:test';
import assert from 'node:assert/strict';
import { createUndetectableDetectorClient } from './undetectableDetector';

// 单测覆盖面：
// 1. USER_ID 没配置时 detectAiWithSentences 抛明确错误（plan v2.1 C 条：不做 fallback，让上层退款）
// 2. submitDetection 传 clientDocumentId 时 body 带 id 字段（plan v2.1 A 条：向后兼容）
// 3. submitDetection 不传 clientDocumentId 时 body 不带 id 字段（走篇章级老行为）

test('detectAiWithSentences: USER_ID 未配置时必须抛错（让上层退款）', async () => {
  const client = createUndetectableDetectorClient({
    apiKey: 'dummy',
    // userId 故意不传
  });

  await assert.rejects(
    () => client.detectAiWithSentences('some test text longer than 200 words...'),
    /USER_ID 未配置/,
  );
});

test('detectAiWithSentences: 空文本直接抛错', async () => {
  const client = createUndetectableDetectorClient({
    apiKey: 'dummy',
    userId: 'user-id-placeholder',
  });
  await assert.rejects(
    () => client.detectAiWithSentences(''),
    /检测文本为空/,
  );
});

test('submitDetection: 不传 clientDocumentId 时 body 不带 id（篇章级老行为）', async () => {
  let capturedBody: any = null;
  const fakeFetch = async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(init!.body as string);
    return new Response(JSON.stringify({ id: 'server-generated-id' }), { status: 200 });
  };
  const client = createUndetectableDetectorClient({
    apiKey: 'k',
    fetchImpl: fakeFetch as any,
  });

  await client.submitDetection('hello world');

  assert.equal(capturedBody.id, undefined, '不传 clientDocumentId 时 body 里不应有 id');
  assert.equal(capturedBody.text, 'hello world');
  assert.equal(capturedBody.key, 'k');
  assert.equal(capturedBody.model, 'xlm_ud_detector');
});

test('submitDetection: 传 clientDocumentId 时 body 带 id（句子级 WebSocket 流程）', async () => {
  let capturedBody: any = null;
  const fakeFetch = async (_url: string, init?: RequestInit) => {
    capturedBody = JSON.parse(init!.body as string);
    return new Response(JSON.stringify({ id: 'client-supplied-id' }), { status: 200 });
  };
  const client = createUndetectableDetectorClient({
    apiKey: 'k',
    fetchImpl: fakeFetch as any,
  });

  await client.submitDetection('hello world', 'client-supplied-id');

  assert.equal(capturedBody.id, 'client-supplied-id', '传 clientDocumentId 时 body.id 必须与之相等');
});
