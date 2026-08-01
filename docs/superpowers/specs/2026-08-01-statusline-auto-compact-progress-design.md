# Peaks-Loop Statusline and Auto-Compact Progress Design

**Date:** 2026-08-01  
**Status:** Approved design; implementation not started

## 1. Goal

Refine the Peaks-Loop Claude Code statusline so it has a clear, professional information hierarchy without a temporary logo, and make the complete auto-compact lifecycle visible through an honest stage-based progress bar.

Success means:

- the normal statusline is easier to scan than the current `⛰ Peaks ● peaks-code · peaks-loop` form;
- no mountain or other provisional logo glyph is shown;
- color enhances the status but symbols and text preserve the meaning without color;
- routine mode and gate data do not make the line noisy;
- an auto-compact run is visible from queueing through completion or failure;
- progress represents observable lifecycle stages rather than invented internal percentages.

## 2. Scope

### In scope

- The primary Peaks statusline renderer.
- Status glyphs, separators, ANSI color policy, and ASCII fallback.
- Conditional gate visibility.
- A unified read-only statusline view of auto-compact lifecycle state.
- Stage progress, completion feedback, failure persistence, and stale-run handling.
- Unit, integration, and real-terminal visual verification.

### Out of scope

- Designing a permanent Peaks logo.
- Responsive terminal-width truncation.
- High-frame-rate animation.
- Claiming access to Claude Code's private internal compaction percentage.
- Changing auto-compact thresholds or the zero-intervention execution contract.
- Redesigning the broader Peaks Skill Swarm response output style.

## 3. Normal statusline design

The stable information order is:

```text
brand  state  current work  exceptional context  project
Peaks   ●     peaks-code          · QA            › peaks-loop
```

### Active

```text
Peaks ● peaks-code › peaks-loop
```

- `Peaks` is the permanent text brand anchor.
- No logo glyph precedes the brand.
- `●` means an active skill.
- The active skill is the primary work identity.
- The project is secondary context and appears last.
- Mode is hidden during normal operation.
- Routine gates are hidden during normal operation.

### Idle

```text
Peaks ○ idle › peaks-loop
```

This confirms that Peaks is installed and healthy while no skill is active.

### Blocking or attention gate

```text
Peaks ⚠ peaks-code · QA › peaks-loop
```

Only a gate that requires attention or blocks advancement is promoted into the statusline. It uses a human-readable label rather than configuration syntax such as `gate:QA`.

### Stale or unreadable state

The existing diagnostic meaning remains available. Technical states such as stale presence or an unreadable presence file must not be silently converted to idle. Their wording may be normalized to the new hierarchy, but diagnosis takes precedence over brevity.

## 4. Color and fallback policy

Color is an enhancement, not the sole carrier of meaning.

| Element | ANSI-capable terminal | Semantic role |
| --- | --- | --- |
| `Peaks` | default or bright foreground | brand anchor |
| `●` | green | active |
| `○` | dim gray | idle |
| `⚠` | yellow | attention or blocked |
| active skill | default or lightly emphasized | primary work |
| attention gate | yellow | required action |
| project suffix | dim gray | secondary context |
| completed compact | green | success |
| failed compact | red | persistent failure |

The renderer supports three output capabilities:

1. **ANSI + Unicode** — colors plus Unicode status glyphs.
2. **No-color Unicode** — same text and Unicode glyphs, no escape sequences.
3. **Plain ASCII** — complete glyph fallback, not only separator fallback.

ASCII mappings:

| Unicode | ASCII |
| --- | --- |
| `●` | `*` |
| `○` | `o` |
| `⚠` | `!` |
| `✓` | `+` |
| `✕` | `!` |
| `◐ ◑ ◒ ◓` | `~` |
| `›` | `>` |
| `·` | `-` |
| `→` | `->` |
| `█` | `#` |
| `░` | `-` |

`NO_COLOR`, non-color output, or an explicitly selected plain mode disables ANSI. Plain ASCII selection disables all non-ASCII glyphs. Visual acceptance must use a real statusline-capable terminal; Markdown code blocks are not evidence that ANSI rendering works.

## 5. Auto-compact lifecycle

The existing compact visibility helper recognizes pending, red-line, recent completion, idle, and missing states. The new design evolves this into one explicit lifecycle source consumed by the primary statusline:

```text
idle → queued → preparing → compacting → verifying → completed
                                  └───────────────→ failed
```

The statusline renderer remains read-only. The auto-compact orchestrator records atomic state transitions before and after each observable operation.

### Stage semantics

| Stage | Bar | Meaning |
| --- | --- | --- |
| `queued` | 0/8 | Threshold crossed; waiting for a safe execution window |
| `preparing` | 2/8 | Persisting checkpoint and recovery context |
| `compacting` | 4/8 | Actual compact action has been submitted or started |
| `verifying` | 6/8 | Reading post-compact context and recovery state |
| `completed` | 8/8 | Compact succeeded and outcome was recorded |
| `failed` | last reached fill | Compact failed at the recorded stage |

The visual percentages implied by the bar are fixed stage milestones: 0, 25, 50, 75, and 100 percent. They are not a claim about Claude's private internal progress.

## 6. Dynamic statusline output

During auto-compact, compact state temporarily outranks skill state.

### Queued

```text
Peaks ◐ [░░░░░░░░] queued · 87% › peaks-loop
```

The ratio is the pre-compact context usage, not execution progress.

### Preparing

```text
Peaks ◑ [██░░░░░░] preparing · 87% › peaks-loop
```

### Compacting

```text
Peaks ◒ [████░░░░] compacting · 87% › peaks-loop
```

The phase glyph may rotate among `◐ ◑ ◒ ◓` according to natural statusline refreshes. No timer-based high-frequency animation is required.

### Verifying

```text
Peaks ◓ [██████░░] verifying › peaks-loop
```

### Completed

```text
Peaks ✓ [████████] compacted · 87% → 42% › peaks-loop
```

A real post-compact ratio is displayed only when measured. If it is unavailable, omit it:

```text
Peaks ✓ [████████] compacted · 87% › peaks-loop
```

Never display guessed values such as `0.0?` or `→ ?`.

The successful result remains visible for approximately 10 seconds and then yields to the normal active-skill line.

### Failed

```text
Peaks ✕ [████░░░░] compact failed · compacting › peaks-loop
```

Failure preserves the last completed stage and records where the run failed. Unlike success, failure does not disappear on a short timer. It remains until a later successful compact, an explicit retry transition, or a defined acknowledgement/reset operation supersedes it.

### Red line

```text
Peaks ⚠ [████░░░░] REDLINE compacting · 96% › peaks-loop
```

`REDLINE` remains textual so color is never the only indicator. This design does not modify the mandatory immediate execution behavior at ratio 0.95 or higher.

### ASCII examples

```text
Peaks ~ [####----] compacting - 87% > peaks-loop
Peaks + [########] compacted - 87% -> 42% > peaks-loop
Peaks ! [####----] compact failed - compacting > peaks-loop
```

## 7. State contract

The compact lifecycle record should contain enough data for deterministic rendering and recovery:

- lifecycle stage;
- lifecycle status (`running`, `completed`, or `failed` where useful);
- update timestamp;
- run identifier or attempt identifier;
- trigger ratio;
- post-compact ratio when measured;
- red-line flag;
- failure stage and a bounded error summary when failed.

Writes must be atomic. The reader must tolerate missing files as idle/missing according to the existing session contract, while malformed or unreadable lifecycle data must surface a diagnostic state rather than silently claim success.

A `preparing`, `compacting`, or `verifying` state whose update timestamp exceeds a defined timeout becomes an interrupted/stalled diagnostic. It must not remain forever as a false live animation. The exact timeout should be selected from observed compact durations during implementation and covered by tests.

## 8. Integration boundaries

- Extend or replace the existing compact-statusline state model rather than creating a second competing compact status source.
- Merge compact state into the primary `skill-statusline-renderer` output path.
- Preserve the primary renderer's read-only, side-effect-free contract.
- Keep auto-compact execution and lifecycle writes in the auto-compact orchestration layer.
- Retain compatibility with current pending/history artifacts for an explicit migration window if downstream installations can contain them.
- Do not change auto-compact policy, thresholds, deferral rules, or user-interaction rules.

## 9. Error handling

- Missing compact lifecycle data: show the normal skill statusline.
- Malformed lifecycle data: show an attention diagnostic; do not silently render idle.
- Interrupted active stage: show a stalled/interrupted diagnostic with the last stage.
- Missing post-ratio: omit it rather than guessing.
- Failed compact: retain failure visibility until superseded by a defined state transition.
- Unsupported ANSI: render no-color Unicode or ASCII according to detected/selected capability.

## 10. Verification

### Unit coverage

- Every primary skill state: active, idle, attention gate, stale, invalid.
- Every compact lifecycle stage and its exact stage fill.
- Compact status precedence over normal skill status.
- Completion expiry back to active skill status.
- Persistent failure behavior.
- Stalled lifecycle detection.
- Real post-ratio, missing post-ratio, and red-line rendering.
- ANSI, no-color Unicode, and full ASCII mappings.
- No temporary mountain/logo glyph in any output.
- No guessed `?` ratio values.

### Integration coverage

- The auto-compact orchestrator produces transitions in valid order.
- The primary statusline reads those transitions without writes or execution side effects.
- Atomic state writes survive partial/interrupted attempts without malformed visible output.
- Existing pending/history artifacts migrate or degrade according to the chosen compatibility contract.

### Real-runtime checks

Verify actual rendering in at least:

- Windows Terminal with color and Unicode;
- Claude Code's active statusline integration;
- a `NO_COLOR` run;
- a forced ASCII run;
- an auto-compact dry-run or controlled fixture that visibly traverses all stages;
- a controlled failure that remains visible.

Screenshots or captured terminal output should demonstrate the color differences. A Markdown code block is not sufficient visual evidence.

## 11. Acceptance criteria

1. Normal active output contains no mountain or provisional logo and follows `Peaks ● <skill> › <project>`.
2. Normal mode and routine gate values are absent; an attention/blocking gate is visible and human-readable.
3. Unicode no-color and full ASCII outputs preserve all status meanings.
4. Auto-compact visibly traverses only stages that the orchestrator actually observes.
5. The progress bar uses fixed stage milestones and never claims continuous internal progress.
6. A measured post-compact ratio is shown; an unavailable ratio is omitted without placeholders.
7. Success is transient; failure and interrupted execution remain actionable.
8. Compact rendering is integrated into the primary statusline and does not create a competing status surface.
9. The statusline reader remains read-only and auto-compact execution remains zero-intervention.
10. Unit, integration, and real-terminal evidence cover color, no-color, ASCII, completion, failure, and interruption behavior.
