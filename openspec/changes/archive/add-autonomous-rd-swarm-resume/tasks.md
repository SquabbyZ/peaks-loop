# Tasks: add-autonomous-rd-swarm-resume

> Execute after the current workflow route, tech gate, and RD swarm dry-run planner are stable. Use TDD. Do not launch real workers, install MCPs, or mutate target repositories.

## 1. Product goal package

- [ ] Add tests for autonomous goal package generation.
- [ ] Define goal, non-goal, preserved behavior, acceptance criteria, done condition, and resume condition types.
- [ ] Implement a pure service that creates a deterministic goal package from `changeId`, `goal`, and mode.
- [ ] Include user-confirmable risk notes and non-goals.

## 2. Capability reuse planning

- [ ] Add tests proving `docs/accessRepo.md` and `docs/mcpServer.md` are represented as curated capability inputs.
- [ ] Parse or model curated resource entries without installing or invoking them.
- [ ] Label each capability with purpose, trust level, activation requirement, and risk.
- [ ] Preserve the categories from `docs/accessRepo.md`, including code standards, project scanning, frontend/browser validation, cross-session memory, UI/design resources, OpenSpec, and swarm/orchestration references.
- [ ] Prefer existing local skills/MCP/resources before custom implementation in recommendations.

## 3. Autonomous RD resume plan

- [ ] Add tests for checkpoints, worker queue placeholders, evidence requirements, and resume instructions.
- [ ] Build an autonomous RD dry-run plan from the goal package and existing RD swarm plan.
- [ ] Mark Claude Code `/goal` as session-level and non-durable.
- [ ] Store durable state requirements in planned Peaks artifact paths.

## 4. CLI surface

- [ ] Add focused CLI tests for the chosen command shape.
- [ ] Reject invalid change ids, empty goals, unsupported modes, and non-dry-run execution.
- [ ] Return stable JSON envelope data with constraints and next actions.
- [ ] Do not change existing `workflow route` output unless tests document the compatibility impact.

## 5. Compact/session recovery behavior

- [ ] Add tests for preview-safe resume when artifacts are unavailable.
- [ ] Add tests for resume blocked when checkpoint or validation evidence is missing.
- [ ] Add tests for resume ready when checkpoints and evidence are present.
- [ ] Ensure the plan says what to verify before continuing after compact or `--continue`.

## 6. Quality gates

- [ ] Run `pnpm vitest run` for focused new tests.
- [ ] Run `pnpm typecheck`.
- [ ] Run `pnpm test`.
- [ ] Run `pnpm test:coverage`.
- [ ] Keep 100% statements, branches, functions, and lines for included modules.

## 7. Review

- [ ] Run code-reviewer after code changes.
- [ ] Run typescript-reviewer for TypeScript service/CLI code.
- [ ] Run security-reviewer because resource discovery, file paths, and autonomy controls affect trust boundaries.
- [ ] Fix CRITICAL and HIGH findings before marking complete.
