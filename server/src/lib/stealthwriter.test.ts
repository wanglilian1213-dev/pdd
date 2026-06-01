import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStealthwriterResultJson,
  buildHumanizedText,
  createStealthwriterClient,
  decodeStealthwriterPayload,
  encodeStealthwriterPayload,
  mergeHumanizeMoreResult,
  StealthwriterAuthError,
  StealthwriterRateLimitError,
} from './stealthwriter';

function dummySession() {
  return {
    id: 'session-1',
    sessionToken: 'token-1',
    cookieHeader: 'session=abc',
    fp: 'fp-1',
    expiresAt: null,
    lastVerifiedAt: null,
    lastRefreshedAt: null,
    status: 'active' as const,
    notes: null,
  };
}

function identityPayload(payload: Record<string, unknown>) {
  return payload;
}

test('buildHumanizedText reconstructs best output from sentence alternatives', () => {
  const result = buildHumanizedText('Sentence one. Sentence two.', [
    {
      original: 'Sentence one.',
      alternatives: [
        { sentence: 'Sentence one.', rank: 0.2 },
        { sentence: 'Rewritten one.', rank: 0.8 },
      ],
    },
    {
      original: 'Sentence two.',
      alternatives: [
        { sentence: 'Sentence two.', rank: 0.4 },
        { sentence: 'Rewritten two.', rank: 0.9 },
      ],
    },
  ]);

  assert.equal(result, 'Rewritten one. Rewritten two.');
});

test('buildStealthwriterResultJson normalizes scan score and preserves sentence data', () => {
  const result = buildStealthwriterResultJson({
    normalScore: 93,
    verdict: 'looks_human',
    resultId: 'scan-1',
    sentences: [
      { sentence: 'Human sentence one.', score: 0.93, label: 'human' },
      { sentence: 'AI sentence two.', score: 0.12, label: 'ai' },
    ],
    raw: { source: 'scan' },
  });

  assert.deepEqual(result, {
    human_score: 93,
    ai_score: 7,
    verdict: 'looks_human',
    scan_version: 'v2',
    stealthwriter_result_id: 'scan-1',
    sentences: [
      { sentence: 'Human sentence one.', score: 0.93, label: 'human' },
      { sentence: 'AI sentence two.', score: 0.12, label: 'ai' },
    ],
    raw: { source: 'scan' },
  });
});

test('buildStealthwriterResultJson can carry display text for article-style highlighting', () => {
  const result = buildStealthwriterResultJson(
    {
      normalScore: 91,
      verdict: 'looks_human',
      resultId: 'scan-2',
      sentences: [
        { sentence: 'Sentence one.', score: 0.91, label: 'human' },
      ],
      raw: { source: 'scan' },
    },
    {
      displayText: 'Sentence one.\n\nReferences\nBook A',
      originalText: 'Sentence one.\n\nReferences\nBook A',
    },
  );

  assert.equal(result.display_text, 'Sentence one.\n\nReferences\nBook A');
  assert.equal(result.original_text, 'Sentence one.\n\nReferences\nBook A');
});

test('encodeStealthwriterPayload round-trips through decodeStealthwriterPayload', () => {
  const payload = {
    text: 'Sentence one.',
    level: 8,
    model: 'Ghost5.2Pro',
    version: 'v2',
    rescan: true,
  };

  const encoded = encodeStealthwriterPayload(payload);
  const decoded = decodeStealthwriterPayload(encoded);

  assert.deepEqual(decoded, payload);
});

test('humanize returns normalized output and scanV2 returns human score', async () => {
  const calls: Array<{ url: string; body: Record<string, unknown>; headers: RequestInit['headers'] | undefined }> = [];
  const client = createStealthwriterClient({
    loadSession: async () => dummySession(),
    refreshSession: async () => dummySession(),
    markSessionBroken: async () => undefined,
    touchSessionVerified: async () => undefined,
    encodePayload: identityPayload,
    decodePayload: identityPayload,
    fetchImpl: async (url, init) => {
      calls.push({
        url,
        body: JSON.parse(String(init?.body || '{}')),
        headers: init?.headers,
      });

      if (String(url).endsWith('/api/humanize')) {
        return new Response(JSON.stringify({
          id: 'humanize-1',
          sentences: [
            {
              original: 'Sentence one.',
              alternatives: [
                { sentence: 'Sentence one.', rank: 0.2 },
                { sentence: 'Human sentence one.', rank: 0.9 },
              ],
            },
          ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({
        id: 'scan-1',
        normal_score: 0.93,
        sentences: [
          { sentence: 'Human sentence one.', score: 0.93 },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const humanized = await client.humanize('Sentence one.');
  const scan = await client.scanV2(humanized.output);

  assert.equal(humanized.output, 'Human sentence one.');
  assert.equal(scan.normalScore, 93);
  assert.equal(calls[0]?.url.endsWith('/api/humanize'), true);
  assert.equal(calls[1]?.url.endsWith('/api/scan'), true);
  assert.equal(calls[0]?.body.model, 'Ghost5.2Pro');
  assert.equal(calls[0]?.body.level, 8);
  assert.equal(calls[0]?.body.num_alternatives, 3);
  assert.equal(calls[1]?.body.model, undefined);
  assert.equal(calls[1]?.body.version, 'v2');
  assert.equal((calls[0]?.headers as Record<string, string>)?.Origin, 'https://stealthwriter.ai');
  assert.equal((calls[0]?.headers as Record<string, string>)?.Referer, 'https://stealthwriter.ai/');
  assert.match((calls[0]?.headers as Record<string, string>)?.['User-Agent'] || '', /Chrome\/147/);
});

test('scanV2 falls back to v1 when StealthWriter v2 has CUDA failure', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = createStealthwriterClient({
    loadSession: async () => dummySession(),
    refreshSession: async () => dummySession(),
    markSessionBroken: async () => undefined,
    touchSessionVerified: async () => undefined,
    encodePayload: identityPayload,
    decodePayload: identityPayload,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      calls.push(body);

      if (calls.length === 1) {
        return new Response(JSON.stringify({
          error: 'Scan failed: CUDA error: unknown error',
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({
        id: 'scan-v1',
        normal_score: 0.87,
        sentences: [{ sentence: 'Sentence one.', score: 0.87 }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });

  const scan = await client.scanV2('Sentence one.');

  assert.equal(scan.normalScore, 87);
  assert.equal(scan.scanVersion, 'v1');
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.version, 'v2');
  assert.equal(calls[1]?.version, 'v1');
});

test('scanV2 CUDA fallback does not loop back to v2 when v1 also fails', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const client = createStealthwriterClient({
    loadSession: async () => dummySession(),
    refreshSession: async () => dummySession(),
    markSessionBroken: async () => undefined,
    touchSessionVerified: async () => undefined,
    encodePayload: identityPayload,
    decodePayload: identityPayload,
    fetchImpl: async (_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'));
      calls.push(body);

      if (calls.length === 1) {
        return new Response(JSON.stringify({
          error: 'Scan failed: CUDA error: unknown error',
        }), { status: 500, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({ error: 'v1 unavailable' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  await assert.rejects(
    () => client.scanV2('Sentence one.'),
    /v1 unavailable/,
  );
  assert.equal(calls.length, 4);
  assert.equal(calls[0]?.version, 'v2');
  assert.equal(calls[1]?.version, 'v1');
  assert.equal(calls[2]?.version, 'v1');
  assert.equal(calls[3]?.version, 'v1');
});

test('humanizeMore keeps higher-ranked previous alternatives when fresh pass regresses', async () => {
  const previous = {
    originalText: 'Sentence one.',
    output: 'Strong rewrite.',
    resultId: 'old',
    raw: {},
    sentences: [
      {
        original: 'Sentence one.',
        alternatives: [
          { sentence: 'Sentence one.', rank: 0.2 },
          { sentence: 'Strong rewrite.', rank: 0.95 },
        ],
      },
    ],
  };

  const fresh = {
    originalText: 'Sentence one.',
    output: 'Weak rewrite.',
    resultId: 'new',
    raw: {},
    sentences: [
      {
        original: 'Sentence one.',
        alternatives: [
          { sentence: 'Sentence one.', rank: 0.2 },
          { sentence: 'Weak rewrite.', rank: 0.4 },
        ],
      },
    ],
  };

  const merged = mergeHumanizeMoreResult(previous, fresh);
  assert.equal(merged.output, 'Strong rewrite.');
  assert.equal(merged.resultId, 'new');
});

test('401 triggers one refresh and then succeeds on retry', async () => {
  let refreshed = 0;
  let calls = 0;

  const client = createStealthwriterClient({
    loadSession: async () => dummySession(),
    refreshSession: async () => {
      refreshed += 1;
      return dummySession();
    },
    markSessionBroken: async () => undefined,
    touchSessionVerified: async () => undefined,
    encodePayload: identityPayload,
    decodePayload: identityPayload,
    fetchImpl: async () => {
      calls += 1;

      if (calls === 1) {
        return new Response(JSON.stringify({ error: 'expired' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        id: 'humanize-2',
        sentences: [
          {
            original: 'Sentence one.',
            alternatives: [{ sentence: 'Retry success.', rank: 0.9 }],
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const result = await client.humanize('Sentence one.');
  assert.equal(result.output, 'Retry success.');
  assert.equal(refreshed, 1);
});

test('humanize retries transient 500 responses before failing the request', async () => {
  let calls = 0;

  const client = createStealthwriterClient({
    loadSession: async () => dummySession(),
    refreshSession: async () => dummySession(),
    markSessionBroken: async () => undefined,
    touchSessionVerified: async () => undefined,
    encodePayload: identityPayload,
    decodePayload: identityPayload,
    fetchImpl: async () => {
      calls += 1;

      if (calls === 1) {
        return new Response(JSON.stringify({ error: 'temporary upstream error' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({
        id: 'humanize-retry',
        sentences: [
          {
            original: 'Sentence one.',
            alternatives: [{ sentence: 'Recovered sentence.', rank: 0.9 }],
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const result = await client.humanize('Sentence one.');

  assert.equal(result.output, 'Recovered sentence.');
  assert.equal(calls, 2);
});

test('humanize retries transient network failures before succeeding', async () => {
  let calls = 0;

  const client = createStealthwriterClient({
    loadSession: async () => dummySession(),
    refreshSession: async () => dummySession(),
    markSessionBroken: async () => undefined,
    touchSessionVerified: async () => undefined,
    encodePayload: identityPayload,
    decodePayload: identityPayload,
    fetchImpl: async () => {
      calls += 1;

      if (calls === 1) {
        throw new TypeError('fetch failed');
      }

      return new Response(JSON.stringify({
        id: 'humanize-network-retry',
        sentences: [
          {
            original: 'Sentence one.',
            alternatives: [{ sentence: 'Recovered after network failure.', rank: 0.9 }],
          },
        ],
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const result = await client.humanize('Sentence one.');

  assert.equal(result.output, 'Recovered after network failure.');
  assert.equal(calls, 2);
});

test('403 FP_LIMIT is treated as rate limit without refresh or retry', async () => {
  let calls = 0;
  let refreshed = 0;

  const client = createStealthwriterClient({
    loadSession: async () => dummySession(),
    refreshSession: async () => {
      refreshed += 1;
      return dummySession();
    },
    markSessionBroken: async () => undefined,
    touchSessionVerified: async () => undefined,
    encodePayload: identityPayload,
    decodePayload: identityPayload,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ code: 'FP_LIMIT', error: 'fingerprint limit' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  await assert.rejects(
    () => client.humanize('Sentence one.'),
    (error: unknown) => error instanceof StealthwriterRateLimitError
      && /fingerprint limit/.test(error.message),
  );
  assert.equal(calls, 1);
  assert.equal(refreshed, 0);
});

test('429 rate limit is not retried', async () => {
  let calls = 0;

  const client = createStealthwriterClient({
    loadSession: async () => dummySession(),
    refreshSession: async () => dummySession(),
    markSessionBroken: async () => undefined,
    touchSessionVerified: async () => undefined,
    encodePayload: identityPayload,
    decodePayload: identityPayload,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: 'too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  await assert.rejects(
    () => client.humanize('Sentence one.'),
    StealthwriterRateLimitError,
  );
  assert.equal(calls, 1);
});

test('400 and 422 request errors are not retried', async () => {
  for (const status of [400, 422]) {
    let calls = 0;
    const client = createStealthwriterClient({
      loadSession: async () => dummySession(),
      refreshSession: async () => dummySession(),
      markSessionBroken: async () => undefined,
      touchSessionVerified: async () => undefined,
      encodePayload: identityPayload,
      decodePayload: identityPayload,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({ error: `request rejected ${status}` }), {
          status,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    await assert.rejects(
      () => client.humanize('Sentence one.'),
      new RegExp(`request rejected ${status}`),
    );
    assert.equal(calls, 1);
  }
});

test('401 without successful refresh still throws auth error', async () => {
  const client = createStealthwriterClient({
    loadSession: async () => dummySession(),
    refreshSession: async () => {
      throw new Error('refresh failed');
    },
    markSessionBroken: async () => undefined,
    touchSessionVerified: async () => undefined,
    encodePayload: identityPayload,
    decodePayload: identityPayload,
    fetchImpl: async () => new Response(JSON.stringify({ error: 'expired' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }),
  });

  await assert.rejects(
    () => client.humanize('Sentence one.'),
    (error: unknown) => error instanceof Error && !(error instanceof StealthwriterAuthError)
      ? /refresh failed/.test(error.message)
      : false,
  );
});

test('401 after refresh is not retried as a transient request error', async () => {
  let calls = 0;
  let refreshed = 0;

  const client = createStealthwriterClient({
    loadSession: async () => dummySession(),
    refreshSession: async () => {
      refreshed += 1;
      return dummySession();
    },
    markSessionBroken: async () => undefined,
    touchSessionVerified: async () => undefined,
    encodePayload: identityPayload,
    decodePayload: identityPayload,
    fetchImpl: async () => {
      calls += 1;
      return new Response(JSON.stringify({ error: 'expired' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  await assert.rejects(
    () => client.humanize('Sentence one.'),
    StealthwriterAuthError,
  );
  assert.equal(calls, 2);
  assert.equal(refreshed, 1);
});
