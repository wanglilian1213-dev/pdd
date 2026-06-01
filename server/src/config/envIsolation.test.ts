import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const serverRoot = path.resolve(__dirname, '..', '..');
const envModulePath = path.join(serverRoot, 'src', 'config', 'env.ts');

test('importing parse-only env module does not require real runtime secrets', () => {
  assert.doesNotThrow(() => {
    execFileSync(
      process.execPath,
      ['--import', 'tsx', '-e', `import(${JSON.stringify(envModulePath)});`],
      {
        cwd: serverRoot,
        env: {
          PATH: process.env.PATH || '',
          HOME: process.env.HOME || '',
          TMPDIR: process.env.TMPDIR || '/tmp',
        },
        stdio: 'pipe',
      },
    );
  });
});
