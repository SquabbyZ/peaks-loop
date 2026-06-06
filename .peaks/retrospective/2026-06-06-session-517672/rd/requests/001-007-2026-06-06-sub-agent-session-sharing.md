# RD Request 007-2026-06-06-sub-agent-session-sharing

- session: 2026-06-06-session-517672
- change-id: 007-2026-06-06-sub-agent-session-sharing
- linked-prd: none (chore)
- linked-ui:  none
- type: chore
- source finding: post-slice-006 dogfood — `peaks request init` (and likely other session-creating CLI calls) **creates a new session every time it's invoked** when no explicit `--session-id` is passed, even if `.peaks/_runtime/session.json` already has a binding. The F3 fix for F13 ("3 consecutive `presence:set` calls = 1 session") only covers `peaks skill presence:set`; other CLI commands (`request init`, `request transition`, etc.) bypass the binding and create a new session on every call. This violates the user's design intent: "一个对话 = 一个 sid" (one conversation = one sid).

## Red-line scope

### In scope

**A. Make session-creating CLI commands respect the existing binding**
- `src/services/workspace/workspace-service.ts`: find ALL the code paths that create a new session (probably `initWorkspace`, `ensureSession`, or similar). The fix: when `.peaks/_runtime/session.json` exists with a valid `sessionId`, the call is a no-op (don't create a new session, don't overwrite the binding). When the file is missing, create a new session. **This is the F13 fix generalized from `presence:set` to ALL session-creating calls.**
- `src/services/session/session-manager.ts`: the `ensureSession` function's existing logic already returns the existing binding if one exists. Verify that ALL CLI commands (request init, request transition, request show, etc.) go through `ensureSession` (or the equivalent), NOT a parallel path that creates a new session.
- `src/cli/commands/request-commands.ts`: trace the call chain for `peaks request init`. If it doesn't go through `ensureSession`, FIX it to do so. (Likely: `request init` calls `createRequestArtifact` which doesn't go through `ensureSession` — the slice 006 scope creep moved the WRITE path to per-session but the call path still doesn't anchor a session.)
- `src/cli/commands/session-commands.ts`: ensure `peaks session title`, `peaks session info`, etc. don't create new sessions (they should be read-only on the existing binding).

**B. SKILL.md updates — sub-agent session sharing pattern**
- `skills/peaks-solo/SKILL.md`: add a "Sub-agent session sharing" section that documents:
  - One conversation = one session. The orchestrator anchors the binding at the start of the conversation via `peaks skill presence:set`.
  - When the orchestrator dispatches a sub-agent (RD, QA, etc.), the sub-agent prompt MUST include `--session-id <parent-sid>` (or the parent's sid) for any session-creating CLI call (`peaks request init --session-id <parent-sid>`, etc.).
  - The sub-agent does NOT call `peaks workspace init` (that would create a new session). The orchestrator has already done the anchor; the sub-agent inherits the binding from `.peaks/_runtime/session.json`.
  - When the sub-agent finishes, the orchestrator's binding is unchanged (the same session, no new dirs).
- `skills/peaks-rd/SKILL.md`, `skills/peaks-qa/SKILL.md`, `skills/peaks-ui/SKILL.md`, `skills/peaks-txt/SKILL.md`: add a one-line note in each: "When invoked as a sub-agent, use the parent's session id (read `.peaks/_runtime/session.json` or use `--session-id <parent-sid>`). Do NOT spawn your own session."

**C. `peaks session` enhancement for sub-agent inspection**
- `peaks session list` already exists (shows all session dirs). Verify it also shows the canonical binding prominently.
- `peaks session info <sid>` already exists. Add a new subcommand or extend `info`: `peaks session show-active` (or similar) that returns just the canonical session id from `.peaks/_runtime/session.json`. This is the "one command a sub-agent can call to find the parent's sid" primitive.

**D. Tests (TDD RED → GREEN → IMPROVE)**
- `tests/unit/request-commands.test.ts` (or wherever the request init test lives) — add:
  1. **2 consecutive `peaks request init` calls in a conversation reuse the bound session**: call `request init --id X`, verify the session.json still points to the same sid; call `request init --id Y`, verify the session.json is UNCHANGED (still the same sid), no new session dir created.
  2. **`peaks request init --session-id <sid>` explicitly binds to that sid**: verifies the existing behavior continues to work.
  3. **After a `peaks session rotate` (binding cleared), the next `request init` DOES create a new session** (this is the intended behavior when there's no binding).
- `tests/unit/workspace-service.test.ts` (or wherever initWorkspace is tested) — add:
  1. When `.peaks/_runtime/session.json` exists with sid=X, calling `initWorkspace` is a no-op (no new dir, no binding change).
  2. When the binding is missing, `initWorkspace` creates a new session.
- `tests/unit/session-manager.test.ts` — add:
  1. `ensureSession` returns the existing sid when one is bound; creates a new one when not.

**E. Doctor check update (scope-creep from original plan)**
- `src/services/doctor/doctor-service.ts`: the existing `build:workspace-layout-canonical` check currently verifies "no top-level session dirs, no legacy dotfiles". Extend it to also check "no per-change-id top-level dirs" (i.e., no `.peaks/<YYYY-MM-DD-...>` dirs of the per-change-id format). The user's design explicitly says there should be no per-change-id dirs at top level. After this slice, that check covers it.
- The check is a small addition: 5-10 lines + 1 test.

### Explicit out of scope (deferred to later slices)

- **Slice 008**: data migration of the 5 already-shipped slices' artifacts from `.peaks/00X-2026-06-06-.../rd/requests/...` to `_runtime/<sid>/rd/requests/...` + deletion of the per-change-id top-level dirs. The new doctor check added in this slice will start reporting these as `ok: false` until slice 008 migrates them.
- **Removing the 4 orphan session dirs** (4eec41, 5ca335, 80ba3d, 7bcb6e) — manual cleanup, user-authorized separately.
- **`peaks retrospective curate` CLI** — separate slice.
- **Sub-agent's internal behavior** (e.g., making `peaks-rd` re-use the parent's session) — handled by the SKILL.md updates + the `--session-id` flag pattern, NOT by hard-coding behavior in `peaks-rd` source.

## Standards preflight

- No new files. `peaks standards init --dry-run` is a no-op (all 5 files `existing`). `peaks standards update --dry-run` would `append` to CLAUDE.md; **not applied** (consistent with prior slices).
- Standards increment for THIS slice: zero (workflow + doctor scope change, not a convention change).

## OpenSpec linkage

- None. This is a workflow enforcement + behavior fix; not a tracked change.

## Coverage status

- New code: 100% covered on the session-id-respecting paths. The 3+3+1 new tests above.
- Gate verdict: **pass** if the 7 new tests pass and existing tests still pass.

## Slice contract

- **Slice id:** `007-2026-06-06-sub-agent-session-sharing`
- **Functional boundary:** ALL session-creating CLI commands respect the existing binding. Sub-agent prompts use `--session-id <parent-sid>` explicitly. SKILL.md documents the pattern. The `build:workspace-layout-canonical` check is broadened to catch per-change-id top-level dirs (which the user's design explicitly disallows).
- **Pre-fix behaviour:** `peaks request init` (and similar session-creating commands) **creates a new session every time** if no explicit `--session-id` is passed. The F3 fix for F13 only covered `peaks skill presence:set`; other commands bypass the binding. This produces orphan session dirs (4eec41, 5ca335, 80ba3d, 7bcb6e were all created this way).
- **Target behaviour:**
  - `peaks request init` (no `--session-id`): reads `.peaks/_runtime/session.json`; if a valid binding exists, uses that sid; only creates a new session if the binding is missing or invalid. Result: 3 consecutive `request init` calls in a conversation = 1 session, 0 new dirs.
  - `peaks request init --session-id <sid>`: explicitly binds to that sid (existing behavior preserved).
  - `peaks session show-active` (or `peaks session info` extension): returns the canonical sid from `.peaks/_runtime/session.json` — the "one command a sub-agent runs to find the parent's sid" primitive.
  - `build:workspace-layout-canonical` check (extended): returns `ok: false` if any per-change-id top-level dir (`.peaks/<YYYY-MM-DD-...>`) exists.
- **Acceptance checks:**
  - On the current repo (with binding `517672` at the time of the test), 3 consecutive `peaks request init --id X` calls produce NO new session dirs (BEFORE=N, AFTER=N).
  - The `peaks session show-active` (or equivalent) command returns the canonical sid from the binding.
  - `peaks request init --session-id <sid>` binds explicitly (existing behavior preserved).
  - The new `build:workspace-layout-canonical` check reports `ok: false` because the 5 already-shipped slices' per-change-id dirs exist. (After slice 008 migrates them, the check returns `ok: true`.)
  - SKILL.md files updated: peaks-solo has a "Sub-agent session sharing" section; peaks-rd/qa/ui/txt each have a one-line note.
  - 7 new tests pass; existing tests still pass.
  - `pnpm typecheck` passes.
- **Rollback plan:** revert the commit. The session-respecting code path change is additive (existing behavior preserved when --session-id is passed); reverting it returns to the F3 behavior (new session per call). The SKILL.md updates are doc-only; no rollback risk.
- **Commit boundary:** one commit on `main`, type `chore(workspace)`, scope ≤ 8 files (3 source + 4 SKILL.md + 1 doctor test). Per `main-branch-iteration` + `commits-belong-to-the-human` + `peaks-current-directory-scope` memories: edit main, no worktree, no AI trailer, user commits with global gitconfig.

## Implementation evidence (required before handoff)

- `git diff --stat` paths: must include only the 8 declared files.
- Test command + output: `pnpm vitest run` — full suite. New tests pass; existing tests still pass. Capture the last 30 lines.
- Type check: `pnpm typecheck` — must pass.
- Smoke test (dogfood per dev-preference): after the change, on the current repo:
  ```bash
  cd "C:/Users/smallMark/Desktop/peaks-cli"
  
  # 1. Confirm 3 consecutive request init calls do NOT spawn new sessions
  BEFORE=$(find .peaks/_runtime/2026-*-session-*/ -maxdepth 0 2>/dev/null | wc -l)
  echo "BEFORE: $BEFORE"
  npx tsx src/cli/index.ts request init --id test-a --role rd --type chore --project . 2>&1 | tail -3
  npx tsx src/cli/index.ts request init --id test-b --role rd --type chore --project . 2>&1 | tail -3
  npx tsx src/cli/index.ts request init --id test-c --role rd --type chore --project . 2>&1 | tail -3
  AFTER=$(find .peaks/_runtime/2026-*-session-*/ -maxdepth 0 2>/dev/null | wc -l)
  echo "AFTER: $AFTER (should be equal to BEFORE)"
  
  # 2. Confirm the new doctor check fires
  npx tsx src/cli/index.ts doctor --json 2>&1 | grep -A 4 "build:workspace-layout-canonical" | head -8
  # Expected: ok: false (5 already-shipped slices' per-change-id dirs exist)
  ```

## MCP usage

- None.

## Handoff

- to peaks-qa: skipped (chore, no QA gate per SKILL.md gate matrix). The smoke test in "Implementation evidence" is the de-facto verification.
- to peaks-sc: `.peaks/007-2026-06-06-sub-agent-session-sharing/sc/commit-boundaries/007-2026-06-06-sub-agent-session-sharing.md` — describe the commit boundary (single commit, ~8 files, ~200 insertions, ~50 deletions).

## Status

- created: 2026-06-05T20:31:21.756Z
- last update: 2026-06-06T05:29:32.198Z
- state: handed-off
