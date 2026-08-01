---
name: 2026-08-01-subagent-merge-and-e2e
kind: feedback
---

# Sub-agent merge-back and end-to-end verification (effective 2026-08-01)

Every downstream project's sub-agent dispatch follows a single contract:

1. **Sub-agent commits to its own branch only.** It does NOT call `git merge`, `git pull`, `git rebase`, or `peaks worktree release` on its own. Its only contract is: commit, then return the dispatch envelope.
2. **Parent session auto-merges back to caller branch.** After the dispatch returns, the parent's `markCompleted` runs the merge plan: `--ff-only` on `main`, `--no-ff` on a feature branch. Then it runs `peaks worktree release` to clean up. Token cost: zero extra LLM calls.
3. **Playwright MCP profile isolation.** Sub-agents share one MCP server but each uses a unique `PEAKS_PLAYWRIGHT_USER_DATA_DIR` + `PEAKS_PLAYWRIGHT_PROFILE_NAME` pair. Token cost: zero (Chromium CLI flags only). State contamination is impossible across dispatches.
4. **Sub-agent shutdown hook.** Sub-agents that start a long-lived local process MUST register it via `peaks sub-agent shutdown register --pid <pid> --name <label>`. The parent's `markCompleted` hook kills every registered PID (`SIGTERM` → 5s → `SIGKILL` on POSIX; `taskkill /T /F` on Windows) BEFORE merge-back runs. The kill is best-effort and does not block the pipeline.
5. **Single E2E run after merge.** E2E is owned by the parent session, not the sub-agent. Fixtures live under `qa/e2e/*.md`. The sub-agent's system prompt tells it explicitly: "do not run E2E; the parent will run it after merge."
6. **Conflict replay.** A merge conflict does NOT pause for the user. The parent re-dispatches the SAME sub-agent with the original prompt + the merge attempt transcript + the conflict diff. A second conflict escalates to the user with a structured report.

**Why:**

- Hand-rolled merge decisions on every conflict is human toil; re-dispatching the same agent with enriched context is cheaper and more reliable.
- Long-lived dev servers (vite, mock APIs) leaking into the parent session is the most common dispatcher footgun; explicit registration closes it.
- Parallel E2E in the same project previously collided on Chromium cookies / localStorage; per-dispatch profile directories close it at near-zero token cost.
- The peaks-loop host worktree governance (slice 2026-08-01) and the UI library priority rule (slice 2026-08-01) are unaffected by this change.

**How to apply:**

- Implementation lives at `docs/superpowers/specs/2026-08-01-subagent-merge-and-e2e-design.md`; the package ships the new behaviour to every downstream project on `npm install`.
- The dispatch record schema gains `serviceKill` and `mergeBackAttempts` fields; `dispatch.merge` and `dispatch.e2e` observability events are emitted at each pipeline step.
- Sub-agents must add a "register local services" line to their operational checklist so the parent can kill them deterministically.
- Conflict replay is bounded to ONE re-dispatch per merge attempt. Multi-conflict cases within a single slice escalate.
