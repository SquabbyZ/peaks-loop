# Sub-Agent Merge-Back and End-to-End Verification Design

**Date:** 2026-08-01
**Status:** Approved design; implementation not started

## Goal

Make every downstream project's sub-agent dispatch honor three contract requirements:

1. **Sub-agent branches are merged back to the caller's working branch automatically** by the parent session after the dispatch report is returned. The parent session owns the merge; the sub-agent only commits to its own branch.
2. **Concurrent playwright MCP browser sessions are isolated by Chromium profile** so the same MCP server can serve multiple in-flight sub-agents without state contamination. The MCP server process is shared; the user-data-dir and profile name are unique per dispatch.
3. **A single end-to-end Playwright UI verification** runs after the merge-back. It is owned by the parent session, not by the sub-agent.

This rule ships through the peaks-loop npm package so every downstream project gets it on `npm install`.

## Behaviour contract

### 1. Sub-agent commits to its own branch only

- A dispatched sub-agent that needs filesystem worktree isolation calls `peaks worktree spawn` from inside its tool-call.
- The sub-agent **does NOT** call `git merge`, `git pull`, `git rebase`, or `peaks worktree release` on its own. Its only contract with the worktree lifecycle is: commit (locally) and report the result.
- The dispatch record on disk records `branch`, `worktreePath`, and `isolationStartedAt`.

### 2. Parent session auto-merges back to caller branch

After the sub-agent returns its dispatch envelope, the parent session runs the merge pipeline:

1. Detect the caller's current branch via `git symbolic-ref --short HEAD` at the caller's CWD.
2. If the caller's current branch is `main` and the sub-agent branch is also rooted at `main`, run `git merge --ff-only <sub-agent-branch>` so the merge stays linear. If fast-forward is not possible, escalate to the parent.
3. If the caller is on a feature branch, run `git merge --no-ff <sub-agent-branch>` to preserve the merge shape.
4. After a successful merge, run `peaks worktree release --lease-id <id>` to clean up the worktree and drop the worktree branch.
5. Append a dispatch event (`category: 'dispatch.merge'`) to the metrics stream so a downstream dashboard can observe the merge shape.

If merge conflicts are present, the parent session surfaces them and waits for explicit user decision. The sub-agent is not re-invoked for conflict resolution.

### 3. Playwright MCP profile isolation

The downstream project's `peaks hooks install` and `peaks sub-agent dispatch` together produce these environment variables for the MCP server:

- `PLAYWRIGHT_BROWSERS_PATH` (existing): single browser install path, shared.
- `PEAKS_PLAYWRIGHT_USER_DATA_DIR`: a per-dispatch sub-directory under `.peaks/_runtime/<sessionId>/pw-profiles/<dispatchId>/`.
- `PEAKS_PLAYWRIGHT_PROFILE_NAME`: a per-dispatch profile name, e.g. `dispatch-<short-uuid>`.

The MCP server reads both env vars and launches Chromium with `--user-data-dir=<PEAKS_PLAYWRIGHT_USER_DATA_DIR> --profile-directory=<PEAKS_PLAYWRIGHT_PROFILE_NAME>`. Token impact is zero (no extra LLM call; just a different CLI flag). State contamination across dispatches is impossible because each profile has its own cookies, storage, and service workers.

The existing peaks-loop dispatch system already supports environment stamping via the `toolCall.args.env` block. The MCP env vars join the existing `PEAKS_SUB_AGENT_DISPATCH_PROVENANCE` / `PEAKS_WORKTREE_LEASE_ID` set; no new env schema.

### 4. Post-merge E2E verification (single run)

After the merge-back succeeds, the parent session runs the verification:

1. Read the slice's `qa/e2e/` directory if it exists. Each file describes one Playwright scenario with `name`, `url`, and `matchers` (e.g. visible text / selector). If the directory is empty or absent, skip and emit `E2E_SKIPPED_NO_FIXTURES`.
2. Spawn exactly ONE Playwright MCP session with a project-level profile (not per-dispatch) and run each fixture sequentially.
3. Emit a `dispatch.e2e` observability event with `passCount`, `failCount`, and `skippedReason`. A failure does not automatically roll back the merge; the parent session surfaces the report and waits for the user.

This step is mandatory in the dispatched slice contract. Sub-agents are told: "do not run E2E; the parent will run it after merge." This avoids the duplicate / conflicting E2E runs that produce misleading results.

### 5. Sub-agent shutdown hook — kill long-lived services before merge-back

Sub-agents that start a long-lived local process during their slice (a `vite dev` server, a mock API, a Docker container, a Node server) MUST register that process for shutdown before they exit. The dispatch system captures the registered PIDs in the dispatch record and the parent session's `markCompleted` hook runs the registered `peaks sub-agent shutdown` step before merge-back:

- The sub-agent at any point may invoke `peaks sub-agent shutdown register --pid <pid> --name <label> [--url <url>]`. The CLI writes a `service-registrations.json` under the dispatch record's directory.
- The sub-agent MUST also invoke `peaks sub-agent shutdown unregister --pid <pid>` when the service exits cleanly (e.g. dev server stops after the slice's tests pass).
- During the parent's `markCompleted` step, the merge-back runner reads the registrations and, for every still-registered PID, issues a best-effort graceful shutdown (in priority order): `SIGTERM` → wait 5s → `SIGKILL` on POSIX; `taskkill /T /F` on Windows. The runner does not re-invoke the sub-agent; the service kill is local and synchronous.
- The shutdown runner is wrapped in a try/catch — a single failed kill does not abort the rest. Each kill attempt is recorded in the dispatch record with a `serviceKill: { pid, name, signal, exitCode }` event.
- After kill, the parent session proceeds with the merge-back pipeline. A failed service kill is reported in the next step's warnings but does not block the merge.
- The sub-agent's system prompt carries an explicit instruction: "if you start a local service during the slice, register it with `peaks sub-agent shutdown register` before you exit, even if you are about to commit and return — the parent session will kill the process tree on its way to merge-back."

### 6. Conflict resolution — re-dispatch the same sub-agent

If the merge-back step detects conflicts (`git status --porcelain` non-empty after the merge attempt), the parent session does not pause for human decision. Instead it re-dispatches the SAME sub-agent with an enriched prompt:

- The re-dispatch prompt includes: the original sub-agent system prompt, the original task, the dispatch record, the merge attempt transcript, and the full conflict patch (`git diff --merge` or `git diff --check`).
- The sub-agent runs in the existing worktree (or a fresh one if the prior worktree was already released). It receives an explicit instruction: "the previous merge conflicted; resolve the conflicts preserving the intent of both your prior work and the caller's current branch. Do not introduce new functionality."
- The re-dispatch is one-shot. A second conflict from the re-dispatched agent escalates to the user with a structured conflict report and pauses the workflow.
- The re-dispatch count is recorded in the dispatch record under `mergeBackAttempts`. The metric `dispatch.merge.conflict` is emitted each time a conflict is detected.
- Token cost: at most one re-dispatch per merge attempt. The re-dispatch does not run E2E; E2E runs only after a clean merge.

## Behaviour compatibility

- The existing `peaks sub-agent dispatch --isolation worktree` contract is unchanged from the sub-agent's perspective.
- The new behaviour lives entirely in the **parent** path; existing slice contracts that finish with a dispatch envelope continue to work.
- For projects that do not declare an E2E fixture under `qa/e2e/`, the new step is a no-op (`E2E_SKIPPED_NO_FIXTURES`).
- For sub-agents that do NOT start a local service, the shutdown step is a no-op.
- The peaks-loop host worktree governance (slice 2026-08-01) and the UI library priority rule (slice 2026-08-01) are unaffected.
- The new conflict-replay step is bounded to one re-dispatch per merge attempt; multi-conflict re-dispatches (within a single slice) escalate to the user.

## Component changes

| File | Change |
|---|---|
| `src/services/dispatch/post-merge.ts` (new) | Pure helper `planMergeBack({ callerBranch, agentBranch, strategy })` that returns `{ kind: 'fast-forward' | 'no-ff' | 'conflict' | 'noop' }` plus the git invocations. |
| `src/services/dispatch/conflict-replay.ts` (new) | Builds the re-dispatch prompt for a conflict-attempt slice, including the merge transcript and conflict diff. |
| `src/services/dispatch/service-shutdown.ts` (new) | Reads `service-registrations.json`, kills each PID in priority order, records the `serviceKill` event. |
| `src/services/dispatch/e2e-fixtures.ts` (new) | Reads `.peaks/_runtime/<sessionId>/qa/e2e/` and produces a plan; supports a `--e2e-from <dir>` flag. |
| `src/services/worktree/playwright-profile.ts` (new) | Generates deterministic profile paths from dispatch id, with collision checks. |
| `src/cli/commands/dispatch-commands.ts` | Reads the new fixture directory and stamps the new env vars into `toolCall.args.env`. |
| `src/cli/commands/sub-agent-shutdown-commands.ts` (new) | `peaks sub-agent shutdown register|unregister|list` for sub-agents. |
| `src/services/dispatch/merge-back-runner.ts` (new) | Executes the merge plan in a child process, with conflict capture, conflict replay, service shutdown, E2E, and metric emission. |
| `src/cli/commands/e2e-verify.ts` (new) | New CLI `peaks e2e verify --slice <rid>` that the parent session calls after merge. |
| `src/services/dispatch/build-dispatch-system-prompt.ts` | Inject the new instructions about service shutdown and "do not run E2E / do not merge". |
| `docs/superpowers/specs/2026-08-01-subagent-merge-and-e2e-design.md` (this file) | Design anchor. |
| `.peaks/memory/2026-08-01-subagent-merge-and-e2e.md` | Sediment for discoverability. |

## Verification

- Unit:
  - `planMergeBack` returns `fast-forward` for linear histories, `no-ff` for feature-branch callers, `conflict` when both sides touched the same file, `noop` for the same branch.
  - `playwright-profile` returns a path under `.peaks/_runtime/<sessionId>/pw-profiles/<dispatchId>/` and a profile name `dispatch-<short-uuid>`. The path is rewritten to a Windows-safe long-path form on Windows.
  - `e2e-fixtures` returns `[]` for an empty directory and `[fixture, fixture]` for two files; honors a top-level `disabled` file as a manual override.
  - `service-shutdown` returns the per-PID kill record; on a missing PID the record is `skipped: not-running`; on a successful TERM-then-KILL the record is `killed: true, signal: 'SIGKILL'`.
  - `conflict-replay` includes the original dispatch transcript, the conflict diff, and the resolved merge state; refuses to run when no parent dispatch record exists.
- Integration (real git + real fixture):
  - Spawn a sub-agent on a feature branch; merge back into another feature branch; assert the merge is recorded as `no-ff`.
  - Spawn a sub-agent on `main` with a clean linear history; merge back into `main`; assert fast-forward.
  - Spawn a sub-agent that conflicts with a local change on the caller branch; assert the conflict-replay step is invoked exactly once and the second conflict escalates to the user.
  - Register a long-lived mock process with `peaks sub-agent shutdown register --pid <pid>`; complete the dispatch; assert the process is killed before merge-back runs and the kill event is in the dispatch record.
  - Spawn two playwright MCP sessions for the same project with different dispatch ids; assert the user-data-dir paths are distinct and the profile names are distinct.
  - Run `peaks e2e verify` against a directory with two fixtures; assert the events fired are `dispatch.e2e` with `passCount: 2`.
- Live:
  - User reports a real downstream project that previously had Playwright profile collisions; after the patch, two dispatches run E2E in parallel without state contamination.

## Acceptance

- A1 A dispatched sub-agent that finishes with commits ends with those commits on the caller's working branch.
- A2 The sub-agent's branch is deleted after successful merge.
- A3 Two simultaneous playwright MCP sessions on the same downstream project do not share cookies, localStorage, or service workers.
- A4 A single end-to-end verification runs exactly once after merge; if the slice has no fixtures, the post-merge step is a fast no-op.
- A5 A merge conflict re-dispatches the same sub-agent with an enriched prompt; a second conflict escalates to the user with a structured conflict report.
- A6 Token usage is unchanged from today's behaviour; the profile isolation is achieved via Chromium CLI flags only.
- A7 A sub-agent that starts a long-lived local process registers it via `peaks sub-agent shutdown register`; the registered process is killed before the parent's merge-back step runs.
- A8 The shutdown kill is best-effort and does not block the merge-back pipeline on a single failed kill.
