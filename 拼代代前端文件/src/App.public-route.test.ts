import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync('src/App.tsx', 'utf8');

test('public auth pages stay mounted while login or register is submitting', () => {
  const publicRouteSource = source.match(/function PublicOnlyRoute[\s\S]*?function App/)?.[0] || '';

  assert.match(publicRouteSource, /const \{ user, loading \} = useAuth\(\)/);
  assert.match(publicRouteSource, /if \(loading\)/);
  assert.doesNotMatch(publicRouteSource, /authBusy/);
});
