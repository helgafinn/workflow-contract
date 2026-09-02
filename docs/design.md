# L’Esprit MVP design

## Goal

L’Esprit prevents a reusable GitHub Actions workflow from changing its public interface without the pull request showing the effect. It treats `on.workflow_call` as an API contract and performs static, read-only analysis.

## Supported surfaces

The contract snapshot contains:

- `inputs`: type, requiredness, default, and description
- `secrets`: requiredness and description
- `outputs`: value expression and description
- effective per-job `permissions` after applying workflow-level inheritance
- workflow name and source path as metadata

The checker only follows local caller references that match a direct `./.github/workflows/<file>.yml` or `.yaml` path. It rejects traversal, nested paths, symlinks, and non-regular files before reading a callee.

## Compatibility policy

### Breaking

- Remove an input, secret, or output.
- Add a required input or secret.
- Make an optional input or secret required.
- Change an input type.
- Increase an explicitly requested permission level.
- Remove a reusable workflow that existed at the base revision.
- Give a local caller an unknown input/secret, omit a required value, provide a literal of the wrong input type, or cap an explicitly requested permission below the callee's request.

### Warning

- Add, remove, or change an input default.
- Change an output value expression.
- Decrease an explicitly requested permission.
- Change permissions when one side relies on GitHub's implicit defaults and therefore cannot be compared safely.
- Encounter a remote reusable-workflow call that cannot be inspected locally (only when explicitly requested in a future remote mode; MVP silently leaves remote calls alone).

### Non-breaking information

- Add an optional input or secret.
- Add an output or a new reusable workflow.
- Relax requiredness.

Description-only edits are excluded from compatibility results.

## CLI

```text
lesprit check --base <git-ref> [--root <path>] [--path <workflow>]...
              [--format pretty|json|github]
              [--fail-on breaking|warning|never]
              [--no-validate-callers]
lesprit diff <before.yml> <after.yml> [--format ...] [--fail-on ...]
lesprit snapshot <workflow.yml> [--output <file|->]
lesprit validate [--root <path>] [--format ...] [--fail-on ...]
```

Exit code `0` means the selected policy passed, `1` means contract or caller findings failed the policy, and `2` means invocation/parsing/runtime failure.

## GitHub Action

The bundled JavaScript action resolves the base revision from its `base` input or the pull-request event, annotates changed files, writes a step summary, and exposes counts as outputs. Callers must checkout full history (`fetch-depth: 0`) because analysis is local and does not call the GitHub API.

## Explicit non-goals for 0.1

- Executing or emulating GitHub Actions.
- Downloading private or remote reusable workflows.
- Resolving dynamic expressions or matrices.
- Proving runtime behavior from implementation changes.
- Hosting a service, collecting telemetry, or requiring credentials.
- Replacing `actionlint` or a security scanner.

These boundaries keep the tool installable, deterministic, and safe for untrusted pull-request content.
