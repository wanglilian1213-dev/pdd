import test from 'node:test';
import assert from 'node:assert/strict';
import { statusGuard } from './statusGuard';
import { supabaseAdmin } from '../lib/supabase';

function stubUserProfile(status: 'active' | 'disabled' | null) {
  const originalFrom = supabaseAdmin.from;

  Object.defineProperty(supabaseAdmin, 'from', {
    value: (table: string) => {
      assert.equal(table, 'user_profiles');
      return {
        select: () => ({
          eq: () => ({
            single: async () => ({
              data: status ? { status } : null,
            }),
          }),
        }),
      };
    },
    configurable: true,
  });

  return () => {
    Object.defineProperty(supabaseAdmin, 'from', {
      value: originalFrom,
      configurable: true,
    });
  };
}

test('statusGuard blocks disabled users', async () => {
  const restore = stubUserProfile('disabled');
  const req = { userId: 'user-1' } as any;
  let statusCode = 200;
  let body: any = null;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(payload: any) {
      body = payload;
      return this;
    },
  } as any;
  let nextCalled = false;

  try {
    await statusGuard(req, res, () => {
      nextCalled = true;
    });
    assert.equal(nextCalled, false);
    assert.equal(statusCode, 403);
    assert.match(body.error, /禁用/);
  } finally {
    restore();
  }
});
