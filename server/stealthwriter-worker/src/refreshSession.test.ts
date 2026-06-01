import test from 'node:test';
import assert from 'node:assert/strict';
import { isSessionExpiringSoon } from './refreshSession';

test('isSessionExpiringSoon returns true when expiry is close', () => {
  const now = Date.parse('2026-05-09T00:00:00.000Z');
  assert.equal(
    isSessionExpiringSoon('2026-05-09T06:00:00.000Z', now),
    true,
  );
});

test('isSessionExpiringSoon returns false when enough time remains', () => {
  const now = Date.parse('2026-05-09T00:00:00.000Z');
  assert.equal(
    isSessionExpiringSoon('2026-05-10T12:00:00.000Z', now),
    false,
  );
});
