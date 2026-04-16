import test from 'node:test';
import assert from 'node:assert/strict';
import { supabaseAdmin } from '../lib/supabase';
import { ActiveTaskExistsError } from '../lib/errors';
import {
  acknowledgeHumanize,
  createTask,
  discardPendingTaskWithDeps,
  getCurrentTask,
} from './taskService';

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

/**
 * 链式 mock helper：
 *   - select / eq / in / order / limit / lt / update / insert / delete 都返回 chain 自己
 *   - single / maybeSingle 返回 Promise(result)
 *   - 直接 await chain 也返回 Promise(result)（用 then 实现 thenable）
 *
 * 这样能覆盖 getCurrentTask 三查询 + getTask 全部链式调用
 */
type MockResult = { data: unknown; error?: unknown };

function chainResult(result: MockResult): any {
  const chain: any = {};
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'lt', 'update', 'insert', 'delete']) {
    chain[m] = () => chain;
  }
  chain.single = async () => result;
  chain.maybeSingle = async () => result;
  chain.then = (resolve: (value: MockResult) => unknown, reject?: (err: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function makeMultiCallStub(callsByTable: Record<string, MockResult[]>) {
  const indices: Record<string, number> = {};
  return (table: string) => {
    if (!callsByTable[table]) {
      throw new Error(`Unexpected table ${table}`);
    }
    const i = indices[table] || 0;
    const result = callsByTable[table][i];
    if (result === undefined) {
      throw new Error(`No more mocked results for ${table} (call ${i + 1})`);
    }
    indices[table] = i + 1;
    return chainResult(result);
  };
}

test('discardPendingTaskWithDeps deletes outline-ready task files from storage before removing the task', async () => {
  const removedPaths: string[] = [];
  let deletedTaskId: string | null = null;

  await discardPendingTaskWithDeps('task-1', 'user-1', {
    loadTask: async () => ({
      id: 'task-1',
      user_id: 'user-1',
      stage: 'outline_ready',
      status: 'processing',
      frozen_credits: 0,
    }),
    listTaskFiles: async () => ([
      { storage_path: 'task-1/material-1.pdf' },
      { storage_path: 'task-1/material-2.pdf' },
    ]),
    removeStoragePaths: async (paths) => {
      removedPaths.push(...paths);
    },
    deleteTask: async (taskId) => {
      deletedTaskId = taskId;
    },
  });

  assert.deepEqual(removedPaths, [
    'task-1/material-1.pdf',
    'task-1/material-2.pdf',
  ]);
  assert.equal(deletedTaskId, 'task-1');
});

test('createTask turns database unique conflicts into ActiveTaskExistsError', async () => {
  const restore = stubSupabaseFrom((table: string) => {
    if (table !== 'tasks') {
      throw new Error(`unexpected table ${table}`);
    }

    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            single: async () => ({ data: null }),
          }),
        }),
      }),
      insert: () => ({
        select: () => ({
          single: async () => ({
            data: null,
            error: { code: '23505' },
          }),
        }),
      }),
    };
  });

  try {
    await assert.rejects(
      () => createTask('user-1', '任务标题', '要求'),
      (error: unknown) => error instanceof ActiveTaskExistsError,
    );
  } finally {
    restore();
  }
});

// ---------------------
// getCurrentTask 三查询测试
// ---------------------

test('getCurrentTask returns the active processing task when one exists', async () => {
  const restore = stubSupabaseFrom(
    makeMultiCallStub({
      tasks: [
        // 查询 1：拿到正在写作的任务
        { data: { id: 'active-task' } },
        // getTask 内部 .single()
        { data: { id: 'active-task', citation_style: null } },
      ],
      task_files: [{ data: [] }],
      outline_versions: [{ data: [] }],
      document_versions: [{ data: [] }],
      humanize_jobs: [{ data: [] }],
    }),
  );

  try {
    const result = await getCurrentTask('user-1');
    assert.ok(result);
    assert.equal((result as { id: string }).id, 'active-task');
  } finally {
    restore();
  }
});

test('getCurrentTask returns the humanizing task when stage=humanizing AND humanize_job.status=processing', async () => {
  const restore = stubSupabaseFrom(
    makeMultiCallStub({
      tasks: [
        { data: null },                                      // 查询 1：无写作任务
        { data: { id: 'humanizing-task' } },                 // 查询 2a：有 humanizing 任务
        { data: { id: 'humanizing-task', citation_style: null } }, // getTask single
      ],
      humanize_jobs: [
        { data: { id: 'job-active' } },                      // 查询 2b：双重校验通过
        { data: [] },                                        // getTask 并行
      ],
      task_files: [{ data: [] }],
      outline_versions: [{ data: [] }],
      document_versions: [{ data: [] }],
    }),
  );

  try {
    const result = await getCurrentTask('user-1');
    assert.ok(result);
    assert.equal((result as { id: string }).id, 'humanizing-task');
  } finally {
    restore();
  }
});

test('getCurrentTask falls through to query 3 when stage=humanizing but humanize_job is not processing', async () => {
  // 陈年残留：stage='humanizing' 没改回，但 humanize_job 已经死了
  // 期望：双重校验失败 → fallthrough 到查询 3 → 查询 3 找未确认 humanize_job
  const restore = stubSupabaseFrom(
    makeMultiCallStub({
      tasks: [
        { data: null },                                      // 查询 1
        { data: { id: 'stale-humanizing' } },                // 查询 2a：有 stage='humanizing' 任务
        { data: [{ id: 'stale-humanizing' }] },              // 查询 3a：用户的 completed 任务列表
      ],
      humanize_jobs: [
        { data: null },                                      // 查询 2b：双重校验失败（job 已不在 processing）
        { data: null },                                      // 查询 3b：也没未确认的 → 返回 null
      ],
    }),
  );

  try {
    const result = await getCurrentTask('user-1');
    assert.equal(result, null);
  } finally {
    restore();
  }
});

test('getCurrentTask returns the latest unacknowledged humanize task (completed)', async () => {
  const restore = stubSupabaseFrom(
    makeMultiCallStub({
      tasks: [
        { data: null },                                      // 查询 1
        { data: null },                                      // 查询 2a：无 humanizing
        { data: [{ id: 'task-completed-humanize' }] },       // 查询 3a：用户有任务
        { data: { id: 'task-completed-humanize', citation_style: null } }, // getTask single
      ],
      humanize_jobs: [
        { data: { task_id: 'task-completed-humanize' } },    // 查询 3b：有未确认
        { data: [] },                                        // getTask 并行
      ],
      task_files: [{ data: [] }],
      outline_versions: [{ data: [] }],
      document_versions: [{ data: [] }],
    }),
  );

  try {
    const result = await getCurrentTask('user-1');
    assert.ok(result);
    assert.equal((result as { id: string }).id, 'task-completed-humanize');
  } finally {
    restore();
  }
});

test('getCurrentTask returns the latest unacknowledged humanize task (failed)', async () => {
  // 验证查询 3 同样能恢复 failed 状态的 humanize（不仅是 completed）
  // 实现细节：查询 3b 用 .in('status', ['completed', 'failed'])
  const restore = stubSupabaseFrom(
    makeMultiCallStub({
      tasks: [
        { data: null },
        { data: null },
        { data: [{ id: 'task-failed-humanize' }] },
        { data: { id: 'task-failed-humanize', citation_style: null } },
      ],
      humanize_jobs: [
        { data: { task_id: 'task-failed-humanize' } },
        { data: [] },
      ],
      task_files: [{ data: [] }],
      outline_versions: [{ data: [] }],
      document_versions: [{ data: [] }],
    }),
  );

  try {
    const result = await getCurrentTask('user-1');
    assert.ok(result);
    assert.equal((result as { id: string }).id, 'task-failed-humanize');
  } finally {
    restore();
  }
});

test('getCurrentTask returns null when all humanize_jobs are acknowledged', async () => {
  const restore = stubSupabaseFrom(
    makeMultiCallStub({
      tasks: [
        { data: null },                                      // 查询 1
        { data: null },                                      // 查询 2a
        { data: [{ id: 'task-old' }, { id: 'task-old-2' }] }, // 查询 3a
      ],
      humanize_jobs: [
        { data: null },                                      // 查询 3b：全部已确认 → null
      ],
    }),
  );

  try {
    const result = await getCurrentTask('user-1');
    assert.equal(result, null);
  } finally {
    restore();
  }
});

test('getCurrentTask returns null when user has no tasks at all', async () => {
  const restore = stubSupabaseFrom(
    makeMultiCallStub({
      tasks: [
        { data: null },                                      // 查询 1
        { data: null },                                      // 查询 2a
        { data: [] },                                        // 查询 3a：空数组
      ],
      // humanize_jobs 不应被查询（因为 userTaskIds 为空，提前 return null）
    }),
  );

  try {
    const result = await getCurrentTask('user-1');
    assert.equal(result, null);
  } finally {
    restore();
  }
});

// ---------------------
// acknowledgeHumanize 测试
// ---------------------

test('acknowledgeHumanize updates all humanize_jobs of the task to acknowledged=true', async () => {
  let updatePayload: Record<string, unknown> | null = null;
  let updateTaskIdFilter: string | null = null;

  const restore = stubSupabaseFrom((table: string) => {
    if (table === 'tasks') {
      // task ownership lookup
      return chainResult({ data: { id: 'task-x' } });
    }
    if (table === 'humanize_jobs') {
      const chain: any = chainResult({ data: null, error: null });
      chain.update = (payload: Record<string, unknown>) => {
        updatePayload = payload;
        return chain;
      };
      chain.eq = (col: string, val: string) => {
        if (col === 'task_id') updateTaskIdFilter = val;
        return chain;
      };
      return chain;
    }
    throw new Error(`Unexpected table ${table}`);
  });

  try {
    await acknowledgeHumanize('task-x', 'user-1');
    assert.deepEqual(updatePayload, { acknowledged: true });
    assert.equal(updateTaskIdFilter, 'task-x');
  } finally {
    restore();
  }
});

test('acknowledgeHumanize rejects with 404 when task does not belong to user', async () => {
  const restore = stubSupabaseFrom((table: string) => {
    if (table === 'tasks') {
      // task ownership lookup → null
      return chainResult({ data: null });
    }
    throw new Error(`Unexpected table ${table}`);
  });

  try {
    await assert.rejects(
      () => acknowledgeHumanize('task-x', 'user-1'),
      (err: unknown) => {
        const appErr = err as { statusCode?: number };
        return appErr.statusCode === 404;
      },
    );
  } finally {
    restore();
  }
});
