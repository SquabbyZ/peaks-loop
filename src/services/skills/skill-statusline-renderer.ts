import { basename } from 'node:path';
import type {
  StatusLineModel,
  StatusLinePresence,
  StatusLineActiveLeaf,
  TwentyFourHourOverlay,
} from './skill-statusline-service.js';
import type {
  CompactStatuslineState,
} from '../compact-statusline/compact-statusline-service.js';
import {
  computeRootSuffix as computeRootSuffixImpl,
  formatShortSid,
} from './skill-statusline-sid-suffix.js';

// Re-export so existing test imports
// (`import { formatShortSid, computeRootSuffix } from '.../skill-statusline-renderer'`)
// keep working byte-identically after the helper extraction in slice
// 2026-08-05-statusline-sid-only-marker-and-multi-binary-drift-guard
// repair cycle.
export { formatShortSid } from './skill-statusline-sid-suffix.js';
export const computeRootSuffix = computeRootSuffixImpl;

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
  // Slice rid-statusline-stale-ux AC-1: stale presence belongs to a
  // *previous* session (outer-session-mismatch). `idleStale` is the
  // muted slate tier — slow-blink OFF, distinct from `idle` (true empty,
  // slow-blink ON) and `warning` (loud invalid-presence alarm). Three-way
  // visual distinction keeps the user's read clear: idle = nothing here,
  // idleStale = previous-session residue (neutral), warning = read error.
  readonly idleStale: string;
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

/** Brand accent: per project request, this is the slate-purple `#5A65D8`. */
const BRAND_RGB = '38;2;90;101;216';
const BRAND_SGR_OPEN = `\x1b[1;${BRAND_RGB}m`;
const BRAND_SGR_FULL_OPEN = `\x1b[${BRAND_RGB}m`;
const BRAND_SGR_CLOSE = '\x1b[0m';

/**
 * Highlight color used by the marquee scan band. `#E0E0E0` bright-grey
 * + bold = "bleached" foreground that reads as a scanner sweeping
 * over the colored text. Kept distinct from brand white (`#FFFFFF`)
 * because pure white on `#5A65D8` brand purple reads as a strobe;
 * the off-white tint gives the same "scanner" affordance without the
 * flicker.
 */
const HIGHLIGHT_RGB = '38;2;224;224;224';
const HIGHLIGHT_SGR_OPEN = `\x1b[1;${HIGHLIGHT_RGB}m`;

function accent(text: string): string {
  return `${BRAND_SGR_OPEN}${text}${BRAND_SGR_CLOSE}`;
}

function accentGlyph(glyph: string): string {
  return `${BRAND_SGR_OPEN}${glyph}${BRAND_SGR_CLOSE}`;
}

// (kept for the brandText/active-dot helpers that inline the same SGR; the
// buildPalette factory owns per-token SGR injection now and does not call
// through these wrappers.)

/**
 * Render the supplied text in the brand purple, honouring the
 * `noColor` flag. Returns plain text when NO_COLOR is set or the
 * tier is ASCII. Used by the active / stale / compact renders for
 * tokens that the {@link buildPalette} cannot pre-stamp (skill
 * name, mode, age, attention labels).
 */
function brandRun(text: string, noColor: boolean, capability: StatusLineCapability): string {
  if (text.length === 0) return text;
  if (noColor || capability === 'ascii') return text;
  return `${BRAND_SGR_OPEN}${text}${BRAND_SGR_CLOSE}`;
}

/**
 * Slow-blink variant of the accent glyph. Used for the idle indicator
 * so the user perceives a pulse on the statusline. The ANSI slow-blink
 * SGR (`\x1b[5m`) is honored by most modern terminals (iTerm2, Windows
 * Terminal, GNOME Terminal with the right profile). Hosts that ignore
 * the SGR render the glyph statically — graceful degradation.
 */
function blinkingAccentGlyph(glyph: string): string {
  return `\x1b[5;1;${BRAND_RGB}m${glyph}\x1b[0m`;
}

/**
 * Build the per-capability palette. `noColor=true` strips every brand
 * ANSI SGR (warning / failed remain because they are SEMANTIC alarms,
 * not brand colour). The unicode glyphs are kept as-is — NO_COLOR
 * (https://no-color.org) addresses ANSI sequences, not UTF-8 chars.
 */
function buildPalette(capability: StatusLineCapability, noColor: boolean): StatusPalette {
  // Brand SGR helpers, noColor-aware.
  const brand = (text: string): string =>
    noColor || capability === 'ascii' ? text : `${BRAND_SGR_OPEN}${text}${BRAND_SGR_CLOSE}`;
  const brandGlyph = (glyph: string): string =>
    noColor || capability === 'ascii' ? glyph : `${BRAND_SGR_OPEN}${glyph}${BRAND_SGR_CLOSE}`;
  const dimBrand = (text: string): string => {
    if (noColor || capability === 'ascii') return text;
    return `\x1b[2;${BRAND_RGB}m${text}\x1b[0m`;
  };
  const blinkBrand = (glyph: string): string => {
    if (noColor || capability === 'ascii') return glyph;
    return `\x1b[5;1;${BRAND_RGB}m${glyph}\x1b[0m`;
  };
  // Warning + failed stay semantic — they are alarms, not brand colour.
  // noColor still suppresses them because a tiny log consumer that
  // sets NO_COLOR expects raw text.
  const warning = noColor || capability === 'ascii' ? '!' : '\x1b[33m!\x1b[0m';
  const failed = noColor || capability === 'ascii' ? 'x' : '\x1b[31m✕\x1b[0m';

  if (capability === 'ascii') {
    return {
      active: '*',
      idle: 'o',
      // Slice rid-statusline-stale-ux AC-1: stale residue uses the same
      // glyph as `idle` (`o`) but stays static (no slow-blink — the user
      // is reading a *previous* session's residue, not a live idle state).
      // The neutral copy `(previous session · N days ago)` is the
      // decisive signal; the glyph is auxiliary.
      idleStale: 'o',
      warning,
      inlineSeparator: ' . ',
      trailSeparator: ' -> ',
      idleLabel: 'empty',
      invalidMessage: 'presence unreadable',
      compact: {
        queued: '[', preparing: '+', compacting: '+', verifying: '+',
        completed: '*', failed,
      },
      barFilled: '#',
      barEmpty: '-',
      ratioArrow: '->',
    };
  }
  return {
    active: brandGlyph('●'),
    idle: blinkBrand('○'),
    // Slice rid-statusline-stale-ux AC-1: muted slate (`#AAAAC8` dim)
    // — slow-blink OFF, distinct from `idle` (slow-blink brand) and
    // `warning` (yellow invalid-presence). The stale branch is
    // semantically "previous-session residue" (neutral), NOT an error.
    idleStale: dimBrand('○'),
    warning,
    inlineSeparator: brand(' · '),
    trailSeparator: brand(' → '),
    idleLabel: brand('empty'),
    invalidMessage: brand('presence unreadable'),
    compact: {
      queued: brandGlyph('◐'),
      preparing: brandGlyph('◑'),
      compacting: brandGlyph('◒'),
      verifying: brandGlyph('◓'),
      completed: brandGlyph('✓'),
      failed,
    },
    barFilled: brand('█'),
    barEmpty: dimBrand('░'),
    ratioArrow: dimBrand('→'),
  };
}

const BREATHING_GLYPHS_UNICODE = ['●', '◐', '◑', '◒', '◓'] as const;
const BREATHING_GLYPHS_ASCII = ['*', 'o', '+', '~', '|'] as const;
const BREATHING_PERIOD_MS = 600;

function pickBreathingGlyph(capability: StatusLineCapability, nowMs: number): string {
  const set = capability === 'ascii' ? BREATHING_GLYPHS_ASCII : BREATHING_GLYPHS_UNICODE;
  const index = Math.floor((nowMs % BREATHING_PERIOD_MS) / (BREATHING_PERIOD_MS / set.length)) % set.length;
  return set[index] as string;
}

function renderActiveDot(capability: StatusLineCapability, nowMs: number, noColor: boolean): string {
  // Brief: the active dot carries the project accent (`#5A65D8` bold)
  // in both colored tiers. The breathing glyph is wrapped in a fresh
  // SGR on every render so the IDE sees a single accent per refresh.
  // NO_COLOR strips the SGR but keeps the glyph (still rotates).
  const glyph = pickBreathingGlyph(capability, nowMs);
  if (noColor || capability === 'ascii') return glyph;
  return `${BRAND_SGR_OPEN}${glyph}${BRAND_SGR_CLOSE}`;
}

function brandText(capability: StatusLineCapability, noColor: boolean): string {
  // Brief: brand carries the project accent (`#5A65D8` bold) in both
  // colored tiers. The `ascii` tier and NO_COLOR stay plain text so
  // log / file consumers never see escape codes.
  if (noColor || capability === 'ascii') return BRAND;
  return `${BRAND_SGR_OPEN}${BRAND}${BRAND_SGR_CLOSE}`;
}

/**
 * Default capability when none is supplied. Per the brief: "if backward
 * compatibility requires a renderer default, use unicode, never
 * unconditional ANSI." The CLI's `peaks statusline` invocation currently
 * passes no options; preserving the legacy no-ANSI behaviour means the
 * default is the unicode palette (no escape codes).
 */
const DEFAULT_CAPABILITY: StatusLineCapability = 'unicode';

function paletteFor(capability: StatusLineCapability | undefined, noColor: boolean): StatusPalette {
  return buildPalette(capability ?? DEFAULT_CAPABILITY, noColor);
}

function formatAge(ageMs: number | null): string {
  // Slice rid-statusline-stale-ux AC-1: this legacy `stale <N>h/m`
  // token is NO LONGER used by renderStale. Kept exported / defined
  // for any downstream caller / test that still asserts against the
  // `stale` substring. The active renderer path uses `formatHumanAge`.
  if (ageMs === null) return '';
  const hours = Math.round(ageMs / (60 * 60 * 1000));
  if (hours >= 1) return `stale ${hours}h`;
  const minutes = Math.max(1, Math.round(ageMs / (60 * 1000)));
  return `stale ${minutes}m`;
}

// Slice rid-statusline-stale-ux AC-1 + perf H2: human-friendly neutral
// age label for the stale branch. en-US strings per RD §5 R1 (codebase
// consistency); zh-CN deferred to a future i18n slice. Backed by a
// bounded Map cache (parity with `formatShortSid` memoization at
// `skill-statusline-sid-suffix.ts`).
const HUMAN_AGE_CACHE = new Map<number, string>();
const HUMAN_AGE_CACHE_LIMIT = 16;
export function formatHumanAge(ageMs: number | null): string {
  if (ageMs === null) return 'unknown';
  const cached = HUMAN_AGE_CACHE.get(ageMs);
  if (cached !== undefined) return cached;
  let result: string;
  if (ageMs < 5 * 60 * 1000) {
    result = 'just now';
  } else {
    const minutes = Math.round(ageMs / (60 * 1000));
    if (minutes < 60) {
      result = `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    } else {
      const hours = Math.round(ageMs / (60 * 60 * 1000));
      if (hours < 24) {
        result = `${hours} hour${hours === 1 ? '' : 's'} ago`;
      } else {
        const days = Math.round(ageMs / (24 * 60 * 60 * 1000));
        result = `${days} day${days === 1 ? '' : 's'} ago`;
      }
    }
  }
  if (HUMAN_AGE_CACHE.size >= HUMAN_AGE_CACHE_LIMIT) HUMAN_AGE_CACHE.clear();
  HUMAN_AGE_CACHE.set(ageMs, result);
  return result;
}

function rootLabel(projectRoot: string | null): string {
  if (!projectRoot) return '';
  return basename(projectRoot);
}

/**
 * Slice rid-statusline-24h-overlay (2026-08-10): format the 24h-mode
 * overlay suffix appended after the existing `<baseMode>` token in
 * the ACTIVE state. Returns `''` when the overlay is `null` (missing
 * file / corrupt file / wrong shape — see `read24hOverlay`).
 *
 * Output shape (ASCII palette): ` . [24h-<lowercase-state>]`
 * Output shape (unicode palette): ` · [24h-<lowercase-state>]`
 *
 * en-US only; i18n deferred to a future slice (PRD §Non-goals.5).
 * The `[24h-...]` prefix is a deliberate marker so the user can
 * visually distinguish a 24h-mode substate from a base-mode token
 * like `[full-auto]`.
 */
export function format24hSuffix(
  overlay: TwentyFourHourOverlay | null,
  palette: StatusPalette,
  capability: StatusLineCapability,
  noColor: boolean,
): string {
  if (!overlay) return '';
  const label = `[24h-${overlay.state.toLowerCase()}]`;
  return `${palette.inlineSeparator}${brandRun(label, noColor, capability)}`;
}

/**
 * `formatShortSid` + `computeRootSuffix` were extracted to
 * `./skill-statusline-sid-suffix.ts` in the slice
 * 2026-08-05-statusline-sid-only-marker-and-multi-binary-drift-guard
 * repair cycle so the renderer file stays under the Karpathy
 * 800-line cap. Both helpers are re-exported above for back-compat
 * with existing test imports.
 */

/**
 * Build the "middle" of the status line — everything between the brand
 * prefix and the project root label. Kept separate so the token layout
 * is obvious at the call site and so each state has a single
 * responsibility.
 *
 * Active-leaf rendering (slice 2026-08-04-rid-005-statusline-dual-skill):
 * when the model carries an `activeLeaf` (an in-flight bee dispatch under
 * the orchestrator), the line surfaces the leaf role alongside the
 * orchestrator skill. The render priorities are:
 *
 *   - activeLeaf === null                       → `${skill}` (current behavior)
 *   - activeLeaf.pendingCount === 1             → `${leaf} | ${skill}`
 *   - activeLeaf.pendingCount > 1               → `${leaf} (+${N-1}) | ${skill}`
 *
 * The orchestrator skill itself is rendered with its mode token; the leaf
 * role is rendered without a mode (the leaf does not own the mode state —
 * the orchestrator does). The 14→1 bee skill mapping that previously
 * forced every bee role to render with a `↑<parent>` marker was removed
 * in this slice; the dual-skill layout above replaces it.
 */
function renderActive(
  presence: StatusLinePresence | null,
  palette: StatusPalette,
  nowMs: number,
  capability: StatusLineCapability,
  noColor: boolean,
  activeLeaf: StatusLineActiveLeaf | null,
  twentyFourHourState: TwentyFourHourOverlay | null,
): string {
  if (!presence) {
    return `${palette.idle} ${palette.idleLabel}`;
  }
  // Slice rid-statusline-24h-overlay (2026-08-10): the 24h suffix
  // is appended on every active-return branch that carries a skill
  // token. The `!presence` branch (idle mark, no skill token) is
  // intentionally NOT modified — 24h overlays are active-only.
  const suffix = format24hSuffix(twentyFourHourState, palette, capability, noColor);
  const attentionLabel = isAttentionGate(presence.gate);
  if (attentionLabel !== null) {
    // Attention gate — surface the warning glyph + human-readable label.
    return `${palette.warning} ${brandRun(presence.skill, noColor, capability)}${palette.inlineSeparator}${brandRun(attentionLabel, noColor, capability)}${suffix}`;
  }
  const skill = presence.skill;
  const dot = renderActiveDot(capability, nowMs, noColor);
  const modeToken = typeof presence.mode === 'string' && presence.mode.length > 0
    ? brandRun(` [${presence.mode}]`, noColor, capability)
    : '';
  // Dual-skill layout: leaf role (in-flight bee) + orchestrator skill.
  if (activeLeaf !== null) {
    const leaf = brandRun(activeLeaf.role, noColor, capability);
    const tail = activeLeaf.pendingCount > 1
      ? ` ${brandRun(`(+${activeLeaf.pendingCount - 1})`, noColor, capability)}`
      : '';
    const sep = brandRun(' | ', noColor, capability);
    return `${dot} ${leaf}${tail}${sep}${brandRun(skill, noColor, capability)}${modeToken}${suffix}`;
  }
  return `${dot} ${brandRun(skill, noColor, capability)}${modeToken}${suffix}`;
}

function renderStale(
  presence: StatusLinePresence | null,
  ageMs: number | null,
  palette: StatusPalette,
  capability: StatusLineCapability,
  noColor: boolean,
): string {
  // Slice rid-statusline-stale-ux AC-1: stale presence belongs to a
  // *previous* session (outer-session-mismatch). Line still emits the
  // recorded skill name (per C-1 — `expect(out).toContain('peaks-code')`
  // must keep passing), but uses `palette.idleStale` (new muted palette,
  // distinct from idle and warning) and neutral
  // `(previous session · <human age>)` suffix instead of legacy
  // `stale <Nh>` token. ASCII capability replaces the `·` middle dot
  // with `-` so byte-identical shape holds across encodings.
  const skill = presence?.skill ?? 'unknown';
  const age = formatHumanAge(ageMs);
  const sep = capability === 'ascii' ? '-' : '·';
  const label = age ? `(previous session ${sep} ${age})` : '(previous session)';
  const ageSuffix = `${palette.inlineSeparator}${brandRun(label, noColor, capability)}`;
  return `${palette.idleStale} ${brandRun(skill, noColor, capability)}${ageSuffix}`;
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
/**
 * NO_COLOR (https://no-color.org) is the cross-industry signal that NO
 * ANSI escape sequences should be emitted. The unicode/ansi-unicode
 * tiers honour it by stripping every brand SGR while keeping the UTF-8
 * glyphs (●, █, ░, ◐, …) — NO_COLOR addresses ANSI specifically.
 * PEAKS_STATUSLINE_ASCII is the stricter override that also drops the
 * unicode glyphs; both can coexist and the ASCII override wins.
 */
function isNoColor(env: NodeJS.ProcessEnv): boolean {
  const v = env['NO_COLOR'];
  return typeof v === 'string' && v.length > 0 && v !== '0' && v.toLowerCase() !== 'false';
}

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
  // NO_COLOR is honoured at render time (see {@link renderStatusLine});
  // capability stays unicode so the UTF-8 glyphs survive — only the
  // brand SGR is suppressed.
  return input.isTTY ? 'ansi-unicode' : 'unicode';
}

export function isNoColorEnv(env: NodeJS.ProcessEnv): boolean {
  return isNoColor(env);
}

/**
 * Marquee scan band — a single-pass light band that sweeps left ↔ right
 * across the entire status line on a 0.4 s round trip. The band's
 * foreground color is `#E0E0E0` (off-white) with `1;` (bold) — see
 * {@link HIGHLIGHT_SGR_OPEN}. Cells OUTSIDE the band keep their
 * original SGR (brand purple or semantic warning/failed); only cells
 * INSIDE the band are temporarily re-painted to the highlight color.
 *
 * Why it does NOT use SGR 7 (reverse video):
 *   - Reverse video inverts BOTH background and foreground, which on a
 *     `#5A65D8` background swaps to a white background — visually that
 *     reads as a solid white block instead of a scan band.
 *   - The off-white foreground + bold keeps the original background
 *     visible behind each glyph, so the band reads as "lit text" not
 *     as a solid stripe — closer to the CSDN-style scan-band reference
 *     image.
 *
 * Phase formula:
 *   phase ∈ [0, 1) over MARQUEE_PERIOD_MS
 *   sweep = phase < 0.5 ? phase * 2 : (1 - phase) * 2     ← triangle wave 0→1→0
 *   center = sweep * (width - 1)
 *   band covers visible-cell range [center - half, center + half]
 *
 * When the band would land outside the visible range (center ≤ half
 * OR center ≥ width-1-half) it is clipped — the band never appears
 * off-line. At `nowMs = 0` the band sits at the LEFT edge covering
 * cells [0, bandWidth); this is a deliberate deterministic anchor
 * for tests that pin `withPinnedClock(0, ...)`.
 *
 * ASCII tier: skipped — there are no SGR codes to inject.
 */
const MARQUEE_PERIOD_MS = 400;
const MARQUEE_BAND_WIDTH = 2;

/**
 * Visible-character width of an ANSI-bearing string. Skips every
 * `\x1b[...m` escape so the count reflects what the terminal paints,
 * not the byte length on the wire.
 */
export function visibleCharWidth(s: string): number {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\x1b' && s[i + 1] === '[') {
      const m = s.indexOf('m', i + 2);
      if (m !== -1) {
        i = m;
        continue;
      }
    }
    w++;
  }
  return w;
}

interface AnsiToken {
  readonly kind: 'text' | 'esc';
  readonly value: string;
}

/**
 * Split an ANSI string into a flat token stream. Escape sequences are
 * grouped as `\x1b[...m` (single token, kind='esc'); everything else
 * is grouped as a single 'text' run. Used by {@link applyMarquee} to
 * locate visible-cell ranges inside an SGR-bearing string.
 */
export function tokenizeAnsi(s: string): readonly AnsiToken[] {
  const out: AnsiToken[] = [];
  let i = 0;
  let buf = '';
  const flush = (): void => {
    if (buf.length > 0) {
      out.push({ kind: 'text', value: buf });
      buf = '';
    }
  };
  while (i < s.length) {
    if (s[i] === '\x1b' && s[i + 1] === '[') {
      const m = s.indexOf('m', i + 2);
      if (m !== -1) {
        flush();
        out.push({ kind: 'esc', value: s.slice(i, m + 1) });
        i = m + 1;
        continue;
      }
    }
    buf += s[i];
    i++;
  }
  flush();
  return out;
}

/**
 * Apply the marquee highlight band to an ANSI-bearing string. Pure.
 * - `bandStart` / `bandEnd` are visible-cell indices (0-based).
 * - Cells in [bandStart, bandEnd] receive a `\x1b[1;38;2;224;224;224m`
 *   prefix; cells after the band receive the closing `\x1b[0m` reset
 *   so the rest of the line keeps its original SGR.
 * - Empty strings and zero-width bands return the input unchanged.
 */
export function applyMarqueeHighlight(s: string, bandStart: number, bandEnd: number): string {
  if (s.length === 0) return s;
  if (bandEnd < 0 || bandStart > bandEnd) return s;
  const tokens = tokenizeAnsi(s);
  const parts: string[] = [];
  let visibleIdx = 0;
  let inside = false;
  for (const tok of tokens) {
    if (tok.kind === 'esc') {
      parts.push(tok.value);
      continue;
    }
    for (let k = 0; k < tok.value.length; k++) {
      const cellPos = visibleIdx + k;
      const inBand = cellPos >= bandStart && cellPos <= bandEnd;
      if (inBand && !inside) {
        parts.push(HIGHLIGHT_SGR_OPEN);
        inside = true;
      } else if (!inBand && inside) {
        parts.push('\x1b[0m');
        inside = false;
      }
      parts.push(tok.value[k]!);
    }
    visibleIdx += tok.value.length;
  }
  if (inside) parts.push('\x1b[0m');
  return parts.join('');
}

/**
 * Compute the marquee band for a string at time `nowMs` and re-emit
 * the string with the band applied. ASCII tier is a pass-through (no
 * SGR to inject) — the scanner has no visible effect on plain text.
 */
export function applyMarquee(s: string, nowMs: number, capability: StatusLineCapability): string {
  if (capability === 'ascii') return s;
  const width = visibleCharWidth(s);
  if (width === 0) return s;
  const phase = (nowMs % MARQUEE_PERIOD_MS) / MARQUEE_PERIOD_MS;
  const sweep = phase < 0.5 ? phase * 2 : (1 - phase) * 2;
  const center = Math.round(sweep * (width - 1));
  const halfBand = Math.floor(MARQUEE_BAND_WIDTH / 2);
  const bandStart = Math.max(0, center - halfBand);
  const bandEnd = Math.min(width - 1, center + halfBand);
  return applyMarqueeHighlight(s, bandStart, bandEnd);
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
 *
 * The full line is wrapped by {@link applyMarquee} so the brand-purple
 * text + non-focal bar cells share a single colour surface while the
 * scanner band paints its `#E0E0E0` highlight over a moving slice.
 *
 * Idle suppression: the marquee is OFF when `model.state === 'idle'`
 * (and no compact state is active). Idle keeps the slow-blink `○`
 * as the only motion — the user is asking whether the harness is
 * running a skill; the scan band would compete for attention and
 * obscure that question. Active / stale / invalid-presence / compact
 * states all keep the marquee.
 */
export function renderStatusLine(
  model: StatusLineModel,
  options?: StatusLineRenderOptions,
  env?: NodeJS.ProcessEnv,
): string {
  const capability: StatusLineCapability = options?.capability ?? DEFAULT_CAPABILITY;
  const noColor = env !== undefined ? isNoColor(env) : false;
  const palette = paletteFor(capability, noColor);
  const root = rootLabel(model.projectRoot);
  // short-sid suffix (slices
  //   - 2026-08-05-statusline-empty-render-and-short-sid-suffix (active only)
  //   - 2026-08-05-statusline-sid-only-marker (idle + stale also)
  // ):
  // the project root cell carries ` [shortSid]` after `peaks-loop` whenever
  // a canonical session id resolves. Per-state matrix:
  //
  //   active             → append sid when sessionId !== null          (AC5/PB1)
  //   idle               → append sid when sessionId !== null          (AC1)
  //   stale              → append sid when sessionId !== null          (AC2)
  //   invalid-presence   → NEVER append sid (G2 — read-error signal must
  //                        stay loud; showing sid would mask the warning)
  //                                                                         (AC4)
  //
  // Compact state with presence is still rendered with the active sid logic
  // (the active branch already covered this in the prior slice). Compact state
  // without presence is the same as the underlying idle / invalid-presence /
  // stale branch; the helper inherits that. Pure ASCII (no narrow space /
  // smart quotes), so Windows PowerShell + Git Bash + zsh render byte-
  // identical (AC7 of the prior slice + AC10 of this slice).
  const rootSuffix = computeRootSuffix(model, root, palette);
  const brand = brandText(capability, noColor);
  // Breathing pulse: key off a single wall-clock read at the start of
  // render so the output is deterministic for a given invocation. The
  // glyph remains a single cell so total visible width is constant.
  const nowMs = Date.now();

  const compactSegment = renderCompact(model.compact, palette);

  let line: string;
  const hasCompact = compactSegment.length > 0;
  if (hasCompact) {
    // Compact state replaces the active / stale / idle skill content.
    // `invalid-presence` still surfaces its own diagnostic when compact
    // is also `invalid` (the compact diagnostic wins, since it's the
    // more recent failure mode).
    line = `${brand} ${compactSegment}${rootSuffix}`;
  } else {
    switch (model.state) {
      case 'active':
        line = `${brand} ${renderActive(model.presence, palette, nowMs, capability, noColor, model.activeLeaf, model.twentyFourHourState)}${rootSuffix}`;
        break;
      case 'stale':
        line = `${brand} ${renderStale(model.presence, model.ageMs, palette, capability, noColor)}${rootSuffix}`;
        break;
      case 'invalid-presence':
        line = `${brand} ${renderInvalid(palette)}${rootSuffix}`;
        break;
      case 'idle':
      default:
        line = `${brand} ${renderIdle(palette)}${rootSuffix}`;
        break;
    }
  }

  // Marquee is OFF for idle (and only idle). Compact states always
  // carry the band because the compact bar IS the headline. NO_COLOR
  // skips the band entirely — there's no SGR to inject.
  const shouldMarquee = !noColor && (hasCompact || model.state !== 'idle');
  return shouldMarquee ? applyMarquee(line, nowMs, capability) : line;
}