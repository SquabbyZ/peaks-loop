---
name: 2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff
description: peaks-cli v2.11.0 architectural direction — remove RD tech-doc, make peaks-prd handoff immutable + shared, audit fan-out with ECC integration, project-scan bidirectional learning loop.
metadata:
  type: project
---

# v2.11.0 Architectural Direction — RD tech-doc removal + immutable shared handoff

> Decided in session `2026-06-26-session-a28d69` after v2.10.0 release.
> **Status:** direction agreed; **PRD draft pending**; **multi-CC implementation mode planned**.
> **Why this matters:** the existing chain `peaks-prd → peaks-rd tech-doc → audit fan-out → peaks-qa` is wasteful (RD rewrites handoff, QA redoes security/perf) and contradicts the "10/90 paradigm" / AI-coding philosophy.

## The 4 design decisions (locked)

### D1. Immutable shared handoff from peaks-prd

peaks-prd produces a single, **immutable** handoff at `.peaks/_runtime/<sessionId>/prd/handoff.md` after user confirmation. **All downstream consumers** (peaks-rd main loop + 4 audit sub-agents + peaks-qa) read the same artifact.

- Frontmatter contains `sha256` of the body content
- Every sub-agent prompt starts with: `verify handoff hash = <X>` — refuses to proceed if mismatch
- **Old pattern killed:** peaks-rd writing its own handoff and passing to peaks-qa (this is "self-rewriting-truth" = meaningless)

### D2. Half-white-box merged audit output

3 audit sub-agents (code-review / security-review / perf-baseline) merge their output into **one** file at `.peaks/_runtime/<sessionId>/rd/audit/<rid>.md` (3 verdicts side-by-side, LLM-friendly format).

- The qa-test-cases-writer sub-agent (4th) writes separately to `qa/test-cases/<rid>.md` (QA reads directly)
- "Half-white-box" = human can verify "all 3 ran and have verdicts" without parsing the per-agent detail
- Stays in `.peaks/_runtime/<sid>/rd/` (gitignored) — **not** promoted to project level

### D3. project-scan bidirectional learning loop

`.peaks/project-scan/` (git-tracked, project-level) carries:
- `project-scan.md` — tech stack, library versions, architecture, security/perf checklist, Karpathy §2 5-anti-pattern template
- `business-knowledge.md` — schema-sedimented: `{ concept, definition, source_rid, decided_at, evidence }[]` (not free text)

Flow:
- **流入 (peaks-prd 脑暴时):** MUST read both files; gate fails if missing
- **流出 (peaks-txt 末尾总结时):** if the session surfaced ≥1 new business concept/rule/decision, must append to `business-knowledge.md`
- This is the "10/90 self-improving" loop — every session makes the project smarter

### D4. ECC code-review agent integration

peaks-rd's parallel audit sub-agent 1 (code-reviewer) is now an ECC bridge: invokes `everything-claude-code:code-review` via **Agent tool** (not Skill tool — IDE-portability concern), and the ECC output is shape-adapted to peaks-cli's `code-review.md` schema.

- New module: `src/services/code-review/ecc-bridge.ts`
- ECC skills/agents kept (security-bounty-hunter, security-review, security-scan, gateguard, code-review, etc.) — they are reference material consumed by peaks sub-agents, not removed
- peaks-mut is **audit** (not business test) — stays as mutation testing tool

## Storage layout (final v2.11.0)

```
.peaks/project-scan/  (git-tracked, project-level)
├── project-scan.md
└── business-knowledge.md  (schema-sedimented, written by peaks-txt)

.peaks/_runtime/<sid>/prd/  (gitignored)
└── handoff.md  ★ IMMUTABLE ★  (sha256 in frontmatter)

.peaks/_runtime/<sid>/rd/  (gitignored)
├── requests/<rid>.md         (per-slice, RD writes)
├── audit/<rid>.md            (3-merged, half-white-box)
└── handoff-ref.md            (pointer: handoffHash, handoffPath)

.peaks/_runtime/<sid>/qa/  (gitignored)
├── test-cases/<rid>.md       (sub-agent 4 writes)
└── test-report/<rid>.md      (peaks-qa writes)
```

## Responsibility matrix (peaks-qa trimmed)

| Skill | Owns | Does NOT own |
|---|---|---|
| `peaks-prd` | handoff (immutable), AC, decisions | implementation, audit |
| `peaks-rd` | implementation, fan-out 4 audit sub-agents | security/perf review self |
| `peaks-rd::sub-agent-1` (code-review) | code review (via ECC bridge) | — |
| `peaks-rd::sub-agent-2` (security-review) | threat model, secret/SSRF/SQLi/XSS, authz | — |
| `peaks-rd::sub-agent-3` (perf-baseline) | perf scaffold + fill | — |
| `peaks-rd::sub-agent-4` (qa-test-cases-writer) | pre-draft test plan from AC | — |
| `peaks-qa` | **business implementation testing only** — AC verify, regression, mutation | ❌ security review, ❌ perf review, ❌ reading tech-doc (gone) |
| `peaks-txt` | handoff compact, **business-knowledge sediment** | — |
| `peaks-mut` | mutation testing (audit) | business test |

## Tier-by-tier change list (8 tiers, ~32 file ops)

- **Tier 1 (delete):** `mandatory-tech-doc.md`, `tech-doc-presence.ts`, `tech-doc-mandatory-sections.ts`; modify `lint-workflow-shape.ts`, `pre-rd-scan.ts`, `red-line-catalog.ts:68`, `request-artifact-service.ts:671`
- **Tier 2 (sub-agent input rewiring):** `parallel-review-fanout.md` (4 hash-verified reads), `rd-fanout-contracts.md`, `rd-sub-agent-dispatch.md`, `writing-handoff-frontmatter.md` (replace `techDoc:` with `handoffPath` + `handoffHash`), `artifact-per-request.md`
- **Tier 3 (peaks-prd handoff redefinition):** rewrite `peaks-prd/SKILL.md`; new `prd/handoff-service.ts`; new CLI `peaks prd handoff init|verify|show`; new schema with sha256
- **Tier 4 (peaks-prd reads project-scan):** Step in peaks-prd SKILL.md "must read project-scan.md + business-knowledge.md before brainstorm"; new `peaks project knowledge` CLI
- **Tier 5 (peaks-txt sediments):** new step in peaks-txt SKILL.md "if new business concept surfaced, append to business-knowledge.md" with structured schema
- **Tier 6 (peaks-qa trim):** `peaks-qa/SKILL.md` remove Gate A3/A4; rewrite `qa-runbook.md`; prune `src/services/qa/`
- **Tier 7 (ECC integration):** new `src/services/code-review/ecc-bridge.ts`; `parallel-review-fanout.md` sub-agent 1 prompt uses Agent tool to call `everything-claude-code:code-review`; output adapted to peaks schema
- **Tier 8 (migration + version):** `migrate-service.ts` v2.10.0→v2.11.0; CHANGELOG entry; old `rd/tech-doc.md` files tagged "deprecated historical" rather than deleted

## Decisions and confirmations (chronological)

1. **Cancel peaks-rd tech-doc output** — confirmed
2. **peaks-qa no longer security/perf** — confirmed; consolidated into peaks-rd's independent audit fan-out
3. **peaks-mut is audit (not business test)** — confirmed
4. **ECC skills/agents preserved as reference** — confirmed
5. **Karpathy self-check at project level (project-scan)** — confirmed
6. **Audit output merged + half-white-box + stays in `.peaks/_runtime/<sid>/rd/`** — confirmed
7. **handoff is immutable, shared by all sub-agents, no RD re-write** — confirmed
8. **peaks-prd reads project-scan during brainstorm (no blind guess)** — confirmed
9. **business-knowledge sedimented by peaks-txt at session end** — confirmed
10. **ECC code-review via Agent tool, NOT Skill tool** — confirmed (option b in last round)
11. **Implementation mode = multi-CC** — confirmed (large change, ~32 file ops, parallel-friendly)
12. **Save to .peaks/memory/ before compact** — confirmed (this file)
13. **full-auto mode should self-decide per recommendations** — confirmed (sibling memory [[2026-06-26-v2-11-full-auto-self-decision]]; 3 hard-floor categories remain: irreversible external side effects, auth/credential, multi-day investment)

## Implementation plan (post-compact resume)

1. **After compact:** fresh session, read this memory + the sibling [[2026-06-26-v2-11-full-auto-self-decision]] memory first
2. **Combine into ONE slice:** both decisions (D1-D4 architectural + D5 self-decision) belong in the same v2.11.0 release; draft PRD for `v2-11-rm-rd-techdoc-immutable-handoff-and-self-decide` (or similar slug)
3. **Run peaks-prd pipeline** to confirm PRD
4. **Multi-CC execution:** since the change spans 9 tiers (D5 + D6 add 2 more tiers on top of the 8) touching ~40 files across `peaks-prd / peaks-rd / peaks-qa / peaks-txt / peaks-solo / src/services/solo / src/services/context / src/cli/commands/solo-commands.ts` + new modules, dispatch in parallel where possible:
   - Group A (Tier 1 + 2 — tech-doc removal + sub-agent rewiring): one CC
   - Group B (Tier 3 + 4 — peaks-prd handoff redefinition + project-scan read): one CC
   - Group C (Tier 5 + 6 — peaks-txt sediment + peaks-qa trim): one CC
   - Group D (Tier 7 — ECC bridge): one CC
   - Group E (Tier 8 — migration + CHANGELOG): one CC
   - **Group F (Tier 9 — D5 self-decision + D6 context monitor — mode-gate.ts + main-session-monitor.ts + 14-row patch + SKILL.md Step N+2): one CC**
5. **Each CC runs standard peaks-rd → peaks-qa pipeline** independently
6. **After all 6 groups pass QA:** version bump to 2.11.0, integrate, release

## Open questions (for next session to verify, not block)

- Does `everything-claude-code:code-review` Agent tool support the "input → output" shape we need for adaptation? Verify in next session.
- Should `business-knowledge.md` schema have a "deprecated" lifecycle for outdated concepts? (probably yes — long-lived projects accumulate dead concepts)
- Migration of historical `rd/tech-doc.md` files in 28+ existing sessions — is the "tag deprecated, keep" approach the right call, or should we offer `peaks migrate --prune-techdoc`?
- Should `peaks-txt` sediment step be a hard gate or soft nudge? User said "由 LLM 做可以在单次流程结束的尾部 txt 总结的时候沉淀" — leaning soft, but verify in next session.

## Related memory / docs

- [[2026-06-26-v2-11-full-auto-self-decision]] — sibling decision in the same session; D5 = "full-auto/swarm auto-proceed per recommended option, except 3 hard-floor categories". 14-row inventory of unconditional AskUserQuestion sites to patch.
- [[2026-06-26-v2-11-main-session-context-monitor]] — sibling decision; D6 = "monitor main-session context + IDE-aware compact trigger". Combines with D5 in Group F implementation.
- [[custom-sop-and-gate-metering]] — same "metering is value" philosophy applies to immutable handoff (handoff IS the value, not the post-hoc review)
- [[custom-sop-domain-agnostic-positioning]] — peaks-prd's structured handoff is the keystone; custom SOPs build on it
- [[coverage-red-line]] — 95%/100% test coverage gate stays in force
- [[main-branch-iteration]] — edit main, no worktree (per peaks-cli dev policy)

## Session info

- Session id: `2026-06-26-session-a28d69`
- Started: 2026-06-26 00:35 UTC+8
- Project: peaks-cli v2.10.0 → planning v2.11.0
- Previous session: `2026-06-25-session-139b84` (released v2.10.0)
- Compaction reason: user requested compact after this memory write, to resume post-compact with clean context
