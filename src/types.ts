export const CONTRACT_SCHEMA_VERSION = 1 as const;

export type WorkflowInputType = 'boolean' | 'number' | 'string';
export type WorkflowInputDefault = boolean | number | string;

export interface WorkflowInputContract {
  type: WorkflowInputType;
  required: boolean;
  description?: string;
  default?: WorkflowInputDefault;
}

export interface WorkflowSecretContract {
  required: boolean;
  description?: string;
}

export interface WorkflowOutputContract {
  description?: string;
  value?: string;
}

export type PermissionLevel = 'none' | 'read' | 'write';
export type PermissionMode = 'implicit' | 'explicit' | 'read-all' | 'write-all';

export interface PermissionSpec {
  mode: PermissionMode;
  scopes: Record<string, PermissionLevel>;
}

export interface WorkflowPermissionsContract {
  workflow: PermissionSpec;
  /** Every job mapped to its effective permissions after workflow-level inheritance. */
  jobs: Record<string, PermissionSpec>;
}

export interface WorkflowContract {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  source: string;
  name?: string;
  inputs: Record<string, WorkflowInputContract>;
  secrets: Record<string, WorkflowSecretContract>;
  outputs: Record<string, WorkflowOutputContract>;
  permissions: WorkflowPermissionsContract;
}

export type ChangeSeverity = 'breaking' | 'warning' | 'info';

export interface ContractChange {
  code: string;
  severity: ChangeSeverity;
  path: string;
  message: string;
  before?: unknown;
  after?: unknown;
}

export type ValidationSeverity = 'error' | 'warning';

export interface ValidationIssue {
  code: string;
  severity: ValidationSeverity;
  message: string;
  caller: string;
  path: string;
  callee?: string;
  job?: string;
}

export type ComparisonStatus = 'added' | 'removed' | 'modified' | 'unchanged';

export interface WorkflowComparison {
  path: string;
  status: ComparisonStatus;
  changes: ContractChange[];
}

export interface CheckSummary {
  workflows: number;
  breakingChanges: number;
  warnings: number;
  information: number;
  validationErrors: number;
}

export interface CheckReport {
  schemaVersion: typeof CONTRACT_SCHEMA_VERSION;
  root: string;
  base: string | null;
  comparisons: WorkflowComparison[];
  validationIssues: ValidationIssue[];
  summary: CheckSummary;
}

export type OutputFormat = 'pretty' | 'json' | 'github';
export type FailOn = 'breaking' | 'warning' | 'never';

export interface CheckOptions {
  base: string;
  root?: string;
  paths?: string[];
  validateCallers?: boolean;
}
