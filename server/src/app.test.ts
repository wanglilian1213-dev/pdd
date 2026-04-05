import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { createApp } from './app';

async function withServer(
  allowedOrigins: string[],
  run: (baseUrl: string) => Promise<void>,
) {
  const app = createApp({ allowedOrigins, mountApiRoutes: false });
  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

test('createApp applies security headers on health responses', async () => {
  await withServer(['https://pindaidai.uk'], async (baseUrl) => {
    const response = await fetch(`${baseUrl}/health`);
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  });
});

test('createApp reflects allowed origins only', async () => {
  await withServer(['https://pindaidai.uk'], async (baseUrl) => {
    const allowed = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'https://pindaidai.uk' },
    });
    assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://pindaidai.uk');

    const blocked = await fetch(`${baseUrl}/health`, {
      headers: { Origin: 'https://evil.example.com' },
    });
    assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  });
});
