export class WorkflowContractError extends Error {
  readonly code: string;
  readonly source: string | undefined;

  constructor(
    code: string,
    message: string,
    options: { source?: string; cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'WorkflowContractError';
    this.code = code;
    this.source = options.source;
  }
}

export class NotReusableWorkflowError extends WorkflowContractError {
  constructor(source: string) {
    super('workflow.not-reusable', `${source} is not triggered by workflow_call.`, { source });
    this.name = 'NotReusableWorkflowError';
  }
}

export class UsageError extends WorkflowContractError {
  constructor(message: string) {
    super('cli.usage', message);
    this.name = 'UsageError';
  }
}
