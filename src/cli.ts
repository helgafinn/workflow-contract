#!/usr/bin/env node

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reportFails, runCheck, runFileDiff, runValidation } from './check.js';
import { UsageError, WorkflowContractError } from './errors.js';
import { formatReport } from './format.js';
import { extractWorkflowContract, serializeContract } from './parse.js';
import type { FailOn, OutputFormat } from './types.js';
import { VERSION } from './version.js';

const HELP = `workflow-contract ${VERSION}

Detect breaking changes in reusable GitHub Actions workflows.

Usage:
  workflow-contract check --base <git-ref> [options]
  workflow-contract diff <before.yml> <after.yml> [options]
  workflow-contract snapshot <workflow.yml> [--output <file|->]
  workflow-contract validate [options]

Commands:
  check       Compare workflow_call contracts at a Git base against the working tree.
  diff        Compare two reusable workflow YAML files directly.
  snapshot    Print a stable JSON contract for one reusable workflow.
  validate    Validate local jobs that call ./.github/workflows/*.

Options:
  --base <git-ref>               Base commit, branch, or tag for check.
  --root <path>                  Repository root (default: current directory).
  --path <workflow>              Limit check to a repository-relative path; repeatable.
  --format <pretty|json|github>  Output format (default: pretty).
  --fail-on <breaking|warning|never>
                                  Exit 1 at the selected severity (default: breaking).
  --no-validate-callers          Skip local caller validation during check.
  --output <file|->              Snapshot destination (default: stdout).
  -h, --help                     Show help.
  -v, --version                  Show version.

Exit codes:
  0  Policy passed.
  1  Compatibility findings failed the selected policy.
  2  Invalid invocation, YAML, Git, or runtime failure.
`;

type OptionKey =
  | 'base'
  | 'root'
  | 'path'
  | 'format'
  | 'fail-on'
  | 'no-validate-callers'
  | 'output'
  | 'help';

interface ParsedOptions {
  base: string | undefined;
  root: string;
  paths: string[];
  format: OutputFormat;
  failOn: FailOn;
  validateCallers: boolean;
  output: string;
  help: boolean;
  positionals: string[];
}

function outputFormat(value: string): OutputFormat {
  if (value !== 'pretty' && value !== 'json' && value !== 'github') {
    throw new UsageError(`Unknown output format "${value}".`);
  }
  return value;
}

function failPolicy(value: string): FailOn {
  if (value !== 'breaking' && value !== 'warning' && value !== 'never') {
    throw new UsageError(`Unknown fail policy "${value}".`);
  }
  return value;
}

function parseOptions(tokens: string[], allowed: ReadonlySet<OptionKey>): ParsedOptions {
  const parsed: ParsedOptions = {
    base: undefined,
    root: process.cwd(),
    paths: [],
    format: 'pretty',
    failOn: 'breaking',
    validateCallers: true,
    output: '-',
    help: false,
    positionals: [],
  };

  const requireAllowed = (name: OptionKey): void => {
    if (!allowed.has(name)) {
      throw new UsageError(`Option --${name} is not valid for this command.`);
    }
  };

  const readValue = (
    name: OptionKey,
    inline: string | undefined,
    index: number,
  ): { value: string; nextIndex: number } => {
    requireAllowed(name);
    if (inline !== undefined) {
      if (inline.length === 0) {
        throw new UsageError(`Option --${name} requires a value.`);
      }
      return { value: inline, nextIndex: index };
    }
    const value = tokens[index + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new UsageError(`Option --${name} requires a value.`);
    }
    return { value, nextIndex: index + 1 };
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined) {
      continue;
    }
    if (token === '--') {
      parsed.positionals.push(...tokens.slice(index + 1));
      break;
    }
    if (token === '-h' || token === '--help') {
      requireAllowed('help');
      parsed.help = true;
      continue;
    }
    if (!token.startsWith('--')) {
      parsed.positionals.push(token);
      continue;
    }

    const separator = token.indexOf('=');
    const rawName = token.slice(2, separator === -1 ? undefined : separator);
    const inline = separator === -1 ? undefined : token.slice(separator + 1);

    if (rawName === 'no-validate-callers') {
      requireAllowed('no-validate-callers');
      if (inline !== undefined) {
        throw new UsageError('--no-validate-callers does not accept a value.');
      }
      parsed.validateCallers = false;
      continue;
    }

    const valueOptions = new Set<OptionKey>([
      'base',
      'root',
      'path',
      'format',
      'fail-on',
      'output',
    ]);
    if (!valueOptions.has(rawName as OptionKey)) {
      throw new UsageError(`Unknown option "--${rawName}".`);
    }
    const name = rawName as OptionKey;
    const result = readValue(name, inline, index);
    index = result.nextIndex;

    switch (name) {
      case 'base':
        parsed.base = result.value;
        break;
      case 'root':
        parsed.root = result.value;
        break;
      case 'path':
        parsed.paths.push(result.value);
        break;
      case 'format':
        parsed.format = outputFormat(result.value);
        break;
      case 'fail-on':
        parsed.failOn = failPolicy(result.value);
        break;
      case 'output':
        parsed.output = result.value;
        break;
      case 'no-validate-callers':
      case 'help':
        break;
    }
  }

  return parsed;
}

function print(text: string): void {
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

function runCheckCommand(tokens: string[]): number {
  const options = parseOptions(
    tokens,
    new Set<OptionKey>([
      'base',
      'root',
      'path',
      'format',
      'fail-on',
      'no-validate-callers',
      'help',
    ]),
  );
  if (options.help) {
    print(HELP);
    return 0;
  }
  if (options.positionals.length > 0) {
    throw new UsageError('check does not accept positional arguments. Use --path to select workflows.');
  }
  if (options.base === undefined) {
    throw new UsageError('check requires --base <git-ref>.');
  }

  const report = runCheck({
    base: options.base,
    root: options.root,
    paths: options.paths,
    validateCallers: options.validateCallers,
  });
  print(formatReport(report, options.format));
  return reportFails(report, options.failOn) ? 1 : 0;
}

function runDiffCommand(tokens: string[]): number {
  const options = parseOptions(
    tokens,
    new Set<OptionKey>(['format', 'fail-on', 'help']),
  );
  if (options.help) {
    print(HELP);
    return 0;
  }
  if (options.positionals.length !== 2) {
    throw new UsageError('diff requires exactly <before.yml> and <after.yml>.');
  }
  const [before, after] = options.positionals;
  if (before === undefined || after === undefined) {
    throw new UsageError('diff requires exactly <before.yml> and <after.yml>.');
  }

  const report = runFileDiff(before, after);
  print(formatReport(report, options.format));
  return reportFails(report, options.failOn) ? 1 : 0;
}

function runSnapshotCommand(tokens: string[]): number {
  const options = parseOptions(tokens, new Set<OptionKey>(['output', 'help']));
  if (options.help) {
    print(HELP);
    return 0;
  }
  if (options.positionals.length !== 1) {
    throw new UsageError('snapshot requires exactly one <workflow.yml>.');
  }
  const source = options.positionals[0];
  if (source === undefined) {
    throw new UsageError('snapshot requires exactly one <workflow.yml>.');
  }

  const contract = extractWorkflowContract(readFileSync(resolve(source), 'utf8'), source);
  const serialized = serializeContract(contract);
  if (options.output === '-') {
    print(serialized);
  } else {
    const destination = resolve(options.output);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, serialized, 'utf8');
  }
  return 0;
}

function runValidateCommand(tokens: string[]): number {
  const options = parseOptions(
    tokens,
    new Set<OptionKey>(['root', 'format', 'fail-on', 'help']),
  );
  if (options.help) {
    print(HELP);
    return 0;
  }
  if (options.positionals.length > 0) {
    throw new UsageError('validate does not accept positional arguments. Use --root <path>.');
  }

  const report = runValidation(options.root);
  print(formatReport(report, options.format));
  return reportFails(report, options.failOn) ? 1 : 0;
}

export function main(argv = process.argv.slice(2)): number {
  try {
    const [command, ...tokens] = argv;
    if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
      print(HELP);
      return 0;
    }
    if (command === '--version' || command === '-v') {
      print(VERSION);
      return 0;
    }

    switch (command) {
      case 'check':
        return runCheckCommand(tokens);
      case 'diff':
        return runDiffCommand(tokens);
      case 'snapshot':
        return runSnapshotCommand(tokens);
      case 'validate':
        return runValidateCommand(tokens);
      default:
        throw new UsageError(`Unknown command "${command}".`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`workflow-contract: ${message}\n`);
    if (error instanceof UsageError) {
      process.stderr.write('Run workflow-contract --help for usage.\n');
    }
    return error instanceof WorkflowContractError ? 2 : 2;
  }
}

export function isEntryModule(moduleUrl: string, entryPath: string | undefined): boolean {
  if (entryPath === undefined) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entryPath);
  } catch {
    return false;
  }
}

if (isEntryModule(import.meta.url, process.argv[1])) {
  process.exitCode = main();
}
