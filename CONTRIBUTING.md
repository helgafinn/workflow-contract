# Contributing to workflow-contract

## Development setup

Use Node.js 24 or newer and the npm version declared in `package.json`.

```bash
npm ci
npm run check
```

`npm run check` runs strict TypeScript checking, the focused test suite, the library/CLI build, and the bundled-action build.

## Project structure

- `src/parse.ts`: YAML and `workflow_call` contract extraction
- `src/diff.ts`: compatibility classification
- `src/validate.ts`: local caller checks
- `src/check.ts`: Git base/working-tree orchestration
- `src/format.ts`: terminal, JSON, and workflow-command output
- `src/cli.ts`: command-line entry point
- `src/action.ts`: GitHub Action entry point
- `tests/fixtures/`: executable compatibility examples
- `docs/design.md`: supported contract and policy decisions

## Change expectations

- Start behavior changes with a focused fixture and test.
- Keep analysis static and deterministic; never execute workflow content.
- Treat remote fetching, credentials, telemetry, and new failure classifications as explicit design changes.
- Avoid broad GitHub Actions emulation. This project checks interfaces and local callers.
- Keep runtime dependencies small and pin dependency versions.

## Bundled action

GitHub downloads an action repository without installing its dependencies. Run:

```bash
npm run build
```

and include the generated `action/index.cjs` whenever action behavior or bundled dependencies change. CI fails if the tracked bundle is stale.

## Before opening a pull request

```bash
npm run check
npm pack --dry-run
```

Include the problem being solved, the compatibility rule affected, and test evidence. Do not commit credentials, real workflow secrets, generated npm archives, or local coverage output.
