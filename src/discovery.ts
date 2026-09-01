import { execFileSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { WorkflowContractError } from './errors.js';

const WORKFLOW_DIRECTORY = '.github/workflows';
const WORKFLOW_FILE_NAME = /^[^/\\]+\.ya?ml$/i;
const WORKFLOW_PATH = /^\.github\/workflows\/[^/]+\.ya?ml$/i;
const MAX_WORKFLOW_BYTES = 10 * 1024 * 1024;

export function normalizeWorkflowPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function resolveGitRoot(inputRoot: string): string {
  try {
    return execFileSync('git', ['-C', resolve(inputRoot), 'rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new WorkflowContractError(
      'git.root-not-found',
      `${resolve(inputRoot)} is not inside a Git repository.`,
      { cause: error },
    );
  }
}

export function validateGitRevision(revision: string): void {
  if (revision.length === 0 || revision.startsWith('-') || revision.includes('\0')) {
    throw new WorkflowContractError(
      'git.invalid-revision',
      `Invalid Git revision: ${JSON.stringify(revision)}.`,
    );
  }
}

export function assertGitRevision(root: string, revision: string): void {
  validateGitRevision(revision);
  try {
    execFileSync('git', ['-C', root, 'cat-file', '-e', `${revision}^{commit}`], {
      stdio: 'ignore',
    });
  } catch (error) {
    throw new WorkflowContractError(
      'git.revision-not-found',
      `Git revision "${revision}" could not be resolved. Fetch it or pass a commit that exists locally.`,
      { cause: error },
    );
  }
}

export function discoverCurrentWorkflowPaths(root: string): string[] {
  const directory = resolve(root, WORKFLOW_DIRECTORY);
  if (!existsSync(directory)) {
    return [];
  }
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && WORKFLOW_FILE_NAME.test(entry.name))
    .map((entry) => `${WORKFLOW_DIRECTORY}/${entry.name}`)
    .sort((left, right) => left.localeCompare(right));
}

export function discoverWorkflowPathsAtRevision(root: string, revision: string): string[] {
  assertGitRevision(root, revision);
  try {
    const output = execFileSync(
      'git',
      ['-C', root, 'ls-tree', '-rz', revision, '--', WORKFLOW_DIRECTORY],
      {
        encoding: 'utf8',
        maxBuffer: MAX_WORKFLOW_BYTES,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );

    const paths: string[] = [];
    for (const entry of output.split('\0')) {
      if (entry.length === 0) {
        continue;
      }
      const separator = entry.indexOf('\t');
      if (separator === -1) {
        continue;
      }
      const [mode, type] = entry.slice(0, separator).split(' ');
      const path = normalizeWorkflowPath(entry.slice(separator + 1));
      const isRegularBlob =
        type === 'blob' && (mode === '100644' || mode === '100755');
      if (isRegularBlob && WORKFLOW_PATH.test(path)) {
        paths.push(path);
      }
    }
    return paths.sort((left, right) => left.localeCompare(right));
  } catch (error) {
    throw new WorkflowContractError(
      'git.list-failed',
      `Could not list workflows at Git revision "${revision}".`,
      { cause: error },
    );
  }
}

export function readCurrentWorkflow(root: string, path: string): string {
  const normalized = normalizeWorkflowPath(path);
  try {
    const absolute = resolve(root, normalized);
    const stat = lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error('workflow is not a regular file');
    }
    if (stat.size > MAX_WORKFLOW_BYTES) {
      throw new Error(`workflow exceeds ${MAX_WORKFLOW_BYTES} bytes`);
    }
    return readFileSync(absolute, 'utf8');
  } catch (error) {
    throw new WorkflowContractError(
      'workflow.read-failed',
      `Could not safely read ${normalized}.`,
      { source: normalized, cause: error },
    );
  }
}

export function readWorkflowAtRevision(
  root: string,
  revision: string,
  path: string,
): string {
  const normalized = normalizeWorkflowPath(path);
  try {
    return execFileSync('git', ['-C', root, 'show', `${revision}:${normalized}`], {
      encoding: 'utf8',
      maxBuffer: MAX_WORKFLOW_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    throw new WorkflowContractError(
      'git.read-failed',
      `Could not read ${normalized} at Git revision "${revision}".`,
      { source: normalized, cause: error },
    );
  }
}
