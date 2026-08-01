import { basename } from 'node:path';
import type {
  StatusLineModel,
  StatusLinePresence,
} from './skill-statusline-service.js';
import type {
  CompactStatuslineState,
} from '../compact-statusline/compact-statusline-service.js';

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
 *
 * Compact glyphs are the unicode quadrant marks ◐◑◒◓, the check ✓, and the
 * ballot ✕. ASCII uses bracket/plus/star/x. Bar characters are █/░ in
 * unicode and #/- in ASCII. Ratios are joined with `·` (` . ` for ASCII)
 * and the before→after arrow is `→` (-> for ASCII).
 */
interface StatusPalette {
  readonly active: string;
  readonly idle: string;
  readonly warning: string;
  readonly inlineSeparator: string; // between skill + gate
  readonly trailSeparator: string;  // before project label
  readonly idleLabel: string;       // token rendered when no presence
  readonly invalidMessage: string;  // text after the warning glyph for invalid-presence
  readonly compact: CompactPalette;
  readonly barFilled: string;
  readonly barEmpty: string;
  readonly ratioArrow: string;
}

interface CompactPalette {
  readonly queued: string;
  readonly preparing: string;
  readonly compacting: string;
  readonly verifying: string;
  readonly completed: string;
  readonly failed: string;
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
    compact: {
      queued: '\x1b[90m◐\x1b[0m',
      preparing: '\x1b[33m◑\x1b[0m',
      compacting: '\x1b[33m◒\x1b[0m',
      verifying: '\x1b[33m◓\x1b[0m',
      completed: '\x1b[32m✓\x1b[0m',
      failed: '\x1b[31m✕\x1b[0m',
    },
    barFilled: '█',
    barEmpty: '░',
    ratioArrow: '→',
  },
  unicode: {
    active: '●',
    idle: '○',
    warning: '!',
    inlineSeparator: ' · ',
    trailSeparator: ' › ',
    idleLabel: 'idle',
    invalidMessage: 'presence unreadable',
    compact: {
      queued: '◐',
      preparing: '◑',
      compacting: '◒',
      verifying: '◓',
      completed: '✓',
      failed: '✕',
    },
    barFilled: '█',
    barEmpty: '░',
    ratioArrow: '→',
  },
  ascii: {
    active: '*',
    idle: 'o',
    warning: '!',
    inlineSeparator: ' . ',
    trailSeparator: ' > ',
    idleLabel: 'idle',
    invalidMessage: 'presence unreadable',
    compact: {
      queued: '[',
      preparing: '+',
      compacting: '+',
      verifying: '+',
      completed: '*',
      failed: 'x',
    },
    barFilled: '#',
    barEmpty: '-',
    ratioArrow: '->',
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

const COMPACT_BAR_WIDTH = 8;

function renderCompactBar(
  filledCells: 0 | 2 | 4 | 6 | 8,
  palette: StatusPalette,
): string {
  const filled = palette.barFilled.repeat(filledCells);
  const empty = palette.barEmpty.repeat(COMPACT_BAR_WIDTH - filledCells);
  return `[${filled}${empty}]`;
}

function formatRatio(value: number): string {
  // Brief ratio labels use 2-decimal precision: 0.87 → "87%".
  return `${Math.round(value * 100)}%`;
}

/**
 * Render the compact-progress segment. Compact state REPLACES the skill
 * content while active (`kind !== 'none'`). The renderer always lays out
 *
 *   <stage-glyph> <bar> <label>[ · <before>%][ → <after>%]
 *
 * Failed states additionally suffix the stage at which the compact failed.
 * Stalled states keep the active-stage cell count and render a plain
 * "stalled" label. Invalid states surface the read-reason verbatim as a
 * single-line diagnostic so the user can see why the bar is empty.
 */
function renderCompact(
  state: CompactStatuslineState,
  palette: StatusPalette,
): string {
  switch (state.kind) {
    case 'none':
      return '';
    case 'queued':
      return `${palette.compact.queued} ${renderCompactBar(0, palette)} queued${
        typeof state.triggerRatio === 'number'
          ? `${palette.inlineSeparator}${formatRatio(state.triggerRatio)}`
          : ''
      }`;
    case 'preparing':
      return `${palette.compact.preparing} ${renderCompactBar(2, palette)} preparing${
        typeof state.triggerRatio === 'number'
          ? `${palette.inlineSeparator}${formatRatio(state.triggerRatio)}`
          : ''
      }`;
    case 'compacting':
      return `${palette.compact.compacting} ${renderCompactBar(4, palette)} compacting${
        typeof state.triggerRatio === 'number'
          ? `${palette.inlineSeparator}${formatRatio(state.triggerRatio)}`
          : ''
      }`;
    case 'verifying':
      return `${palette.compact.verifying} ${renderCompactBar(6, palette)} verifying`;
    case 'completed':
      return `${palette.compact.completed} ${renderCompactBar(8, palette)} compacted${
        typeof state.triggerRatio === 'number'
          ? `${palette.inlineSeparator}${formatRatio(state.triggerRatio)}${
              typeof state.afterRatio === 'number'
                ? ` ${palette.ratioArrow} ${formatRatio(state.afterRatio)}`
                : ''
            }`
          : typeof state.afterRatio === 'number'
            ? `${palette.inlineSeparator}${formatRatio(state.afterRatio)}`
            : ''
      }`;
    case 'failed': {
      const failedAt = state.failedAt ?? 'compacting';
      const filledAt = failedAt === 'queued'
        ? 0
        : failedAt === 'preparing'
          ? 2
          : failedAt === 'compacting'
            ? 4
            : 6;
      return `${palette.compact.failed} ${renderCompactBar(filledAt, palette)} compact failed${palette.inlineSeparator}${failedAt}`;
    }
    case 'stalled':
      return `${palette.compact.compacting} ${renderCompactBar(state.filledCells, palette)} stalled`;
    case 'invalid': {
      const detail = state.detail ?? 'lifecycle record malformed';
      return `${palette.warning} ${detail}`;
    }
  }
}

/**
 * Resolve the capability tier from explicit overrides and environment. Pure
 * and deterministic — no I/O beyond reading `process.env` and the `isTTY`
 * flag passed by the caller. The CLI delegates to this so the read-only
 * status line does not need to know about ANSI/NO_COLOR semantics.
 *
 * Order of resolution (highest priority first):
 *
 *   1. `forced` argument — caller-supplied override (`--plain-ascii` style)
 *   2. `NO_COLOR` set → `unicode` (no ANSI, no Unicode-extra glyphs)
 *   3. `isTTY === true` → `ansi-unicode`
 *   4. otherwise → `unicode` (default; byte-identical to C1 baseline)
 *
 * The deliberate ordering keeps the rendered text ANSI-free when the consumer
 * is a logger, a file, or any non-interactive sink, and only enables ANSI
 * under an explicit supported condition (TTY + no env veto).
 */
export function resolveStatusLineCapability(input: {
  readonly env: NodeJS.ProcessEnv;
  readonly isTTY: boolean;
  readonly forced?: StatusLineCapability;
}): StatusLineCapability {
  if (input.forced !== undefined) {
    return input.forced;
  }
  const envNoColor = input.env.NO_COLOR;
  if (typeof envNoColor === 'string' && envNoColor.length > 0 && envNoColor !== '0') {
    return 'unicode';
  }
  return input.isTTY ? 'ansi-unicode' : 'unicode';
}

/**
 * Render the status line. Pure — no I/O, no side effects. The output is
 * a single short line suitable for the bottom-of-terminal status bar.
 *
 * The `options.capability` field selects the glyph palette. When omitted,
 * the function falls back to `unicode` (no ANSI escape codes), preserving
 * the legacy behaviour for the CLI's `peaks statusline` invocation.
 *
 * Compact-state precedence: when `model.compact.kind !== 'none'` the
 * compact bar replaces the active/idle/stale content. The C1 baseline
 * line is preserved when the compact state is `none`.
 */
export function renderStatusLine(
  model: StatusLineModel,
  options?: StatusLineRenderOptions,
): string {
  const palette = paletteFor(options?.capability);
  const root = rootLabel(model.projectRoot);
  const rootSuffix = root ? `${palette.trailSeparator}${root}` : '';

  const compactSegment = renderCompact(model.compact, palette);

  if (compactSegment.length > 0) {
    // Compact state replaces the active / stale / idle skill content.
    // `invalid-presence` still surfaces its own diagnostic when compact
    // is also `invalid` (the compact diagnostic wins, since it's the
    // more recent failure mode).
    return `${BRAND} ${compactSegment}${rootSuffix}`;
  }

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