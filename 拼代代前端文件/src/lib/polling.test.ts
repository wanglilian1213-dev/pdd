import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPollDelayMs,
  getPollTimeoutMs,
  hasPollingTimedOut,
} from './polling';

test('getPollDelayMs grows over time but stays within the outline cap', () => {
  assert.equal(getPollDelayMs('outline', 0), 3000);
  assert.equal(getPollDelayMs('outline', 1), 5000);
  assert.equal(getPollDelayMs('outline', 10), 15000);
});

test('getPollDelayMs grows over time but stays within the writing cap', () => {
  assert.equal(getPollDelayMs('writing', 0), 5000);
  assert.equal(getPollDelayMs('writing', 1), 8000);
  assert.equal(getPollDelayMs('writing', 10), 15000);
});

test('getPollTimeoutMs returns the product timeout for each stage', () => {
  assert.equal(getPollTimeoutMs('outline'), 10 * 60 * 1000);
  assert.equal(getPollTimeoutMs('writing'), 3 * 60 * 60 * 1000);
  assert.equal(getPollTimeoutMs('humanize'), 20 * 60 * 1000);
});

test('hasPollingTimedOut flips to true after the timeout window', () => {
  const startedAt = 0;
  assert.equal(hasPollingTimedOut('outline', startedAt, 10 * 60 * 1000 - 1), false);
  assert.equal(hasPollingTimedOut('outline', startedAt, 10 * 60 * 1000), true);
});
