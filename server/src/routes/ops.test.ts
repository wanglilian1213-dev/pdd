import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { AddressInfo } from 'node:net';
import opsRoutes from './ops';
import { opsMiddleware } from '../middleware/ops';
import { env } from '../lib/runtimeEnv';
import { supabaseAdmin } from '../lib/supabase';
import { __resetConfigCacheForTests } from '../services/configService';

function stubSupabaseFrom(impl: (table: string) => any) {
  const originalFrom = supabaseAdmin.from;

  Object.defineProperty(supabaseAdmin, 'from', {
    value: impl,
    configurable: true,
  });

  return () => {
    Object.defineProperty(supabaseAdmin, 'from', {
      value: originalFrom,
      configurable: true,
    });
  };
}

function stubSupabaseRpc(impl: (fn: string, args: Record<string, unknown>) => any) {
  const originalRpc = supabaseAdmin.rpc;

  Object.defineProperty(supabaseAdmin, 'rpc', {
    value: impl,
    configurable: true,
  });

  return () => {
    Object.defineProperty(supabaseAdmin, 'rpc', {
      value: originalRpc,
      configurable: true,
    });
  };
}

async function withOpsServer(
  userEmail: string,
  run: (baseUrl: string) => Promise<void>,
) {
  __resetConfigCacheForTests();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).userEmail = userEmail;
    next();
  });
  app.use('/api/ops', opsMiddleware, opsRoutes);

  const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
    const instance = app.listen(0, () => resolve(instance));
  });

  try {
    const address = server.address() as AddressInfo;
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    __resetConfigCacheForTests();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
}

test('opsMiddleware allows whitelisted email regardless of case', async () => {
  const originalWhitelist = [...env.opsWhitelistEmails];
  env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, '1318823634@qq.com');

  const restore = stubSupabaseFrom((table: string) => {
    if (table === 'system_config') {
      return {
        select: async () => ({ data: [], error: null }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  try {
    await withOpsServer('1318823634@QQ.COM', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ops/config`);
      assert.equal(response.status, 200);
      const body = await response.json() as any;
      assert.equal(body.success, true);
    });
  } finally {
    env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, ...originalWhitelist);
    restore();
  }
});

test('POST /api/ops/codes/generate rejects denomination outside allowed list', async () => {
  const originalWhitelist = [...env.opsWhitelistEmails];
  env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, '1318823634@qq.com');

  const restore = stubSupabaseFrom((table: string) => {
    if (table === 'system_config') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { value: [1000, 3000, 10000, 20000] }, error: null }),
            single: async () => ({ data: { value: [1000, 3000, 10000, 20000] } }),
          }),
        }),
      };
    }
    if (table === 'recharge_codes') {
      return {
        insert: async () => ({ error: null }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  try {
    await withOpsServer('1318823634@qq.com', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ops/codes/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ denomination: 999, count: 2 }),
      });

      assert.equal(response.status, 400);
      const body = await response.json() as any;
      assert.match(body.error, /面值/);
    });
  } finally {
    env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, ...originalWhitelist);
    restore();
  }
});

test('POST /api/ops/codes/void rejects empty code id array', async () => {
  const originalWhitelist = [...env.opsWhitelistEmails];
  env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, '1318823634@qq.com');

  const restore = stubSupabaseFrom((table: string) => {
    if (table === 'recharge_codes') {
      return {
        update: () => ({
          in: () => ({
            eq: async () => ({ error: null }),
          }),
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  try {
    await withOpsServer('1318823634@qq.com', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ops/codes/void`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codeIds: [] }),
      });

      assert.equal(response.status, 400);
      const body = await response.json() as any;
      assert.match(body.error, /激活码/);
    });
  } finally {
    env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, ...originalWhitelist);
    restore();
  }
});

test('POST /api/ops/codes/void rejects invalid code id format', async () => {
  const originalWhitelist = [...env.opsWhitelistEmails];
  env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, '1318823634@qq.com');

  const restore = stubSupabaseFrom((_table: string) => {
    throw new Error('database should not be called for invalid code ids');
  });

  try {
    await withOpsServer('1318823634@qq.com', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ops/codes/void`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ codeIds: ['not-a-uuid'] }),
      });

      assert.equal(response.status, 400);
      const body = await response.json() as any;
      assert.match(body.error, /ID/);
    });
  } finally {
    env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, ...originalWhitelist);
    restore();
  }
});

test('POST /api/ops/codes/void rejects partial success', async () => {
  const originalWhitelist = [...env.opsWhitelistEmails];
  env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, '1318823634@qq.com');

  let calledRpc = false;
  const restoreRpc = stubSupabaseRpc(async (fn: string) => {
    calledRpc = true;
    assert.equal(fn, 'void_recharge_codes');
    return {
      data: null,
      error: { message: 'RECHARGE_CODE_PARTIAL_VOID' },
      count: null,
      status: 400,
      statusText: 'Bad Request',
    } as never;
  });
  const restoreFrom = stubSupabaseFrom((_table: string) => {
    throw new Error('table update should not run for atomic recharge code void');
  });

  try {
    await withOpsServer('1318823634@qq.com', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ops/codes/void`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          codeIds: [
            '11111111-1111-4111-8111-111111111111',
            '22222222-2222-4222-8222-222222222222',
          ],
        }),
      });

      assert.equal(response.status, 400);
      const body = await response.json() as any;
      assert.match(body.error, /只有一部分|部分/);
      assert.equal(calledRpc, true);
    });
  } finally {
    env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, ...originalWhitelist);
    restoreRpc();
    restoreFrom();
  }
});

test('POST /api/ops/users/:id/disable rejects invalid user id format', async () => {
  const originalWhitelist = [...env.opsWhitelistEmails];
  env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, '1318823634@qq.com');

  const restore = stubSupabaseFrom((_table: string) => {
    throw new Error('database should not be called for invalid user id');
  });

  try {
    await withOpsServer('1318823634@qq.com', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ops/users/not-a-uuid/disable`, {
        method: 'POST',
      });

      assert.equal(response.status, 400);
      const body = await response.json() as any;
      assert.match(body.error, /ID/);
    });
  } finally {
    env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, ...originalWhitelist);
    restore();
  }
});

test('PUT /api/ops/config/writing_price_per_1000 rejects non-positive value', async () => {
  const originalWhitelist = [...env.opsWhitelistEmails];
  env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, '1318823634@qq.com');

  const restore = stubSupabaseFrom((table: string) => {
    if (table === 'system_config') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { key: 'writing_price_per_1000' }, error: null }),
          }),
        }),
        upsert: async () => ({ error: null }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  try {
    await withOpsServer('1318823634@qq.com', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ops/config/writing_price_per_1000`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 0 }),
      });

      assert.equal(response.status, 400);
      const body = await response.json() as any;
      assert.match(body.error, /配置值/);
    });
  } finally {
    env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, ...originalWhitelist);
    restore();
  }
});

test('GET /api/ops/config returns 500 when config read fails', async () => {
  const originalWhitelist = [...env.opsWhitelistEmails];
  env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, '1318823634@qq.com');

  const restore = stubSupabaseFrom((table: string) => {
    if (table === 'system_config') {
      return {
        select: async () => ({
          data: null,
          error: { message: 'db down' },
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  try {
    await withOpsServer('1318823634@qq.com', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ops/config`);

      assert.equal(response.status, 500);
      const body = await response.json() as any;
      assert.match(body.error, /获取配置失败/);
    });
  } finally {
    env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, ...originalWhitelist);
    restore();
  }
});

test('POST /api/ops/codes/generate returns 500 when denominations config read fails', async () => {
  const originalWhitelist = [...env.opsWhitelistEmails];
  env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, '1318823634@qq.com');

  const restore = stubSupabaseFrom((table: string) => {
    if (table === 'system_config') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data: null,
              error: { message: 'db down' },
            }),
            single: async () => ({
              data: null,
              error: { message: 'db down' },
            }),
          }),
        }),
      };
    }
    if (table === 'recharge_codes') {
      return {
        insert: async () => ({ error: null }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  try {
    await withOpsServer('1318823634@qq.com', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ops/codes/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ denomination: 1000, count: 2 }),
      });

      assert.equal(response.status, 500);
      const body = await response.json() as any;
      assert.match(body.error, /读取配置失败/);
    });
  } finally {
    env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, ...originalWhitelist);
    restore();
  }
});

test('PUT /api/ops/config/not_exists rejects unknown config key', async () => {
  const originalWhitelist = [...env.opsWhitelistEmails];
  env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, '1318823634@qq.com');

  const restore = stubSupabaseFrom((table: string) => {
    if (table === 'system_config') {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        upsert: async () => ({ error: null }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  try {
    await withOpsServer('1318823634@qq.com', async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/ops/config/not_exists`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: 123 }),
      });

      assert.equal(response.status, 400);
      const body = await response.json() as any;
      assert.match(body.error, /配置/);
    });
  } finally {
    env.opsWhitelistEmails.splice(0, env.opsWhitelistEmails.length, ...originalWhitelist);
    restore();
  }
});
