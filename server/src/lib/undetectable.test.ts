import test from 'node:test';
import assert from 'node:assert/strict';
import { createUndetectableClient } from './undetectable';

test('Undetectable client submits with project defaults and polls until output is ready', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const sleeps: number[] = [];

  const client = createUndetectableClient({
    apiKey: 'api-key-1',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });

      if (String(url).endsWith('/submit')) {
        return new Response(JSON.stringify({
          status: 'Document submitted successfully',
          id: 'doc-1',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      if (calls.filter((call) => call.url.endsWith('/document')).length === 1) {
        return new Response(JSON.stringify({
          id: 'doc-1',
          status: 'processing',
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return new Response(JSON.stringify({
        id: 'doc-1',
        status: 'done',
        output: 'Humanized output',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
    pollIntervalMs: 5000,
    maxPollAttempts: 3,
  });

  const result = await client.humanizeText('This is a long enough input text that definitely exceeds fifty characters.');

  assert.equal(result.documentId, 'doc-1');
  assert.equal(result.output, 'Humanized output');
  assert.equal(calls.length, 3);
  assert.equal(calls[0]?.url.endsWith('/submit'), true);
  assert.equal(calls[1]?.url.endsWith('/document'), true);
  assert.equal(calls[2]?.url.endsWith('/document'), true);
  assert.deepEqual(sleeps, [5000]);

  const submitBody = JSON.parse(String(calls[0]?.init?.body));
  assert.equal(calls[0]?.init?.headers && (calls[0].init!.headers as Record<string, string>).apikey, 'api-key-1');
  assert.equal(submitBody.readability, 'University');
  assert.equal(submitBody.purpose, 'Essay');
  assert.equal(submitBody.strength, 'More Human');
  assert.equal(submitBody.model, 'v11sr');
});

test('Undetectable client throws when output never becomes ready', async () => {
  const client = createUndetectableClient({
    apiKey: 'api-key-2',
    fetchImpl: async (url) => {
      if (String(url).endsWith('/submit')) {
        return new Response(JSON.stringify({ id: 'doc-timeout' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      return new Response(JSON.stringify({ id: 'doc-timeout', status: 'processing' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
    sleepImpl: async () => {},
    pollIntervalMs: 10,
    maxPollAttempts: 2,
  });

  await assert.rejects(
    () => client.humanizeText('This is another long enough input text that definitely exceeds fifty characters.'),
    /Undetectable 处理超时/,
  );
});
