# Parked Tests Policy — peaks-loop governance for slice-boundary prose-contract locks

**Date:** 2026-07-24
**Session:** `2026-07-24-session-f13da7`
**Author:** MiniMax (Opus 4.8) — owner-takeover ACTIVE
**Rid:** `2026-07-24-rid-001-b1-n4-parked-governance`
**Source:** traces audit at
`.peaks/_runtime/2026-07-24-session-f13da7/analysis/N4-parked-tests-2026-07-24.md`

> Governance policy — not a fix log. Future LLM or user
> encountering a parked root test failure during slice work
> should follow this policy verbatim.

---

## 1. What these parked tests are

Three parked tests under peaks-loop. Each pins a
**prose-contract lock** at a slice boundary:

| File | Pin | Slice |
|---|---|---|
| `tests/unit/code/checkpoint-periodic-frequency.test.ts` | `skills/peaks-code/SKILL.md` "Step N: Periodic checkpoint" prose hard-codes `20` tool calls | `2026-06-24-efficiency-4p-bundle` / G1 (P0.1) |
| `tests/unit/code/openspec-decoupled.test.ts` | `skills/peaks-code/SKILL.md` + `references/*.md` + `src/cli/commands/code-commands.ts` carry no openspec refs | `2026-07-08-openspec-decouple` (RR — Regression-Removed) |
| `tests/unit/skills/code-step-n-plus-2-prose.test.ts` | Step N+2 paragraph uses `0.85`/`0.95` thresholds + `peaks code context-now --json` | `2026-07-02-auto-compact-zero-pause` / AC-3 |

They are **honest tests, not flaky**, **parked because of fast-lane
scope**, not because the underlying behavior is broken.

## 2. Escalation SOP (LLM-executable)

### Scenario A — parked test fails on a user-encountered breakage

1. `git diff --name-only HEAD~1..HEAD | grep -E "skills/peaks-code/(SKILL.md|references/.*\.md)|src/cli/commands/code-commands.ts"` — confirm prose/code change.
2. If no relevant diff → **do not patch the parked test**. Apply `[DISABLED]` to CLI test invocation only via `--skip-tests`.
3. If diff IS the prose / code — read the slice that pinned the contract (see column 3 in §1). Compare the change against the slice design.
4. If intentional and matches the slice direction: update the parked test's constants to the new values (e.g. `20` → new cadence; `0.85`/`0.95` → new thresholds).
5. If unintentional (someone re-added a reference): **revert the change**, do not patch the test.
6. Sediment under `.peaks/memory/<date>-parked-test-fail-<short-slug>.md` with `[[2026-07-24-parked-tests-policy]]` backlink.

### Scenario B — parked test makes fast-lane slow

1. `grep -nE "\|fast\||\|io-heavy\||exclude:" vitest.config.ts` — confirm tiering exclusion paths.
2. If a parked test got accidentally promoted out of `|fast|`, demote it (config drift, not test drift).
3. Sediment the config change with `[[2026-07-24-parked-tests-policy]]` backlink.

### Scenario C — user asks "should I un-park these?"

1. **No** by default. Un-parking means re-running them on every change,
   slowing fast-lane and re-pinning contracts that the LLM has not earned
   the authority to relax.
2. The only legitimate un-park condition: a future slice explicitly
   re-uses the pinned values as a *baseline* and updates them via
   a tracked PRD handoff.

### Scenario D — user questions "why are these parked, not deleted?"

1. These are RR (regression-removed) and prose-contract guard tests.
   Removal would lose the contract. They are `parked`, not `deleted`.
2. If they're truly stale (no slice references them anymore),
   filing a slice to delete them is the right path — they are
   audit-trail evidence that a contract existed once. Sediment the
   contract-evolution in `.peaks/memory/<date>-contract-stale-<slug>.md`.

### Scenario E — non-anchoring concern (G1 audit-trail)

If the parked-test audit-trail goes missing (e.g. ephemeral layer
cleared, search engine cannot find this file), re-bootstrap from
`.peaks/memory/MEMORY.md` or rerun the L1-checklist at
`analysis/N4-parked-tests-2026-07-24.md` §4.

## 3. Idempotent re-run (next session)

```
$ ls tests/unit/code/checkpoint-periodic-frequency.test.ts tests/unit/code/openspec-decoupled.test.ts tests/unit/skills/code-step-n-plus-2-prose.test.ts
# expect 3 files
$ cat .peaks/memory/MEMORY.md | grep -E "parked-tests-policy|2026-07-24-parked" 
# expect hit
$ grep -nE "20( tool calls)?|0\.85|0\.95" skills/peaks-code/SKILL.md
# expect at least 3 hits, no `~20` approximation
```

If file paths or values diverge, re-pin per Scenario A §1-4.

## 4. Status

**Active.** This policy supersedes the ephemeral N4 audit-trail
for governance purposes; the N4 file remains the technical
provenance record. Both pointers must remain in
`.peaks/memory/index.json` (managed by
`peaks memory extract --apply`).

## 5. Sibling governance policies

This file is one of the 5+1 tracked governance policies for
session `2026-07-24-session-f13da7`. Adjacent concerns:

- **[[claude-code-end-to-end-2026-07-24]]** — B1 closure; the upstream state this policy assumes.
- **[[2026-07-24-multi-ide-adapter-policy]]** — adapter field verification; relevant if a parked-test pin references an IDE-specific surface.
- **[[2026-07-24-openspec-enforce-artifact-policy]]** — OpenSpec apply gate; relevant if an OpenSpec change tries to re-pin parked tests.
- **[[2026-07-24-sediment-pruning-policy]]** — memory size health; relevant if this policy grows past 9.4 kB Q90.
- **[[2026-07-24-b1-manifest-v2-b2-policy]]** — RID-008 Tier-1.1 inline PRD; orthogonal to parked tests.
- **[[2026-07-24-engineer-write-continuation-rid-008]]** — RID-008 closure record; documents this policy's reconciliation status.
- **[[2026-07-24-l1-f-slice-check-rid-policy]]** — L1.F slice-check `--rid` policy; relevant when re-pinning parked tests requires running `peaks slice check`.

End.
