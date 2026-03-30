import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../lib/errors';
import { supabaseAdmin } from '../lib/supabase';
import {
  __resetConfigCacheForTests,
  __setConfigCacheClockForTests,
  getAllConfig,
  getConfig,
  setConfig,
} from './configService';

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

test('getConfig throws AppError when system_config read fails', async () => {
  __resetConfigCacheForTests();
  const restore = stubSupabaseFrom((table: string) => {
    assert.equal(table, 'system_config');
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
  });

  try {
    await assert.rejects(
      () => getConfig('activation_denominations'),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.match(error.userMessage, /读取配置失败/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('getAllConfig throws AppError when system_config read fails', async () => {
  __resetConfigCacheForTests();
  const restore = stubSupabaseFrom((table: string) => {
    assert.equal(table, 'system_config');
    return {
      select: async () => ({
        data: null,
        error: { message: 'db down' },
      }),
    };
  });

  try {
    await assert.rejects(
      () => getAllConfig(),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.match(error.userMessage, /读取配置失败/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('getConfig caches values until ttl expires', async () => {
  __resetConfigCacheForTests();
  let currentTime = 0;
  __setConfigCacheClockForTests(() => currentTime);
  let calls = 0;

  const restore = stubSupabaseFrom((table: string) => {
    assert.equal(table, 'system_config');
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => {
            calls += 1;
            return {
              data: { value: ['100', '200'] },
              error: null,
            };
          },
        }),
      }),
    };
  });

  try {
    assert.deepEqual(await getConfig('activation_denominations'), ['100', '200']);
    assert.deepEqual(await getConfig('activation_denominations'), ['100', '200']);
    assert.equal(calls, 1);

    currentTime = 60_001;
    assert.deepEqual(await getConfig('activation_denominations'), ['100', '200']);
    assert.equal(calls, 2);
  } finally {
    restore();
    __resetConfigCacheForTests();
  }
});

test('setConfig clears stale cache after update', async () => {
  __resetConfigCacheForTests();
  let currentTime = 0;
  __setConfigCacheClockForTests(() => currentTime);

  const calls: string[] = [];
  const restore = stubSupabaseFrom((table: string) => {
    assert.equal(table, 'system_config');
    return {
      select: (fields?: string) => {
        if (fields === 'value') {
          return {
            eq: () => ({
              maybeSingle: async () => {
                calls.push('read');
                return {
                  data: { value: ['100', '200'] },
                  error: null,
                };
              },
            }),
          };
        }

        return {
          eq: () => ({
            maybeSingle: async () => ({
              data: { key: 'activation_denominations' },
              error: null,
            }),
          }),
        };
      },
      upsert: async () => {
        calls.push('upsert');
        return { error: null };
      },
    };
  });

  try {
    await getConfig('activation_denominations');
    currentTime = 1;
    await setConfig('activation_denominations', [100, 200, 300], 'ops@example.com');
    await getConfig('activation_denominations');
    assert.deepEqual(calls, ['read', 'upsert', 'read']);
  } finally {
    restore();
    __resetConfigCacheForTests();
  }
});
