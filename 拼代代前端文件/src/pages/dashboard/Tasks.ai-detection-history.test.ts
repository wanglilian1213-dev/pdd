import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/pages/dashboard/Tasks.tsx', 'utf8');

test('AI detection history opens the clicked detection by id', () => {
  assert.match(
    source,
    /navigate\(`\/dashboard\/ai-tools\?tab=detection&detection=\$\{encodeURIComponent\(item\.id\)\}`\)/,
  );
});

test('standalone humanization history opens the humanization tab', () => {
  assert.match(source, /navigate\('\/dashboard\/ai-tools\?tab=humanization'\)/);
});
