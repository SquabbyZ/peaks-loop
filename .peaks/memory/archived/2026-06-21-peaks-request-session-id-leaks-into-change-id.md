---
archived: 2026-06-29
reason: v2.16.0-alpha change-id axis scope reduction
status: archived
name: peaks-request-session-id-leaks-into-change-id
description: peaks-loop CLI bug — `request init/transition --session-id X` writes envelope to `.peaks/X/...` (change-id dir) instead of `.peaks/_runtime/<sid>/...`, violating the two-axis naming convention. Discoverer: Plan 1 ship wave on 2026-06-21.
metadata:
  type: bug
---

**Bug location:** `src/cli/commands/request-commands.ts:194-201`

```ts
if (options.sessionId !== undefined) {
  serviceOptions.sessionId = options.sessionId;
  // Back-compat: pre-1.3.0 the `--session-id <scope>` flag also
  // set the on-disk dir name. Preserve that by passing the same
  // value as the explicit change-id; the service still records
  // the session binding separately in the artifact body.
  serviceOptions.changeId = options.sessionId;  // ← WRONG
}
```

**Why:** The "back-compat" comment is misleading — pre-1.3.0 the on-disk
dir was session-keyed, but peaks-code SKILL.md now mandates two
orthogonal axes (change-id at `.peaks/_runtime/<changeId>/` vs session-id at
`.peaks/_runtime/<sessionId>/`). Mirroring `--session-id` into
`changeId` collapses them.

**Symptom:** Running
`peaks request transition <rid> --session-id <sid> --apply` writes the
envelope to `.peaks/_runtime/<sid>/rd/tech-doc.md` (NOT `.peaks/_runtime/<sid>/rd/tech-doc.md`).

If the session-id happens to match the `.peaks/2026-*-*/` gitignore
pattern, the dir is silently ignored and looks "fine" in `git status`
— but the artifact is on the wrong axis, and downstream consumers
(`peaks workflow verify-pipeline`) only find it because verify-pipeline
searches both roots.

**Carry-forward:** This is a pre-existing CLI bug, not a Plan 1
regression. Plan 2 (peaks-mut) should add a preflight task:

- Task 0 / preflight: open an RD slice to remove the back-compat line
  and add a regression test asserting
  `peaks request init --session-id <sid> --apply` writes under
  `.peaks/_runtime/<sid>/...` exclusively.
- Severity: MEDIUM. Doesn't break ship (verify-pipeline tolerates both
  roots today), but leaks axis semantics, makes cross-machine handoff
  fragile (Mac clone won't see `.peaks/_runtime/<sid>/` because gitignore hides
  it AND because it's only created when CLI runs locally).

**Why:** Why I should remember this: in Plan 1 ship wave I noticed
`.peaks/2026-06-21-session-6fefac/` was being created (a directory
matching the session-id) and thought the CLI was misbehaving. Root
cause is the back-compat line above. Fix in Plan 2 or later; do NOT
fix in Plan 1 ship (out of scope, would invalidate the working-tree
that just shipped).

**How to apply:** When you see `.peaks/_runtime/<sessionIdShape>/` directories
appear in `git status` (or in `ls .peaks/`), check `request-commands.ts`
to confirm whether the CLI is the source. If yes, this is the same
bug — don't try to delete the dir manually (it'll just come back on
next transition). The dir is also gitignored, so it's harmless on the
working tree; the real harm is the cross-machine handoff problem.

---

## Followup (Plan 1 followup hotfix)

Status: **fixed** by `fix(plan1-followup): envelope is one-axis
(.peaks/_runtime/<sid>/ only)` — commit `5cd4c87`.

What changed:

- `src/cli/commands/request-commands.ts` — deleted the
  `serviceOptions.changeId = options.sessionId;` back-compat line.
  The `--session-id` flag now ONLY sets the session binding; the
  on-disk root is always `.peaks/_runtime/<sessionId>/<role>/...`.
  `--session-id` is enforced as required: omitting it (or passing
  an empty value) fails with `SESSION_ID_REQUIRED`.
- `src/services/artifacts/request-artifact-service.ts` — removed
  the dual-root scan in `listRequestArtifacts` and
  `showRequestArtifact`. Both now scan only
  `.peaks/_runtime/<sid>/<role>/requests/`. The pre-F3 legacy
  `.peaks/_runtime/<sid>/<role>/requests/` home is no longer read or
  written.
- `src/cli/commands/workflow-commands.ts` — `peaks workflow
  verify-pipeline` description now documents the one-axis scan.
  The CLI itself does not embed dual-root logic; it goes through
  the service.
- `.gitignore` — deleted the `.peaks/2026-*-*/` rule. The CLI
  no longer creates `.peaks/_runtime/<id>/` dirs, so the broad ignore is
  no longer needed.
- `tests/unit/cli/commands/request-commands.test.ts` (new) — pins
  the one-axis invariant: envelope lands ONLY at
  `.peaks/_runtime/<sid>/...`, missing `--session-id` fails with
  `SESSION_ID_REQUIRED`, and the legacy `--change-id` flag is
  rejected by the commander parser.

The legacy `.peaks/2026-06-21-session-6fefac/` dir from the Plan 1
ship wave remains on disk (gitignored by `peaks/` shape, not
re-created by the CLI). It is harmless.