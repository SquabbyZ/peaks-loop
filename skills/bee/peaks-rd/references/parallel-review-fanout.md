# Parallel review fan-out (RD)

> Body of `## Parallel review fan-out`. **When RD reaches the end of implementation, the three review activities (code review, QA test-cases draft, AND karpathy review) run in parallel via `peaks sub-agent dispatch <role>` (then executing the returned toolCall), not sequentially.** This is the same fan-out pattern peaks-code uses for the post-PRD swarm. RD itself, when it is the main loop, behaves as a sub-agent orchestrator: it issues 3 `peaks sub-agent dispatch` calls in a single message and waits for all to return before aggregating findings and transitioning to `qa-handoff`.

**v2.12.0 collapse (Group A — Tier 1+2+3):** the previous 4-way fan-out (slice 004) plus the appended `karpathy-reviewer` (slice 5/6) totalled **5 sub-agents**. The `security-reviewer` and `perf-baseline-reviewer` slots moved out of the RD fan-out into two new standalone audit skills:

- `peaks-security-audit` — CLI: `peaks security-audit run`. Writes `.peaks/_runtime/<sessionId>/audit/security.md`. Required RD-side prereq `AUDIT_SECURITY`.
- `peaks-perf-audit` — CLI: `peaks perf-audit run`. Writes `.peaks/_runtime/<sessionId>/audit/perf.md`. Required RD-side prereq `AUDIT_PERF`.

Both audit skills consume the immutable peaks-prd handoff (`prd/handoff.md`) and the project-scoped audit templates under `.peaks/project-scan/{security-template, perf-template, audit-output-schema}.md`. The handoff presence is enforced by the `AUDIT_REQUIRES_HANDOFF` prereq. The 1-minor-release back-compat window (`v2.12.0`) keeps the old `rd/{security-review,perf-baseline}.md` paths readable via `mustContainAny` — see `tests/unit/rd/deprecated-reviewer-back-compat.test.ts` (8 cases) and `tests/unit/artifact-prerequisites-typed.test.ts`.

The current fan-out is therefore **3 sub-agents**:

1. `code-reviewer` (always runs for feature / refactor / bugfix)
2. `qa-test-cases-writer` (always runs for feature / refactor / bugfix)
3. `karpathy-reviewer` (always runs for feature / refactor / bugfix — the **hard Karpathy-Gate**)

Config / docs / chore: no fan-out (no review surface). Document N/A in the request artifact.

**Why 3 sub-agents (v2.12.0):** the original 3-way fan-out (code-review + security-review + perf-baseline — slice 002) cut the RD→QA wall-clock by running 3 LLM writes in parallel. Slice 004 added `qa-test-cases-writer` (4-way), slice 5/6 added `karpathy-reviewer` (5-way). The v2.12.0 collapse moves `security-reviewer` + `perf-baseline-reviewer` out of the fan-out into standalone pre-RD audit passes; the remaining 3 sub-agents are dispatched from the RD main loop as before. Wall-clock: the security + perf audit work shifts to pre-RD / pre-QA and runs as `peaks sub-agent dispatch peaks-security-audit` + `peaks sub-agent dispatch peaks-perf-audit` — those are also parallelizable, so the end-to-end wall-clock is unchanged or improved.

**When to fan out:**
- Feature / refactor slices: all three sub-agents always run.
- Bugfix slices: all three sub-agents always run (no perf-shaped conditional — perf audit is now a separate skill that the LLM decides to dispatch when the bug is perf-shaped).
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

Note: sub-agent 1 (code-reviewer) and sub-agent 3 (karpathy-reviewer) write to `rd/<evidence-path>`; sub-agent 2 (qa-test-cases-writer) writes to `qa/test-cases/<rid>.md` (QA's dir). The role name in the description differentiates them.

**Sub-agent 1 — code-reviewer (always runs for feature / refactor / bugfix):**
- Read the git diff for this slice (`git diff main...HEAD` or equivalent).
- Read `.peaks/_runtime/<sessionId>/prd/handoff.md` for slice intent (v2.11.0: the immutable peaks-prd handoff replaces `rd/tech-doc.md`). Verify the handoff hash matches the dispatched value before proceeding.
- Inspect for: correctness, type safety, error handling, mutation patterns, file-size, naming, dead code, regressions, contract drift.
- Output: `.peaks/_runtime/<sessionId>/rd/code-review.md` with sections: Summary, Findings, Required Fixes, Recommended, Verdict.
- Required for Gate B3.
- **v2.11.0 Tier 7 (Group D):** the code-reviewer dispatch goes through the **ECC bridge** (`src/services/code-review/ecc-bridge.ts`). The parent RD loop invokes the Agent tool with `subagent_type: "everything-claude-code:code-review"` and receives a structured envelope `{ passed, violations[], gateAction }`. The bridge adapter (`adaptEccEnvelopeToRdCodeReview`) renders that envelope into the canonical `rd/code-review.md` markdown shape that Gate B3 reads (`mustContain: ['## Findings', 'CRITICAL']`). The pre-Tier-7 5-state detect (`detectEcc`: ready / plugin-missing / agent-missing / dispatch-failed / envelope-malformed) soft-fails to inline review on any non-ready state — TXT note `code-review-ecc-degraded-to-inline`. Same soft-fail philosophy as `ocr-service.ts` and `detectOcr`.

**Sub-agent 2 — qa-test-cases-writer (always runs for feature / refactor / bugfix):**
- Read the git diff and the PRD acceptance criteria.
- Draft the test plan: enumerate every acceptance criterion as a separate test case; for each, write a `ts` snippet, assert the expected outcome, link to the PRD criterion by ID.
- Include the standard sections: ## Test cases, ## Test case summary, ## Mandatory validation gates, ## Regression matrix, ## Verdict.
- Output: `.peaks/_runtime/<sessionId>/qa/test-cases/<rid>.md`.
- Required for Gate C (RD-side qa-handoff transition). When this file is present at RD's qa-handoff transition, QA's main loop can skip its own "draft test plan" step and proceed directly to "execute pre-drafted test plan + write test-report + verdict".

**Sub-agent 3 — karpathy-reviewer (always runs for feature / refactor / bugfix — the hard gate):**
- Inspect the diff + handoff against the 4 Karpathy-guidelines.
- Read `.peaks/_runtime/<sessionId>/prd/handoff.md` (v2.11.0: architecture summary — the immutable peaks-prd handoff replaces `rd/tech-doc.md`).
- Output: `.peaks/_runtime/<sessionId>/rd/karpathy-review.md` containing a `## Karpathy-Gate` header and the 4 guideline section markers (Think Before Coding / Simplicity First / Surgical Changes / Goal-Driven Execution).
- Required for the `KARPATHY_REVIEW` prereq. The transition CLI gate reads those markers and refuses `rd:qa-handoff` when the file is missing or the markers are absent.
- See `references/rd-fanout-contracts.md` §"karpathy-reviewer contract" for the JSON envelope shape + file format.

**Hard prohibitions on all 3 sub-agents:**
- Do NOT call `Skill(skill="...")` — would re-enter RD or another skill and break the fan-out.
- Do NOT call `peaks skill presence:set` — only the main RD loop owns presence.
- Do NOT open interactive user prompts. If something is unclear, return `blocked` and let the main loop handle the user.
- Do NOT commit, push, install hooks, or mutate settings.json.
- Do NOT edit any source file under src/, tests/, skills/, bin/, scripts/, docs/, schemas/. Review only.

**Aggregation (after all 3 sub-agents return):**

1. Restore presence: `peaks skill presence:set peaks-rd --project <repo> --gate review-fan-out-converged`
2. Run the 3 `ls` checks (Gate B3 code-review, Gate C2 qa-test-cases, KARPATHY_REVIEW prereq).
3. Read each evidence file. Aggregate CRITICAL/HIGH across code-review.
4. If any CRITICAL or HIGH finding exists: fix in the main RD loop, then re-launch ONLY the affected sub-agent(s) to verify the fix. Loop until clean, or mark as blocked if the issue cannot be resolved.
5. For qa-test-cases: the file is now pre-drafted by sub-agent 2. The main RD loop does NOT re-draft it; it only verifies (a) the file exists, (b) every PRD acceptance criterion is enumerated, (c) every `ts` test snippet is syntactically valid. If incomplete, fix it inline in the main RD loop (small edits only) OR re-launch the sub-agent (large re-drafts).
6. Re-run all 3 `ls` checks to confirm the evidence files are present and not empty.
7. Confirm the audit prereqs (`AUDIT_SECURITY` + `AUDIT_PERF` + `AUDIT_REQUIRES_HANDOFF`) are satisfied — those are produced by the standalone audit skills, not the fan-out.
8. Only then transition `peaks request transition <rid> --role rd --state qa-handoff --project <repo> --json`.

**Degradation when a sub-agent fails or returns blocked:**
- code-review sub-agent fails: fall back to inline RD code review. TXT handoff note: `code-review-subagent-degraded-to-inline`.
- code-review sub-agent runs the ECC bridge but ECC is unavailable (plugin-missing / agent-missing / dispatch-failed / envelope-malformed per `detectEcc`): fall back to inline RD code review. TXT handoff note: `code-review-ecc-degraded-to-inline`.
- qa-test-cases sub-agent fails: fall back to inline QA test-case drafting at the start of QA's main loop. TXT note: `qa-test-cases-subagent-degraded-to-inline-qa-draft`.
- karpathy-reviewer sub-agent fails: NOT degradeable — its failure blocks qa-handoff. Per karpathy §1 Think Before Coding + §3 Surgical Changes, the file MUST exist with the gate header + at least one guideline marker.
- 2 or more fail: do not hand off as clean; transition to `qa-handoff` with `--allow-incomplete --reason "<degradation>"` OR block.

**Why this works (3-loop repair closure):** the original 3-loop repair pain was caused by perf being QA-only. Slice 002 moved perf to RD-side fan-out; slice 004 extended the same parallel pattern to QA test-cases so the QA→verdict loop is also faster on the first attempt. The v2.12.0 collapse preserves the parallel pattern but moves `security-reviewer` + `perf-baseline-reviewer` out of the RD-side fan-out into standalone pre-RD audit passes (`peaks-security-audit` + `peaks-perf-audit`). Those passes are themselves parallelizable, so the end-to-end wall-clock is preserved or improved.