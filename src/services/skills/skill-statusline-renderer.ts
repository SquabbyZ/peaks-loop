import { basename } from 'node:path';
import type {
  StatusLineModel,
  StatusLinePresence,
} from './skill-statusline-service.js';

/**
 * Pure formatting layer for the Peaks statusLine. Takes the read-only status
 * model and produces the single line Claude Code paints at the bottom of the
 * terminal. Kept separate from the reader so formatting can be tested without
 * touching the filesystem.
 *
 * Capability-aware rendering: three glyph palettes are kept side by side in
 * {@link PALETTES} so the switch from "active" / "idle" / "warning" to a
 * concrete string happens in one place. Adding a fourth capability (e.g. for
 * a future IDE) is a one-table change.
 */

export type StatusLineCapability = 'ansi-unicode' | 'unicode' | 'ascii';

export interface StatusLineRenderOptions {
  readonly capability: StatusLineCapability;
}

/**
 * Internal: the brand prefix is plain ASCII so a tiny terminal without
 * monospaced UTF-8 still sees a recognizable string. The mountain glyphs
 * (`⛰` / `🏔`) used in earlier 1.x renders were the loudest a11y regression
 * in the 2026-07-22 ice-cola surface check and are deliberately removed.
 */
const BRAND = 'Peaks';

/**
 * Attention-gate allowlist. The brief requires conservative classification:
 * only gate names that encode a blocking condition surface as a warning
 * glyph. Routine progress gates (`startup`, `swarm-fan-out`,
 * `swarm-converged`, `repair-cycle-N`, etc.) stay hidden. The map is
 * explicit — there is no "non-empty gate means alert" inference.
 */
const ATTENTION_GATE_LABELS: ReadonlyMap<string, string> = new Map([
  ['qa-validation', 'QA'],
  ['verdict-issued', 'Verdict'],
  ['blocked', 'Blocked'],
]);

function isAttentionGate(gate: string | undefined): string | null {
  if (!gate) return null;
  return ATTENTION_GATE_LABELS.get(gate) ?? null;
}

/**
 * Glyph palette per capability. Status glyphs (active / idle / warning),
 * separators (· / › / ▸ / ASCII variants), and the diagnostic marker
 * (`presence unreadable`). Unicode glyphs use widely-supported characters;
 * ASCII keeps byte-identical shape across encodings.
 */
interface StatusPalette {
  readonly active: string;
  readonly idle: string;
  readonly warning: string;
  readonly inlineSeparator: string; // between skill + gate
  readonly trailSeparator: string;  // before project label
  readonly idleLabel: string;       // token rendered when no presence
  readonly invalidMessage: string;  // text after the warning glyph for invalid-presence
}

const PALETTES: Readonly<Record<StatusLineCapability, StatusPalette>> = {
  'ansi-unicode': {
    active: '\x1b[32m●\x1b[0m',      // green active
    idle: '\x1b[90m○\x1b[0m',         // dim idle
    warning: '\x1b[33m!\x1b[0m',      // amber warning
    inlineSeparator: ' · ',
    trailSeparator: ' › ',
    idleLabel: 'idle',
    invalidMessage: 'presence unreadable',
  },
  unicode: {
    active: '●',
    idle: '○',
    warning: '!',
    inlineSeparator: ' · ',
    trailSeparator: ' › ',
    idleLabel: 'idle',
    invalidMessage: 'presence unreadable',
  },
  ascii: {
    active: '*',
    idle: 'o',
    warning: '!',
    inlineSeparator: ' . ',
    trailSeparator: ' > ',
    idleLabel: 'idle',
    invalidMessage: 'presence unreadable',
  },
};

/**
 * Default capability when none is supplied. Per the brief: "if backward
 * compatibility requires a renderer default, use unicode, never
 * unconditional ANSI." The CLI's `peaks statusline` invocation currently
 * passes no options; preserving the legacy no-ANSI behaviour means the
 * default is the unicode palette (no escape codes).
 */
const DEFAULT_CAPABILITY: StatusLineCapability = 'unicode';

function paletteFor(capability: StatusLineCapability | undefined): StatusPalette {
  return PALETTES[capability ?? DEFAULT_CAPABILITY];
}

function formatAge(ageMs: number | null): string {
  if (ageMs === null) return '';
  const hours = Math.round(ageMs / (60 * 60 * 1000));
  if (hours >= 1) return `stale ${hours}h`;
  const minutes = Math.max(1, Math.round(ageMs / (60 * 1000)));
  return `stale ${minutes}m`;
}

function rootLabel(projectRoot: string | null): string {
  if (!projectRoot) return '';
  return basename(projectRoot);
}

/**
 * Build the "middle" of the status line — everything between the brand
 * prefix and the project root label. Kept separate so the token layout
 * is obvious at the call site and so each state has a single
 * responsibility.
 */
function renderActive(
  presence: StatusLinePresence | null,
  palette: StatusPalette,
): string {
  if (!presence) {
    return `${palette.idle} ${palette.idleLabel}`;
  }
  const attentionLabel = isAttentionGate(presence.gate);
  if (attentionLabel !== null) {
    // Attention gate — surface the warning glyph + human-readable label.
    return `${palette.warning} ${presence.skill}${palette.inlineSeparator}${attentionLabel}`;
  }
  // Routine active state — active glyph + skill only. Mode is not part of
  // the primary hierarchy (it changes every few turns and would crowd the
  // bar); the gate is hidden when not in the allowlist.
  return `${palette.active} ${presence.skill}`;
}

function renderStale(
  presence: StatusLinePresence | null,
  ageMs: number | null,
  palette: StatusPalette,
): string {
  const skill = presence?.skill ?? 'unknown';
  const age = formatAge(ageMs);
  const ageSuffix = age ? `${palette.inlineSeparator}${age}` : '';
  return `${palette.warning} ${skill}${ageSuffix}`;
}

function renderInvalid(palette: StatusPalette): string {
  return `${palette.warning} ${palette.invalidMessage}`;
}

function renderIdle(palette: StatusPalette): string {
  return `${palette.idle} ${palette.idleLabel}`;
}

/**
 * Render the status line. Pure — no I/O, no side effects. The output is
 * a single short line suitable for the bottom-of-terminal status bar.
 *
 * The `options.capability` field selects the glyph palette. When omitted,
 * the function falls back to `unicode` (no ANSI escape codes), preserving
 * the legacy behaviour for the CLI's `peaks statusline` invocation.
 */
export function renderStatusLine(
  model: StatusLineModel,
  options?: StatusLineRenderOptions,
): string {
  const palette = paletteFor(options?.capability);
  const root = rootLabel(model.projectRoot);
  const rootSuffix = root ? `${palette.trailSeparator}${root}` : '';

  switch (model.state) {
    case 'active':
      return `${BRAND} ${renderActive(model.presence, palette)}${rootSuffix}`;
    case 'stale':
      return `${BRAND} ${renderStale(model.presence, model.ageMs, palette)}${rootSuffix}`;
    case 'invalid-presence':
      return `${BRAND} ${renderInvalid(palette)}${rootSuffix}`;
    case 'idle':
    default:
      return `${BRAND} ${renderIdle(palette)}${rootSuffix}`;
  }
}