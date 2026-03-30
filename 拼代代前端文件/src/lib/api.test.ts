import test from 'node:test';
import assert from 'node:assert/strict';
import { parseApiResponse } from './httpResponse';

function createJsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

test('parseApiResponse returns data for a successful JSON response', async () => {
  const data = await parseApiResponse<{ ok: boolean }>(
    createJsonResponse({ success: true, data: { ok: true } }),
    '请求失败',
  );

  assert.deepEqual(data, { ok: true });
});

test('parseApiResponse surfaces backend error message when HTTP status is not ok', async () => {
  await assert.rejects(
    () =>
      parseApiResponse(
        createJsonResponse({ success: false, error: '服务器炸了' }, { status: 500 }),
        '请求失败',
      ),
    /服务器炸了/,
  );
});

test('parseApiResponse falls back to a readable message when response is not JSON', async () => {
  await assert.rejects(
    () =>
      parseApiResponse(
        new Response('<html>error</html>', {
          status: 502,
          headers: { 'content-type': 'text/html' },
        }),
        '请求失败',
      ),
    /服务器暂时返回了异常内容|请求失败/,
  );
});
