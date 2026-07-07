---
name: 2026-06-26-v2-11-post-compact-resume
description: v2.11.0 D7 — after manual /compact, peaks-code MUST auto-resume (run Step 0.75, read memory, continue PRD draft) without re-asking the user to confirm resume. Companion to D5 (full-auto self-decision) and D6 (main-session context monitor).
metadata:
  type: project
---

# D7 — post-compact auto-resume contract

> User asked: "我是想先手动 compact 之后，你再继续". Confirms: manual `/compact` (Claude Code native context compression) → fresh Claude Code context window (same peaks-loop `<sessionId>`) → peaks-code auto-resumes from the prior checkpoint (no AskUserQuestion) → loads project memory → continues the in-flight task. The fresh LLM should NOT re-litigate mode, re-confirm resume, or re-explain the task.

## The pain (literal user quote)

> "我是想先手动 compact 之后，你再继续"

Translation: After the user manually triggers Claude Code's native `/compact` slash command (escaping context overflow), the next turn must seamlessly continue the peaks-code workflow. Today the fresh-context LLM:
- Does not know peaks-code was in flight
- Re-asks mode selection (Step 1)
- Re-asks resume confirmation (Step 0.7 — "never silently auto-resume")
- Has to re-load project memory (Step 2.3)
- Risks re-litigating decisions captured in 4 v2.11.0 memory files

D7 closes that gap with an automatic resume path that triggers when conditions match.

## Why this is distinct from D5 + D6

| Decision | Trigger | Scope | Mode override |
|---|---|---|---|
| D5 (full-auto self-decision) | Mode = full-auto or swarm | 14 AskUserQuestion sites | Only full-auto/swarm auto-proceed |
| D6 (context monitor) | Threshold ≥ 75% | Main-session context window | All modes (programmatic) |
| **D7 (post-compact resume)** | **Manual `/compact` + today's checkpoint** | **Step 0.7 resume-detection** | **All modes auto-proceed (override "never silently auto-resume")** |

D7 is the **manual-trigger sibling of D6**: D6 fires on programmatic threshold; D7 fires on user-driven compact. Both ship in v2.11.0 Group F.

## The new rule (locked — D7 in v2.11.0)

### D7.a — Detection condition (all 5 must hold)

Post-compact auto-resume triggers when ALL of the following are true:

| # | Condition | Source | Why |
|---|---|---|---|
| 1 | `.peaks/_runtime/<sessionId>/` is bound | Step 0 anchor succeeds | Workspace exists |
| 2 | `.peaks/_runtime/<sessionId>/checkpoints/` has ≥1 file from today | Step 0.75 probe | User worked today |
| 3 | Latest checkpoint has `mode` field | Last checkpoint metadata | We know which mode to restore |
| 4 | User invokes `/peaks-code` (not a different skill) | Skill presence detection | peaks-code is the active skill |
| 5 | Latest checkpoint was written within last 24h | mtime check | Same-day only (cross-day uses normal resume) |

If any condition fails, fall through to normal Step 0.7 (which may still ask via AskUserQuestion in assisted/strict modes).

### D7.b — Override the "never silently auto-resume" rule

The current SKILL.md Step 0.7 explicitly says: "Never silently auto-resume". D7 OVERRIDES this for the post-compact case specifically:

- **Pre-compact state:** Today's checkpoint exists with `mode` + `current-plan` + `recent-decisions`
- **Post-compact behavior:** Auto-resume (no AskUserQuestion), regardless of mode (full-auto / assisted / swarm / strict)
- **Rationale:** The user already approved the in-flight task pre-compact. Asking again after `/compact` is friction with no upside — the user explicitly asked to continue.

This is the ONLY AskUserQuestion site where ALL modes auto-proceed. Even D5's 3 hard-floor categories (irreversible external side effects / auth-credential / multi-day investment) defer here — those gates are mid-workflow; D7 is at workflow resume.

### D7.c — Skip redundant steps (already done pre-compact, persisted)

When post-compact auto-resume triggers, the following steps are SKIPPED:

| Step | Why skip |
|---|---|
| Step 0.5 (OpenSpec opt-in) | Decision persisted to `.peaks/.peaks-openspec-opt-in.json` |
| Step 0.55 (1.x → 2.0 upgrade) | Decision persisted to `.peaks/preferences.json` (`autoUpgradePrompt`) |
| Step 0.6 (audit + goal) | Approved goal already at `.peaks/_runtime/<sid>/audit-goal/<rid>.json` |
| Step 1 (mode selection) | Mode restored from last checkpoint's `mode` field |
| Step 2 (skill presence re-set) | Re-run with restored mode (idempotent) |
| Step 2.5 (session title) | Title already set; Step 2.5 is already a no-op when set |

### D7.d — Run only these steps (post-compact)

| Step | Why run |
|---|---|
| Step 0 (anchor) | Re-bind workspace (cheap, idempotent) |
| Step 0.75 (resume probe) | Load latest checkpoint context into LLM prompt |
| Step 0.7 (resume detection — auto) | Confirm post-compact + emit resume context block |
| Step 2.3 (load project memory) | Refresh memory index (may have new memories written post-compact — e.g., the D5/D6/D7 files just written) |
| Step N+2 (context monitor — from D6) | First thing after resume — confirm context is sane (post-compact should be ≤ 50%) |

### D7.e — Always log (matches D5.a / D6.d)

Every post-compact resume emits a one-line log entry:

```
2026-06-26T10:30:00Z post-compact resume: <task> mode=<mode> checkpoint=<path>
```

Appended to `.peaks/_runtime/<sessionId>/txt/auto-decisions.md`. The peaks-txt Step 10 audit picks this up automatically (same channel as D5 + D6).

### D7.f — Fresh-context auto-detection mechanism (two options)

For post-compact auto-resume to work, the fresh-context LLM needs to know peaks-code is in flight. Two options:

| Option | Mechanism | When to use |
|---|---|---|
| **Option A (LLM-driven)** | User re-invokes `/peaks-code` in fresh context. peaks-code Step 0.7 detects today's checkpoint → auto-resume. | **Default for v2.11.0** — no new infrastructure |
| **Option B (hook-driven)** | SessionStart hook fires `peaks session info --active --json` + injects resume context into fresh LLM's first turn. | **Deferred** — requires SessionStart hook infra; can come in a later slice |

**Lean Option A for v2.11.0:** the user types `/peaks-code` (or the skill is auto-loaded by CLAUDE.md / skills config), peaks-code detects the in-flight session via today's checkpoint, auto-resumes. No new CLI or hooks needed.

Option B would let the fresh LLM auto-continue even without typing `/peaks-code` — but that adds infrastructure surface area (SessionStart hook, prompt injection, edge cases for non-peaks sessions). Defer until the user explicitly asks for it.

### D7.g — Cross-session scope (NOT in scope for D7)

D7 only handles the **same-day post-compact** case. For cross-day / cross-machine resume, that's a separate concern:

- `peaks session checkpoint` (slice 011) — already exists
- `peaks session resume --from <path>` (slice 011) — already exists
- Cross-machine resume: tracked under [[peaks-loop-cross-machine-resume]] (planned, not v2.11.0)

D7 is the smallest unit of auto-resume: "I just `/compact`'d, please continue". It does not invent cross-day / cross-machine mechanics.

## Concrete change list for the v2.11.0 slice

- **D7.h — Modify** `references/checkpoint-resume.md` — add "post-compact auto-resume" section; document the override of "never silently auto-resume" for this case
- **D7.i — Modify** `references/resume-detection.md` — add "post-compact" tier to the classification table; auto-resume when D7.a.1–5 conditions met
- **D7.j — Modify SKILL.md Step 0.7** — add the post-compact branch; document that ALL modes auto-proceed here (D7.b override)
- **D7.k — New module** `src/services/code/post-compact-detector.ts` — encapsulates detection logic; exposes `detectPostCompactResume(sid, projectRoot): Promise<PostCompactResumeProbe>`
- **D7.l — Extend** `src/services/code/mode-gate.ts` (from D5) — add `shouldAutoProceedOnPostCompact()` that always returns `true`; documents the D7.b override in code
- **D7.m — New CLI** `peaks code post-compact-detect --project <repo> --json` — LLM can probe before invoking Step 0.7 logic
- **D7.n — Test** `tests/unit/services/code/post-compact-detector.test.ts` covering: 4 modes × 3 checkpoint states (today / yesterday / none) × 2 binding states (bound / unbound) = 24 cases; plus the multi-checkpoint disambiguation test (3 sessions, verify most-recent wins); plus the missing-mode-field test
- **D7.o — Test** `tests/unit/skill-post-compact-resume.test.ts` covering SKILL.md Step 0.7 prose + the log-line shape + the Step 0.7 AskUserQuestion mock (assert NOT called)

### PostCompactResumeProbe schema

```typescript
// src/services/code/post-compact-detector.ts
export type PostCompactResumeReason =
  | 'post-compact-match'
  | 'no-checkpoint-today'
  | 'sid-unbound'
  | 'no-mode-field'
  | 'checkpoint-stale'
  | 'multiple-checkpoints-ambiguous';

export interface PostCompactResumeProbe {
  shouldAutoResume: boolean;
  reason: PostCompactResumeReason;
  mode?: 'full-auto' | 'assisted' | 'swarm' | 'strict';
  checkpointPath?: string;        // path to the latest checkpoint .json file
  checkpointMtime?: string;       // ISO 8601
  task?: string;                  // current-plan field
  openQuestions?: string[];
  recentDecisions?: string[];
}

export async function detectPostCompactResume(
  sid: string,
  projectRoot: string,
): Promise<PostCompactResumeProbe> { /* D7.a + D7.g logic */ }
```

## Multi-CC implementation — same Group F as D5 + D6

D5, D6, D7 all ship together as Group F ("runtime friction removal"):

| Decision | Module(s) | SKILL.md touch | Test files |
|---|---|---|---|
| D5 self-decision | `src/services/code/mode-gate.ts` | 14-row patch in Steps 0.5, 0.6, 0.7, 0.55, 0.75, 1, 2.5, N+1, Phase 2/3/6/10, frontend-only | `mode-gate.test.ts` (56 cases), `skill-auto-proceed.test.ts` |
| D6 context monitor | `src/services/context/main-session-monitor.ts`, extend `threshold.ts` | New Step N+2 | `main-session-monitor.test.ts` (24 cases), `skill-context-monitor.test.ts` |
| **D7 post-compact resume** | **`src/services/code/post-compact-detector.ts`, extend `mode-gate.ts`** | **Step 0.7 prose update** | **`post-compact-detector.test.ts` (24 cases), `skill-post-compact-resume.test.ts`** |

Combined integration test: `tests/unit/services/runtime-friction.test.ts` covers D5 + D6 + D7 end-to-end (one continuous session that gets mocked-compacted mid-flow).

## Implementation pattern

Two-line pattern, fits in `src/services/code/post-compact-detector.ts`:

```typescript
// Detect post-compact auto-resume (called from SKILL.md Step 0.7 prose / skill code)
const probe = await detectPostCompactResume(sid, projectRoot);
if (probe.shouldAutoResume) {
  emitLog(`post-compact resume: ${probe.task} mode=${probe.mode} checkpoint=${probe.checkpointPath}`);
  return runPostCompactResumePath(probe);  // skip 0.5/0.55/0.6/1/2/2.5; run 0/0.75/0.7/2.3/N+2
}
// fall through to normal Step 0.7 flow
return runNormalStep07Flow();
```

The detector MUST be the single source of truth — no inline `isPostCompact()` checks scattered across files (Karpathy §2 simplicity, matches D5's `shouldAutoProceed()` pattern).

## Test requirements

- New `tests/unit/services/code/post-compact-detector.test.ts`:
  - 4 modes × 3 checkpoint states (today / yesterday / none) × 2 binding states (bound / unbound) = 24 cases
  - Multi-checkpoint disambiguation (3 sessions with today's checkpoint → most-recent wins)
  - Stale-checkpoint (yesterday → fall through)
  - Missing-mode-field (checkpoint without `mode` → fall through)
  - Multi-session-equal-mtime (ambiguous → fall through to AskUserQuestion)
- New `tests/unit/skill-post-compact-resume.test.ts`:
  - SKILL.md Step 0.7 prose assertions
  - Log-line shape (regex match against `auto-decisions.md`)
  - Mock the AskUserQuestion call → assert it was NOT made when post-compact-match
- Each gated decision gets a `--json` probe that the LLM can grep before emitting the question: `peaks code post-compact-detect --project <repo> --json`

## Why this is additive, not a replacement

- The existing Step 0.75 (resume from checkpoint) is **unchanged** — D7 extends it with the auto-resume path
- The existing Step 0.7 (resume detection) keeps its AskUserQuestion for non-post-compact cases (multi-day resume, fresh start, different skill invoked)
- The peaks-code skill still respects the "never silently auto-resume" rule for the general case
- D7.b is the ONLY AskUserQuestion site where all modes auto-proceed, by design (user already approved pre-compact)
- Cross-day resume is NOT in scope (D7.g) — keep `peaks session resume --from <path>` for that
- The peaks-loop `<sessionId>` axis is preserved across `/compact` (Claude Code's outer session changes, but peaks-loop owns its own session continuity)

## Open questions

- Should Option B (SessionStart hook) be added in v2.11.0 or deferred? **Lean deferred** — Option A covers the user's literal request, less surface area; revisit post-v2.11.0 if user asks
- Should post-compact auto-resume work even if the user invokes a DIFFERENT skill (not `/peaks-code`) in fresh context? **Lean no** — the user might want a fresh perspective. Verify with user post-PRD
- Should the auto-resume be opt-out via `peaks.code.postCompactResume: false` in `.peaks/preferences.json`? **Lean yes** — default-on matches user's "你再继续" wording, opt-out for edge cases (rare LLM misfire, multi-session ambiguity)
- Should the resume context block include the original user message (pre-compact) or just the checkpoint summary? **Lean summary only** — original messages may be sensitive / out of context. Checkpoint's `current-plan` + `open-questions` + `recent-decisions` is enough
- What if multiple sessions have today's checkpoint (multi-session user)? Disambiguate via `lastActivity` (most recent wins); if equal, fall through to AskUserQuestion with disambiguation options. **Verify with user.**
- Should D7 emit a user-visible notice ("auto-resuming from checkpoint <path>") or just the log line? **Lean log-only** (matches D5.a / D6.d) but make it grep-friendly so users can audit via `peaks session audit-log`

## Related memory / docs

- [[2026-06-26-v2-11-rm-rd-techdoc-immutable-handoff]] (D1-D4, PRD target — D7 ensures PRD draft survives compact)
- [[2026-06-26-v2-11-full-auto-self-decision]] (D5, same auto-proceed philosophy)
- [[2026-06-26-v2-11-main-session-context-monitor]] (D6, programmatic threshold trigger — D7 is the manual trigger sibling)
- `references/checkpoint-resume.md` — Step 0.75 contract; D7 extends it
- `references/resume-detection.md` — Step 0.7 detection algorithm; D7 adds a tier
- `peaks-loop-1-3-3-will-be-the-first-release-with-the-ide-adapter-layer` — slice 021 IDE-adapter layer; Option B (SessionStart hook) would depend on this
- [[main-branch-iteration]] — peaks-loop dev policy

## Session info

- Session id: `2026-06-26-session-a28d69`
- Started: 2026-06-26 00:35 UTC+8
- Discovered: user message "我是想先手动 compact 之后，你再继续" (after initial misinterpretation as auto-trigger)
- Compaction: pending after this memory expansion (D7 fleshed out to match D5/D6 detail density)