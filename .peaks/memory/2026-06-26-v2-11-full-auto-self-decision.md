---
name: 2026-06-26-v2-11-full-auto-self-decision
description: v2.11.0 — full-auto mode should let LLM self-decide per recommendations instead of pausing for AskUserQuestion. The "10/90 paradigm" demands that the recommended option IS the chosen option when the user picked full-auto.
metadata:
  type: project
---

# v2.11.0 — full-auto self-decision rule

> Decided in session `2026-06-26-session-a28d69` immediately after the
> v2.11.0 architectural direction (see [[2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff]]).
> **Status:** direction agreed; **PRD draft pending**; will merge into the same slice
> `remove-rd-techdoc-with-immutable-handoff-and-self-decide` (or a sibling slice).
> **Why this matters:** the user reported "full-auto 还是需要手动确认很多环节，正常应该是 LLM 自己根据推荐作为决策往下进行". The current SKILL.md is full of unconditional `AskUserQuestion` calls that do not gate on `--mode` — even in full-auto the LLM halts at every recommendation and waits for the human.

## The pain (literal user quote)

> "当我是使用 peaks-code 的 full auto 模式的时候，还是需要手动确认很多环节，正常应该是 LLM 自己根据推荐作为决策往下进行"

Translation: in full-auto, the LLM should treat the **recommended option as the chosen option** and continue without a confirmation round-trip. The user picked full-auto precisely to avoid the round-trips.

## Inventory of unconditional confirmation gates in current SKILL.md

The following sites pause regardless of `--mode`. In full-auto/swarm, each is supposed to be a no-op (recommended = chosen); today they all block.

| # | Step | File:line | What it pauses for | Mode-gated today? |
|---|---|---|---|---|
| 1 | Step 0.5 | `SKILL.md:83` → `references/openspec-workflow.md:63` | OpenSpec first-run opt-in | ❌ no |
| 2 | Step 0.6 | `SKILL.md:89` → `references/audit-goal-gate.md` (file does NOT exist) | "Display audit + goal to human for one-shot approval" — **file missing** | ❌ no |
| 3 | Step 0.7 | `SKILL.md:113` → `references/resume-detection.md:48-58` | Resume-from-deepest-gate question | ❌ no (hard rule "never silently auto-resume") |
| 4 | Step 0.55 | `SKILL.md:119` → `references/step-0-55-1x-detection.md:51` | 1.x → 2.0 upgrade prompt | ✅ opt-in/skip-this-session/skip-forever persistence — but no mode check |
| 5 | Step 1 | `SKILL.md:125` → `references/mode-selection.md` | Mode-selection question | n/a (this IS the mode select) |
| 6 | Step 2.5 | `SKILL.md:143` | Session title extraction — already a no-op if title set | ✅ already no-op when set |
| 7 | Step 2 → Phase 2 PRD | `references/workflow-gates-and-types.md:37` | "Assisted/Strict: pause with AskUserQuestion for explicit user confirmation before proceeding" | ✅ partial (only Assisted/Strict) |
| 8 | Phase 3 swarm | `references/runbook.md:104` | "Assisted/Strict: [CONFIRM]" | ✅ partial |
| 9 | Phase 6 QA | `references/runbook.md:128` | "Assisted/Strict: [CONFIRM]" | ✅ partial |
| 10 | Phase 10 TXT | `references/runbook.md:156-170` | memory extract apply/selective/skip | ❌ no mode check |
| 11 | Step N+1 | `SKILL.md:95` → `references/final-review-gate.md` (file does NOT exist) | "Display evidence to human for judgment" — **file missing** | ❌ no |
| 12 | Frontend-only | `references/frontend-only-mode.md:13-31` | 3 places: scan mismatch overrides | ❌ no mode check |
| 13 | Step 0.75 | `SKILL.md:75` → `references/checkpoint-resume.md` | Resume question | ❌ no |
| 14 | Standards preflight | `references/standards-preflight.md:8` | "assisted/strict pause for explicit user confirmation between dry-run and apply" | ✅ partial |

## The new rule (locked — D5 in v2.11.0)

### D5. full-auto / swarm mode = "recommended = chosen"

When `--mode` is `full-auto` or `swarm`, every AskUserQuestion site listed above MUST be re-implemented so the recommended option is auto-selected, the LLM emits a one-line "Auto-proceeding: <option>" log line, and the workflow continues without a round-trip.

Two sub-rules:

**D5.a — Always log, never silently skip.** Even when auto-proceeding, the LLM must emit one line: `auto-proceed (full-auto): <decision>`. The TXT handoff surfaces the full list of auto-decisions at session end so the human can audit. This preserves the "human can trace" property without blocking the round-trip.

**D5.b — Hard floor: 3 categories MUST always ask, regardless of mode.** These are intentionally above auto-proceed because they cross the cost-of-being-wrong threshold:

| Category | Why always ask | Examples |
|---|---|---|
| **Irreversible external side effects** | Cannot roll back | `git push` to remote, deleting remote branches, force-push, publishing npm, posting to chat |
| **Authentication / credential usage** | Permission to act on behalf of | Browser login walls, OAuth consent, secret injection |
| **Multi-day investment decisions** | Cost of wrong choice ≫ round-trip cost | Release tagging, dependency major-version upgrades, breaking-API changes |

Everything else auto-proceeds.

## Concrete change list for the v2.11.0 slice

- **D5.c — Per-gate patch table** (the 14 inventory rows above, mapped to which patch):

| Row | Patch shape |
|---|---|
| 1 (OpenSpec) | Add `if mode in {full-auto, swarm}: auto-opt-in + log line` |
| 2 (audit-goal) | Skip gate for full-auto; emit auto-decision log; persist goal |
| 3 (resume) | full-auto auto-resumes from deepest gate, logs decision, continues |
| 4 (1.x upgrade) | full-auto auto-runs upgrade if isOneX (current persistence already handles opt-in) |
| 5 (mode select) | n/a — only when user did not name mode |
| 7 (PRD confirm) | full-auto auto-transitions to `confirmed-by-user` (already supposed to work; verify runbook step 2) |
| 8 (swarm Gate B) | full-auto auto-proceeds (already supposed to work; verify runbook step 3) |
| 9 (QA Gate D) | full-auto auto-proceeds (already supposed to work; verify runbook step 6) |
| 10 (TXT memory extract) | full-auto auto-applies all; logs count |
| 11 (final review) | full-auto auto-emits pass if all 4 dims pass; logs dim summary |
| 12 (frontend-only mismatch) | full-auto auto-uses CLI's authoritative value; logs override |
| 13 (checkpoint resume) | full-auto auto-resumes from latest checkpoint; logs |
| 14 (standards preflight) | full-auto `--apply` is already default per `standards-preflight.md:8` — verify no extra prompt |

## Implementation pattern

A new shared helper:

```typescript
// src/services/solo/mode-gate.ts
export type Mode = 'full-auto' | 'assisted' | 'swarm' | 'strict';

export function shouldAutoProceed(mode: Mode): boolean {
  return mode === 'full-auto' || mode === 'swarm';
}

// Usage in SKILL.md prose / skill code:
//   if (shouldAutoProceed(currentMode)) {
//     emitLog(`auto-proceed (${currentMode}): ${recommendedOption}`);
//     return recommendedOption;
//   }
//   return askUserQuestion(options);
```

The helper MUST be the single source of truth — no inline `mode === 'full-auto'` checks scattered across files (Karpathy §2 simplicity).

## Test requirements

- New `tests/unit/services/solo/mode-gate.test.ts` covering all 4 modes × all 14 inventory rows → 56 cases
- New `tests/unit/skill-auto-proceed.test.ts` covering each SKILL.md gate individually (mock the AskUserQuestion call → assert it was NOT made)
- Each AskUserQuestion site that is mode-gated gets a `--json` probe that the LLM can grep before emitting the question: `peaks solo should-pause --step <step> --mode <mode> --project <repo> --json`

## Why this is additive, not a replacement

- The 3 hard-floor categories (D5.b) preserve all irreversible-side-effect safety
- Auto-decisions are logged to `.peaks/_runtime/<sid>/txt/auto-decisions.md` for audit
- The TXT handoff already lists "validated decisions"; the auto-decision list joins the same table
- Assisted/Strict modes are unaffected — every gate still pauses for human input

## Open questions

- Should the "log line" go to a separate audit file (`.peaks/_runtime/<sid>/audit/auto-proceed.log`) or inline into TXT handoff? Leaning separate file (grep-friendly + survives post-compact).
- Should `--mode full-auto` have a `--confirm-destructive` flag that requires a one-time typed phrase for destructive ops (safety belt)? Probably no — adds friction without proportional value.
- Should peaks-txt's Step 10 "Apply all / selective / skip" question auto-resolve to "Apply all" in full-auto? Yes (matches D5 default) but verify against the existing memory extract contract.

## Related memory / docs

- [[2026-06-26-v2-11-main-session-context-monitor]] — sibling (D6). D5 = "stop pausing unnecessarily"; D6 = "monitor and compact when full". Both ship in Group F.
- [[2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff]] — companion architectural change (4 locked decisions D1-D4)
- [[custom-sop-domain-agnostic-positioning]] — same "remove friction" philosophy
- [[gate-enforcement-hook]] — irrecoverable-side-effect detection already in place via PreToolUse hooks; complements D5.b

## Session info

- Session id: `2026-06-26-session-a28d69`
- Started: 2026-06-26 00:35 UTC+8
- Discovered: user message at the start of post-compact turn "full-auto 还是需要手动确认很多环节"
- Compaction reason: same session, second compact pending after this memory write