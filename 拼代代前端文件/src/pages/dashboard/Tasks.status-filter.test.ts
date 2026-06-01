import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/pages/dashboard/Tasks.tsx', 'utf8');

test('task history status filters use native selects', () => {
  assert.doesNotMatch(source, /DropdownMenu/);
  assert.match(source, /aria-label="筛选写作任务状态"/);
  assert.match(source, /aria-label="筛选文章修改状态"/);
  assert.match(source, /aria-label="筛选文章评审状态"/);
});

test('failed history rows show refunded credits instead of spent credits', () => {
  assert.match(source, /if \(status === 'failed'\) return '已退回'/);
  assert.match(source, /formatCreditDisplay\(item\.status, item\.frozen_credits, item\.settled_credits\)/);
});
