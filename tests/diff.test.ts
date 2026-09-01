import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { diffContracts } from '../src/diff.js';
import { extractWorkflowContract } from '../src/parse.js';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/contracts');

function contract(name: string) {
  return extractWorkflowContract(readFileSync(resolve(fixtures, name), 'utf8'), name);
}

test('classifies public interface removals and requirement increases as breaking', () => {
  const changes = diffContracts(contract('base.yml'), contract('breaking.yml'));
  const codes = new Set(changes.map((change) => change.code));

  assert.ok(codes.has('input.type-changed'));
  assert.ok(codes.has('input.removed'));
  assert.ok(codes.has('input.required-added'));
  assert.ok(codes.has('secret.removed'));
  assert.ok(codes.has('secret.required-added'));
  assert.ok(codes.has('output.removed'));
  assert.ok(codes.has('permission.request-increased'));
  assert.ok(changes.some((change) => change.severity === 'breaking'));
});

test('keeps additive optional changes compatible under the breaking policy', () => {
  const changes = diffContracts(contract('base.yml'), contract('compatible.yml'));
  const codes = new Set(changes.map((change) => change.code));

  assert.ok(codes.has('input.optional-added'));
  assert.ok(codes.has('input.became-optional'));
  assert.ok(codes.has('input.default-changed'));
  assert.ok(codes.has('secret.optional-added'));
  assert.ok(codes.has('output.added'));
  assert.equal(changes.some((change) => change.severity === 'breaking'), false);
});

test('applies workflow-level permissions to jobs when an override is removed', () => {
  const before = extractWorkflowContract(`
on: workflow_call
permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps: []
`, 'before.yml');
  const after = extractWorkflowContract(`
on: workflow_call
permissions:
  contents: write
jobs:
  build:
    runs-on: ubuntu-latest
    steps: []
`, 'after.yml');

  const increase = diffContracts(before, after);
  assert.ok(
    increase.some(
      (change) =>
        change.code === 'permission.request-increased' &&
        change.severity === 'breaking' &&
        change.message.includes('contents (read → write)'),
    ),
  );

  const decrease = diffContracts(after, before);
  assert.ok(
    decrease.some(
      (change) =>
        change.code === 'permission.request-decreased' &&
        change.severity === 'warning' &&
        change.message.includes('contents (write → read)'),
    ),
  );
});
