import { parseDocument } from 'yaml';
import { NotReusableWorkflowError, WorkflowContractError } from './errors.js';
import { parsePermissionSpec } from './permissions.js';
import {
  CONTRACT_SCHEMA_VERSION,
  type WorkflowContract,
  type WorkflowInputContract,
  type WorkflowInputDefault,
  type WorkflowInputType,
  type WorkflowOutputContract,
  type WorkflowSecretContract,
} from './types.js';

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortRecord<T>(record: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

function optionalString(
  value: unknown,
  source: string,
  path: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new WorkflowContractError(
      'workflow.invalid-string',
      `${source}: ${path} must be a string.`,
      { source },
    );
  }
  return value;
}

function requiredFlag(value: unknown, source: string, path: string): boolean {
  if (value === undefined) {
    return false;
  }
  if (typeof value !== 'boolean') {
    throw new WorkflowContractError(
      'workflow.invalid-required',
      `${source}: ${path} must be true or false.`,
      { source },
    );
  }
  return value;
}

function parseInputType(value: unknown, source: string, path: string): WorkflowInputType {
  if (value !== 'boolean' && value !== 'number' && value !== 'string') {
    throw new WorkflowContractError(
      'input.invalid-type',
      `${source}: ${path} must be boolean, number, or string.`,
      { source },
    );
  }
  return value;
}

export function valueMatchesInputType(value: unknown, type: WorkflowInputType): boolean {
  switch (type) {
    case 'boolean':
      return typeof value === 'boolean';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'string':
      return typeof value === 'string';
  }
}

export function parseWorkflowRoot(sourceText: string, source: string): Record<string, unknown> {
  const document = parseDocument(sourceText, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });

  if (document.errors.length > 0) {
    const details = document.errors.map((error) => error.message).join('; ');
    throw new WorkflowContractError(
      'yaml.invalid',
      `${source}: invalid YAML: ${details}`,
      { source },
    );
  }

  const value: unknown = document.toJS();
  if (!isRecord(value)) {
    throw new WorkflowContractError(
      'workflow.invalid-root',
      `${source}: workflow root must be a mapping.`,
      { source },
    );
  }
  return value;
}

function workflowCallConfig(
  root: Record<string, unknown>,
  source: string,
): Record<string, unknown> {
  const trigger = root.on;

  if (trigger === 'workflow_call') {
    return {};
  }
  if (Array.isArray(trigger) && trigger.includes('workflow_call')) {
    return {};
  }
  if (!isRecord(trigger) || !hasOwn(trigger, 'workflow_call')) {
    throw new NotReusableWorkflowError(source);
  }

  const config = trigger.workflow_call;
  if (config === null || config === undefined) {
    return {};
  }
  if (!isRecord(config)) {
    throw new WorkflowContractError(
      'workflow.invalid-workflow-call',
      `${source}: on.workflow_call must be empty or a mapping.`,
      { source },
    );
  }
  return config;
}

function definitions(
  value: unknown,
  source: string,
  path: string,
): Record<string, unknown> {
  if (value === undefined || value === null) {
    return {};
  }
  if (!isRecord(value)) {
    throw new WorkflowContractError(
      'workflow.invalid-definitions',
      `${source}: ${path} must be a mapping.`,
      { source },
    );
  }
  return value;
}

function parseInputs(value: unknown, source: string): Record<string, WorkflowInputContract> {
  const result: Record<string, WorkflowInputContract> = {};
  for (const [name, rawDefinition] of Object.entries(definitions(value, source, 'on.workflow_call.inputs'))) {
    if (!isRecord(rawDefinition)) {
      throw new WorkflowContractError(
        'input.invalid-definition',
        `${source}: input ${name} must be a mapping.`,
        { source },
      );
    }

    const type = parseInputType(rawDefinition.type, source, `on.workflow_call.inputs.${name}.type`);
    const input: WorkflowInputContract = {
      type,
      required: requiredFlag(
        rawDefinition.required,
        source,
        `on.workflow_call.inputs.${name}.required`,
      ),
    };

    const description = optionalString(
      rawDefinition.description,
      source,
      `on.workflow_call.inputs.${name}.description`,
    );
    if (description !== undefined) {
      input.description = description;
    }

    if (hasOwn(rawDefinition, 'default')) {
      if (!valueMatchesInputType(rawDefinition.default, type)) {
        throw new WorkflowContractError(
          'input.invalid-default',
          `${source}: default for input ${name} must match its ${type} type.`,
          { source },
        );
      }
      input.default = rawDefinition.default as WorkflowInputDefault;
    }

    result[name] = input;
  }
  return sortRecord(result);
}

function parseSecrets(value: unknown, source: string): Record<string, WorkflowSecretContract> {
  const result: Record<string, WorkflowSecretContract> = {};
  for (const [name, rawDefinition] of Object.entries(definitions(value, source, 'on.workflow_call.secrets'))) {
    if (rawDefinition !== null && !isRecord(rawDefinition)) {
      throw new WorkflowContractError(
        'secret.invalid-definition',
        `${source}: secret ${name} must be a mapping.`,
        { source },
      );
    }
    const definition = rawDefinition ?? {};
    const secret: WorkflowSecretContract = {
      required: requiredFlag(
        definition.required,
        source,
        `on.workflow_call.secrets.${name}.required`,
      ),
    };
    const description = optionalString(
      definition.description,
      source,
      `on.workflow_call.secrets.${name}.description`,
    );
    if (description !== undefined) {
      secret.description = description;
    }
    result[name] = secret;
  }
  return sortRecord(result);
}

function parseOutputs(value: unknown, source: string): Record<string, WorkflowOutputContract> {
  const result: Record<string, WorkflowOutputContract> = {};
  for (const [name, rawDefinition] of Object.entries(definitions(value, source, 'on.workflow_call.outputs'))) {
    if (!isRecord(rawDefinition)) {
      throw new WorkflowContractError(
        'output.invalid-definition',
        `${source}: output ${name} must be a mapping.`,
        { source },
      );
    }
    const output: WorkflowOutputContract = {};
    const description = optionalString(
      rawDefinition.description,
      source,
      `on.workflow_call.outputs.${name}.description`,
    );
    const outputValue = optionalString(
      rawDefinition.value,
      source,
      `on.workflow_call.outputs.${name}.value`,
    );
    if (description !== undefined) {
      output.description = description;
    }
    if (outputValue !== undefined) {
      output.value = outputValue;
    }
    result[name] = output;
  }
  return sortRecord(result);
}

export function extractWorkflowContract(sourceText: string, source: string): WorkflowContract {
  const root = parseWorkflowRoot(sourceText, source);
  const call = workflowCallConfig(root, source);
  const workflowPermission = parsePermissionSpec(root.permissions, source, 'permissions');
  const jobs: Record<string, ReturnType<typeof parsePermissionSpec>> = {};

  if (isRecord(root.jobs)) {
    for (const [jobName, rawJob] of Object.entries(root.jobs)) {
      if (!isRecord(rawJob)) {
        continue;
      }
      jobs[jobName] = hasOwn(rawJob, 'permissions')
        ? parsePermissionSpec(rawJob.permissions, source, `jobs.${jobName}.permissions`)
        : { mode: workflowPermission.mode, scopes: { ...workflowPermission.scopes } };
    }
  }

  const contract: WorkflowContract = {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    source,
    inputs: parseInputs(call.inputs, source),
    secrets: parseSecrets(call.secrets, source),
    outputs: parseOutputs(call.outputs, source),
    permissions: {
      workflow: workflowPermission,
      jobs: sortRecord(jobs),
    },
  };

  if (typeof root.name === 'string') {
    contract.name = root.name;
  }
  return contract;
}

export function tryExtractWorkflowContract(
  sourceText: string,
  source: string,
): WorkflowContract | null {
  try {
    return extractWorkflowContract(sourceText, source);
  } catch (error) {
    if (error instanceof NotReusableWorkflowError) {
      return null;
    }
    throw error;
  }
}

export function serializeContract(contract: WorkflowContract): string {
  return `${JSON.stringify(contract, null, 2)}\n`;
}
