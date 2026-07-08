---
name: 2026-07-08-peaks-solo-dogfood
description: Manual dogfood run of the peaks-solo dispatcher on the canonical 4.0.0-beta.5 use case ("获取 GitHub top 10"). Records the dispatcher pattern, HC-11 verification, and (a) lesson sediment. Per user-decision 2026-07-08 §"沉淀为本条" 协议 this is feedback-type (not loop_release / asset-type); peaks-solo crystallization is deferred to M4 ratchet.
metadata:
  type: project
  createdAt: 2026-07-08
  loopName: peaks-solo-launch
  source: 4.0.0-beta.5 dogfood (S3)
  session: 2026-07-08-session-fd90c4
  rid: peaks-solo-dogfood-2026-07-08
  status: candidate
  redLines: [RL-1, RL-4, RL-7, RL-8, RL-9, HC-7, HC-9, HC-11]
  runLog: .peaks/_runtime/2026-07-08-session-fd90c4/dogfood/dispatcher-run.log
---

# peaks-solo Dogfood — 4.0.0-beta.5 (获取 GitHub top 10)

> **Per user-decision 2026-07-08 §"沉淀为本条" 协议, this brief is feedback-type (`.peaks/memory/`), NOT asset-type (`.peaks/standards/` or `loop_release`).** peaks-solo crystallization as a Loop Engineering Asset is deferred to **M4 ratchet 之后再说**. The brief follows the locked 4-section form for future evolution-evaluation evidence; it is NOT itself a loop_release row.

## 1. what_happened

**User natural-language query** (verbatim from 商讨 session 2026-07-08-session-fd90c4):

> "获取当天的 GitHub 排名前 10 的代码仓的信息"

**peaks-solo triage decision** (per `skills/peaks-solo/SKILL.md` §3 + §4):

1. `peaks skill search --query "github"` → **1 result**, `peaks-sc` at `matchScore=0.0119` (noise-level substring hit on the word "GitHub" in its description body — NOT a trigger, NOT a primary keyword, NOT a use-case intent).
2. **Dispatcher signal: 0 MEANINGFUL candidates.** The top match score (0.0119) is well below the 0.05 threshold that separates a real match (e.g., `peaks-code` on `code` = 0.2808) from a noise substring hit. The dispatcher's §3 route logic treats this as the **zero-meaningful-candidate path → self-plan fallback (§4)**.
3. **Tool chosen:** WebSearch. `deep-search` is not installed in this environment (plan R7 mitigation); WebSearch is the next-best allowed fallback per `skills/peaks-solo/references/fallback-tool-inventory.md`.
4. **Self-plan execution:** invoke WebSearch with `"GitHub trending top 10 repositories today 2026-07-08"`.
5. **Sediment proposal** (HC-9 Human-NL-Choice-Only 锁死): AskUserQuestion with 4 options (a)/(b)/(c)/(d), default recommendation = **(a)** (普通 lesson / convention), per `skills/peaks-solo/references/sediment-prompt-template.md`.
6. **Simulated user pick** (per spec §3.5 `success_default_prompt` 协议, the LLM picks the canonical default for dogfood): **(a) 沉淀为普通 lesson / convention**.
7. **Output:** this brief as `.peaks/memory/2026-07-08-peaks-solo-dogfood.md` + raw run log at `.peaks/_runtime/2026-07-08-session-fd90c4/dogfood/dispatcher-run.log`.

**HC-11 verification (peaks-solo did NOT write code):**
- No `Edit` on `src/**`.
- No `Bash` command touching `src/**`, `skills/peaks-*/**`, or `.peaks/standards/**`.
- No `peaks-rd` / `peaks-qa` / `peaks-ui` / `peaks-sc` sub-agent dispatch.
- S3 only writes to (a) `tests/integration/dispatcher-flow.test.ts` (test file, not `src/`), (b) `.peaks/memory/2026-07-08-peaks-solo-dogfood.md` (this brief), (c) `.peaks/_runtime/<sid>/dogfood/dispatcher-run.log` (gitignored run log).

## 2. why_it_matters

- **Proves the dispatcher pattern works end-to-end on a use case with no peak-* skill match.** This is the first real-world run of `peaks skill search` (S0) AND the first real triage (S1) in production. Both ship green together in 4.0.0-beta.5.
- **Confirms HC-11 holds:** peaks-solo's self-plan fallback path can complete an information query without writing code, writing a PRD, running vitest, or mutating any Loop Engineering Asset. The dispatcher is **strictly thinner** than an orchestrator.
- **Confirms the user is commander, not LLM:** the sediment proposal is a 4-option AskUserQuestion (HC-9); the LLM only **proposes** (a) and **records** the rationale; the actual sediment is the user's decision. (For dogfood, the spec §3.5 `success_default_prompt` 协议 delegates the user pick to the LLM with a recorded rationale — this is the dogfood exception, NOT the production behavior.)
- **First locked evidence of the "noise substring hit ≠ meaningful match" distinction** that the S0 substring-scoring model relies on. This distinction is what makes the dispatcher's "no peak-* skill handles this" decision possible without a semantic-search layer. See T-3 in `tests/integration/dispatcher-flow.test.ts` for the locked assertion (`matchScore < 0.05 = no meaningful match`).
- **Locks the 7-day rename lock** (HC-7): peaks-solo name is locked for 7 days after 4.0.0-beta.5 ships. No rename of peaks-solo / peaks-code / peaks-content / peaks-doctor / peaks-issue-fix-orchestrator / peaks-sop until 2026-07-15 at the earliest, and only after a decider session with ≥ 3 new pieces of evidence + a grep impact scan across all peaks-* references.

## 3. what_learned

- **`peaks skill search` performance:** cold-start CLI spawn (skill list + skill search) takes ~10 s for the full 20+ skill pool on this Windows machine. That is acceptable for the dispatcher path because the dispatcher is invoked once per user request, not per tool call. For tighter loops (e.g., a future peaks-status dashboard), an in-process import of `searchSkills()` (S0 service) would be ~30 ms; that is the optimization path, NOT a CLI-only invocation.
- **Zero-candidate path is well-defined and works:** the dispatcher's §3 + §4 logic handles a query with no meaningful peak-* skill match cleanly. The user does not hit a dead end. The fallback tool inventory (`fallback-tool-inventory.md`) is sufficient for the typical information-query case.
- **WebSearch fallback works when deep-search is not installed (R7 mitigation in plan index):** the R7 risk ("peaks-loop 自己 dogfood 时找不到 deep-search skill") was correctly mitigated by the plan's `if deep-search is not installed, use WebSearch` clause in S3-B's manual procedure.
- **Sediment AskUserQuestion template is reusable as-is.** The 4-option template (a/b/c/d) with default = (a) is complete and the LLM rationale convention ("我推荐 (a) 沉淀为普通 lesson / convention,理由:...") is short enough to be a one-liner. No edits needed for 4.0.0-beta.5.
- **Substring-scoring noise vs meaningful-match distinction is the dispatcher's load-bearing assumption.** This is locked into `tests/integration/dispatcher-flow.test.ts` T-3 (`matchScore < 0.05 = no meaningful match`). If the scoring model changes in a future minor, T-3 must be re-derived; the 0.05 threshold is not arbitrary — it is the gap between peaks-code on "code" (0.28) and the next-best match (peaks-rd on "code" = 0.02).
- **Did NOT crystallize peaks-solo as a Loop Engineering Asset** — per user-decision 2026-07-08 §"沉淀为本条" 协议, this brief is feedback-type, not asset-type. The crystallization of peaks-solo itself (if any) would require M4 ratchet evidence accumulation first, then a separate decider session. M4 ratchet = the `peaks-loop-positioning-loop-engineering` memory's `m4_ratchet_after` gate; until that gate fires, peaks-solo stays as a skill (S1) and a dispatcher, not as a crystallized loop.
- **`peaks workflow verify-pipeline` returned `PIPELINE_INCOMPLETE` for rid `peaks-solo-dogfood-2026-07-08`.** This is **expected** — S3 is a validation slice (integration test + dogfood), NOT a feature RD, so it does not run peaks-rd / peaks-qa internally. The Gate H feedback-promotion violations are pre-existing (3 memories not yet promoted to enforcement layers) and unrelated to S3. The final acceptance gate runs in the main session per S3 brief §"Workflow" step 13.

## 4. what_action

- **4.0.0-beta.5 ships with `peaks-solo` dispatcher + `peaks skill search` CLI primitive.** No further dogfood run is needed before ship; S0 + S1 + S2 + S3 are all green.
- **peaks-solo name is locked for 7 days** (HC-7). Earliest possible rename window: 2026-07-15. Any rename attempt before that must (a) open a decider session, (b) list ≥ 3 new pieces of evidence not present at the 2026-07-08 revive decision, (c) grep-scan all `peaks-*` references for impact, (d) user-confirm the change explicitly per Two-Forms-Only.
- **Future iterations may consider:**
  - (i) installing `deep-search` as a richer fallback than `WebSearch` (would extend the dispatcher's §4 tool inventory).
  - (ii) expanding the triage vocabulary (more `peaks-*` skill descriptions adding explicit triggers for cross-domain queries like "trending top N" / "GitHub" / "Hacker News").
  - (iii) **after M4 ratchet evidence accumulates** — re-evaluate whether to crystallize peaks-solo as a Loop Engineering Asset. Until then, peaks-solo is a skill (S1) and dispatcher, NOT a loop.
- **`similar_task_recurrence` trigger:** if a 2nd similar run happens (e.g., user asks "获取 X 的 top 10" again, or "查询 GitHub trending" again), the dispatcher's `llm_suggested` trigger fires with ≥ 2 reuse signals + a 4-section brief, and asks the user whether to crystallize the search-and-summarize pattern.
- **`peaks workflow verify-pipeline` exit-0 gate** for the full 4.0.0-beta.5 ship is the main-session final acceptance, NOT this S3 slice. S3's verify-pipeline call returns `PIPELINE_INCOMPLETE` by design (S3 is validation-only); this is recorded as a non-blocking observation, not a failure.

---

**Related:**
- `docs/superpowers/specs/2026-07-08-peaks-solo-dispatcher-design.md` §1.1, §3.4, §3.5
- `docs/superpowers/plans/2026-07-08-peaks-solo-dispatcher/s3-dogfood.md` §Deliverables, §API Contract, §Exit conditions
- `.peaks/memory/user-decision-2026-07-08-revive-peaks-solo-as-dispatcher.md` (the §"沉淀为本条" 协议)
- `tests/integration/dispatcher-flow.test.ts` (the 7-case locked test contract)
- `.peaks/_runtime/2026-07-08-session-fd90c4/dogfood/dispatcher-run.log` (verbatim raw run outputs)
- S0 commit: `1ae58cd` — `feat(cli): peaks skill search primitive`
- S1 commit: `8ba6336` — `feat(skill): peaks-solo dispatcher`
- S2 commit: `b4b9b73` — `docs(release): 4.0.0-beta.5 — peaks-solo dispatcher surface`
- S3 commit: (this slice's commit, recorded in `.superpowers/sdd/task-7-s3-report.md`)
