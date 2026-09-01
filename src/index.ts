export { runCheck, runFileDiff, runValidation, reportFails } from './check.js';
export { diffContracts } from './diff.js';
export { WorkflowContractError, NotReusableWorkflowError } from './errors.js';
export { formatGitHub, formatPretty, formatReport } from './format.js';
export {
  extractWorkflowContract,
  serializeContract,
  tryExtractWorkflowContract,
} from './parse.js';
export type {
  ChangeSeverity,
  CheckOptions,
  CheckReport,
  ContractChange,
  FailOn,
  OutputFormat,
  PermissionLevel,
  PermissionSpec,
  ValidationIssue,
  WorkflowContract,
  WorkflowInputContract,
  WorkflowInputType,
  WorkflowOutputContract,
  WorkflowSecretContract,
} from './types.js';
export { VERSION } from './version.js';
