import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OUTLINE_GENERATION_RETRY_ATTEMPTS,
  OUTLINE_REGENERATION_RETRY_ATTEMPTS,
} from './outlineService';

test('outline generation uses enough upstream retries for transient 503 errors', () => {
  assert.equal(OUTLINE_GENERATION_RETRY_ATTEMPTS, 4);
  assert.equal(OUTLINE_REGENERATION_RETRY_ATTEMPTS, 4);
});
