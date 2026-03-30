const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_COOLDOWN_MS = 15 * 60 * 1000;

export function validateRegistrationPassword(password: string) {
  const trimmed = password.trim();

  if (trimmed.length < 8) {
    return '密码至少包含 8 位，并同时包含字母和数字。';
  }

  const hasLetter = /[A-Za-z]/.test(trimmed);
  const hasNumber = /\d/.test(trimmed);

  if (!hasLetter || !hasNumber) {
    return '密码至少包含 8 位，并同时包含字母和数字。';
  }

  return null;
}

export function createLoginAttemptGuard(limit = LOGIN_ATTEMPT_LIMIT, cooldownMs = LOGIN_COOLDOWN_MS) {
  let failures: number[] = [];

  function prune(now: number) {
    failures = failures.filter((timestamp) => now - timestamp < cooldownMs);
  }

  return {
    canAttempt(now = Date.now()) {
      prune(now);
      return failures.length < limit;
    },
    recordFailure(now = Date.now()) {
      prune(now);
      failures.push(now);
    },
    reset() {
      failures = [];
    },
  };
}

export const sharedLoginAttemptGuard = createLoginAttemptGuard();
export const LOGIN_COOLDOWN_MINUTES = 15;
