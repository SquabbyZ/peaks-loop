# peaks worktree L2 enforcers — reference

> **Slice 2026-07-29-rid-prose-only-sweep Part 33.** Companion to
> the L2 ecosystem shipped across 28 commits. The peaks
> `peaks audit red-lines --project .` command reports 119
> catalog red-lines, of which **86+ are cli-backed enforcers**
> (the rest are discovered prose-only lines still being
> sweeped). This document is the operator-side reference for
> the L2 surface.

## What is the L2 surface?

The **L2 surface** is the worktree / dispatch / observability
stack peaks-loop owns. Sub-agents touching any of the L2
verbs (`peaks worktree *`, `peaks container *`,
`peaks sub-agent dispatch --isolation <mode>`, `peaks lease-*`,
`peaks cron*`, `peaks audit red-lines`) need to read this
document to know which enforcers will run against them.

## Why this document exists

LLM-side runners (skills/peaks-code, peaks-rd, peaks-qa, etc.)
read the prose-only catalog as guidance but historically
under-estimated how strict the cli-backed enforcers are.
Documenting the enforcer surface upfront prevents
"discovered late in a cycle" surprises.

## Enforcers by source

### peaks-worktree authority (L2 grant + lease)

- **`withSuperpowersSkillDenylist`** (src/services/skills/hooks-settings-service.ts)
  Installs `UseSkill(superpowers:using-git-worktrees)` into
  `permissions.deny`. Triggered by `peaks hooks install`.
- **`withoutSuperpowersSkillDenylist`** — symmetric uninstall.
- **`withTriggeredDenyList`** (Part 27 / 29) — appends
  `Edit(deny-trigger:<phrase>)` when the existing settings
  has superpowers / git-worktree / podman-run entries. LLM
  must run `peaks hooks uninstall` to remove.
- **`decideFromAuthorization`** (src/services/hooks/worktree-authorization-gate.ts)
  Decides allow / deny for a worktree-mutating tool call
  based on `peaks worktree auth grant` file contents.
- **`decideFromLease`** (Part 2.B) — falls back to the lease
  file when no grant is on file. Activated by
  `PEAKS_WORKTREE_LEASE_ID` env var.
- **`decideFromContainerLease`** (Part 19) — analogous to
  `decideFromLease` for the L4 container surface.
  Activated by `PEAKS_CONTAINER_LEASE_ID` env var.

### L2 section structure (P2-a lint)

- **`rl-section-hard-contracts-001`** (lint-style.ts) — peaks-*
  bee SKILL.md must declare `## Hard contracts` section.
- **`rl-section-mandatory-artifact-001`** — must declare
  `## Mandatory per-request artifact` section.
- **`rl-section-default-runbook-001`** — must declare
  `## Default runbook` section.
- **`rl-section-gate-index-001`** — must declare
  `## RD gate index` / `## QA gate index` section.
- **`rl-section-naming-axiom-001`** — single-scope-axis
  naming convention.

### L2 frontmatter (P2-a lint)

- **`rl-frontmatter-skills-md-001`** — name / description
  frontmatter on every SKILL.md.
- **`rl-frontmatter-references-load-strategy-001`** —
  loadStrategy field on references/*.md.
- **`rl-frontmatter-applicable-task-levels-001`** —
  applicableTaskLevels field on references/*.md.

### L2 output style (P2-a lint)

- **`rl-output-style-status-header-001`** — every peaks-*
  response carries a `peaks-loop skill: | peaks-loop gate: |
  peaks-loop next:` status header.
- **`rl-output-style-no-fluff-001`** — no greeting / persona
  fluff in SKILL.md.
- **`rl-output-style-no-closing-prompt-001`** — no "Should I
  continue?" closing prompt.

### L2 reference integrity (P2-a lint)

- **`rl-ref-path-resolves-001`** — every `references/*.md`
  link in a SKILL.md resolves to a real file.
- **`rl-ref-no-broken-mkdir-001`** — no `mkdir -p
  nonexistent/dir` in references code blocks.
- **`rl-ref-no-pwd-symlink-jumps-001`** — no pwd that
  jumps symlinks.
- **`rl-ref-no-relative-archive-paths-001`** — no relative
  archive paths in references.

### L2 OpenSpec

- **`rl-openspec-proposal-has-ac-bullets-001`** — OpenSpec
  proposal must have acceptance criteria bullets.
- **`rl-openspec-proposal-has-spec-changes-001`** — OpenSpec
  proposal must have spec changes.

### L2 CLI back

- **`rl-cli-back-mandatory-text-001`** — every CLI command's
  `--help` text matches the canonical `mandatory` keyword.
- **`rl-cli-back-no-orphan-blocking-001`** — every blocking
  red line has a corresponding enforcer.
- **`rl-cli-back-no-orphan-must-not-001`** — every MUST-NOT
  red line has a corresponding enforcer.
- **`rl-cli-back-prose-only-threshold-001`** — the
  prose-only ratio stays ≤ 5% (per §10.2 L2 acceptance).
- **`rl-cli-back-prose-only-ratio-001`** — secondary
  threshold (7% per slice 2026-07-28).

### L2 catalog governance

- **`rl-catalog-total-le-45-001`** — the catalog size must
  grow to ≥ 45 (P2-a target).
- **`rl-catalog-prose-only-ratio-001`** — secondary 7%
  threshold (post-reform).

### L2 peaks-* bee runtime contracts (sweep 1-8)

- **`rl-skill-presence-mandatory-001`** (sweep 003) —
  peaks-* bee SKILL.md must declare the "Skill presence
  (MANDATORY first action)" section.
- **`rl-prd-source-snapshot-placement-001`** (sweep 004) —
  peaks-prd SKILL.md must declare the source-snapshot
  placement guidance + Prohibited paths.
- **`rl-prd-artifact-handoff-001`** (sweep 004) — peaks-prd
  SKILL.md must declare the artifact handoff contract
  (Preserved behavior + step 5.5 + Transition verification
  gates).
- **`rl-rd-handoff-contract-001`** (sweep 005) — peaks-rd
  SKILL.md must declare the QA-handoff BLOCKING contract
  (tech-doc + perf-baseline).
- **`rl-rd-coverage-discipline-001`** (sweep 005) —
  peaks-rd SKILL.md must declare the coverage discipline
  (100% target + no-padding rule).
- **`rl-qa-gateguard-preflight-001`** (sweep 006) — peaks-qa
  SKILL.md must declare the gateguard pre-flight BLOCKING
  section.
- **`rl-qa-runtime-contract-001`** (sweep 006) — peaks-qa
  SKILL.md must declare the runtime contract (transition
  gates + Playwright MCP fallback + OpenSpec integration).
- **`rl-peaks-ui-superpowers-chain-001`** (sweep 007) —
  peaks-ui SKILL.md must declare the superpowers chain
  refusal + reference-material contract.
- **`rl-peaks-ui-involvement-001`** (sweep 007) — peaks-ui
  SKILL.md must declare the UI-involvement identification
  block.
- **`rl-peaks-txt-upstream-001`** (sweep 007) — peaks-txt
  SKILL.md must declare the upstream-inspection +
  memory-block contract.
- **`rl-peaks-perf-audit-scope-001`** (sweep 007) —
  peaks-perf-audit SKILL.md must declare the non-perf
  MUST NOT invoke clause.
- **`rl-peaks-rd-runtime-contract-001`** (sweep 008) —
  peaks-rd SKILL.md must declare the runtime contract
  (OpenSpec usage + Frontend project generation).
- **`rl-peaks-ui-transition-gates-001`** (sweep 008) —
  peaks-ui SKILL.md must declare the Transition verification
  gates section.
- **`rl-peaks-sc-transition-gates-001`** (sweep 008) —
  peaks-sc SKILL.md must declare the Transition verification
  gates section.
- **`rl-peaks-txt-runtime-contract-001`** (sweep 008) —
  peaks-txt SKILL.md must declare the runtime contract
  (Transition verification gates + Memory block embedding
  rule).

## How to run

```sh
# Default — list every catalog red line.
peaks audit red-lines --project .

# Just the cli-backed ones (the L2 surface).
peaks audit red-lines --project . --json | jq '.audit[] | select(.backing == "cli-backed")'
```

## How to read the report

Each entry has:

- `id` — the catalog id (e.g. `rl-skill-presence-mandatory-001`).
- `rule` — the human-readable description of the contract.
- `source.file` — the file the marker was found in.
- `source.line` — the line number (1-indexed).
- `source.marker` — MANDATORY / BLOCKING / MUST NOT / RED LINE.
- `backing` — `cli-backed` (an enforcer file exists) or
  `prose-only` (no enforcer; the line is documented in
  skills/ and audited by humans).

A red line that is `prose-only` is **not enforced** by
peaks. The audit report's `proseOnly` count is the backlog
that has not been closed yet.

## Related memory

- [[2026-07-29-worktree-l2-extended-part1]] — lease foundation
- [[2026-07-29-worktree-l2-extended-part2]] — renew/list/gc/status + hook
- [[2026-07-29-worktree-l2-extended-part3]] — auto-release
- [[2026-07-29-worktree-l2-extended-part4]] — observability + v3
- [[2026-07-29-worktree-l2-extended-part5]] — leak rate + cross-session
- [[2026-07-29-worktree-l2-extended-part6-9]] — final sediment
- [[2026-07-29-worktree-l1-dispatch-block]] — L1 dispatch hardening
- [[2026-07-29-worktree-skills-md-shipped]] — SKILL.md npm contract
- [[2026-07-29-worktree-layer3-deny]] — L3 superpowers deny
- [[2026-07-27-worktree-user-auth-hard-gate]] — L2 grant token
