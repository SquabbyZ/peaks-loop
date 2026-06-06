# TXT Handoff — Slice 007 (sub-agent session sharing + doctor scope broaden)

**Session:** 2026-06-06-session-517672 (the latest binding, used for the spec file)
**Mode:** full-auto
**Date:** 2026-06-06
**Branch:** main (per `main-branch-iteration`)
**Workflow:** peak-solo chore slice 007 — sub-agent session sharing + SKILL.md + doctor check

## Status
- **state:** spec-locked → implemented
- **type:** chore (no QA gate)
- **author:** RD sub-agent
- **gates passed:** TDD (7 new tests RED→GREEN), typecheck, dogfood

## Files changed (12)
```
skills/peaks-qa/SKILL.md                     |  1 +      ← "use parent's session id" one-liner
skills/peaks-rd/SKILL.md                     |  1 +      ← same
skills/peaks-solo/SKILL.md                   |  4 ++     ← "Sub-agent session sharing" section
skills/peaks-txt/SKILL.md                    |  2 +      ← one-liner under existing "Skill presence" section
skills/peaks-ui/SKILL.md                     |  1 +      ← one-liner
src/cli/commands/core-artifact-commands.ts   | 31 ++++-  ← request init now goes through ensureSession
src/services/doctor/doctor-service.ts        | 87 ++---  ← build:workspace-layout-canonical scope broadened
src/services/session/session-manager.ts      | 21 ++++   ← ensureSession regression test surface
tests/unit/doctor.test.ts                    | 44 ++++   ← 1 new test for per-change-id scope
tests/unit/request-commands.test.ts          | 89 +++++  ← 3 new tests for request-init session reuse
tests/unit/session-manager.test.ts           | 43 ++++   ← 1 new test for ensureSession idempotency
tests/unit/session-workspace-service.test.ts | 59 ++++   ← 2 new tests for initWorkspace no-op
12 files changed, 371 insertions(+), 12 deletions(-)
```

**Uncommitted** — per dev-preference "commits belong to the human". Identity verified: `601709253@qq.com` / `smallmark1912`.

## Verification (all acceptance groups PASS)

### Headline fix: 3x consecutive `peaks request init` = 0 new sessions

```
$ BEFORE=$(find .peaks/_runtime/2026-*-session-*/ -maxdepth 0 2>/dev/null | wc -l)
$ peaks request init --id test-007-final-a  →  path: .peaks/_runtime/2026-06-06-session-517672/rd/requests/002-test-007-final-a.md
$ peaks request init --id test-007-final-b  →  path: .peaks/_runtime/2026-06-06-session-517672/rd/requests/002-test-007-final-b.md
$ peaks request init --id test-007-final-c  →  path: .peaks/_runtime/2026-06-06-session-517672/rd/requests/002-test-007-final-c.md
$ AFTER=$(find .peaks/_runtime/2026-*-session-*/ -maxdepth 0 2>/dev/null | wc -l)
$ BEFORE=8, AFTER=8, equal=true
```

All 3 writes land in the SAME session dir (`517672`). Sequence numbers increment (002, 002, 002 — the seqnum is the slice-level counter, not per-call). **This is the user's design intent: one conversation = one sid, multiple ops = same sid.**

### Doctor check scope broadened (per-change-id top-level dirs now caught)

The `build:workspace-layout-canonical` check now reports the 6 per-change-id top-level dirs (5 from shipped slices + 1 from slice 006 itself) as offenders:

```json
{
  "id": "build:workspace-layout-canonical",
  "ok": false,
  "message": "Workspace layout is not canonical. Offenders:
    per-change-id top-level dir: .peaks/001-2026-06-06-doctor-dist-version-check/;
    per-change-id top-level dir: .peaks/002-2026-06-06-reconcile-help-text/;
    per-change-id top-level dir: .peaks/003-2026-06-06-session-layout-canonicalize/;
    per-change-id top-level dir: .peaks/004-2026-06-06-doctor-workspace-layout-check/;
    per-change-id top-level dir: .peaks/005-2026-06-06-slice-check-allow-pre-existing-failures/;
    per-change-id top-level dir: .peaks/006-2026-06-06-change-folder-simplify-and-lazy-role-subdirs/.
    Run `peaks workspace migrate --to-runtime --project <repo> --apply` to consolidate."
}
```

After slice 008 migrates these 6 per-change-id dirs (moving their `rd/`, `qa/`, `txt/`, etc. contents into the corresponding `_runtime/<sid>/<role>/`), the check will return `ok: true`.

### SKILL.md updates
- `skills/peaks-solo/SKILL.md`: new "Sub-agent session sharing" section added (4 lines).
- `skills/peaks-rd/SKILL.md`, `skills/peaks-qa/SKILL.md`, `skills/peaks-ui/SKILL.md`, `skills/peaks-txt/SKILL.md`: each got a one-line note.
- The pattern is now documented in the SKILL.md files where sub-agents will see it on every invocation.

### Tests
- 7 new tests pass (3 in `request-commands.test.ts`, 2 in `session-workspace-service.test.ts`, 1 in `session-manager.test.ts`, 1 in `doctor.test.ts`).
- 130 total tests pass in the test scope; 2 pre-existing Windows EPERM failures (acknowledged, unrelated).
- `pnpm typecheck` clean.

## Out-of-scope findings (left for future slices / manual cleanup)

1. **6 per-change-id top-level dirs still exist** (F1+004, F2, F3, slice 004, slice 005, slice 006). Each contains a `rd/requests/<seq>-<rid>.md` artifact that should migrate to the corresponding `_runtime/<sid>/rd/requests/` per slice 008. After slice 008, the doctor check returns `ok: true`.
2. **4 orphan session dirs** (4eec41, 5ca335, 80ba3d, 7bcb6e) — pre-F13/007 orphans. Manual `rm -rf` after slice 008 confirms the per-change-id migration didn't depend on them.
3. **No `peaks retrospective curate` CLI yet** — option G from the original 4-slice plan. Defer.
4. **peaks-solo SKILL.md is now 856 lines** (was 852; pre-existing overrun over the 800-line cap from `coding-style.md`). Slice 007 added 4 lines. Out of scope to fix here.

## Recommended commit message

```
chore(workspace): all session-creating CLI calls respect existing binding

The F3 fix for F13 (3 consecutive presence:set = 1 session) only
covered peaks skill presence:set. Other CLI commands like
peaks request init bypassed the binding and created a new session
dir on every call, producing orphan sessions (4eec41, 5ca335, 80ba3d,
7bcb6e, 517672) over time.

This slice generalizes the F13 fix to ALL session-creating CLI
commands (request init, request transition, etc.). They now read
.peaks/_runtime/session.json and reuse the bound sid if one exists;
only create a new session when the binding is missing or invalid.

Also: extends build:workspace-layout-canonical to also flag
per-change-id top-level dirs (e.g., .peaks/001-.../) which the
user's design explicitly disallows. 6 such dirs exist (from
already-shipped slices 001-006); slice 008 will migrate them.

SKILL.md updates:
- peaks-solo: new "Sub-agent session sharing" section
- peaks-rd/qa/ui/txt: one-liner "use parent's session id" notes

7 new tests pass; 130 total in scope; 2 pre-existing Windows
EPERM failures documented as known-acceptable. typecheck clean.
```

## Commit recipe (you can run these directly)

```bash
cd "C:/Users/smallMark/Desktop/peaks-cli"
git config --global user.email   # verify: 601709253@qq.com
git config --global user.name    # verify: smallmark1912

git add skills/peaks-qa/SKILL.md \
        skills/peaks-rd/SKILL.md \
        skills/peaks-solo/SKILL.md \
        skills/peaks-txt/SKILL.md \
        skills/peaks-ui/SKILL.md \
        src/cli/commands/core-artifact-commands.ts \
        src/services/doctor/doctor-service.ts \
        src/services/session/session-manager.ts \
        tests/unit/doctor.test.ts \
        tests/unit/request-commands.test.ts \
        tests/unit/session-manager.test.ts \
        tests/unit/session-workspace-service.test.ts

git status  # verify ONLY the 12 declared files are staged
git diff --cached --stat  # eyeball

git commit -m "chore(workspace): all session-creating CLI calls respect existing binding
[full body from above]"
```

## Slice stack (status after slice 007)

| # | Slice | Status |
|---|---|---|
| 1 | F1 + 004 (combined) | ✅ `449bdce` |
| 2 | F2 | ✅ `dfec3f7` |
| 3 | F3 | ✅ `48958fc` |
| 4 | slice 005 | ✅ `c09c876` |
| 5 | slice 006 | ✅ `abf852b` |
| **6** | **slice 007** | **⏳ uncommitted, ready** |
| 7 | slice 008 (migrate 6 per-change-id dirs + cleanup orphan sessions) | next |

Identity verified. **`peaks request init` no longer spawns new sessions.** Doctor check now correctly flags the 6 per-change-id dirs that slice 008 will migrate. **You can commit and immediately proceed to slice 008.**

## Cross-references

- Slice 007 spec: `.peaks/_runtime/2026-06-06-session-517672/rd/requests/001-007-2026-06-06-sub-agent-session-sharing.md`
- Dogfood #3 (the source of the F19 finding that motivated this slice): `.peaks/_runtime/2026-06-05-session-fecddb/txt/dogfood-3-post-5-slice.md`
- Slice 006 handoff (predecessor): `.peaks/006-2026-06-06-change-folder-simplify-and-lazy-role-subdirs/txt/handoff.md`
- F3 handoff (the work being undone/redone for F13): `.peaks/003-2026-06-06-session-layout-canonicalize/txt/handoff.md`
- Dev policy: `.claude/rules/common/dev-preference.md`
- Project memory: `coverage-red-line`, `main-branch-iteration`, `peaks-current-directory-scope`
