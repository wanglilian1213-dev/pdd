import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from '../lib/errors';
import { supabaseAdmin } from '../lib/supabase';
import {
  confirmOutlineTaskAtomic,
  freezeCreditsAtomic,
  redeemRechargeCodeAtomic,
  startHumanizeJobAtomic,
  voidRechargeCodesAtomic,
} from './atomicOpsService';

function stubRpc(impl: any) {
  const originalRpc = supabaseAdmin.rpc;
  const originalFrom = supabaseAdmin.from;

  Object.defineProperty(supabaseAdmin, 'rpc', {
    value: impl,
    configurable: true,
  });

  Object.defineProperty(supabaseAdmin, 'from', {
    value: () => {
      throw new Error('from should not be called when using atomic RPC operations');
    },
    configurable: true,
  });

  return () => {
    Object.defineProperty(supabaseAdmin, 'rpc', {
      value: originalRpc,
      configurable: true,
    });
    Object.defineProperty(supabaseAdmin, 'from', {
      value: originalFrom,
      configurable: true,
    });
  };
}

test('freezeCreditsAtomic uses wallet_freeze_credits RPC', async () => {
  let called: { fn: string; args: Record<string, unknown> } | null = null;
  const restore = stubRpc(async (fn: string, args: Record<string, unknown>) => {
    called = { fn, args: args as Record<string, unknown> };
    return { data: { balance: 700, frozen: 300 }, error: null, count: null, status: 200, statusText: 'OK' } as never;
  });

  try {
    const result = await freezeCreditsAtomic('user-1', 300, 'task', 'task-1', '冻结 300');
    assert.deepEqual(called, {
      fn: 'wallet_freeze_credits',
      args: {
        p_user_id: 'user-1',
        p_amount: 300,
        p_ref_type: 'task',
        p_ref_id: 'task-1',
        p_note: '冻结 300',
      },
    });
    assert.deepEqual(result, { balance: 700, frozen: 300 });
  } finally {
    restore();
  }
});

test('freezeCreditsAtomic maps insufficient balance errors to AppError', async () => {
  const restore = stubRpc(async () => {
    return {
      data: null,
      error: { message: 'INSUFFICIENT_BALANCE' },
      count: null,
      status: 400,
      statusText: 'Bad Request',
    } as never;
  });

  try {
    await assert.rejects(
      () => freezeCreditsAtomic('user-1', 300, 'task', 'task-1', '冻结 300'),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.match(error.userMessage, /余额不足/);
        return true;
      },
    );
  } finally {
    restore();
  }
});

test('redeemRechargeCodeAtomic uses redeem_recharge_code RPC', async () => {
  let called: { fn: string; args: Record<string, unknown> } | null = null;
  const restore = stubRpc(async (fn: string, args: Record<string, unknown>) => {
    called = { fn, args: args as Record<string, unknown> };
    return {
      data: { denomination: 1000, balance: 1500 },
      error: null,
      count: null,
      status: 200,
      statusText: 'OK',
    } as never;
  });

  try {
    const result = await redeemRechargeCodeAtomic('user-1', 'ABCD-EFGH-IJKL-MNOP');
    assert.deepEqual(called, {
      fn: 'redeem_recharge_code',
      args: {
        p_user_id: 'user-1',
        p_code: 'ABCD-EFGH-IJKL-MNOP',
      },
    });
    assert.deepEqual(result, { denomination: 1000, balance: 1500 });
  } finally {
    restore();
  }
});

test('confirmOutlineTaskAtomic uses confirm_outline_task RPC', async () => {
  let called: { fn: string; args: Record<string, unknown> } | null = null;
  const restore = stubRpc(async (fn: string, args: Record<string, unknown>) => {
    called = { fn, args: args as Record<string, unknown> };
    return {
      data: { taskId: 'task-1', stage: 'writing', frozenCredits: 250 },
      error: null,
      count: null,
      status: 200,
      statusText: 'OK',
    } as never;
  });

  try {
    const result = await confirmOutlineTaskAtomic('task-1', 'user-1', 1000, 'APA 7', 250);
    assert.deepEqual(called, {
      fn: 'confirm_outline_task',
      args: {
        p_task_id: 'task-1',
        p_user_id: 'user-1',
        p_target_words: 1000,
        p_citation_style: 'APA 7',
        p_cost: 250,
      },
    });
    assert.deepEqual(result, { taskId: 'task-1', stage: 'writing', frozenCredits: 250 });
  } finally {
    restore();
  }
});

test('startHumanizeJobAtomic uses start_humanize_job RPC', async () => {
  let called: { fn: string; args: Record<string, unknown> } | null = null;
  const restore = stubRpc(async (fn: string, args: Record<string, unknown>) => {
    called = { fn, args: args as Record<string, unknown> };
    return {
      data: { jobId: 'job-1', stage: 'humanizing', frozenCredits: 250 },
      error: null,
      count: null,
      status: 200,
      statusText: 'OK',
    } as never;
  });

  try {
    const result = await startHumanizeJobAtomic('task-1', 'user-1', 'doc-1', 1000, 250);
    assert.deepEqual(called, {
      fn: 'start_humanize_job',
      args: {
        p_task_id: 'task-1',
        p_user_id: 'user-1',
        p_input_version_id: 'doc-1',
        p_input_word_count: 1000,
        p_cost: 250,
      },
    });
    assert.deepEqual(result, { jobId: 'job-1', stage: 'humanizing', frozenCredits: 250 });
  } finally {
    restore();
  }
});

test('voidRechargeCodesAtomic uses void_recharge_codes RPC', async () => {
  let called: { fn: string; args: Record<string, unknown> } | null = null;
  const restore = stubRpc(async (fn: string, args: Record<string, unknown>) => {
    called = { fn, args: args as Record<string, unknown> };
    return {
      data: { voidedCount: 2 },
      error: null,
      count: null,
      status: 200,
      statusText: 'OK',
    } as never;
  });

  try {
    const result = await voidRechargeCodesAtomic([
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
    ]);
    assert.deepEqual(called, {
      fn: 'void_recharge_codes',
      args: {
        p_code_ids: [
          '11111111-1111-4111-8111-111111111111',
          '22222222-2222-4222-8222-222222222222',
        ],
      },
    });
    assert.deepEqual(result, { voidedCount: 2 });
  } finally {
    restore();
  }
});

test('voidRechargeCodesAtomic maps partial void errors to AppError', async () => {
  const restore = stubRpc(async () => {
    return {
      data: null,
      error: { message: 'RECHARGE_CODE_PARTIAL_VOID' },
      count: null,
      status: 400,
      statusText: 'Bad Request',
    } as never;
  });

  try {
    await assert.rejects(
      () => voidRechargeCodesAtomic(['11111111-1111-4111-8111-111111111111']),
      (error: unknown) => {
        assert.ok(error instanceof AppError);
        assert.match(error.userMessage, /部分/);
        return true;
      },
    );
  } finally {
    restore();
  }
});
