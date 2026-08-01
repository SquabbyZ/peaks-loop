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

### Mode display scoped to `peaks-code` only

- Active `peaks-code`: `Peaks ● peaks-code [<mode>] › <project>`.
- Active other peaks-* skills: `Peaks ● <skill> › <project>` — no mode token.
- Idle: `Peaks ○ idle › <project>` — no mode.
- Attention/blocked: gate label remains the override (gate wording still wins).
- Compact lifecycle: mode slot is replaced by the compact segment; compact stage verb and ratio stay primary.

The mode token is only emitted when the active presence's `skill === 'peaks-code'` and `mode` is a non-empty string. All other active skills — including known peaks-* skills and any future skill names — never show the mode token. This keeps the statusline uncluttered when sub-agents are running and reserves the mode display for the orchestrator skill that actually defines the mode taxonomy.

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
  - Active `peaks-code` with `mode: 'full-auto'` renders `Peaks ● peaks-code [full-auto] › peaks-loop`.
  - Active `peaks-code` with `mode: undefined` renders without brackets.
  - Active `peaks-rd`, `peaks-qa`, `peaks-content`, `peaks-doctor` (with any mode) never render brackets.
  - Cyan escape applied to `Peaks`, `●`, and compact bar fill; not applied to gate or project suffix.
  - Breathing output for ANSI vs no-color vs ASCII matches the glyph rotation table.
  - Breathing output length is constant across N consecutive samples at the same capability.
- Integration tests:
  - Real subprocess against built `peaks statusline` with canonical session + active presence including `mode: 'full-auto'` renders `Peaks ● peaks-code [full-auto] › peaks-loop`.
  - The same with `mode: undefined` renders without brackets.
  - The same with `peaks-rd` (sub-agent role) renders `Peaks ● peaks-rd › peaks-loop` (no brackets).
  - The same with `NO_COLOR=1` removes ANSI escape codes but keeps the breathing glyph rotation.
- Live runtime check:
  - User observes the IDE statusline reflects cyan, mode, and breathing on a fresh dispatch and confirms before any further polish.

## Acceptance

- A1 The primary statusline reads as `Peaks ● peaks-code [full-auto] › peaks-loop` for an active peaks-code dispatch.
- A2 Active sub-agent skills (peaks-rd, peaks-qa, etc.) never show a mode token.
- A3 Idle, attention, and compact states never show `[]` or a stale mode.
- A4 No-color and ASCII variants preserve meaning and breathing animation; ANSI variants carry cyan on the three accent surfaces.
- A5 Existing C1 hierarchy, attention-gate precedence, and compact progress contracts remain intact.
- A6 Total visible width of the breathing variants is byte-identical across samples so the terminal does not jitter.
