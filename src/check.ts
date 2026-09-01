import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { diffContracts } from './diff.js';
import {
  discoverCurrentWorkflowPaths,
  discoverWorkflowPathsAtRevision,
  normalizeWorkflowPath,
  readCurrentWorkflow,
  readWorkflowAtRevision,
  resolveGitRoot,
} from './discovery.js';
import { WorkflowContractError } from './errors.js';
import { extractWorkflowContract, tryExtractWorkflowContract } from './parse.js';
import {
  CONTRACT_SCHEMA_VERSION,
  type CheckOptions,
  type CheckReport,
  type CheckSummary,
  type ContractChange,
  type FailOn,
  type WorkflowComparison,
} from './types.js';
import { validateLocalCallers } from './validate.js';

function unionPaths(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])].sort((a, b) => a.localeCompare(b));
}

function summarize(
  comparisons: WorkflowComparison[],
  validationIssues: CheckReport['validationIssues'],
): CheckSummary {
  const changes = comparisons.flatMap((comparison) => comparison.changes);
  return {
    workflows: comparisons.length,
    breakingChanges: changes.filter((change) => change.severity === 'breaking').length,
    warnings:
      changes.filter((change) => change.severity === 'warning').length +
      validationIssues.filter((issue) => issue.severity === 'warning').length,
    information: changes.filter((change) => change.severity === 'info').length,
    validationErrors: validationIssues.filter((issue) => issue.severity === 'error').length,
  };
}

export function createReport(
  root: string,
  base: string | null,
  comparisons: WorkflowComparison[],
  validationIssues: CheckReport['validationIssues'],
): CheckReport {
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    root,
    base,
    comparisons,
    validationIssues,
    summary: summarize(comparisons, validationIssues),
  };
}

function workflowAdded(path: string): ContractChange {
  return {
    code: 'workflow.added',
    severity: 'info',
    path: 'workflow',
    message: `Reusable workflow ${path} was added.`,
  };
}

function workflowRemoved(path: string): ContractChange {
  return {
    code: 'workflow.removed',
    severity: 'breaking',
    path: 'workflow',
    message: `Reusable workflow ${path} was removed or no longer accepts workflow_call.`,
  };
}

export function runCheck(options: CheckOptions): CheckReport {
  const root = resolveGitRoot(options.root ?? process.cwd());
  const currentPaths = discoverCurrentWorkflowPaths(root);
  const basePaths = discoverWorkflowPathsAtRevision(root, options.base);
  const selectedPaths = [
    ...new Set(options.paths?.map(normalizeWorkflowPath) ?? []),
  ];
  const selected = new Set(selectedPaths);
  const availablePaths = unionPaths(basePaths, currentPaths);
  const unmatched = selectedPaths.filter((path) => !availablePaths.includes(path));
  if (unmatched.length > 0) {
    throw new WorkflowContractError(
      'workflow.path-not-found',
      `Selected workflow path${unmatched.length === 1 ? '' : 's'} not found at the base or working tree: ${unmatched.join(', ')}.`,
    );
  }
  const paths = availablePaths.filter(
    (path) => selected.size === 0 || selected.has(path),
  );

  const comparisons: WorkflowComparison[] = [];
  const currentSet = new Set(currentPaths);
  const baseSet = new Set(basePaths);

  for (const path of paths) {
    const before = baseSet.has(path)
      ? tryExtractWorkflowContract(
          readWorkflowAtRevision(root, options.base, path),
          `${path}@${options.base}`,
        )
      : null;
    const after = currentSet.has(path)
      ? tryExtractWorkflowContract(readCurrentWorkflow(root, path), path)
      : null;

    if (before === null && after === null) {
      continue;
    }
    if (before === null && after !== null) {
      comparisons.push({ path, status: 'added', changes: [workflowAdded(path)] });
      continue;
    }
    if (before !== null && after === null) {
      comparisons.push({ path, status: 'removed', changes: [workflowRemoved(path)] });
      continue;
    }
    if (before === null || after === null) {
      continue;
    }

    const changes = diffContracts(before, after);
    comparisons.push({
      path,
      status: changes.length === 0 ? 'unchanged' : 'modified',
      changes,
    });
  }

  const validationIssues =
    options.validateCallers === false ? [] : validateLocalCallers(root);
  return createReport(root, options.base, comparisons, validationIssues);
}

export function runFileDiff(beforeFile: string, afterFile: string): CheckReport {
  const beforePath = resolve(beforeFile);
  const afterPath = resolve(afterFile);
  const before = extractWorkflowContract(readFileSync(beforePath, 'utf8'), beforeFile);
  const after = extractWorkflowContract(readFileSync(afterPath, 'utf8'), afterFile);
  const changes = diffContracts(before, after);
  const comparison: WorkflowComparison = {
    path: afterFile,
    status: changes.length === 0 ? 'unchanged' : 'modified',
    changes,
  };
  return createReport(process.cwd(), beforeFile, [comparison], []);
}

export function runValidation(inputRoot = process.cwd()): CheckReport {
  const root = resolve(inputRoot);
  const issues = validateLocalCallers(root);
  return createReport(root, null, [], issues);
}

export function reportFails(report: CheckReport, failOn: FailOn): boolean {
  if (failOn === 'never') {
    return false;
  }
  const hardFailure =
    report.summary.breakingChanges > 0 || report.summary.validationErrors > 0;
  if (failOn === 'breaking') {
    return hardFailure;
  }
  return hardFailure || report.summary.warnings > 0;
}
