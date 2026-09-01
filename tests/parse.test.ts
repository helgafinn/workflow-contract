import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { WorkflowContractError } from '../src/errors.js';
import { extractWorkflowContract } from '../src/parse.js';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/contracts');

function fixture(name: string): string {
  return readFileSync(resolve(fixtures, name), 'utf8');
}

test('extracts a stable workflow_call contract', () => {
  const contract = extractWorkflowContract(fixture('base.yml'), 'base.yml');

  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.name, 'Deploy application');
  assert.deepEqual(Object.keys(contract.inputs), ['environment', 'retries']);
  assert.deepEqual(contract.inputs.environment, {
    type: 'string',
    required: true,
    description: 'Deployment environment',
  });
  assert.equal(contract.inputs.retries?.default, 2);
  assert.equal(contract.secrets.azure_credentials?.required, true);
  assert.equal(contract.outputs.deployment_url?.value, '${{ jobs.deploy.outputs.url }}');
  assert.deepEqual(contract.permissions.workflow.scopes, {
    contents: 'read',
    'id-token': 'write',
  });
  assert.deepEqual(contract.permissions.jobs.deploy?.scopes, {
    contents: 'read',
    'id-token': 'write',
  });
});

test('accepts the compact on: workflow_call form', () => {
  const contract = extractWorkflowContract('on: workflow_call\njobs: {}\n', 'compact.yml');
  assert.deepEqual(contract.inputs, {});
  assert.deepEqual(contract.secrets, {});
  assert.deepEqual(contract.outputs, {});
});

test('rejects a default that does not match the declared input type', () => {
  const source = `
on:
  workflow_call:
    inputs:
      enabled:
        type: boolean
        default: yes
jobs: {}
`;

  assert.throws(
    () => extractWorkflowContract(source, 'invalid.yml'),
    (error: unknown) =>
      error instanceof WorkflowContractError && error.code === 'input.invalid-default',
  );
});
