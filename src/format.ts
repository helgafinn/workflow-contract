import type {
  CheckReport,
  ContractChange,
  OutputFormat,
  ValidationIssue,
} from './types.js';

const LABEL: Record<ContractChange['severity'], string> = {
  breaking: 'BREAKING',
  warning: 'WARNING',
  info: 'INFO',
};

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

export function formatPretty(report: CheckReport): string {
  const lines = ['surety'];
  if (report.base !== null) {
    lines.push(`Base: ${report.base}`);
  }

  const findings = report.comparisons.filter((comparison) => comparison.changes.length > 0);
  if (findings.length === 0 && report.validationIssues.length === 0) {
    lines.push('', 'PASS No contract or local-caller compatibility problems found.');
  }

  for (const comparison of findings) {
    lines.push('', comparison.path);
    for (const change of comparison.changes) {
      lines.push(`  ${LABEL[change.severity]} [${change.code}] ${change.message}`);
    }
  }

  if (report.validationIssues.length > 0) {
    lines.push('', 'Local caller validation');
    for (const item of report.validationIssues) {
      lines.push(
        `  ${item.severity.toUpperCase()} ${item.caller}:${item.path} [${item.code}] ${item.message}`,
      );
    }
  }

  lines.push(
    '',
    `Summary: ${plural(report.summary.breakingChanges, 'breaking change')}, ` +
      `${plural(report.summary.validationErrors, 'caller error')}, ` +
      `${plural(report.summary.warnings, 'warning')}, ` +
      `${plural(report.summary.information, 'informational change')}.`,
  );
  return `${lines.join('\n')}\n`;
}

function escapeCommandMessage(value: string): string {
  return value.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function escapeCommandProperty(value: string): string {
  return escapeCommandMessage(value).replaceAll(':', '%3A').replaceAll(',', '%2C');
}

function changeAnnotation(path: string, change: ContractChange): string {
  const command =
    change.severity === 'breaking' ? 'error' : change.severity === 'warning' ? 'warning' : 'notice';
  const properties = `file=${escapeCommandProperty(path)},title=${escapeCommandProperty(change.code)}`;
  return `::${command} ${properties}::${escapeCommandMessage(change.message)}`;
}

function issueAnnotation(item: ValidationIssue): string {
  const command = item.severity === 'error' ? 'error' : 'warning';
  const properties = `file=${escapeCommandProperty(item.caller)},title=${escapeCommandProperty(item.code)}`;
  return `::${command} ${properties}::${escapeCommandMessage(item.message)}`;
}

export function formatGitHub(report: CheckReport): string {
  const lines: string[] = [];
  for (const comparison of report.comparisons) {
    for (const change of comparison.changes) {
      lines.push(changeAnnotation(comparison.path, change));
    }
  }
  for (const item of report.validationIssues) {
    lines.push(issueAnnotation(item));
  }
  if (lines.length === 0) {
    lines.push('::notice title=surety::No compatibility problems found.');
  }
  return `${lines.join('\n')}\n`;
}

export function formatReport(report: CheckReport, format: OutputFormat): string {
  switch (format) {
    case 'pretty':
      return formatPretty(report);
    case 'json':
      return `${JSON.stringify(report, null, 2)}\n`;
    case 'github':
      return formatGitHub(report);
  }
}
