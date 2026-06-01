import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/pages/dashboard/AiTools.tsx', 'utf8');

test('AI tools page opens an explicit historical detection before current detection', () => {
  assert.match(source, /useSearchParams/);
  assert.match(source, /historicalDetectionId = searchParams\.get\('detection'\)/);
  assert.match(source, /api\.getAiDetection\(historicalDetectionId\)/);
  assert.match(source, /api\.getAiDetectionCurrent\(\)/);
  assert.match(source, /historicalDetectionId\s*\?\s*\(await api\.getAiDetection\(historicalDetectionId\)\)/s);
  assert.match(source, /setData\(resp \?\? null\)/);
});

test('AI detection reset clears the historical result query', () => {
  assert.match(source, /onClearHistoricalDetection/);
  assert.match(source, /setSearchParams\(\{ tab: 'detection' \}, \{ replace: true \}\)/);
});
