import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('humanizeService keeps its separate OpenAI model for now', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/services/humanizeService.ts'), 'utf8');

  assert.match(source, /model:\s*'gpt-4\.1'/);
  assert.doesNotMatch(source, /buildMainOpenAIResponsesOptions/);
});
