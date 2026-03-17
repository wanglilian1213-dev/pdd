import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const migrationPath = path.resolve(
  __dirname,
  '../supabase/migrations/20260317000000_security_and_atomic_ops.sql',
);

test('security migration enables RLS and defines atomic SQL functions', () => {
  const sql = fs.readFileSync(migrationPath, 'utf8');

  assert.match(sql, /alter table user_profiles enable row level security/i);
  assert.match(sql, /alter table wallets enable row level security/i);
  assert.match(sql, /alter table credit_ledger enable row level security/i);
  assert.match(sql, /alter table tasks enable row level security/i);
  assert.match(sql, /alter table recharge_codes enable row level security/i);
  assert.match(sql, /alter table system_config enable row level security/i);

  assert.match(sql, /create policy/i);
  assert.match(sql, /create or replace function redeem_recharge_code/i);
  assert.match(sql, /create or replace function wallet_freeze_credits/i);
  assert.match(sql, /create or replace function confirm_outline_task/i);
  assert.match(sql, /create or replace function start_humanize_job/i);
  assert.match(sql, /create unique index if not exists idx_one_processing_humanize_job_per_task/i);
});
