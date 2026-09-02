# L’Esprit

Contract tests for reusable GitHub Actions workflows.

**L’Esprit**—French for “the spirit” or “the mind”—is the reasoning layer that protects workflow contracts. It treats `on.workflow_call` as a public API and detects breaking changes to inputs, secrets, outputs, and explicitly requested permissions before a pull request reaches dependent repositories. It also validates callers of local reusable workflows.

The analysis commands are static and read-only: they do not execute workflows, send repository content to a service, require a token, or collect telemetry. `snapshot --output` writes only to the destination explicitly selected by the user.

## What it catches

```text
.github/workflows/deploy.yml
  BREAKING [input.removed] Input "environment" was removed.
  BREAKING [secret.required-added] Required secret "subscription_id" was added.
  WARNING [input.default-changed] Input "retries" changed its default value.

Local caller validation
  ERROR .github/workflows/release.yml:jobs.deploy.with.region
        [caller.missing-required-input] Job "deploy" does not provide required input "region".
```

| Change | Default result |
| --- | --- |
| Remove an input, secret, output, or reusable workflow | Breaking |
| Add a required input or secret | Breaking |
| Make an optional input or secret required | Breaking |
| Change an input type | Breaking |
| Increase an explicit permission request | Breaking |
| Change a default or output value expression | Warning |
| Add an optional input, optional secret, or output | Informational |
| Invalid local caller input, secret, literal type, or permission cap | Error |

Description-only edits do not produce compatibility findings.

## Requirements

- Node.js 24 or newer
- Git history containing the base revision when using `check`

## Install

After the first npm release:

```bash
npm install --save-dev lesprit
```

From a source checkout:

```bash
npm ci
npm run build
node dist/cli.js --help
```

## CLI

Compare every reusable workflow at a base revision with the working tree and validate local callers:

```bash
npx lesprit check --base origin/main
```

Limit comparison to selected workflow files:

```bash
npx lesprit check \
  --base origin/main \
  --path .github/workflows/deploy.yml \
  --path .github/workflows/test.yml
```

Compare two files without a Git repository:

```bash
npx lesprit diff before.yml after.yml
```

Extract a deterministic contract snapshot:

```bash
npx lesprit snapshot .github/workflows/deploy.yml \
  --output deploy.contract.json
```

Validate current local callers only:

```bash
npx lesprit validate
```

### Output and failure policy

```bash
npx lesprit check --base origin/main --format json
npx lesprit check --base origin/main --format github
npx lesprit check --base origin/main --fail-on warning
npx lesprit check --base origin/main --fail-on never
```

Formats are `pretty`, `json`, and `github`. `--fail-on breaking` is the default. Exit codes are:

- `0`: selected policy passed
- `1`: compatibility findings failed the selected policy
- `2`: invocation, YAML, Git, or runtime failure

Use `--no-validate-callers` when only base/head contract comparison is wanted.

## GitHub Action

The action is bundled and does not install packages at runtime. Full history is required because it reads the base contract through local Git rather than the GitHub API.

```yaml
name: Reusable workflow compatibility

on:
  pull_request:
    paths:
      - '.github/workflows/*.yml'
      - '.github/workflows/*.yaml'

permissions:
  contents: read

jobs:
  contract:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
        with:
          fetch-depth: 0

      - uses: helgafinn/lesprit@v1
        with:
          fail-on: breaking
          validate-callers: true
```

The action automatically uses `pull_request.base.sha` or the push event's `before` SHA. Override it when necessary:

```yaml
      - uses: helgafinn/lesprit@v1
        id: contract
        with:
          base: origin/main
          paths: |
            .github/workflows/deploy.yml
            .github/workflows/test.yml

      - run: echo "Breaking changes: ${{ steps.contract.outputs.breaking-changes }}"
```

Outputs are `breaking-changes`, `caller-errors`, `warnings`, and `passed`. Findings appear as file annotations and in the job summary.

## What local caller validation supports

For jobs with a local reference such as:

```yaml
jobs:
  deploy:
    uses: ./.github/workflows/deploy.yml
```

The validator reports:

- undeclared or missing required inputs
- literal input values whose YAML type does not match the declaration
- undeclared or missing required secrets
- explicit caller permissions lower than explicit callee requests
- missing or non-reusable local workflow files

Expression values containing `${{ ... }}` are accepted without static type evaluation. `secrets: inherit` satisfies required-secret presence because the available names are only known at runtime.

## Current scope

Version 0.1 intentionally does not:

- fetch or authenticate to workflows in other repositories
- execute or emulate GitHub Actions
- resolve expressions, matrices, or runtime outputs
- infer behavior from implementation-only step changes
- replace [`actionlint`](https://github.com/rhysd/actionlint) or a security scanner

Permission comparisons are conservative. Explicit increases are breaking because a caller may cap the token, while transitions involving GitHub's implicit defaults are warnings because repository defaults are not available to static analysis.

See [`docs/design.md`](docs/design.md) for the complete compatibility policy.

## Library API

The package exports the same primitives used by the CLI and action:

```ts
import {
  diffContracts,
  extractWorkflowContract,
  runCheck,
} from 'lesprit';
```

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run check
```

The generated `action/` bundle must be committed with source changes that affect the action. See [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Security and privacy

Analysis is local, deterministic, and read-only. Workflow files are parsed as data and are never executed. Git commands use argument arrays rather than a shell. Do not add telemetry or remote uploads without an explicit design decision and an opt-in privacy review.

## License

[MIT](LICENSE)
