import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isEntryModule } from '../src/cli.js';

const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli.ts');

test('recognizes an npm-style symlink as the CLI entry module', (context) => {
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'workflow-contract-cli-'));
  context.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const linkedEntry = resolve(temporaryRoot, 'workflow-contract');
  symlinkSync(cliPath, linkedEntry);

  assert.equal(isEntryModule(pathToFileURL(cliPath).href, linkedEntry), true);
});
