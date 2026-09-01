import {
  aggregatePermissionProfile,
  permissionRank,
} from './permissions.js';
import type {
  ContractChange,
  WorkflowContract,
} from './types.js';

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function unionKeys<T, U>(left: Record<string, T>, right: Record<string, U>): string[] {
  return [...new Set([...Object.keys(left), ...Object.keys(right)])].sort((a, b) =>
    a.localeCompare(b),
  );
}

function compareEffectivePermissions(
  before: WorkflowContract,
  after: WorkflowContract,
): ContractChange[] {
  const oldProfile = aggregatePermissionProfile(before.permissions);
  const newProfile = aggregatePermissionProfile(after.permissions);
  if (sameValue(oldProfile, newProfile)) {
    return [];
  }

  if (oldProfile.hasImplicit || newProfile.hasImplicit) {
    return [
      {
        code: 'permission.implicit-changed',
        severity: 'warning',
        path: 'permissions',
        message:
          'Effective permissions changed while at least one job relies on GitHub defaults; the change cannot be ranked safely.',
        before: oldProfile,
        after: newProfile,
      },
    ];
  }

  const increased: string[] = [];
  const decreased: string[] = [];
  for (const scope of unionKeys(oldProfile.levels, newProfile.levels)) {
    const oldLevel = oldProfile.levels[scope] ?? 'none';
    const newLevel = newProfile.levels[scope] ?? 'none';
    const difference = permissionRank(newLevel) - permissionRank(oldLevel);
    if (difference > 0) {
      increased.push(`${scope} (${oldLevel} → ${newLevel})`);
    } else if (difference < 0) {
      decreased.push(`${scope} (${oldLevel} → ${newLevel})`);
    }
  }

  const changes: ContractChange[] = [];
  if (increased.length > 0) {
    changes.push({
      code: 'permission.request-increased',
      severity: 'breaking',
      path: 'permissions',
      message: `Effective permission requests increased: ${increased.join(', ')}.`,
      before: oldProfile,
      after: newProfile,
    });
  }
  if (decreased.length > 0) {
    changes.push({
      code: 'permission.request-decreased',
      severity: 'warning',
      path: 'permissions',
      message: `Effective permission requests decreased: ${decreased.join(', ')}.`,
      before: oldProfile,
      after: newProfile,
    });
  }
  if (changes.length === 0) {
    changes.push({
      code: 'permission.mode-changed',
      severity: 'warning',
      path: 'permissions',
      message:
        'Effective permission wildcard behavior changed and may affect permission scopes GitHub adds in the future.',
      before: oldProfile,
      after: newProfile,
    });
  }
  return changes;
}

export function diffContracts(
  before: WorkflowContract,
  after: WorkflowContract,
): ContractChange[] {
  const changes: ContractChange[] = [];

  for (const name of unionKeys(before.inputs, after.inputs)) {
    const oldInput = before.inputs[name];
    const newInput = after.inputs[name];
    const path = `inputs.${name}`;

    if (oldInput !== undefined && newInput === undefined) {
      changes.push({
        code: 'input.removed',
        severity: 'breaking',
        path,
        message: `Input "${name}" was removed.`,
        before: oldInput,
      });
      continue;
    }
    if (oldInput === undefined && newInput !== undefined) {
      changes.push({
        code: newInput.required ? 'input.required-added' : 'input.optional-added',
        severity: newInput.required ? 'breaking' : 'info',
        path,
        message: `${newInput.required ? 'Required' : 'Optional'} input "${name}" was added.`,
        after: newInput,
      });
      continue;
    }
    if (oldInput === undefined || newInput === undefined) {
      continue;
    }

    if (oldInput.type !== newInput.type) {
      changes.push({
        code: 'input.type-changed',
        severity: 'breaking',
        path: `${path}.type`,
        message: `Input "${name}" changed type from ${oldInput.type} to ${newInput.type}.`,
        before: oldInput.type,
        after: newInput.type,
      });
    }
    if (oldInput.required !== newInput.required) {
      changes.push({
        code: newInput.required ? 'input.became-required' : 'input.became-optional',
        severity: newInput.required ? 'breaking' : 'info',
        path: `${path}.required`,
        message: `Input "${name}" became ${newInput.required ? 'required' : 'optional'}.`,
        before: oldInput.required,
        after: newInput.required,
      });
    }

    const oldHasDefault = hasOwn(oldInput, 'default');
    const newHasDefault = hasOwn(newInput, 'default');
    if (
      oldHasDefault !== newHasDefault ||
      (oldHasDefault && newHasDefault && !sameValue(oldInput.default, newInput.default))
    ) {
      changes.push({
        code: 'input.default-changed',
        severity: 'warning',
        path: `${path}.default`,
        message: `Input "${name}" changed its default value.`,
        before: oldInput.default,
        after: newInput.default,
      });
    }
  }

  for (const name of unionKeys(before.secrets, after.secrets)) {
    const oldSecret = before.secrets[name];
    const newSecret = after.secrets[name];
    const path = `secrets.${name}`;

    if (oldSecret !== undefined && newSecret === undefined) {
      changes.push({
        code: 'secret.removed',
        severity: 'breaking',
        path,
        message: `Secret "${name}" was removed.`,
        before: oldSecret,
      });
      continue;
    }
    if (oldSecret === undefined && newSecret !== undefined) {
      changes.push({
        code: newSecret.required ? 'secret.required-added' : 'secret.optional-added',
        severity: newSecret.required ? 'breaking' : 'info',
        path,
        message: `${newSecret.required ? 'Required' : 'Optional'} secret "${name}" was added.`,
        after: newSecret,
      });
      continue;
    }
    if (oldSecret === undefined || newSecret === undefined) {
      continue;
    }
    if (oldSecret.required !== newSecret.required) {
      changes.push({
        code: newSecret.required ? 'secret.became-required' : 'secret.became-optional',
        severity: newSecret.required ? 'breaking' : 'info',
        path: `${path}.required`,
        message: `Secret "${name}" became ${newSecret.required ? 'required' : 'optional'}.`,
        before: oldSecret.required,
        after: newSecret.required,
      });
    }
  }

  for (const name of unionKeys(before.outputs, after.outputs)) {
    const oldOutput = before.outputs[name];
    const newOutput = after.outputs[name];
    const path = `outputs.${name}`;

    if (oldOutput !== undefined && newOutput === undefined) {
      changes.push({
        code: 'output.removed',
        severity: 'breaking',
        path,
        message: `Output "${name}" was removed.`,
        before: oldOutput,
      });
      continue;
    }
    if (oldOutput === undefined && newOutput !== undefined) {
      changes.push({
        code: 'output.added',
        severity: 'info',
        path,
        message: `Output "${name}" was added.`,
        after: newOutput,
      });
      continue;
    }
    if (oldOutput === undefined || newOutput === undefined) {
      continue;
    }
    if (oldOutput.value !== newOutput.value) {
      changes.push({
        code: 'output.value-changed',
        severity: 'warning',
        path: `${path}.value`,
        message: `Output "${name}" changed its value expression.`,
        before: oldOutput.value,
        after: newOutput.value,
      });
    }
  }

  changes.push(...compareEffectivePermissions(before, after));

  if (before.name !== after.name) {
    changes.push({
      code: 'workflow.name-changed',
      severity: 'info',
      path: 'name',
      message: 'Workflow display name changed.',
      before: before.name,
      after: after.name,
    });
  }

  const order: Record<ContractChange['severity'], number> = {
    breaking: 0,
    warning: 1,
    info: 2,
  };
  return changes.sort(
    (left, right) =>
      order[left.severity] - order[right.severity] ||
      left.path.localeCompare(right.path) ||
      left.code.localeCompare(right.code),
  );
}
