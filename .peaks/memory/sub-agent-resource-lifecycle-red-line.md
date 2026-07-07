---
name: sub-agent-resource-lifecycle-red-line
description: Sub-agent resource lifecycle red line — not "more is better"; create responsibly + must reclaim
metadata:
  type: rule
  sourceArtifact: .peaks/_runtime/2026-06-06-session-5b1095/prd/requests/002-2026-06-07-sub-agent-dispatch-decouple.md
---

User hard rule (2026-06-07 1:19 GMT+8): "要加一条红线子 agent 不是越多越好,要合理创建,还有用完必须回收". This is the **resource lifecycle** red line for peaks agentTeam's pseudo-swarm model. It is orthogonal to G1 (abstraction) / G2 (CLI primitive) / G3 (skill surface) / G4 (R-2 path safety); registered as G5 in slice #009 PRD.

## Why

peaks agentTeam is a pseudo-swarm (per PRD §"Agent Team = 伪蜂群架构宣言") — Dispatcher static-batches N sub-agents per message, sub-agents work via shared artifacts, Dispatcher reduces. Without explicit lifecycle constraints, three failure modes emerge:

1. **Fan-out for fan-out's sake.** LLM might split a 1-sub-agent job into 3 just to look like a swarm. Waste of context, tokens, time, and reducer auditability.
2. **No input/output boundary.** A sub-agent without an explicit artifact path writes somewhere else, reducer can't find it, the batch stalls. Worse: reducer silently moves on, downstream gate fails later with no traceable cause.
3. **Resource leak.** Dispatch records accumulate forever; completed sub-agents whose artifacts were never consumed are invisible to the user; the next slice starts with a polluted `.peaks/_sub_agents/<sid>/` and the user can't tell what's current vs leftover.

## The rule (RL-1..RL-12)

**Not "more is better":**
- **RL-1 Batch size ≤ 6** per Dispatcher per batch (empirical basis: peaks-code swarm = 3, peaks-rd 4-way, peaks-qa 3-way; headroom to 6 for future). > 6 must split into multiple batches with explicit reducer step between.
- **RL-2 Every dispatch has input + output.** `--prompt` non-empty AND prompt internally declares the artifact path. CLI emits `code: "DISPATCH_NO_ARTIFACT_PLAN"` warning (info level, not blocking) if neither `peaks/*` path nor `write` keyword detected.
- **RL-3 Each sub-agent must be informationally independent.** peaks-code swarm 3-way (UI design / RD planning / QA test-cases) is justified because the three are information-orthogonal. peaks-rd 4-way same. peaks-qa 3-way (业务/性能/安全) same. Refused: 1 job split into 3 for fan-out theater.
- **RL-4 业务可再分 ≤ 2 layers.** peaks-qa 业务细分 (`qa-business` → `qa-business-api` / `qa-business-frontend` / `qa-business-regression` etc.) is allowed but **not** 3+ levels (e.g. no `qa-business-api-user`). Beyond 2 layers, Dispatcher depth = 4+, reducer auditability collapses, prompt boundaries blur.

**Must reclaim after use:**
- **RL-5 Dispatch record落盘 mandatory.** Every `peaks sub-agent dispatch` writes `.peaks/_sub_agents/<sid>/dispatch-<rid>-<ts>.json` (already in slice #009 AC-24; G5 makes it a strong constraint, not nice-to-have).
- **RL-6 Record schema with lifecycle fields.** `createdAt` (ISO8601) / `completedAt` (ISO8601 \| null, LLM回填) / `outcome` ("success" \| "failed" \| "timeout" \| "cancelled" \| "no-execution") / `artifactPaths` (string[]) / `disposed` (boolean) / `disposedAt` (ISO8601 \| null) / `role` / `requestId` / `sessionId` / `prompt` / `toolCall`. The `outcome: "no-execution"` case is the audit-risk marker for "LLM got the toolCall but never invoked it" (R-8 boundary).
- **RL-7 Reducer disposes after consume.** Code main loop, after reducing a batch, MUST traverse this batch's dispatch records, set `disposed: true` + write `disposedAt`. After reducer, any `disposed === false` AND `createdAt < now() - 1h` is a **leak** — emit warning to next session.
- **RL-8 Slice close → archive + GC.** On `peaks session finish` / `peaks session abandon` / new rid startup, the previous slice's `.peaks/_sub_agents/<sid>/` records that are completed + disposed get archived to `.peaks/_runtime/<sid>/_archive/_sub_agents/<slice-id>/` (aligns with existing `_runtime` archive pattern), **retained 30 days then GC**. Records that are not yet disposed get archived but **not** GC'd — next session finishes them.
- **RL-9 User cancel must dispose.** When user hits Ctrl-C in Code main loop / `peaks workflow cancel --rid <rid>`, Code catches SIGINT, MUST mark in-flight dispatch records `outcome: "cancelled"` + `disposed: true` + `disposedAt: now()` BEFORE exit. No silent discard of records when LLM got toolCall but sub-agent didn't finish.

**Observability is the enforcement mechanism:**
- **RL-10 `peaks sub-agent list` future CLI stub.** New `peaks sub-agent` subcommand **only** implements `dispatch` atom in slice #009; `list` / `show` / `gc` are interface-only stubs (next implementer MUST add these 3 atoms before sub-agent CLI is "complete"). G5.3 makes the stub explicit.
- **RL-11 Reducer completion visible.** Code main loop after each batch emit `reducerReport: { batchId, total: N, disposed: M, leaked: K }`. `leaked > 0` triggers user-visible warning.
- **RL-12 Slice-level audit.** Slice close emits `sliceReport.subAgentStats: { created: N, completed: M, disposed: K, leaked: L }`. `created > 30` triggers user-visible hint (经验上界, not hard fail).

## How to apply

For every `peaks sub-agent dispatch` invocation, the calling SKILL.md / LLM MUST be able to answer:

1. Why is this sub-agent necessary? (RL-3 — not for fan-out theater)
2. What input does it receive and what artifact does it produce? (RL-2)
3. Is this within the batch size ≤ 6? (RL-1)
4. Is the business sub-division ≤ 2 layers? (RL-4, peaks-qa only)
5. After the batch reduces, will reducer dispose this record? (RL-7)

For every peak-code main loop iteration:

1. Track batch count + dispose status (RL-7)
2. Emit `reducerReport` with `leaked` count (RL-11)
3. On SIGINT, dispose in-flight before exit (RL-9)

For slice close:

1. Archive completed + disposed records (RL-8)
2. Archive not-yet-disposed records (without GC)
3. Emit `sliceReport.subAgentStats` (RL-12)

## What does NOT satisfy the rule

- "I made a 5-way fan-out because the work seemed parallel" without each sub-agent having a distinct artifact path (violates RL-2)
- "I'll let the next slice clean up the leftover records" (violates RL-7 / RL-8 — slice-close MUST handle its own records)
- "Sub-agent 3rd-level sub-roles are needed because the project is big" (violates RL-4 — 2 layers is hard cap; reconsider Dispatcher design)
- "Disposed=false is fine, no one's been hurt" (violates RL-11 — emit reducerReport always, even when leaked=0)
- "User can press Ctrl-C, the LLM cleans up" (violates RL-9 — Code MUST dispose before exit, LLM behavior is not the disposal mechanism)

## Cross-reference

- **PRD #009** (`.peaks/_runtime/2026-06-06-session-5b1095/prd/requests/002-2026-06-07-sub-agent-dispatch-decouple.md`): G5 段; AC-25..AC-32; R-8
- **RD request #009** (`.peaks/_runtime/2026-06-06-session-5b1095/rd/requests/002-2026-06-07-sub-agent-dispatch-decouple.md`): G5 资源生命周期设计 11.段
- [[slim-ideadapter-shape-is-the-contract]] — the dispatcher field is part of the IdeAdapter contract; this red line governs its **use**, not its shape
- [[peaks-memory-scan-is-intentionally-not-a-cli]] — precedent for "skill-first CLI primitive"; this red line is the lifecycle counterpart

## Why this is additive, not a replacement

- **Skill-first / CLI-auxiliary** (top of `dev-preference.md`): governs **what** to build (skill > CLI).
- **Dogfood rule** (middle): governs **how to verify** (run on current project).
- **No AI trailer / global gitconfig** (bottom): governs **who owns the commit** (human, no AI co-author).
- **This rule** (sub-agent lifecycle): governs **how sub-agents are governed at runtime** (resource hygiene).

A slice can pass the first three and still violate this — e.g. SKILL.md rewritten correctly, dogfood passes, commit clean, but the new `peaks sub-agent dispatch` is called 50 times in one slice with no dispose logic, and the next session inherits 50 orphan records. This rule catches that.
