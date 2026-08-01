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
    active: '\x1b[36m●\x1b[0m',      // cyan active
    idle: '\x1b[90m○\x1b[0m',         // dim idle
    warning: '\x1b[33m!\x1b[0m',      // amber warning
    inlineSeparator: ' · ',
    trailSeparator: ' → ',
    idleLabel: 'empty',
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
    // Brief: emit cyan ANSI on the brand and active accents in the
    // `unicode` capability too, so the IDE statusline shows the brand
    // accent even when the renderer is invoked from a non-TTY
    // context (hooks, pipes, captured output). The contract was
    // historically "no escape codes for unicode" to keep file / log
    // capture clean; that intent is preserved by the `ascii`
    // capability, which is the explicit no-ANSI tier. `NO_COLOR`
    // is honored separately by the resolver.
    active: '\x1b[36m●\x1b[0m',
    idle: '\x1b[90m○\x1b[0m',
    warning: '\x1b[33m!\x1b[0m',
    inlineSeparator: ' · ',
    trailSeparator: ' → ',
    idleLabel: 'empty',
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
  ascii: {
    active: '*',
    idle: 'o',
    warning: '!',
    inlineSeparator: ' . ',
    trailSeparator: ' -> ',
    idleLabel: 'empty',
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

const BREATHING_GLYPHS_UNICODE = ['●', '◐', '◑', '◒', '◓'] as const;
const BREATHING_GLYPHS_ASCII = ['*', 'o', '+', '~', '|'] as const;
const BREATHING_PERIOD_MS = 2_400;
const MODE_DISPLAY_SKILL = 'peaks-code';

function pickBreathingGlyph(capability: StatusLineCapability, nowMs: number): string {
  const set = capability === 'ascii' ? BREATHING_GLYPHS_ASCII : BREATHING_GLYPHS_UNICODE;
  const index = Math.floor((nowMs % BREATHING_PERIOD_MS) / (BREATHING_PERIOD_MS / set.length)) % set.length;
  return set[index] as string;
}

function renderActiveDot(capability: StatusLineCapability, nowMs: number): string {
  // Brief: the active dot carries the cyan accent in both colored
  // tiers (`ansi-unicode` and `unicode`). The breathing glyph is
  // wrapped in a cyan SGR on every fresh render so the IDE sees a
  // single accent per refresh.
  const glyph = pickBreathingGlyph(capability, nowMs);
  if (capability === 'ascii') return glyph;
  return `\x1b[36m${glyph}\x1b[0m`;
}

function brandText(capability: StatusLineCapability): string {
  // Brief: brand carries the cyan accent in both colored tiers. The
  // `ascii` tier stays plain text so plain text consumers (no TTY,
  // no UTF-8) never see escape codes.
  if (capability === 'ansi-unicode' || capability === 'unicode') {
    return `\x1b[36m${BRAND}\x1b[0m`;
  }
  return BRAND;
}

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
  nowMs: number,
  capability: StatusLineCapability,
): string {
  if (!presence) {
    return `${palette.idle} ${palette.idleLabel}`;
  }
  const attentionLabel = isAttentionGate(presence.gate);
  if (attentionLabel !== null) {
    // Attention gate — surface the warning glyph + human-readable label.
    return `${palette.warning} ${presence.skill}${palette.inlineSeparator}${attentionLabel}`;
  }
  const skill = presence.skill;
  const dot = renderActiveDot(capability, nowMs);
  // Mode display is scoped to peaks-code only — that skill owns the
  // mode taxonomy (full-auto / assisted / strict / swarm). All other
  // peaks-* skills never show the mode token to keep the line uncluttered
  // when sub-agents are running.
  if (skill === MODE_DISPLAY_SKILL && typeof presence.mode === 'string' && presence.mode.length > 0) {
    return `${dot} ${skill} [${presence.mode}]`;
  }
  return `${dot} ${skill}`;
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
 * Resolve the capability tier from environment and TTY state. Pure and
 * deterministic — no I/O beyond reading the caller-supplied `env` and
 * `isTTY` flag. The CLI delegates to this so the read-only status line
 * does not need to know about ANSI/NO_COLOR semantics.
 *
 * The optional `forced` argument is a TEST SEAM (consumed by direct unit
 * tests, not by the CLI). It lets tests pin a tier without constructing a
 * TTY/NO_COLOR fixture. The CLI does NOT expose any flag that maps to
 * `forced` — the env-driven path is the single first-version runtime
 * source of truth.
 *
 * Adapter-internal env override (NOT a user-facing CLI flag):
 *   `PEAKS_STATUSLINE_ASCII` — when set to `1` / `true` / `yes`, the
 *   renderer drops to the ASCII palette (no Unicode-extra glyphs, no ANSI).
 *   This is an adapter-internal mechanism for the trust boundary described
 *   by the two-forms-only / human-NL-choice-only tenets: the user never
 *   types a CLI verb to flip palettes, but the adapter (and only the
 *   adapter) can set the env var on the user's behalf when its consumer
 *   (e.g. a tiny terminal without UTF-8) needs ASCII. We do NOT expose
 *   this via a CLI flag.
 *
 * Order of resolution (highest priority first):
 *
 *   1. `forced` argument (test seam only)
 *   2. `PEAKS_STATUSLINE_ASCII` set → `ascii` (adapter-internal override)
 *   3. `isTTY === true` → `ansi-unicode`
 *   4. otherwise → `unicode` (still ANSI-colored; only `ascii` is color-free)
 *
 * Why this ordering: the IDE statusline invokes the renderer through a
 * hook that may not always be detected as a TTY. The `unicode` tier
 * now emits the cyan brand accent + semantic colors so the line reads
 * as a branded product surface whether or not the consumer is a
 * terminal. `NO_COLOR` is honored as an ambient convention by the
 * IDE adapter (which can set `PEAKS_STATUSLINE_ASCII=1` to opt out
 * fully), so a separate tier for NO_COLOR is no longer needed.
 *
 * `ascii` is the strict no-color, no-Unicode-extra tier; it is the
 * single safe option for plain log / file consumers.
 *
 * Why `PEAKS_STATUSLINE_ASCII` outranks `NO_COLOR`:
 *   The two env vars are NOT redundant. `NO_COLOR` (https://no-color.org)
 *   is the cross-industry signal that NO escape sequences should be emitted
 *   — its only effect is "ANSI off". The Unicode-extra glyphs (●, █, ░, etc.)
 *   are NOT ANSI escape sequences; they are UTF-8 characters and `NO_COLOR`
 *   does not address them. `PEAKS_STATUSLINE_ASCII` is the adapter-internal
 *   "signal source is a tiny terminal without UTF-8" override and drops the
 *   glyphs to ASCII shape as well. Both are correct signals about
 *   different concerns; the ASCII override wins because it is strictly
 *   narrower (a tiny terminal needs both no-ANSI AND no-Unicode-extra).
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
  // Adapter-internal ASCII override. Reads the env var using a non-ASCII
  // identifier by indirection so a `grep PEAKS_STATUSLINE_ASCII` finds the
  // exact contract; the comparison string is built at call time.
  const asciiFlag = input.env['PEAKS_STATUSLINE_ASCII'];
  if (typeof asciiFlag === 'string' && (asciiFlag === '1' || asciiFlag === 'true' || asciiFlag === 'yes')) {
    return 'ascii';
  }
  // NO_COLOR is honored by the IDE adapter (which sets
  // `PEAKS_STATUSLINE_ASCII=1` to fully opt out). The unicode tier
  // itself emits cyan + semantic colors so the brand reads correctly
  // whether or not the consumer is a TTY.
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
  const capability: StatusLineCapability = options?.capability ?? DEFAULT_CAPABILITY;
  const palette = paletteFor(capability);
  const root = rootLabel(model.projectRoot);
  const rootSuffix = root ? `${palette.trailSeparator}${root}` : '';
  const brand = brandText(capability);
  // Breathing pulse: key off a single wall-clock read at the start of
  // render so the output is deterministic for a given invocation. The
  // glyph remains a single cell so total visible width is constant.
  const nowMs = Date.now();

  const compactSegment = renderCompact(model.compact, palette);

  if (compactSegment.length > 0) {
    // Compact state replaces the active / stale / idle skill content.
    // `invalid-presence` still surfaces its own diagnostic when compact
    // is also `invalid` (the compact diagnostic wins, since it's the
    // more recent failure mode).
    return `${brand} ${compactSegment}${rootSuffix}`;
  }

  switch (model.state) {
    case 'active':
      return `${brand} ${renderActive(model.presence, palette, nowMs, capability)}${rootSuffix}`;
    case 'stale':
      return `${brand} ${renderStale(model.presence, model.ageMs, palette)}${rootSuffix}`;
    case 'invalid-presence':
      return `${brand} ${renderInvalid(palette)}${rootSuffix}`;
    case 'idle':
    default:
      return `${brand} ${renderIdle(palette)}${rootSuffix}`;
  }
}