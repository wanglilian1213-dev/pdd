import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../lib/errors';
import { supabaseAdmin } from '../lib/supabase';
import { getAllConfig, getConfig } from './configService';

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
