import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createLoginAttemptGuard,
  validateRegistrationPassword,
} from './authProtection';

test('validateRegistrationPassword accepts stronger passwords', () => {
  assert.equal(validateRegistrationPassword('StrongPass123'), null);
});

test('validateRegistrationPassword rejects weak passwords', () => {
  assert.match(validateRegistrationPassword('12345678') || '', /至少包含/);
});

test('createLoginAttemptGuard blocks the sixth failed attempt within 15 minutes', () => {
  const guard = createLoginAttemptGuard();
  const now = new Date('2026-03-30T10:00:00.000Z').getTime();

  for (let i = 0; i < 5; i += 1) {
    assert.equal(guard.canAttempt(now + i), true);
    guard.recordFailure(now + i);
  }

  assert.equal(guard.canAttempt(now + 1000), false);
});

test('createLoginAttemptGuard recovers after the cooldown window', () => {
  const guard = createLoginAttemptGuard();
  const now = new Date('2026-03-30T10:00:00.000Z').getTime();

  for (let i = 0; i < 5; i += 1) {
    guard.recordFailure(now + i);
  }

  assert.equal(guard.canAttempt(now + 15 * 60 * 1000 + 1), true);
});
