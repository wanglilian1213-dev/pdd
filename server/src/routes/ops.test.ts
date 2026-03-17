import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { AddressInfo } from 'node:net';
import opsRoutes from './ops';
import { opsMiddleware } from '../middleware/ops';
import { env } from '../config/env';
import { supabaseAdmin } from '../lib/supabase';

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

async function withOpsServer(
  userEmail: string,
  run: (baseUrl: string) => Promise<void>,
) {
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
