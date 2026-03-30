import test from 'node:test';
import assert from 'node:assert/strict';
import { generateActivationCode, ACTIVATION_CODE_CHARS } from './activationCodeService';

test('generateActivationCode keeps the XXXX-XXXX-XXXX-XXXX format with readable characters only', () => {
  const code = generateActivationCode();

  assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);

  for (const char of code.replaceAll('-', '')) {
    assert.ok(ACTIVATION_CODE_CHARS.includes(char), `unexpected char ${char}`);
  }
});

test('generateActivationCode can produce many distinct values without format drift', () => {
  const seen = new Set<string>();

  for (let i = 0; i < 200; i += 1) {
    const code = generateActivationCode();
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    seen.add(code);
  }

  assert.ok(seen.size > 190);
});
