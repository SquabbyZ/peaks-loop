# Parallel review fan-out (RD)

> Body of `## Parallel review fan-out`. **When RD reaches the end of implementation, the four review activities (code review, security review, perf baseline, AND QA test-cases draft) run in parallel via `peaks sub-agent dispatch <role>` (then executing the returned toolCall), not sequentially.** This is the same fan-out pattern peaks-solo uses for the post-PRD swarm. RD itself, when it is the main loop, behaves as a sub-agent orchestrator: it issues 4 `peaks sub-agent dispatch` calls in a single message and waits for all to return before aggregating findings and transitioning to `qa-handoff`.

**Why 4 sub-agents (added in slice 004):** the original 3-way fan-out (code-review + security-review + perf-baseline) cut the RD→QA wall-clock by running 3 LLM writes in parallel, but `qa/test-cases/<rid>.md` was still written sequentially by QA's main loop AFTER the RD handoff landed. Drafting QA test-cases in the same fan-out means the QA main loop's first action is "execute the pre-drafted test plan + write test-report" instead of "draft a test plan from scratch + execute + write report". Wall-clock drop: ~30-40% on the RD→QA-verdict segment for `feature` / `refactor` / `bugfix` slices.

**When to fan out:**
- Feature / refactor slices: all four sub-agents always run.
- Bugfix slices: code-review + security-review + qa-test-cases always run; perf-baseline runs only when the bug is performance-shaped (matches the "When this applies" criteria in the perf-baseline section above).
- Config / docs / chore slices: no fan-out (no review surface). Document N/A in the request artifact.

**The dispatch template:**

```
peaks sub-agent dispatch <role> \
  --prompt "<role contract below>, plus runtime args: project=<repo>, session-id=<session-id>, request-id=<rid>.
             Write your evidence file at .peaks/_runtime/<sessionId>/<evidence-path> and return ONLY the path.
             Do not call Skill(...). Do not set presence. Do not prompt the user. Do not commit, push,
             install hooks, or mutate settings.json. Do not edit any source file — review only.
             While running, call peaks sub-agent heartbeat --record <dispatchRecordPath>
             --status running --progress <pct> --note \"<text>\" at least every 30 seconds;
             on completion call --status done --progress 100 --note 'completed'." \
  --request-id <rid> --session-id <session-id> --project <repo> --json
```

Note: sub-agents 1-3 write to `rd/<evidence-path>`, sub-agent 4 writes to `qa/test-cases/<rid>.md` (QA's dir). The role name in the description differentiates them.

**Sub-agent 1 — code-reviewer (always runs for feature / refactor / bugfix):**
- Read the git diff for this slice (`git diff main...HEAD` or equivalent).
- Read `.peaks/_runtime/<sessionId>/prd/handoff.md` for slice intent (v2.11.0: the immutable peaks-prd handoff replaces `rd/tech-doc.md`). Verify the handoff hash matches the dispatched value before proceeding.
- Inspect for: correctness, type safety, error handling, mutation patterns, file-size, naming, dead code, regressions, contract drift.
- Output: `.peaks/_runtime/<sessionId>/rd/code-review.md` with sections: Summary, Findings, Required Fixes, Recommended, Verdict.
- Required for Gate B3.
- **v2.11.0 Tier 7 (Group D):** the code-reviewer dispatch goes through the **ECC bridge** (`src/services/code-review/ecc-bridge.ts`). The parent RD loop invokes the Agent tool with `subagent_type: "everything-claude-code:code-review"` and receives a structured envelope `{ passed, violations[], gateAction }`. The bridge adapter (`adaptEccEnvelopeToRdCodeReview`) renders that envelope into the canonical `rd/code-review.md` markdown shape that Gate B3 reads (`mustContain: ['## Findings', 'CRITICAL']`). The pre-Tier-7 5-state detect (`detectEcc`: ready / plugin-missing / agent-missing / dispatch-failed / envelope-malformed) soft-fails to inline review on any non-ready state — TXT note `code-review-ecc-degraded-to-inline`. Same soft-fail philosophy as `ocr-service.ts` and `detectOcr`.

**Sub-agent 2 — security-reviewer (always runs for feature / refactor / bugfix):**
- Read the git diff and the file list.
- Read `.peaks/_runtime/<sessionId>/prd/handoff.md` for the slice's threat model (v2.11.0: handoff replaces `rd/tech-doc.md`). Verify the handoff hash matches the dispatched value before proceeding.
- Inspect for: hardcoded secrets, unsanitized input, path traversal, SQL injection, XSS, missing auth, dependency changes, external API surface, command injection via Bash guards.
- Output: `.peaks/_runtime/<sessionId>/rd/security-review.md` with the same shape.
- Required for Gate B4.

**Sub-agent 3 — perf-baseline-reviewer (feature / refactor / bugfix-when-perf only):**
- Read the git diff and the slice's PRD/tech-doc for any mentioned numbers.
- Run `peaks perf baseline --project <repo> --apply --reason "parallel fan-out for rid=<rid>"` to scaffold `.peaks/_runtime/<sessionId>/rd/perf-baseline.md` (idempotent).
- Decide: perf surface exists → leave the scaffold in place for the main RD loop to fill in. No perf surface → write `N/A — no perf surface` and return.
- Output: `.peaks/_runtime/<sessionId>/rd/perf-baseline.md` (scaffolded, or N/A stub).
- Required for Gate B9.

**Sub-agent 4 — qa-test-cases-writer (always runs for feature / refactor / bugfix):**
- Read the git diff and the PRD acceptance criteria.
- Draft the test plan: enumerate every acceptance criterion as a separate test case; for each, write a `ts` snippet, assert the expected outcome, link to the PRD criterion by ID.
- Include the standard sections: ## Test cases, ## Test case summary, ## Mandatory validation gates, ## Regression matrix, ## Verdict.
- Output: `.peaks/_runtime/<sessionId>/qa/test-cases/<rid>.md`.
- Required for Gate C (RD-side qa-handoff transition). When this file is present at RD's qa-handoff transition, QA's main loop can skip its own "draft test plan" step and proceed directly to "execute pre-drafted test plan + write test-report + verdict".

**Hard prohibitions on all 4 sub-agents:**
- Do NOT call `Skill(skill="...")` — would re-enter RD or another skill and break the fan-out.
- Do NOT call `peaks skill presence:set` — only the main RD loop owns presence.
- Do NOT open interactive user prompts. If something is unclear, return `blocked` and let the main loop handle the user.
- Do NOT commit, push, install hooks, or mutate settings.json.
- Do NOT edit any source file under src/, tests/, skills/, bin/, scripts/, docs/, schemas/. Review only.

**Aggregation (after all 4 sub-agents return):**

1. Restore presence: `peaks skill presence:set peaks-rd --project <repo> --gate review-fan-out-converged`
2. Run the 4 `ls` checks (Gate B3 code-review, Gate B4 security-review, Gate B9 perf-baseline, Gate C2 qa-test-cases).
3. Read each evidence file. Aggregate CRITICAL/HIGH across code-review + security-review.
4. If any CRITICAL or HIGH finding exists: fix in the main RD loop, then re-launch ONLY the affected sub-agent(s) to verify the fix. Loop until clean, or mark as blocked if the issue cannot be resolved.
5. For perf-baseline: if scaffolded, run the project's perf measurement tool, fill in the Results table. If N/A, no measurement needed.
6. For qa-test-cases: the file is now pre-drafted by sub-agent 4. The main RD loop does NOT re-draft it; it only verifies (a) the file exists, (b) every PRD acceptance criterion is enumerated, (c) every `ts` test snippet is syntactically valid. If incomplete, fix it inline in the main RD loop (small edits only) OR re-launch the sub-agent (large re-drafts).
7. Re-run all 4 `ls` checks to confirm the evidence files are present and not empty.
8. Only then transition `peaks request transition <rid> --role rd --state qa-handoff --project <repo> --json`.

**Degradation when a sub-agent fails or returns blocked:**
- code-review sub-agent fails: fall back to inline RD code review. TXT handoff note: `code-review-subagent-degraded-to-inline`.
- code-review sub-agent runs the ECC bridge but ECC is unavailable (plugin-missing / agent-missing / dispatch-failed / envelope-malformed per `detectEcc`): fall back to inline RD code review. TXT handoff note: `code-review-ecc-degraded-to-inline`.
- security-review sub-agent fails: same fallback. TXT note: `security-review-subagent-degraded-to-inline`.
- perf-baseline sub-agent fails: same fallback. TXT note: `perf-baseline-subagent-degraded-to-inline`.
- qa-test-cases sub-agent fails: fall back to inline QA test-case drafting at the start of QA's main loop. TXT note: `qa-test-cases-subagent-degraded-to-inline-qa-draft`.
- 2 or more fail: do not hand off as clean; transition to `qa-handoff` with `--allow-incomplete --reason "<degradation>"` OR block.

**Why this works (3-loop repair closure):** the original 3-loop repair pain was caused by perf being QA-only. This fan-out moves perf measurement to the RD side AND runs it in parallel with the other reviews, so the RD handoff is complete on the first attempt instead of after several cycles. Slice 004 extends the same pattern to QA test-cases so the QA→verdict loop is also faster on the first attempt.