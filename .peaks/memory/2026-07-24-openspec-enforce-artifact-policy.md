# OpenSpec `enforce-artifact-boundary-and-coverage` Policy — peaks-loop governance

**Date:** 2026-07-24
**Session:** `2026-07-24-session-f13da7`
**Rid:** `2026-07-24-rid-003-n5-openspec-enforce-artifact`
**Sources:**
- `openspec/changes/enforce-artifact-boundary-and-coverage/proposal.md`
- `openspec/changes/enforce-artifact-boundary-and-coverage/tasks.md`
- `.peaks/_runtime/<sid>/analysis/` (this session's audit-trail)

> Governance policy for the OpenSpec change-id
> `enforce-artifact-boundary-and-coverage`, which is the
> **dependency root** of the active OpenSpec chain.

## 1. Change metadata (verbatim from proposal.md)

- **Why**: planner commands must keep `.peaks/changes/<change-id>/`
  outside the target repo by default; newly included modules
  must reach 100% unit coverage.
- **What Changes**: shared artifact workspace boundary for
  `.peaks/changes/<change-id>/...` outputs; validation for change
  ids + artifact-relative paths; dry-run preview/persist logic;
  the completion gate; preservation of 100% coverage thresholds.
- **Out of Scope**: remote artifact repo sync; auto commit/push;
  unrelated coverage exclusions; UI workflows.
- **Dependencies**: must land **before or together with**
  `add-tech-dry-run-gate` and `add-rd-swarm-dry-run-planner`.
- **Risks**: too-strict workspace blocking useful previews;
  too-permissive fallback polluting target repo with
  orchestration state; coverage bypass by excluding modules.
- **AC** (5 bullets — full text in proposal.md).

## 2. tasks.md structure (3 sections)

1. **Change id validation** — validator for IDs (rejects empty, `.`, `..`, separators, drive prefixes, URL-like, traversal).
2. **Artifact path planning helpers** — relative-path generation; resolved paths stay under workspace; `/` separators cross-platform.
3. **Workspace unavailable responses** — `preview-only` (when dry-run persistence not required) vs `blocked` (when persistence required).

(Plus upstream excerpts: completion gate = `pnpm test` + `pnpm typecheck` + `pnpm test:coverage`; coverage metrics 100% statements / branches / functions / lines.)

## 3. Dependency chain (corrected per Step N self-audit)

```
                                ┌── add-tech-dry-run-gate
enforce-artifact-boundary-and-coverage  ──┤
                                └── add-rd-swarm-dry-run-planner  ──┬── add-autonomous-rd-swarm-resume
                                                                    └── (rd-swarm chain)

Indep ── add-slice-topology-multipass
Indep ── fix-claude-settings-template-hook-node-wrapper
```

Count: **1 root** + **4 dependents** (strict chain) + **2 independents**.

## 4. Escalation SOP — LLM-executable

### Scenario A — user asks "should we apply this change?"

**Do not apply**. Apply requires:

1. **Pre-condition 1**: every `[ ]` in `tasks.md` (sections 1-3) is `[x]`. If not, the change is not yet implemented.
2. **Pre-condition 2**: 100% coverage threshold verified (per proposal.md AC5).
3. **Pre-condition 3**: `pnpm test` + `pnpm typecheck` + `pnpm test:coverage` all pass.
4. **Pre-condition 4**: downstream dependents (`add-tech-dry-run-gate`, `add-rd-swarm-dry-run-planner`) explicitly declare they will build atop this root.

Without all four, applying the change breaks the dependency chain that other proposals rely on.

### Scenario B — user asks "what blocks applying this change now?"

Run:

```
$ grep -c "^\s*-\s*\[\]" openspec/changes/enforce-artifact-boundary-and-coverage/tasks.md   # count unchecked
$ grep -c "^\s*-\s*\[x\]" openspec/changes/enforce-artifact-boundary-and-coverage/tasks.md   # count checked
$ peaks test --run-tests --changed --no-cache --json 2>&1 | tail -30
$ peaks standards lint --category loop-engineering 2>&1 | tail -10
```

Open vs checked counter pair is the diagnostic; if `[ ]` ≫ `[x]`, the change is in proposal-stage and not yet implementable.

### Scenario C — user wants to "de-risk by applying this first"

Even though this is the dependency root, **applying without the dependents raises risk**:

- Apply on its own = defines the workspace + change-id validator + coverage threshold rules.
- Without `add-tech-dry-run-gate`: tech planner commands don't actually consume the new validator yet, so applying is symbolic.
- Without `add-rd-swarm-dry-run-planner`: same — RD planner doesn't consume it.

So apply **only** if the user has an external reason (e.g. "I want the validator to ship alone"). Otherwise wait until dependents are also approved.

### Scenario D — proposal.md references policies that don't exist

Each `tasks.md` checkbox reference is to existing peak-loop surfaces (validation helpers, path planning, workspace unavailable response). Before marking `[x]`, verify the referenced implementation actually landed in src/ via `git log --follow <file>`.

## 5. Idempotent re-run (next session)

```
$ ls openspec/changes/enforce-artifact-boundary-and-coverage/   # expect 3 files + specs/
$ grep -c "^\s*-\s*\[\]" openspec/changes/enforce-artifact-boundary-and-coverage/tasks.md
$ grep -E "## Dependencies" -A 5 openspec/changes/enforce-artifact-boundary-and-coverage/proposal.md
$ cat .peaks/memory/MEMORY.md | grep -E "2026-07-24-openspec-enforce"   # expect ≥1
```

If file state or dependency text drifts, re-pin via §1-3 of this policy.

## 6. Status

**Active.** This is the formal governance surface for the
dependency-root OpenSpec change. The change itself is in
proposal-stage (tasks.md `[ ]` items not yet implemented).
Apply-path remains gated on the 4 pre-conditions in §4.

## 7. Sibling governance policies

This file is one of the 5+1 tracked governance policies for
session `2026-07-24-session-f13da7`. For adjacent concerns,
see the parallel files at `.peaks/memory/`:

- **[[claude-code-end-to-end-2026-07-24]]** — B1 closure (Claude Code end-to-end verified; the upstream state this policy assumes).
- **[[2026-07-24-parked-tests-policy]]** — 3-parked-tests governance; relevant when OpenSpec apply triggers test changes.
- **[[2026-07-24-multi-ide-adapter-policy]]** — adapter field verification; relevant if OpenSpec apply ships a new IDE surface.
- **[[2026-07-24-sediment-pruning-policy]]** — memory size health; relevant when this policy's sediment grows past the 9.4 kB Q90 threshold.
- **[[2026-07-24-b1-manifest-v2-b2-policy]]** — manifest v2-b2 schema; relevant if apply changes the role/manifest.json shape.
- **[[2026-07-24-engineer-write-continuation-rid-008]]** — RID-008 closure record; documents when this policy was last reconciled.
- **[[2026-07-24-l1-f-slice-check-rid-policy]]** — L1.F slice-check `--rid` policy; orthogonal to OpenSpec apply.
