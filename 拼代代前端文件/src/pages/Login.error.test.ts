import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/pages/Login.tsx', 'utf8');

test('login form uses one submit path and keeps visible error feedback', () => {
  assert.match(source, /<form className="space-y-4" onSubmit=\{handleSubmit\}>/);
  assert.match(source, /role="alert"/);
  assert.match(source, /setError\(err\.message \|\| '登录失败，请稍后重试。'\)/);
  assert.match(source, /type="submit"/);
  assert.doesNotMatch(source, /onClick=\{handleLoginClick\}/);
  assert.doesNotMatch(source, /const handleLoginClick/);
});
