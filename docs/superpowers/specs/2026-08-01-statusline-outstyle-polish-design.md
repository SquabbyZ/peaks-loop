# Peaks Statusline Outstyle Polish Design

**Date:** 2026-08-01
**Status:** Approved design; implementation not started
**Supersedes:** `2026-08-01-statusline-auto-compact-progress-design.md` for the visual layer only

## Goal

Polish the primary Claude Code statusline produced by `peaks sub-agent dispatch` so it reads as a deliberate, branded product surface without changing any of the truthful information it already exposes. The polish is purely visual: cyan accent expansion, mode display for any active skill, and a slow 2.4s breathing pulse that respects the harness's natural statusline refresh cadence.

## Visual design

### Color

Use a single cyan accent for the brand and active lifecycle.

- ANSI escape (where supported): `\x1b[36m` — cyan, foreground.
- Plain text (no-color or ASCII capability): keep the symbol and the order; do not synthesize color via pseudo-glyphs.
- Cyan applies to: `Peaks` brand text, the `●` activity dot, the compact progress bar filled cells. Attention-gate label and project suffix stay neutral; idle/compacting glyphs use the same cyan accent as activity so the brand reads as one continuous accent.

### Mode display for any active skill

- Active state: `Peaks ● <skill> [<mode>] › <project>`.
- Idle: `Peaks ○ idle › <project>` — no mode.
- Attention/blocked: gate label remains the override (gate wording still wins).
- Compact lifecycle: mode slot is replaced by the compact segment; compact stage verb and ratio stay primary.

The skill roles that surface mode: `peaks-code`, `peaks-rd`, `peaks-qa`, `peaks-ui`, `peaks-sc`, `peaks-txt`, `peaks-prd`, `peaks-content`, `peaks-doctor`, `peaks-audit`, `peaks-ide`, `peaks-final-review`, `peaks-ide-fix-orchestrator`, `peaks-issue-fix-orchestrator`, `peaks-perf-audit`, `peaks-reviewer`, `peaks-security-audit`, `peaks-slice-decompose`, `peaks-solo`, `peaks-sop`, `peaks-status`, `peaks-test`, `peaks-resume`. This is the set of skill names that share the `peaks-` prefix. Unknown skill names fall back to the same rule: if the active presence carries a non-empty `mode`, it is shown.

### Breathing pulse

- A 2.4s sinusoidal pulse on the active dot's foreground intensity when the active skill is breathing.
- Pulse is symbolic on the IDE statusline: the renderer emits a numeric alpha that climbs 0.0 → 1.0 → 0.0 across each refresh, and the IDE (Claude Code) blends ANSI into the cell.
- For non-color and ASCII capabilities: the breathing falls back to a glyph rotation between `●`, `◐`, `◑`, `◒`, `◓`, `●` at each natural refresh. Rotation is keyed off wall-clock so the same effective animation appears in no-color and ASCII modes.
- Idle, attention, and compact states do **not** breathe. Only the active "running" state breathes.
- The breathing never modifies count of characters or terminator: total visible width stays constant so terminal layouts do not jitter.

## Behavior compatibility

- No new fields on `WorktreeAuthCheckInput` or any dispatch envelope.
- No policy or threshold change.
- Compact progress truthfulness contract (only observable stages) remains unchanged.
- Statusline remains read-only; no additional file IO.
- The renderer is pure: output is a deterministic function of (model, capability, wall-clock-derived alpha).

## Fallbacks

- ANSI: `\x1b[36m` + `\x1b[0m` reset.
- `NO_COLOR` / non-TTY: Unicode palette, no escape codes; the same breathing glyph rotation still appears.
- Forced ASCII (`PEAKS_STATUSLINE_ASCII=1`): glyph rotation only; cyan reduces to standard terminal foreground.
- Compact segment keeps its existing capabilities: queued/compacting/verifying/completed/failed/fresh-expiry/persistent-failed behavior is unchanged.

## Verification

- Unit tests:
  - Active render with mode in presence includes `mode` token exactly once.
  - Active render without mode omits the bracket slot entirely.
  - Cyan escape applied to `Peaks`, `●`, and compact bar fill; not applied to gate or project suffix.
  - Breathing output for ANSI vs no-color vs ASCII matches the glyph rotation table.
  - Breathing output length is constant across N consecutive samples at the same capability.
- Integration tests:
  - Real subprocess against built `peaks statusline` with canonical session + active presence including `mode: 'full-auto'` renders `Peaks ● peaks-code [full-auto] › peaks-loop`.
  - The same with `mode: undefined` renders without brackets.
  - The same with `NO_COLOR=1` removes ANSI escape codes but keeps the breathing glyph rotation.
- Live runtime check:
  - User observes the IDE statusline reflects cyan, mode, and breathing on a fresh dispatch and confirms before any further polish.

## Acceptance

- A1 The primary statusline reads as `Peaks ● peaks-code [full-auto] › peaks-loop` for an active dispatch.
- A2 Idle, attention, and compact states never show `[]` or a stale mode.
- A3 No-color and ASCII variants preserve meaning and breathing animation; ANSI variants carry cyan on the three accent surfaces.
- A4 Existing C1 hierarchy, attention-gate precedence, and compact progress contracts remain intact.
- A5 Total visible width of the breathing variants is byte-identical across samples so the terminal does not jitter.
