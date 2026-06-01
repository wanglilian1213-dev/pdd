import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getActiveStealthwriterSession,
  markStealthwriterSessionBroken,
  replaceStealthwriterSession,
  refreshStealthwriterSessionIfNeeded,
  shouldRefreshStealthwriterSession,
} from './stealthwriterSessionService';

function buildDeps() {
  let active: any = {
    id: 'session-1',
    session_token: 'token-1',
    cookie_header: 'a=1; b=2',
    fp: 'fp-1',
    expires_at: '2026-05-10T00:00:00.000Z',
    last_verified_at: null,
    last_refreshed_at: null,
    status: 'active',
    notes: null,
  };

  return {
    deps: {
      loadActive: async () => active,
      replaceActive: async (input: any) => {
        active = {
          id: 'session-2',
          session_token: input.sessionToken ?? null,
          cookie_header: input.cookieHeader,
          fp: input.fp,
          expires_at: input.expiresAt ?? null,
          last_verified_at: '2026-05-09T00:00:00.000Z',
          last_refreshed_at: '2026-05-09T00:00:00.000Z',
          status: 'active',
          notes: input.notes ?? null,
        };
        return active;
      },
      updateActive: async (payload: Record<string, unknown>) => {
        active = { ...active, ...payload };
      },
      fetchImpl: fetch,
    },
    getActive: () => active,
  };
}

test('getActiveStealthwriterSession returns normalized active session', async () => {
  const { deps } = buildDeps();
  const session = await getActiveStealthwriterSession(deps as any);

  assert.equal(session?.sessionToken, 'token-1');
  assert.equal(session?.cookieHeader, 'a=1; b=2');
  assert.equal(session?.fp, 'fp-1');
  assert.equal(session?.status, 'active');
});

test('replaceStealthwriterSession replaces the active session atomically via repo', async () => {
  const { deps, getActive } = buildDeps();

  const session = await replaceStealthwriterSession({
    sessionToken: 'token-2',
    cookieHeader: 'session=xyz',
    fp: 'fp-2',
    expiresAt: '2026-05-11T00:00:00.000Z',
    notes: 'rotated',
  }, deps as any);

  assert.equal(session.sessionToken, 'token-2');
  assert.equal(session.cookieHeader, 'session=xyz');
  assert.equal(session.fp, 'fp-2');
  assert.equal(getActive().id, 'session-2');
});

test('markStealthwriterSessionBroken marks active session as broken', async () => {
  const { deps, getActive } = buildDeps();

  await markStealthwriterSessionBroken('401 from upstream', deps as any);

  assert.equal(getActive().status, 'broken');
  assert.equal(getActive().notes, '401 from upstream');
});

test('shouldRefreshStealthwriterSession returns true when session is missing or stale', () => {
  const now = Date.parse('2026-05-09T12:00:00.000Z');

  assert.equal(shouldRefreshStealthwriterSession(null, now), true);
  assert.equal(shouldRefreshStealthwriterSession({
    id: 'session-1',
    sessionToken: 'token-1',
    cookieHeader: 'a=1',
    fp: 'fp-1',
    expiresAt: '2026-05-09T18:00:00.000Z',
    lastVerifiedAt: '2026-05-09T02:00:00.000Z',
    lastRefreshedAt: null,
    status: 'active',
    notes: null,
  }, now), true);
  assert.equal(shouldRefreshStealthwriterSession({
    id: 'session-2',
    sessionToken: 'token-2',
    cookieHeader: 'b=2',
    fp: 'fp-2',
    expiresAt: '2026-05-11T12:00:00.000Z',
    lastVerifiedAt: '2026-05-09T11:00:00.000Z',
    lastRefreshedAt: null,
    status: 'active',
    notes: null,
  }, now), false);
});

test('refreshStealthwriterSessionIfNeeded returns current session when still healthy', async () => {
  const { deps } = buildDeps();
  deps.loadActive = async () => ({
    id: 'session-healthy',
    session_token: 'token-healthy',
    cookie_header: 'session=healthy',
    fp: 'fp-healthy',
    expires_at: '2026-05-11T12:00:00.000Z',
    last_verified_at: '2026-05-09T00:30:00.000Z',
    last_refreshed_at: '2026-05-09T00:30:00.000Z',
    status: 'active',
    notes: null,
  });
  const session = await refreshStealthwriterSessionIfNeeded(
    deps as any,
    Date.parse('2026-05-09T01:00:00.000Z'),
  );

  assert.equal(session?.id, 'session-healthy');
});
