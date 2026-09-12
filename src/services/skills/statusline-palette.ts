/**
 * Visual / palette / SGR rendering block extracted from
 * `skill-statusline-renderer.ts` (slice 2026-09-06-split-batch-b) so the
 * renderer stays under the 800-line cap. Behaviour-preserving verbatim move;
 * `export` keywords were added to the symbols the renderer still imports.
 */

export type StatusLineCapability = 'ansi-unicode' | 'unicode' | 'ascii';

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

export function isAttentionGate(gate: string | undefined): string | null {
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
export interface StatusPalette {
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
  /**
   * Slice 2026-09-12-compact-band-policy: a trigger is registered but no
   * compaction is running. Rendered WITHOUT a bar — see
   * `renderCompact` in skill-statusline-renderer.ts.
   */
  readonly armed: string;
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
export const HIGHLIGHT_SGR_OPEN = `\x1b[1;${HIGHLIGHT_RGB}m`;

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
export function brandRun(text: string, noColor: boolean, capability: StatusLineCapability): string {
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
        queued: '[', preparing: '+', compacting: '+', armed: '~', verifying: '+',
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
      // Distinct from `compacting` on purpose: "waiting for the trigger"
      // must not wear the same face as "a compact is in flight".
      armed: brandGlyph('◔'),
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

export function renderActiveDot(capability: StatusLineCapability, nowMs: number, noColor: boolean): string {
  // Brief: the active dot carries the project accent (`#5A65D8` bold)
  // in both colored tiers. The breathing glyph is wrapped in a fresh
  // SGR on every render so the IDE sees a single accent per refresh.
  // NO_COLOR strips the SGR but keeps the glyph (still rotates).
  const glyph = pickBreathingGlyph(capability, nowMs);
  if (noColor || capability === 'ascii') return glyph;
  return `${BRAND_SGR_OPEN}${glyph}${BRAND_SGR_CLOSE}`;
}

export function brandText(capability: StatusLineCapability, noColor: boolean): string {
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
export const DEFAULT_CAPABILITY: StatusLineCapability = 'unicode';

export function paletteFor(capability: StatusLineCapability | undefined, noColor: boolean): StatusPalette {
  return buildPalette(capability ?? DEFAULT_CAPABILITY, noColor);
}
