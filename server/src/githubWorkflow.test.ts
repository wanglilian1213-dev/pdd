import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const cleanupWorkflowPath = path.resolve(__dirname, '../../.github/workflows/deploy-cleanup.yml');

test('GitHub Actions includes cleanup deployment workflow', () => {
  assert.equal(fs.existsSync(cleanupWorkflowPath), true);

  const yaml = fs.readFileSync(cleanupWorkflowPath, 'utf8');
  assert.match(yaml, /name:\s*Deploy Cleanup/i);
  assert.match(yaml, /server\/\*\*/i);
  assert.match(yaml, /--service\s+a2cc1781-db8f-4827-b051-2aef637c8e60/i);
});
