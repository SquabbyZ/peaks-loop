# Boundaries

> Body of `## Boundaries`. Peaks-Loop Code may:

- identify scenarios such as refactor, bugfix, QA hardening, release validation, and incident response;
- recommend Code, Assisted, Swarm, or Strict profiles;
- coordinate Peaks-Loop role skills through artifacts;
- coordinate project memory extraction from stable skill artifact sections;
- request user confirmation at risk and commit boundaries;
- read CLI doctor/profile/artifact reports.

Peaks-Loop Code must not silently:

- install hooks;
- create agents;
- enable MCP servers;
- modify Claude settings;
- create GitHub repositories;
- bypass role-skill artifacts.

Use the Peaks-Loop CLI for runtime side effects.

## Superpowers red lines (effective 2026-07-24, slice 2026-07-24-peaks-code-bridge-002-rootcause)

`peaks-code` coordinates with the **superpowers** skill family but never lets it override peaks-loop governance:

- `superpowers:brainstorming` / `superpowers:writing-plans` — **reference only**. Output (brainstorm / plan) MUST be re-authored as a `peaks-rd` PRD/RD artefact under `.peaks/_runtime/<sessionId>/rd/requests/<rid>.md` before any peaks-code step continues. `superpowers:writing-plans` upstream SKILL.md is **not edited** (it is owned by superpowers and silently overwritten on `claude install skill superpowers:writing-plans`).
- `superpowers:executing-plans` / `superpowers:subagent-driven-development` — **forbidden** as direct runners. peaks-rd is the only authoritative planner + executor pair in the peaks-loop governance surface. Dispatching either one to replace peaks-rd is a governance violation and the LLM MUST stop.
- `superpowers:test-driven-development` / `superpowers:verification-before-completion` / `superpowers:systematic-debugging` — **reference only**. peaks-qa owns TDD, verification gates, and bug triage. The superpowers versions inform method selection; they are not dispatched in place of `peaks sub-agent dispatch qa`.
- `superpowers:dispatching-parallel-agents` — superseded by `peaks sub-agent dispatch --from-dag` (peaks-loop DAG-aware fan-out). Use the peaks primitive.
- `superpowers:using-git-worktrees` / `superpowers:using-superpowers` — informational. peaks-loop has its own workspace conventions (`.peaks/_runtime/<sessionId>/<role>/...` two-axis gitignored tree). Do not adopt superpowers' bare worktree conventions for peak-* work.
- `superpowers:finishing-a-development-branch` — informational. peaks-loop finishes via `peaks request transition` + `peaks memory extract`.
- `superpowers:requesting-code-review` / `superpowers:receiving-code-review` — informational. peaks-loop review channels are `peaks-reviewer` (v2.14.0 G4 third-party reviewer) + karpathy-reviewer (RD-side fanout) + karpathy-5way-fanout guard test.

If a user explicitly asks for "the superpowers plan flow" inside a peaks-code request, the answer is: brainstorm/plan via superpowers as references, then re-author through `peaks sub-agent dispatch rd` and continue peaks-code's 11-step sequence from Step 3.