import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { openai, streamResponseText } from './openai';

const serviceFiles = [
  'src/services/chatService.ts',
  'src/services/revisionService.ts',
  'src/services/writingService.ts',
  'src/services/humanizeService.ts',
  'src/services/standaloneHumanizeCondenseService.ts',
];

test('OpenAI gateway calls avoid unsupported max_output_tokens', () => {
  for (const file of serviceFiles) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /max_output_tokens\s*:/, file);
  }
});

test('OpenAI gateway calls avoid top-level string input', () => {
  for (const file of serviceFiles) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /input:\s*(?:inputText|enhancedText|text)\s*,/, file);
  }
});

test('chat uses the streaming helper for gateway-compatible responses', () => {
  const source = readFileSync('src/services/chatService.ts', 'utf8');
  assert.match(source, /streamResponseText\(/);
  assert.doesNotMatch(source, /responses\.create\(/);
});

test('streamResponseText keeps captured text when finalResponse fails on missing output array', async () => {
  const originalStream = openai.responses.stream;
  const handlers = new Map<string, Array<(event: unknown) => void>>();

  (openai.responses as any).stream = () => ({
    on(eventName: string, handler: (event: unknown) => void) {
      handlers.set(eventName, [...(handlers.get(eventName) || []), handler]);
      return this;
    },
    async finalResponse() {
      for (const handler of handlers.get('response.output_text.delta') || []) {
        handler({ delta: 'partial text' });
      }
      for (const handler of handlers.get('response.output_text.done') || []) {
        handler({ text: 'final recovered text' });
      }
      throw new TypeError("Cannot read properties of undefined (reading 'map')");
    },
  });

  try {
    const result = await streamResponseText({} as any);
    assert.equal(result.text, 'final recovered text');
    assert.equal(result.response.recoveredFromFinalResponseError, true);
  } finally {
    (openai.responses as any).stream = originalStream;
  }
});
