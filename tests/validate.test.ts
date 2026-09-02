import { strict as assert } from 'node:assert';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateLocalCallers } from '../src/validate.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/callers');

test('validates local caller inputs, secrets, literal types, and permission caps', () => {
  const issues = validateLocalCallers(root);
  const codes = new Set(issues.map((item) => item.code));

  assert.ok(codes.has('caller.unknown-input'));
  assert.ok(codes.has('caller.input-type-mismatch'));
  assert.ok(codes.has('caller.missing-required-input'));
  assert.ok(codes.has('caller.unknown-secret'));
  assert.ok(codes.has('caller.missing-required-secret'));
  assert.ok(codes.has('caller.insufficient-permission'));
  assert.ok(issues.every((item) => item.caller.endsWith('invalid.yml')));
});

test('uses effective job permissions instead of combining an overridden workflow default', (context) => {
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'workflow-contract-permissions-'));
  context.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const workflows = resolve(temporaryRoot, '.github/workflows');
  mkdirSync(workflows, { recursive: true });

  writeFileSync(
    resolve(workflows, 'called.yml'),
    `
on: workflow_call
permissions:
  contents: write
jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps: []
`,
    'utf8',
  );
  writeFileSync(
    resolve(workflows, 'caller.yml'),
    `
on: pull_request
jobs:
  deploy:
    uses: ./.github/workflows/called.yml
    permissions:
      contents: read
`,
    'utf8',
  );

  const issues = validateLocalCallers(temporaryRoot);
  assert.equal(
    issues.some((item) => item.code === 'caller.insufficient-permission'),
    false,
  );
});

test('rejects traversal and symlink local workflow references before reading them', (context) => {
  const temporaryRoot = mkdtempSync(resolve(tmpdir(), 'workflow-contract-paths-'));
  context.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const workflows = resolve(temporaryRoot, '.github/workflows');
  mkdirSync(workflows, { recursive: true });

  const outside = resolve(temporaryRoot, 'outside.yml');
  writeFileSync(outside, 'on: workflow_call\njobs: {}\n', 'utf8');
  symlinkSync(outside, resolve(workflows, 'linked.yml'));
  writeFileSync(
    resolve(workflows, 'caller.yml'),
    `
on: pull_request
jobs:
  traversal:
    uses: ./.github/workflows/../../outside.yml
  linked:
    uses: ./.github/workflows/linked.yml
`,
    'utf8',
  );

  const issues = validateLocalCallers(temporaryRoot);
  const codes = new Set(issues.map((item) => item.code));
  assert.ok(codes.has('caller.invalid-local-reference'));
  assert.ok(codes.has('caller.unsafe-local-workflow'));
});
