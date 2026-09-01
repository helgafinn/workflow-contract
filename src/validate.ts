import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
} from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { WorkflowContractError } from './errors.js';
import {
  discoverCurrentWorkflowPaths,
  readCurrentWorkflow,
} from './discovery.js';
import {
  extractWorkflowContract,
  isRecord,
  parseWorkflowRoot,
  valueMatchesInputType,
} from './parse.js';
import {
  aggregateKnownPermissionRequests,
  parsePermissionSpec,
  permissionLevelAt,
  permissionRank,
} from './permissions.js';
import type {
  PermissionSpec,
  ValidationIssue,
  WorkflowContract,
} from './types.js';

const LOCAL_WORKFLOW_REFERENCE = /^\.\/(\.github\/workflows\/[^/\\]+\.ya?ml)$/i;
const MAX_WORKFLOW_BYTES = 10 * 1024 * 1024;
const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function issue(
  severity: ValidationIssue['severity'],
  code: string,
  message: string,
  caller: string,
  path: string,
  details: { callee?: string; job?: string } = {},
): ValidationIssue {
  const result: ValidationIssue = { severity, code, message, caller, path };
  if (details.callee !== undefined) {
    result.callee = details.callee;
  }
  if (details.job !== undefined) {
    result.job = details.job;
  }
  return result;
}

function workflowErrorIssue(
  error: unknown,
  caller: string,
  path = 'workflow',
): ValidationIssue {
  if (error instanceof WorkflowContractError) {
    return issue('error', error.code, error.message, caller, path);
  }
  const message = error instanceof Error ? error.message : String(error);
  return issue('error', 'workflow.unexpected-error', message, caller, path);
}

function isDynamicExpression(value: unknown): boolean {
  return typeof value === 'string' && value.includes('${{');
}

function localCalleePath(reference: string): string | null {
  return LOCAL_WORKFLOW_REFERENCE.exec(reference)?.[1] ?? null;
}

function isWithin(parent: string, candidate: string): boolean {
  return candidate === parent || candidate.startsWith(`${parent}${sep}`);
}

function resolveSafeLocalCallee(root: string, calleePath: string): string {
  const canonicalRoot = realpathSync(root);
  const workflowDirectory = resolve(root, '.github/workflows');
  const canonicalWorkflowDirectory = realpathSync(workflowDirectory);
  if (!isWithin(canonicalRoot, canonicalWorkflowDirectory)) {
    throw new WorkflowContractError(
      'caller.unsafe-local-workflow',
      `${calleePath} resolves outside the repository.`,
      { source: calleePath },
    );
  }

  const absoluteCallee = resolve(root, calleePath);
  const stat = lstatSync(absoluteCallee);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new WorkflowContractError(
      'caller.unsafe-local-workflow',
      `${calleePath} must be a regular, non-symlink file.`,
      { source: calleePath },
    );
  }
  if (stat.size > MAX_WORKFLOW_BYTES) {
    throw new WorkflowContractError(
      'caller.workflow-too-large',
      `${calleePath} exceeds the ${MAX_WORKFLOW_BYTES}-byte safety limit.`,
      { source: calleePath },
    );
  }

  const canonicalCallee = realpathSync(absoluteCallee);
  if (dirname(canonicalCallee) !== canonicalWorkflowDirectory) {
    throw new WorkflowContractError(
      'caller.unsafe-local-workflow',
      `${calleePath} does not resolve directly inside .github/workflows.`,
      { source: calleePath },
    );
  }
  return absoluteCallee;
}

function parseCallerPermission(
  rawValue: unknown,
  caller: string,
  path: string,
  issues: ValidationIssue[],
): PermissionSpec | null {
  try {
    return parsePermissionSpec(rawValue, caller, path);
  } catch (error) {
    issues.push(workflowErrorIssue(error, caller, path));
    return null;
  }
}

function validateInputs(
  caller: string,
  calleePath: string,
  jobName: string,
  rawWith: unknown,
  callee: WorkflowContract,
  issues: ValidationIssue[],
): void {
  let provided: Record<string, unknown> = {};
  if (rawWith !== undefined) {
    if (!isRecord(rawWith)) {
      issues.push(
        issue(
          'error',
          'caller.invalid-with',
          `Job "${jobName}" must provide with as a mapping.`,
          caller,
          `jobs.${jobName}.with`,
          { callee: calleePath, job: jobName },
        ),
      );
      return;
    }
    provided = rawWith;
  }

  for (const name of Object.keys(provided).sort((a, b) => a.localeCompare(b))) {
    const definition = callee.inputs[name];
    if (definition === undefined) {
      issues.push(
        issue(
          'error',
          'caller.unknown-input',
          `Job "${jobName}" passes unknown input "${name}" to ${calleePath}.`,
          caller,
          `jobs.${jobName}.with.${name}`,
          { callee: calleePath, job: jobName },
        ),
      );
      continue;
    }
    const value = provided[name];
    if (!isDynamicExpression(value) && !valueMatchesInputType(value, definition.type)) {
      issues.push(
        issue(
          'error',
          'caller.input-type-mismatch',
          `Job "${jobName}" passes a literal ${typeof value} to ${definition.type} input "${name}".`,
          caller,
          `jobs.${jobName}.with.${name}`,
          { callee: calleePath, job: jobName },
        ),
      );
    }
  }

  for (const [name, definition] of Object.entries(callee.inputs)) {
    if (definition.required && !hasOwn(provided, name)) {
      issues.push(
        issue(
          'error',
          'caller.missing-required-input',
          `Job "${jobName}" does not provide required input "${name}" for ${calleePath}.`,
          caller,
          `jobs.${jobName}.with.${name}`,
          { callee: calleePath, job: jobName },
        ),
      );
    }
  }
}

function validateSecrets(
  caller: string,
  calleePath: string,
  jobName: string,
  rawSecrets: unknown,
  callee: WorkflowContract,
  issues: ValidationIssue[],
): void {
  if (rawSecrets === 'inherit') {
    return;
  }

  let provided: Record<string, unknown> = {};
  if (rawSecrets !== undefined) {
    if (!isRecord(rawSecrets)) {
      issues.push(
        issue(
          'error',
          'caller.invalid-secrets',
          `Job "${jobName}" must provide secrets as a mapping or inherit.`,
          caller,
          `jobs.${jobName}.secrets`,
          { callee: calleePath, job: jobName },
        ),
      );
      return;
    }
    provided = rawSecrets;
  }

  for (const name of Object.keys(provided).sort((a, b) => a.localeCompare(b))) {
    if (callee.secrets[name] === undefined) {
      issues.push(
        issue(
          'error',
          'caller.unknown-secret',
          `Job "${jobName}" passes unknown secret "${name}" to ${calleePath}.`,
          caller,
          `jobs.${jobName}.secrets.${name}`,
          { callee: calleePath, job: jobName },
        ),
      );
    }
  }

  for (const [name, definition] of Object.entries(callee.secrets)) {
    if (definition.required && !hasOwn(provided, name)) {
      issues.push(
        issue(
          'error',
          'caller.missing-required-secret',
          `Job "${jobName}" does not provide required secret "${name}" for ${calleePath}.`,
          caller,
          `jobs.${jobName}.secrets.${name}`,
          { callee: calleePath, job: jobName },
        ),
      );
    }
  }
}

function validatePermissions(
  caller: string,
  calleePath: string,
  jobName: string,
  callerPermission: PermissionSpec,
  callee: WorkflowContract,
  issues: ValidationIssue[],
): void {
  if (callerPermission.mode === 'implicit') {
    return;
  }

  const requested = aggregateKnownPermissionRequests(callee.permissions);
  for (const [scope, requestedLevel] of Object.entries(requested)) {
    const allowedLevel = permissionLevelAt(callerPermission, scope);
    if (
      allowedLevel !== undefined &&
      permissionRank(allowedLevel) < permissionRank(requestedLevel)
    ) {
      issues.push(
        issue(
          'error',
          'caller.insufficient-permission',
          `Job "${jobName}" grants ${scope}: ${allowedLevel}, but ${calleePath} effectively requests ${requestedLevel}.`,
          caller,
          `jobs.${jobName}.permissions.${scope}`,
          { callee: calleePath, job: jobName },
        ),
      );
    }
  }
}

export function validateLocalCallers(inputRoot: string): ValidationIssue[] {
  const root = resolve(inputRoot);
  const issues: ValidationIssue[] = [];
  const calleeCache = new Map<string, WorkflowContract | Error>();

  const loadCallee = (path: string): WorkflowContract | Error => {
    const cached = calleeCache.get(path);
    if (cached !== undefined) {
      return cached;
    }
    try {
      const absolute = resolveSafeLocalCallee(root, path);
      const contract = extractWorkflowContract(readFileSync(absolute, 'utf8'), path);
      calleeCache.set(path, contract);
      return contract;
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error));
      calleeCache.set(path, normalizedError);
      return normalizedError;
    }
  };

  for (const caller of discoverCurrentWorkflowPaths(root)) {
    let workflow: Record<string, unknown>;
    try {
      workflow = parseWorkflowRoot(readCurrentWorkflow(root, caller), caller);
    } catch (error) {
      issues.push(workflowErrorIssue(error, caller));
      continue;
    }

    if (!isRecord(workflow.jobs)) {
      continue;
    }

    const workflowPermission = parseCallerPermission(
      workflow.permissions,
      caller,
      'permissions',
      issues,
    );

    for (const [jobName, rawJob] of Object.entries(workflow.jobs)) {
      if (!isRecord(rawJob) || typeof rawJob.uses !== 'string') {
        continue;
      }
      if (!rawJob.uses.startsWith('./')) {
        continue;
      }

      const calleePath = localCalleePath(rawJob.uses);
      if (calleePath === null) {
        issues.push(
          issue(
            'error',
            'caller.invalid-local-reference',
            `Job "${jobName}" must reference a direct ./.github/workflows/*.yml or *.yaml file.`,
            caller,
            `jobs.${jobName}.uses`,
            { callee: rawJob.uses, job: jobName },
          ),
        );
        continue;
      }
      if (!existsSync(resolve(root, calleePath))) {
        issues.push(
          issue(
            'error',
            'caller.missing-local-workflow',
            `Job "${jobName}" references missing local workflow ${calleePath}.`,
            caller,
            `jobs.${jobName}.uses`,
            { callee: calleePath, job: jobName },
          ),
        );
        continue;
      }

      const loaded = loadCallee(calleePath);
      if (loaded instanceof Error) {
        const message = loaded instanceof WorkflowContractError ? loaded.message : loaded.message;
        const code = loaded instanceof WorkflowContractError ? loaded.code : 'callee.invalid';
        issues.push(
          issue(
            'error',
            code,
            `Cannot validate call from job "${jobName}": ${message}`,
            caller,
            `jobs.${jobName}.uses`,
            { callee: calleePath, job: jobName },
          ),
        );
        continue;
      }

      validateInputs(caller, calleePath, jobName, rawJob.with, loaded, issues);
      validateSecrets(caller, calleePath, jobName, rawJob.secrets, loaded, issues);

      let callerPermission = workflowPermission;
      if (hasOwn(rawJob, 'permissions')) {
        callerPermission = parseCallerPermission(
          rawJob.permissions,
          caller,
          `jobs.${jobName}.permissions`,
          issues,
        );
      }
      if (callerPermission !== null) {
        validatePermissions(caller, calleePath, jobName, callerPermission, loaded, issues);
      }
    }
  }

  return issues.sort(
    (left, right) =>
      left.caller.localeCompare(right.caller) ||
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code),
  );
}
