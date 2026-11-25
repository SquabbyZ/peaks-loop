/**
 * Contrast as DECLARED-PAIR PRESENCE on the rendered frame (S8 Task 3).
 * The payload's own pairs NEVER render: the pilot's 3 emitted pairs each have a
 * colour covering 0.000 % of the frame, yet `accessibility` scored one AAA and
 * `colors.pairs` another AA — its score even reports 100 with `totalPairs: 0`.
 * Neither field is rendered verification. Per-element contrast needs a
 * browser-side script S8 does not build.
 *
 * Each pair the CONTRACT declares is looked up in the measured palette: both
 * colours present → report the ratio of the RENDERED family colours; either
 * absent → `unmeasured` "declared but not rendered", never a pass. A pair over
 * a gradient/image background is `unmeasured`. Presence, not adjacency, is
 * proven. No declared pairs → S7's "not judged".
 */

/* eslint-disable no-magic-numbers -- the presence thresholds and display precision are stated constants. */

import { toRenderableColor } from '../../css-color.js';
import type { AuditFinding } from '../audit-finding.js';
import { contrastRatio, type ContrastContract, type DeclaredColorPair } from '../audit-contrast.js';
import { deltaE, oklabOfHex } from '../color-oklch.js';
import type { PaletteFamily, PaletteMeasurement } from './palette-measure.js';
import type { RenderBackground, RenderFrame } from './render-audit.js';

/**
 * A rendered family within this OKLab distance of the declared colour IS that
 * colour — a quarter of the 0.12 visible step. A 0.06 window would match
 * #777777 to #888888 (0.058 apart), which the palette merge deliberately keeps
 * distinct.
 */
export const PRESENCE_DELTA_E = 0.03;

const BODY_MIN_RATIO = 4.5;
const LARGE_MIN_RATIO = 3;
const DISPLAY_DECIMALS = 2;

/**
 * The WCAG threshold rule, with an `invert` arm for the calibration control:
 * `invert` reports a pair that PASSES. The real audit uses the default arm, so
 * a deleted check fails the control instead of silently passing it.
 */
export function thresholdViolated(ratio: number, minimum: number, invert = false): boolean {
  return invert ? ratio >= minimum : ratio < minimum;
}

type FramePresence = {
  frame: RenderFrame;
  background: PaletteFamily;
  foreground: PaletteFamily;
};

export type RenderedContrastAudit = {
  findings: AuditFinding[];
  /** True only when at least one declared pair was actually measured. */
  judged: boolean;
};

function display(name: string): string {
  return name.startsWith('--') ? name : `--${name}`;
}

function tokenValue(contract: ContrastContract, key: string): string | null {
  const name = key.startsWith('--') ? key.slice('--'.length) : key;
  const value = contract.color?.[name]?.$value;
  return typeof value === 'string' ? value : null;
}

function declaredPairs(contract: ContrastContract): DeclaredColorPair[] {
  if (!Array.isArray(contract.pairs)) return [];
  return contract.pairs.filter(
    (pair): pair is DeclaredColorPair =>
      pair !== null &&
      typeof pair === 'object' &&
      typeof (pair as DeclaredColorPair).fg === 'string' &&
      typeof (pair as DeclaredColorPair).bg === 'string'
  );
}

/**
 * The rendered family that IS the declared colour in this frame, or null.
 * `invert` returns the CLOSEST family NOT within the presence window — the
 * flipped rule the calibration control drives. No presence-share guard: the
 * palette already drops families below its 0.05 % floor.
 */
export function familyNearIn(
  measurement: PaletteMeasurement,
  colour: string,
  invert = false
): PaletteFamily | null {
  const target = oklabOfHex(colour);
  if (target === null) return null;
  let best: PaletteFamily | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const family of measurement.families) {
    const rendered = oklabOfHex(family.colour);
    if (rendered === null) continue;
    const distance = deltaE(target, rendered);
    const inside = distance <= PRESENCE_DELTA_E;
    if (inside === invert) continue;
    // Closest wins; a larger family only breaks an exact tie, so a declared
    // colour never resolves to a merely neighbouring family.
    if (
      distance < bestDistance ||
      (distance === bestDistance && family.areaShare > (best?.areaShare ?? 0))
    ) {
      best = family;
      bestDistance = distance;
    }
  }
  return best;
}

function familyNear(measurement: PaletteMeasurement, colour: string): PaletteFamily | null {
  return familyNearIn(measurement, colour, false);
}

function presenceIn(
  frame: RenderFrame,
  foreground: string,
  background: string
): FramePresence | null {
  if (!frame.palette.ok) return null;
  const fg = familyNear(frame.palette.measurement, foreground);
  const bg = familyNear(frame.palette.measurement, background);
  return fg === null || bg === null ? null : { frame, foreground: fg, background: bg };
}

const BACKGROUND_LABEL: Record<RenderBackground, string> = {
  solid: '纯色',
  gradient: '渐变',
  image: '图片',
  unknown: '未知'
};

function unmeasured(
  pair: DeclaredColorPair,
  file: string,
  why: string,
  technical: string
): AuditFinding {
  const names = `${display(pair.fg)}/${display(pair.bg)}`;
  return {
    dimension: 'contrast',
    severity: 'unmeasured',
    file,
    line: 1,
    value: names,
    expected: 'both colours in the rendered frame',
    humanText: `契约的配对 ${names} 无法从渲染结果确认（${why}），这个配对的对比度是未知的。`,
    techText: `${file}:1 contrast:${names} unmeasured (${technical})`
  };
}

function lowContrast(
  pair: DeclaredColorPair,
  ratio: number,
  minimum: number,
  presence: FramePresence
): AuditFinding {
  const measured = ratio.toFixed(DISPLAY_DECIMALS);
  const kind = pair.large === true ? '大字' : '正文';
  const fg = presence.foreground;
  const bg = presence.background;
  return {
    dimension: 'contrast',
    severity: 'hard',
    file: presence.frame.capture,
    line: 1,
    value: `${measured}:1`,
    expected: `${minimum}:1`,
    // What is PROVEN: both declared colours appear in the same solid-labelled
    // frame. Adjacency is not measured (per-element contrast needs a
    // browser-side script), so the sentence must not say the text "sits on"
    // the background.
    humanText: `渲染帧里同时出现了 ${fg.colour} 和 ${bg.colour}，两色对比度为 ${measured}:1，低于${kind}要求的 ${minimum}:1；本规则只证明两个颜色都出现在同一帧，没有验证文字与背景是否相邻。`,
    techText: `${presence.frame.capture}:1 contrast:${display(pair.fg)}/${display(pair.bg)}=${measured} < ${minimum} (both rendered ${fg.colour} and ${bg.colour} present, solid; adjacency not measured)`
  };
}

function measuredPair(
  pair: DeclaredColorPair,
  ratio: number,
  minimum: number,
  presence: FramePresence
): RenderedContrastAudit {
  return {
    findings: thresholdViolated(ratio, minimum)
      ? [lowContrast(pair, ratio, minimum, presence)]
      : [],
    judged: true
  };
}

/** Both declared colours resolved to hex, or the gap finding that stops the pair. */
function resolvedPair(
  contract: ContrastContract,
  pair: DeclaredColorPair,
  fallbackFile: string
): { foreground: string; background: string } | { finding: AuditFinding } {
  const declaredForeground = tokenValue(contract, pair.fg);
  const declaredBackground = tokenValue(contract, pair.bg);
  const foreground = declaredForeground === null ? null : toRenderableColor(declaredForeground);
  const background = declaredBackground === null ? null : toRenderableColor(declaredBackground);
  if (foreground !== null && background !== null) return { foreground, background };
  return {
    finding: unmeasured(
      pair,
      fallbackFile,
      '契约的 token 无法解析',
      'declared token is missing or unconvertible'
    )
  };
}

function absentPair(
  pair: DeclaredColorPair,
  resolved: { foreground: string; background: string },
  frames: readonly RenderFrame[],
  fallbackFile: string
): RenderedContrastAudit {
  return {
    findings: [
      unmeasured(
        pair,
        fallbackFile,
        `声明过但没有渲染出来（${frames.length} 张截图里没有同时找到这两个颜色）`,
        `declared but not rendered (no family within ΔE ${PRESENCE_DELTA_E} of ${resolved.foreground} and ${resolved.background} in ${frames.length} capture(s))`
      )
    ],
    judged: false
  };
}

function nonSolidPair(
  pair: DeclaredColorPair,
  presences: readonly FramePresence[],
  fallbackFile: string
): RenderedContrastAudit {
  const kinds = [
    ...new Set(presences.map((presence) => BACKGROUND_LABEL[presence.frame.background]))
  ].join('、');
  return {
    findings: [
      unmeasured(
        pair,
        presences[0]?.frame.capture ?? fallbackFile,
        `配对的背景是${kinds}，不是纯色`,
        `rendered over a ${presences[0]?.frame.background ?? 'unknown'} background, not a solid fill`
      )
    ],
    judged: false
  };
}

function pairFindings(
  contract: ContrastContract,
  pair: DeclaredColorPair,
  frames: readonly RenderFrame[],
  fallbackFile: string
): RenderedContrastAudit {
  const resolved = resolvedPair(contract, pair, fallbackFile);
  if ('finding' in resolved) return { findings: [resolved.finding], judged: false };
  const presences = frames
    .map((frame) => presenceIn(frame, resolved.foreground, resolved.background))
    .filter((presence): presence is FramePresence => presence !== null);
  if (presences.length === 0) return absentPair(pair, resolved, frames, fallbackFile);
  const solid = presences.find((presence) => presence.frame.background === 'solid');
  if (solid === undefined) return nonSolidPair(pair, presences, fallbackFile);
  const ratio = contrastRatio(solid.foreground.colour, solid.background.colour);
  if (ratio === null) {
    return {
      findings: [
        unmeasured(pair, solid.frame.capture, '渲染颜色无法读取', 'rendered colour unreadable')
      ],
      judged: false
    };
  }
  return measuredPair(pair, ratio, pair.large === true ? LARGE_MIN_RATIO : BODY_MIN_RATIO, solid);
}

/**
 * Every declared pair verified against the rendered frames. A pair measured on
 * at least one solid frame is judged; a pair absent everywhere is unmeasured.
 */
export function auditRenderedContrast(
  contract: ContrastContract,
  frames: readonly RenderFrame[],
  fallbackFile: string
): RenderedContrastAudit {
  const pairs = declaredPairs(contract);
  const findings: AuditFinding[] = [];
  let judged = false;
  for (const pair of pairs) {
    const result = pairFindings(contract, pair, frames, fallbackFile);
    findings.push(...result.findings);
    judged = judged || result.judged;
  }
  return { findings, judged };
}
