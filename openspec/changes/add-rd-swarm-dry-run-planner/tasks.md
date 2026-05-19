# Tasks: add-rd-swarm-dry-run-planner

> Execute after or alongside `add-tech-dry-run-gate`. Use TDD. Do not launch real agents and do not edit target repository source files.

## 1. RD swarm service types and template

- [ ] Add unit tests for RD graph wave generation.
- [ ] Create RD swarm request, graph, task, and conflict group types.
- [ ] Implement deterministic wave templates for discovery, planning, implementation candidates, quality gates, and reducer.
- [ ] Ensure every task includes inputs, outputs, dependencies, conflict group, target area, and expected evidence.

## 2. Worker count and parallelism rules

- [ ] Add tests for default worker target, `--max-workers 40`, cap behavior, and below-minimum behavior.
- [ ] Implement 25-40 worker target logic.
- [ ] Expand implementation candidate workers while preserving required quality and reducer workers.
- [ ] Return an explicit blocked reason when worker count is below target without a small-scope explanation.

## 3. Tech approval gate integration

- [ ] Add tests where tech approval is required and missing.
- [ ] Add tests where tech approval is required and approved.
- [ ] Add tests where tech approval is not required for clear bug-fix/local-refactor flows.
- [ ] Reuse `peaks tech status` logic instead of duplicating approval parsing.
- [ ] Return stable blocked reasons for missing tech approval.

## 4. Artifact path planning

- [ ] Add tests proving RD artifact paths are workspace-relative and normalized with `/`.
- [ ] Plan `swarm/task-graph.json`, wave manifests, worker briefs, and reducer report paths.
- [ ] Ensure no `.peaks/changes/<change-id>/swarm/` directory is created inside the target repository by default.

## 5. CLI command

- [ ] Add CLI tests for `peaks swarm plan --skill rd --change-id <id> --goal "<goal>" --max-workers 40 --dry-run --json`.
- [ ] Add CLI tests for unsupported skills.
- [ ] Add CLI tests for invalid `change-id`, empty goal, and missing `--dry-run`.
- [ ] Implement CLI command registration using existing result envelope patterns.

## 6. Quality gates

- [ ] Run `pnpm test`.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test:coverage`.
- [ ] Fix any coverage gaps so included new/changed modules reach 100% statements, branches, functions, and lines.

## 7. Review

- [ ] Run code review agent after code changes.
- [ ] Run TypeScript reviewer if TypeScript service/CLI code changed.
- [ ] Run security reviewer because artifact paths, file boundaries, and CLI input validation are involved.
- [ ] Fix CRITICAL and HIGH findings before marking complete.
