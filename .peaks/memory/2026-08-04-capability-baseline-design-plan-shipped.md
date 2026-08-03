---
name: capability-baseline-guard-audit-fully-shipped
description: 2026-08-03 session — peaks-loop 4.0.x capability baseline / guard / audit three-layer system fully shipped (15 P0 journeys frozen, 15 guard contracts in CI, audit service + 5th dim + release-pack gate). 5-slice plan executed end-to-end.
metadata:
  type: project
---

**What happened**: 5-slice plan executed end-to-end. Slice 1 (baseline store + freeze CLI), Slice 2 (4.0.8 frozen by user-approved `peaks baseline freeze`), Slice 3 (guard runner + J01 sample contract), Slice 4 (14 remaining contracts + CI gate), Slice 5 (audit service + 5th dim + release-pack gate + RL-10). 32 tasks shipped, 15/15 guard contracts passing, `openspec/baselines/current/capability-baseline.json` is the 4.0.8 frozen baseline.

**Why**: The user asked "我有个问题，当前这个项目整体功能稳定能力75%，但是我还担心的是，随着迭代修改BUG等，让项目的功能偏移。因为整个项目完全是AI开发的" — and the answer is to freeze the 15 P0 user journeys' product semantics, run pure-function guard contracts in CI, and audit cross-version behavior with an independent LLM context.

**How to apply**:
- Any future slice that touches a P0 journey's external behavior must run `peaks baseline freeze-update` (Human-NL-Choice-Only two-step confirmation). The guard runner + audit service will detect unauthorized drift on the next CI run.
- If `peaks baseline audit` returns `drifted` or `inconclusive`, the slice is blocked. Do not bypass.
- The 5th-dim verdict (`capability-consistency`) is appended to every `prepareFinalReview` output. `drifted` ⇒ `fail`; `inconclusive` ⇒ `inconclusive`; `consistent` ⇒ `pass`.
- Plan + spec live at `docs/superpowers/{specs,plans}/2026-08-03-capability-baseline-guard-audit-{design,plan}.md` for any future amendment.
- Locked vocabulary: `capability baseline` / `capability guard` / `capability audit` / `P0 journey` / `guard contract` / `capability-consistency` — the glossary test in `tests/unit/standards/capability-glossary.test.ts` enforces this.
