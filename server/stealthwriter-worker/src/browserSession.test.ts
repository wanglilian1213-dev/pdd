import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCookieHeader,
  extractSessionToken,
  loginToStealthwriter,
  parseCookieHeaderForContext,
  pickFpCandidate,
} from './browserSession';

test('buildCookieHeader joins cookies into a request header', () => {
  assert.equal(
    buildCookieHeader([
      { name: 'session_token', value: 'abc' } as any,
      { name: 'flag', value: '1' } as any,
    ]),
    'session_token=abc; flag=1',
  );
});

test('extractSessionToken prefers exact auth cookies', () => {
  assert.equal(
    extractSessionToken([
      { name: 'other', value: 'x' } as any,
      { name: 'session_token', value: 'token-1' } as any,
    ]),
    'token-1',
  );
});

test('pickFpCandidate finds fp from nested JSON-like values', () => {
  const fp = pickFpCandidate([
    { user: { id: '123' } },
    '{"meta":{"fingerprint":"fp_stealthwriter_12345"}}',
  ]);

  assert.equal(fp, 'fp_stealthwriter_12345');
});

test('parseCookieHeaderForContext converts a request cookie header into browser cookies', () => {
  assert.deepEqual(
    parseCookieHeaderForContext(
      'session_token=abc; theme=light',
      'https://stealthwriter.ai/dashboard',
      '2026-05-20T00:00:00.000Z',
    ),
    [
      {
        name: 'session_token',
        value: 'abc',
        domain: 'stealthwriter.ai',
        path: '/',
        secure: true,
        sameSite: 'Lax',
        expires: 1779235200,
      },
      {
        name: 'theme',
        value: 'light',
        domain: 'stealthwriter.ai',
        path: '/',
        secure: true,
        sameSite: 'Lax',
        expires: 1779235200,
      },
    ],
  );
});

test('loginToStealthwriter chooses Google login and falls back from passkey to password', async () => {
  type State =
    | 'home'
    | 'stealthwriterLogin'
    | 'googleEmail'
    | 'passkeyChallenge'
    | 'passwordOption'
    | 'googlePassword'
    | 'loggedIn';
  const actions: string[] = [];
  let state: State = 'home';

  function isVisible(selector: string) {
    if (state === 'home') {
      return selector.includes('login') || /login|log in|sign in/i.test(selector);
    }

    if (state === 'stealthwriterLogin') {
      return /google/i.test(selector);
    }

    if (state === 'googleEmail') {
      return selector.includes('email')
        || selector.includes('identifierId')
        || /next/i.test(selector);
    }

    if (state === 'passkeyChallenge') {
      return /try another|尝试其他/i.test(selector);
    }

    if (state === 'passwordOption') {
      return /password|密码/i.test(selector) && !selector.includes('input');
    }

    if (state === 'googlePassword') {
      return selector.includes('password')
        || selector.includes('Passwd')
        || /next/i.test(selector);
    }

    return selector === 'textarea';
  }

  function makeLocator(selector: string) {
    return {
      first: () => makeLocator(selector),
      isVisible: async () => isVisible(selector),
      click: async () => {
        actions.push(`click:${selector}`);
        if (state === 'home') state = 'stealthwriterLogin';
        else if (state === 'stealthwriterLogin' && /google/i.test(selector)) state = 'googleEmail';
        else if (state === 'googleEmail' && /next/i.test(selector)) state = 'passkeyChallenge';
        else if (state === 'passkeyChallenge') state = 'passwordOption';
        else if (state === 'passwordOption') state = 'googlePassword';
        else if (state === 'googlePassword' && /next/i.test(selector)) state = 'loggedIn';
      },
      fill: async (value: string) => {
        actions.push(`fill:${selector}:${value.includes('@') ? 'email' : 'password'}`);
      },
    };
  }

  const page = {
    goto: async () => undefined,
    url: () => (state === 'loggedIn' ? 'https://stealthwriter.ai/dashboard/humanizer' : 'https://stealthwriter.ai'),
    waitForTimeout: async () => undefined,
    waitForLoadState: async () => undefined,
    waitForEvent: async () => {
      throw new Error('no popup');
    },
    locator: (selector: string) => makeLocator(selector),
  };

  const loginState = await loginToStealthwriter(page as any, 'https://stealthwriter.ai', {
    email: 'user@example.com',
    password: 'password',
  });

  assert.equal(loginState, 'relogged');
  assert.ok(actions.some((action) => /google/i.test(action)), actions.join('\n'));
  assert.ok(actions.some((action) => action.includes(':email')), actions.join('\n'));
  assert.ok(actions.some((action) => action.includes(':password')), actions.join('\n'));
});
