# OpenSpec Apply Command — Drift Discovery

**Date:** 2026-07-24
**Session:** `2026-07-24-session-f13da7`
**Author:** MiniMax (Opus 4.8) — engineer-write ACTIVE
**Status:** Drift found + decision documented

> This file documents a **drift finding** between
> the documented apply command in
> `openspec-enforce-artifact-policy.md` §4 and the
> actual CLI surface in peaks-loop 4.0.0-beta.34.
> The drift is **not a bug** — the actual apply path
> is the `archive` command with `--apply`. The
> tasks.md checkbox gate is a **project convention**,
> not enforced by the CLI.

---

## 1. Documented vs actual

`openspec-enforce-artifact-policy.md` §4 references:

> "Pre-condition 1: every `[ ]` in `tasks.md` (sections 1-3) is `[x]`. If not, the change is not yet implemented."

This implies a hard `peaks openspec apply <changeId>` CLI command that validates the gate. **That command does not exist.**

The actual `peaks openspec --help` (peaks-loop 4.0.0-beta.34) shows:

```
Commands:
  list, show, to-rd, render, validate, archive, init, from-doctor
```

**No `apply`.** The real apply path is:

```
$ peaks openspec archive <changeId> --apply
```

Per the `archive` help: *"Move an OpenSpec change under openspec/changes/<archiveDir>/<id>/"*. This is the "apply" path — it moves the change to `archive/` after the work is done.

## 2. What the dry-run reveals

```
$ peaks openspec archive enforce-artifact-boundary-and-coverage --json
{
  "ok": true,
  "command": "openspec.archive",
  "data": {
    "changeId": "enforce-artifact-boundary-and-coverage",
    "from": ".../openspec/changes/enforce-artifact-boundary-and-coverage",
    "to": ".../openspec/changes/archive/enforce-artifact-boundary-and-coverage",
    "applied": false   # dry-run
  },
  "warnings": [],
  "nextActions": ["Re-run with --apply to move ..."]
}
```

The archive command **does not validate the tasks.md `[ ]` → `[x]` gate**. It will happily move a change with 21 unchecked boxes.

## 3. Why we still should NOT apply (G5 no-fake-green)

The policy §4 pre-condition is a **project convention**, not a CLI gate. The project maintains the gate honestly. Specifically:

- **rid-009 sub-slices 1-3 shipped the helpers** (`validateChangeId`, `planArtifactPath`, `buildWorkspaceUnavailable`, `isPathInsideArtifactRoot`) — 42/42 tests green
- **But the consumer-side integration is NOT done** — tasks like "Reuse the validator in tech and RD planner commands" (Section 1 Task 4) require the dependent proposals `add-tech-dry-run-gate` + `add-rd-swarm-dry-run-planner` to land first
- **The downstream consumers haven't called the new helpers** — the integration is what makes the change "applied", not the helper modules existing

Per G5 no-fake-green: marking all 21 boxes as `[x]` because the helpers exist would be **fake-green** because the consumer-side integration is not in this proposal's scope. The policy's intent is correct; the CLI enforcement is missing.

## 4. Correct sequencing for rid-009 apply

The 21 tasks split into 2 categories:

| Category | Tasks | Status |
|---|---|---|
| Helper implementation (this proposal's scope) | 12 tasks (1-3 of section 1 + 2 + 3) | ✅ Implemented + tested (42/42) |
| Consumer integration (downstream proposals' scope) | 4 tasks (Section 1 task 4 + Section 2 tasks 4-5 + Section 3 task 4) | ❌ Not in this proposal |
| Coverage gate | 3 tasks (Section 4) | ❌ B1 still open |
| Verification | 5 tasks (Section 5) | ⚠ Partial: pnpm test + typecheck pass; coverage + reviews deferred |

**Total: 12/21 implementable in this proposal; 9/21 require downstream work or tooling fixes.**

## 5. Recommendation

The `openspec-enforce-artifact-policy.md` §4 should be updated to reflect the actual CLI:
- Replace "peaks openspec apply" with "peaks openspec archive <changeId> --apply"
- Note that the tasks.md gate is a **project convention**, not CLI-enforced
- The G5 no-fake-green check is the human/audit layer, not the CLI

The dependent proposals (`add-tech-dry-run-gate` + `add-rd-swarm-dry-run-planner`) should land BEFORE `peaks openspec archive enforce-artifact-boundary-and-coverage --apply`. Only then will all 21 boxes be honestly checkable.

## 6. Status

**Drift documented.** No CLI changes required. The policy is internally consistent; it just documents a non-existent CLI command. Future update: rewrite the policy to reference the actual `archive --apply` command + the project-convention gate.

End.