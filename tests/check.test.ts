import { strict as assert } from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runCheck } from '../src/check.js';
import { WorkflowContractError } from '../src/errors.js';

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/contracts');

const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_NAME: 'workflow-contract test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'workflow-contract test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
};

function git(root: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: root, env: gitEnvironment, stdio: 'ignore' });
}

test('compares a Git base revision against the working tree', (context) => {
  const root = mkdtempSync(resolve(tmpdir(), 'workflow-contract-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));

  const workflowDirectory = resolve(root, '.github/workflows');
  mkdirSync(workflowDirectory, { recursive: true });
  cpSync(resolve(fixtures, 'base.yml'), resolve(workflowDirectory, 'deploy.yml'));

  git(root, 'init', '-b', 'main');
  git(root, 'add', '.github/workflows/deploy.yml');
  git(root, 'commit', '-m', 'base workflow');

  writeFileSync(
    resolve(workflowDirectory, 'deploy.yml'),
    readFileSync(resolve(fixtures, 'breaking.yml'), 'utf8'),
    'utf8',
  );

  const report = runCheck({ base: 'HEAD', root, validateCallers: false });

  assert.equal(report.comparisons.length, 1);
  assert.equal(report.comparisons[0]?.status, 'modified');
  assert.ok(report.summary.breakingChanges >= 1);
  assert.equal(report.summary.validationErrors, 0);

  assert.throws(
    () =>
      runCheck({
        base: 'HEAD',
        root,
        paths: ['.github/workflows/typo.yml'],
        validateCallers: false,
      }),
    (error: unknown) =>
      error instanceof WorkflowContractError && error.code === 'workflow.path-not-found',
  );
});
