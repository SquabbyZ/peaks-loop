# Tasks: add-tech-dry-run-gate

> Execute with TDD. Every implementation step that adds behavior starts with a failing test. Do not implement RD swarm planning in this change.

## 1. Tech service types and graph template

- [ ] Add unit tests for tech plan wave/task generation.
- [ ] Create focused tech service types.
- [ ] Implement deterministic wave and task template generation.
- [ ] Include inputs, outputs, dependencies, conflict groups, and worker brief paths for every task.

## 2. Artifact path planning

- [ ] Add unit tests proving all generated paths are artifact-workspace relative and normalized with `/`.
- [ ] Reuse existing artifact workspace configuration/resolution where available.
- [ ] Return preview paths and next actions when artifact workspace is unavailable.
- [ ] Ensure dry-run does not write files unless persistence is explicitly supported by existing artifact workspace code.

## 3. Tech approval status

- [ ] Add unit tests for missing docs, missing review report, missing approval record, unapproved approval record, and approved approval record.
- [ ] Implement `peaks tech status` service logic.
- [ ] Require canonical `status: approved` marker for approved status.
- [ ] Return blocked reasons as stable machine-readable strings.

## 4. CLI commands

- [ ] Add CLI tests for `peaks tech plan --change-id <id> --goal "<goal>" --swarm --dry-run --json`.
- [ ] Add CLI tests for `peaks tech status --change-id <id> --json`.
- [ ] Add CLI validation tests for invalid `change-id`, empty goal, and missing `--dry-run`.
- [ ] Implement CLI command registration using existing result envelope patterns.

## 5. Quality gates

- [ ] Run `pnpm test`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test:coverage`.
- [ ] Fix any coverage gaps so included new/changed modules reach 100% statements, branches, functions, and lines.

## 6. Review

- [ ] Run code review agent after code changes.
- [ ] Run TypeScript reviewer if TypeScript service/CLI code changed.
- [ ] Fix CRITICAL and HIGH findings before marking complete.
