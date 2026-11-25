/**
 * The `palette` dimension (S8 Task 2): the contract's declared colour scale vs
 * the colours a captured frame actually paints.
 *
 * Two rules, both read from measured evidence:
 *
 *   1. UNDECLARED HUE FAMILY (per captured page). A rendered chromatic family
 *      whose OKLCH hue falls in a bucket the contract declares NO token for is
 *      `soft`, naming the family and its measured area share. The oracle is the
 *      contract, and the unit is the same on both sides: a HUE BUCKET, not a
 *      "step count" — counting rendered families against declared hue families
 *      compared a ΔE-merged colour list to a bucket list and read one declared
 *      red scale with two lightness steps as "2 families (red)". A contract
 *      with no chromatic token renders this rule `unmeasured`; a frame with no
 *      chromatic family is judged clean. The measurement itself lives in
 *      `palette-measure.ts`; this module only judges it.
 *   2. ΔE LADDER (contract level). Adjacent steps of one declared hue scale
 *      closer than the visible threshold (the article's 0.12 reference, or the
 *      contract's own `visibleDeltaE`) are indistinguishable on the page. This
 *      reads the declared tokens, not the capture, so it is emitted once.
 *
 * The measurement's non-app mask share travels in every finding's technical
 * line, so the cost of masking (≈ 3.2 % of the pilot frames) is visible.
 */

/* eslint-disable no-magic-numbers -- display precision and the visible-step default are stated constants. */

import { toRenderableColor } from '../../css-color.js';
import type { AuditFinding } from '../audit-finding.js';
import {
  deltaE,
  hueBucket,
  HUE_LABELS,
  oklabOfHex,
  oklchFields,
  type Oklab
} from '../color-oklch.js';
import type { ColorTokenGroup } from '../audit-color.js';
import {
  PALETTE_MIN_CHROMA,
  PALETTE_MIN_FAMILY_SHARE,
  type PaletteFamily,
  type PaletteMeasurement
} from './palette-measure.js';
import { MAX_MERGE_FAMILIES } from './palette-cells.js';

/** The article's visible step in OKLab; a contract may declare its own. */
export const DEFAULT_VISIBLE_DELTA_E = 0.12;
/** Shares and ΔE are echoed with four decimals, enough for a 4 M-pixel frame. */
const SHARE_DECIMALS = 4;
const ECHO_FAMILIES = 6;

export type DeclaredStep = { name: string; hex: string; lab: Oklab };
export type DeclaredFamily = { bucket: number; label: string; steps: DeclaredStep[] };

function display(name: string): string {
  return name.startsWith('--') ? name : `--${name}`;
}

/** One token as a chromatic ladder step, or null when it declares none. */
function stepOf(name: string, value: unknown): { bucket: number; step: DeclaredStep } | null {
  const hex = typeof value === 'string' ? toRenderableColor(value) : null;
  const lab = hex === null ? null : oklabOfHex(hex);
  if (hex === null || lab === null) return null;
  const fields = oklchFields(hex);
  if (fields.hue === null || (fields.chroma ?? 0) < PALETTE_MIN_CHROMA) return null;
  return { bucket: hueBucket(fields.hue), step: { name, hex, lab } };
}

/**
 * The contract's chromatic hue families, each with its steps in lightness
 * order. Neutrals and values that cannot be converted are absent: they declare
 * no chromatic family and cannot be ladder steps.
 */
export function declaredChromaticFamilies(color?: ColorTokenGroup): DeclaredFamily[] {
  const families = new Map<number, DeclaredFamily>();
  for (const name of Object.keys(color ?? {}).sort((left, right) => left.localeCompare(right))) {
    const parsed = stepOf(name, color?.[name]?.$value);
    if (parsed === null) continue;
    const family = families.get(parsed.bucket) ?? {
      bucket: parsed.bucket,
      label: HUE_LABELS[parsed.bucket] ?? '未知色相',
      steps: []
    };
    family.steps.push(parsed.step);
    families.set(parsed.bucket, family);
  }
  for (const family of families.values()) {
    family.steps.sort(
      (left, right) =>
        left.lab.lightness - right.lab.lightness || left.name.localeCompare(right.name)
    );
  }
  return [...families.values()].sort((left, right) => left.bucket - right.bucket);
}

/**
 * The ΔE ladder, with an `invert` arm for the calibration control: the real
 * rule reports steps BELOW the visible threshold, `invert` reports steps AT OR
 * ABOVE it. The audit uses the default arm, so a flipped or deleted comparison
 * fails the control instead of silently passing it.
 */
function ladderFindings(
  families: readonly DeclaredFamily[],
  file: string,
  threshold: number,
  invert: boolean
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const family of families) {
    for (let index = 1; index < family.steps.length; index += 1) {
      const previous = family.steps[index - 1];
      const next = family.steps[index];
      if (previous === undefined || next === undefined) continue;
      const distance = deltaE(previous.lab, next.lab);
      const violated = invert ? distance >= threshold : distance < threshold;
      if (!violated) continue;
      const measured = distance.toFixed(3);
      findings.push({
        dimension: 'palette',
        severity: 'soft',
        file,
        line: 1,
        value: `${display(previous.name)}/${display(next.name)}`,
        expected: invert ? `<${threshold}` : `>=${threshold}`,
        humanText: invert
          ? `契约的${family.label}色阶 ${display(previous.name)} 与 ${display(next.name)} 的 ΔE 为 ${measured}，达到或超过可见阈值 ${threshold}（反向对照）。`
          : `契约的${family.label}色阶 ${display(previous.name)} 与 ${display(next.name)} 的 ΔE 只有 ${measured}，低于可见阈值 ${threshold}，两者在页面上分不出层级。`,
        techText: `${file}:1 palette-ladder:${display(previous.name)}/${display(next.name)} ΔE=${measured} ${invert ? '>=' : '<'} ${threshold}`
      });
    }
  }
  return findings;
}

/** Every contract-level ladder finding, for the project reader to fold in once. */
export function auditDeclaredLadder(
  color: ColorTokenGroup | undefined,
  file: string,
  threshold: number = DEFAULT_VISIBLE_DELTA_E,
  invert = false
): AuditFinding[] {
  return ladderFindings(declaredChromaticFamilies(color), file, threshold, invert);
}

function maskEvidence(measurement: PaletteMeasurement): string {
  const { topStrip, toast, corners } = measurement.maskComponents;
  return `mask ${measurement.maskShare.toFixed(SHARE_DECIMALS)}% (top ${topStrip.toFixed(SHARE_DECIMALS)} + toast ${toast.toFixed(SHARE_DECIMALS)} + corners ${corners.toFixed(SHARE_DECIMALS)}), discarded ${measurement.discardedShare.toFixed(SHARE_DECIMALS)}% outside the listed families (below the ${PALETTE_MIN_FAMILY_SHARE}% floor or past the ${MAX_MERGE_FAMILIES}-family cap)`;
}

function familyLabel(colour: string): string {
  const fields = oklchFields(colour);
  if (fields.hue === null) return '未知色相';
  return HUE_LABELS[hueBucket(fields.hue)] ?? '未知色相';
}

/**
 * The rendered chromatic families whose hue bucket the contract does not
 * declare. The comparison is bucket-to-bucket; `invert` returns the DECLARED
 * ones instead, so the inversion control drives this same function rather than
 * a copy (a detector that cannot fail is the thing this slice exists to catch).
 */
export function undeclaredChromaticFamilies(
  measurement: PaletteMeasurement,
  declared: readonly DeclaredFamily[],
  invert = false
): PaletteFamily[] {
  const buckets = new Set(declared.map((family) => family.bucket));
  return measurement.families
    .filter((family) => family.chroma >= PALETTE_MIN_CHROMA)
    .sort(
      (left, right) => right.areaShare - left.areaShare || left.colour.localeCompare(right.colour)
    )
    .filter((family) => {
      const fields = oklchFields(family.colour);
      const declaredHere = fields.hue !== null && buckets.has(hueBucket(fields.hue));
      return invert ? declaredHere : !declaredHere;
    });
}

function familyFinding(
  undeclared: readonly PaletteFamily[],
  measurement: PaletteMeasurement,
  declared: readonly DeclaredFamily[],
  capture: string
): AuditFinding {
  const listing = undeclared
    .slice(0, ECHO_FAMILIES)
    .map(
      (family) => `${familyLabel(family.colour)}(${family.colour} ${family.areaShare.toFixed(3)}%)`
    )
    .join('; ');
  const labels = [...new Set(undeclared.map((family) => familyLabel(family.colour)))].join('、');
  return {
    dimension: 'palette',
    severity: 'soft',
    file: capture,
    line: 1,
    value: labels,
    expected: 'a declared hue family',
    humanText: `本页渲染出契约未声明的彩色色系：${labels}（共 ${undeclared.length} 个颜色家族），契约只声明了 ${declared.length} 个色系，页面颜色显得杂乱。`,
    techText: `${capture}:1 palette-undeclared:${undeclared.length} (${listing}) not among the ${declared.length} declared hue families [${maskEvidence(measurement)}]`
  };
}

/** Every family fell below the floor: no measurable palette, never a judged 100. */
export function paletteEmptyUnmeasured(capture: string): AuditFinding {
  return {
    dimension: 'palette',
    severity: 'unmeasured',
    file: capture,
    line: 1,
    value: 'palette',
    expected: `a colour family above the ${PALETTE_MIN_FAMILY_SHARE}% floor`,
    humanText: `截图 ${capture} 的每个颜色家族都低于 ${PALETTE_MIN_FAMILY_SHARE}% 的面积下限，没有可测量的调色板。`,
    techText: `${capture}:1 palette-families unmeasured (every family below the ${PALETTE_MIN_FAMILY_SHARE}% floor)`
  };
}

/** A capture the decoder refused: a gap with the measured reason, never a pass. */
export function paletteCaptureUnmeasured(capture: string, reason: string): AuditFinding {
  return {
    dimension: 'palette',
    severity: 'unmeasured',
    file: capture,
    line: 1,
    value: 'capture',
    expected: 'a decodable full-page.png',
    humanText: `截图 ${capture} 无法解码（${reason}），这一帧的调色板无法测量。`,
    techText: `${capture}:1 palette unmeasured (capture refused: ${reason})`
  };
}

/** A contract with no chromatic token: the family rule has no oracle. */
export function paletteOracleUnmeasured(
  capture: string,
  measurement: PaletteMeasurement
): AuditFinding {
  return {
    dimension: 'palette',
    severity: 'unmeasured',
    file: capture,
    line: 1,
    value: 'tokens.color',
    expected: 'a declared chromatic colour token',
    humanText: '契约没有声明任何彩色颜色 token，无法判断本页的彩色色系是否超出配色规范。',
    techText: `${capture}:1 palette-families unmeasured (tokens.color declares no chromatic colour token) [${maskEvidence(measurement)}]`
  };
}

export type PaletteDimensionAudit = {
  findings: AuditFinding[];
  /** True only when a capture was measured AND the contract declares a chromatic scale. */
  judged: boolean;
};

/**
 * Judge one captured page's palette against the declared scale. `judged` is
 * false for a capture-less page (the caller passes no measurement) and for a
 * contract with no chromatic token, so an unmeasured palette never reads as a
 * judged 100.
 */
export function auditPaletteDimension(input: {
  measurement: PaletteMeasurement;
  capture: string;
  color?: ColorTokenGroup;
}): PaletteDimensionAudit {
  const declared = declaredChromaticFamilies(input.color);
  if (declared.length === 0) return { findings: [], judged: false };
  if (input.measurement.families.length === 0) {
    return { findings: [paletteEmptyUnmeasured(input.capture)], judged: false };
  }
  const undeclared = undeclaredChromaticFamilies(input.measurement, declared);
  return {
    findings:
      undeclared.length === 0
        ? []
        : [familyFinding(undeclared, input.measurement, declared, input.capture)],
    judged: true
  };
}
