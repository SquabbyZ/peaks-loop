# Change: add-autonomous-rd-swarm-resume

## Why

Peaks should help a solo developer get high-quality outcomes from lower-cost execution models by letting top-tier models define goals, gates, and review criteria while `peaks-rd` runs bounded autonomous swarm execution. The current CLI can plan workflow, tech gates, and RD swarm graphs, but it does not yet model durable goal state, compact/session recovery, or capability reuse from known MCPs, skills, and external resources.

This change makes the product direction explicit: Peaks should reuse existing capabilities listed in `docs/accessRepo.md` and `docs/mcpServer.md` before building features from scratch, and should make autonomous RD execution resumable after Claude Code auto compact or session continuation.

## What Changes

- Add a product-level autonomous RD goal package for `peaks-prd` / `peaks-solo` workflows.
- Model `/goal`-style completion conditions as optional session accelerators, not as the durable Peaks orchestrator.
- Add checkpoint, resume, worker queue, artifact evidence, and validation evidence requirements for `peaks-rd` autonomous swarm planning.
- Add capability reuse requirements so Peaks consults known MCPs, skills, and repos before proposing custom implementation.
- Keep the first implementation dry-run and artifact-bound: no real worker launch, no MCP installation, no settings mutation, and no target repository mutation.

## Out of Scope

- Installing Claude Code Router, MCP servers, hooks, or external skills automatically.
- Storing API keys or provider credentials.
- Launching real MiniMax, Claude, OpenAI, or other model workers.
- Replacing Claude Code `/goal`; Peaks should interoperate with it but remain independent.
- Writing implementation code into target projects from this change.

## Dependencies

- `add-tech-dry-run-gate` for approved technical direction.
- `add-rd-swarm-dry-run-planner` for RD task graph planning.
- Existing artifact workspace boundary and coverage gates.
- `docs/accessRepo.md` and `docs/mcpServer.md` as curated capability/resource inputs.

## Risks

- Treating Claude Code `/goal` as durable state could lose progress after compact or session changes.
- Overusing swarm workers could create coordination overhead or conflicting edits.
- Reusing external capabilities without trust/risk labeling could install or invoke unsafe resources.
- Capability discovery may become too token-heavy if every run scans every external resource.

## Acceptance Criteria

- A Peaks autonomous RD plan includes goal, done condition, resume condition, checkpoints, queue status, evidence paths, and next actions.
- The plan records whether Claude Code `/goal` can be used and what completion condition should be supplied.
- The plan explicitly states that durable resume state belongs to Peaks artifacts, not only Claude Code session state.
- The plan prefers existing resources from `docs/accessRepo.md` and `docs/mcpServer.md` before custom implementation.
- Capability reuse is gated by source, purpose, trust level, and whether installation or network access would be required.
- Dry-run mode does not launch agents, install resources, mutate Claude settings, or edit target repository source files.
- `pnpm test`, `pnpm typecheck`, and `pnpm test:coverage` pass with 100% coverage for included modules when code is added.
