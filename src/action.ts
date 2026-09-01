import * as core from '@actions/core';
import { readFileSync } from 'node:fs';
import { reportFails, runCheck } from './check.js';
import type {
  CheckReport,
  ContractChange,
  FailOn,
  ValidationIssue,
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function eventBaseRevision(): string | undefined {
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (eventPath === undefined || eventPath.length === 0) {
    return undefined;
  }

  const payload: unknown = JSON.parse(readFileSync(eventPath, 'utf8'));
  if (!isRecord(payload)) {
    return undefined;
  }

  if (isRecord(payload.pull_request) && isRecord(payload.pull_request.base)) {
    const sha = payload.pull_request.base.sha;
    if (typeof sha === 'string' && sha.length > 0) {
      return sha;
    }
  }

  const before = payload.before;
  if (
    typeof before === 'string' &&
    before.length > 0 &&
    !/^0+$/.test(before)
  ) {
    return before;
  }
  return undefined;
}

function failPolicy(value: string): FailOn {
  if (value === 'breaking' || value === 'warning' || value === 'never') {
    return value;
  }
  throw new Error(`Input fail-on must be breaking, warning, or never; received "${value}".`);
}

function annotateChange(file: string, change: ContractChange): void {
  const properties = { file, title: change.code };
  switch (change.severity) {
    case 'breaking':
      core.error(change.message, properties);
      break;
    case 'warning':
      core.warning(change.message, properties);
      break;
    case 'info':
      core.notice(change.message, properties);
      break;
  }
}

function annotateIssue(item: ValidationIssue): void {
  const properties = { file: item.caller, title: item.code };
  if (item.severity === 'error') {
    core.error(item.message, properties);
  } else {
    core.warning(item.message, properties);
  }
}

function annotateReport(report: CheckReport): void {
  for (const comparison of report.comparisons) {
    for (const change of comparison.changes) {
      annotateChange(comparison.path, change);
    }
  }
  for (const item of report.validationIssues) {
    annotateIssue(item);
  }
}

async function writeSummary(report: CheckReport, failed: boolean): Promise<void> {
  const summary = report.summary;
  await core.summary
    .addHeading('Reusable workflow contract')
    .addRaw(failed ? '❌ Compatibility policy failed.' : '✅ Compatibility policy passed.', true)
    .addTable([
      [
        { data: 'Result', header: true },
        { data: 'Count', header: true },
      ],
      ['Breaking changes', String(summary.breakingChanges)],
      ['Caller errors', String(summary.validationErrors)],
      ['Warnings', String(summary.warnings)],
      ['Informational changes', String(summary.information)],
      ['Workflows compared', String(summary.workflows)],
    ])
    .write();
}

export async function runAction(): Promise<void> {
  try {
    const explicitBase = core.getInput('base');
    const base = explicitBase || eventBaseRevision();
    if (base === undefined) {
      throw new Error(
        'Could not determine a base revision. Pass the base input or run on a pull_request/push event.',
      );
    }

    const root =
      core.getInput('root') || process.env.GITHUB_WORKSPACE || process.cwd();
    const paths = core.getMultilineInput('paths');
    const validateCallers = core.getBooleanInput('validate-callers');
    const failOn = failPolicy(core.getInput('fail-on') || 'breaking');

    const report = runCheck({
      base,
      root,
      paths,
      validateCallers,
    });
    const failed = reportFails(report, failOn);

    annotateReport(report);
    core.setOutput('breaking-changes', report.summary.breakingChanges);
    core.setOutput('caller-errors', report.summary.validationErrors);
    core.setOutput('warnings', report.summary.warnings);
    core.setOutput('passed', !failed);
    await writeSummary(report, failed);

    if (failed) {
      core.setFailed(
        `Reusable workflow contract failed: ${report.summary.breakingChanges} breaking change(s), ` +
          `${report.summary.validationErrors} caller error(s), and ${report.summary.warnings} warning(s).`,
      );
    }
  } catch (error) {
    core.setFailed(error instanceof Error ? error : String(error));
  }
}

void runAction();
