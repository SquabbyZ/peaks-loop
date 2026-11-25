/**
 * Surface-consistency detector (S7 Task 5, dimension `surface`, soft).
 *
 * Three source-readable questions:
 *   - how many distinct radius tiers does the page use? More than three reads
 *     as "every component rounded itself" and is a soft finding. Numeric tiers
 *     are reported against `tokenScale.radius`; keyword tiers are counted by
 *     name because the contract declares no keyword map (see `surface-measure`).
 *   - what does a shadow's blur measure? The contract declares no shadow scale
 *     (`DesignTokenScale` has space / font / radius / colour / weight only), so
 *     a measured blur is an `unmeasured` gap quoting the blur — never judged
 *     against an invented px threshold (S7 review K2). The retired 12 px
 *     soft rule survives only as the inversion control in its test.
 *   - is the primary button written more than one way? Two distinct class
 *     strings carrying the primary style is the "主按钮被复制成几套" tell.
 *
 * WHICH SOURCE SET EACH QUESTION READS (Task 6d). Radius and shadow judge the
 * page PLUS its import closure: the tiers live in the components the page
 * renders, and a page-scope-only read measured zero radius values on the pilot.
 * The primary-string rule stays page-scope and reads `input.pageSources` (or
 * `input.sources` when no separate page set was supplied): it is about what the
 * page itself asks the user to click first, not what a shared child draws.
 *
 * A radius value behind `var()` / `calc()` is `unmeasured`, naming it, never a
 * violation. A contract that declares no radius scale records one `unmeasured`
 * finding instead of judging the page against a ladder it never declared.
 */

import type { AuditFinding, AuditInput } from './audit-finding.js';
import {
  distinctPrimaryStrings,
  primaryClassSamples,
  type PrimaryClassSample
} from './primary-measure.js';
import { measureRadius, measureShadows, type RadiusSample } from './surface-measure.js';

export { measureRadius, measureShadows } from './surface-measure.js';
export { distinctPrimaryStrings, primaryClassSamples } from './primary-measure.js';

/** More than three radius tiers on one page is the crowded-radius rule. */
export const MAX_RADIUS_TIERS = 3;

/**
 * The shadow rule reports an UNMEASURED gap, never a soft finding (S7 review
 * K2). The contract declares no shadow scale (`DesignTokenScale` has space /
 * font / radius / colour / weight only), so a 12 px threshold would be invented
 * — and judging a shadow against an invented ladder is exactly what the plan's
 * Global Constraint forbids. The measured blur stays in the evidence so a reader
 * can still see what the page does.
 */
function shadowUnmeasuredFinding(sample: {
  file: string;
  line: number;
  raw: string;
  blurPx: number | null;
}): AuditFinding {
  const blur = sample.blurPx === null ? 'runtime' : `${sample.blurPx}px`;
  return {
    dimension: 'surface',
    severity: 'unmeasured',
    file: sample.file,
    line: sample.line,
    value: sample.blurPx === null ? sample.raw : `${sample.blurPx}px`,
    expected: 'tokenScale.shadow',
    humanText: `第 ${sample.line} 行的阴影模糊半径是 ${blur}，契约没有声明阴影刻度，源码里无法判断它是否合适。`,
    techText: `${sample.file}:${sample.line} box-shadow:${sample.raw} blur=${blur} unmeasured (no shadow scale declared)`
  };
}

/** Witnesses stay short in a technical line; the human sentence names the set. */
const MAX_WITNESSES = 3;

function anchor(samples: readonly { file: string; line: number }[]): {
  file: string;
  line: number;
} {
  const first = samples[0];
  return { file: first?.file ?? '', line: first?.line ?? 1 };
}

/** The distinct, readable radius tiers a page uses, sorted. */
export function radiusTiers(samples: readonly RadiusSample[]): string[] {
  return [
    ...new Set(samples.filter((sample) => !sample.unreadable).map((sample) => sample.tier))
  ].sort((left, right) => left.localeCompare(right));
}

function tierFinding(samples: readonly RadiusSample[], tiers: readonly string[]): AuditFinding {
  const first = anchor(samples);
  const ladder = [...new Set(samples.flatMap((sample) => (sample.px === null ? [] : [sample.px])))];
  return {
    dimension: 'surface',
    severity: 'soft',
    file: first.file,
    line: first.line,
    value: tiers.join('/'),
    expected: `<=${MAX_RADIUS_TIERS}`,
    humanText: `本页共用了 ${tiers.length} 种圆角（${tiers.join('、')}），超过 ${MAX_RADIUS_TIERS} 种，同类控件的圆角看起来会不一致。`,
    techText: `${first.file}:${first.line} radius-tiers:${tiers.join('/')} > ${MAX_RADIUS_TIERS} (px:${ladder.join('/') || 'none'})`
  };
}

function unmeasuredRadiusFinding(sample: RadiusSample): AuditFinding {
  const why = `它用了 ${sample.raw}`;
  return {
    dimension: 'surface',
    severity: 'unmeasured',
    file: sample.file,
    line: sample.line,
    value: sample.raw,
    expected: '',
    humanText: `第 ${sample.line} 行的圆角是 ${sample.raw}，${why}，源码里无法判断它属于哪一级圆角。`,
    techText: `${sample.file}:${sample.line} border-radius:${sample.raw} unmeasured (runtime value)`
  };
}

function noScaleFinding(samples: readonly RadiusSample[]): AuditFinding {
  const first = anchor(samples);
  return {
    dimension: 'surface',
    severity: 'unmeasured',
    file: first.file,
    line: first.line,
    value: String(radiusTiers(samples).length),
    expected: 'tokenScale.radius',
    humanText: '契约没有声明圆角刻度，本页的圆角无法按刻度判断。',
    techText: `${first.file}:${first.line} radius-tiers unmeasured (tokenScale.radius declares no value)`
  };
}

/** Radius verdicts: tier count (soft), runtime values (unmeasured), no scale. */
function radiusFindings(input: AuditInput): AuditFinding[] {
  const samples = measureRadius(input.sources);
  if (samples.length === 0) return [];
  if (input.tokenScale.radius.length === 0) return [noScaleFinding(samples)];
  const findings = samples
    .filter((sample) => sample.unreadable)
    .slice(0, 1)
    .map((sample) => unmeasuredRadiusFinding(sample));
  const tiers = radiusTiers(samples);
  if (tiers.length > MAX_RADIUS_TIERS) findings.push(tierFinding(samples, tiers));
  return findings;
}

function shadowFinding(sample: {
  file: string;
  line: number;
  raw: string;
  blurPx: number | null;
}): AuditFinding {
  return shadowUnmeasuredFinding(sample);
}

function primaryFinding(
  samples: readonly PrimaryClassSample[],
  strings: readonly string[]
): AuditFinding {
  const first = samples[0];
  const witnesses = samples
    .slice(0, MAX_WITNESSES)
    .map((sample) => `${sample.text}@${sample.file}:${sample.line} [${sample.evidence}]`);
  return {
    dimension: 'surface',
    severity: 'soft',
    file: first?.file ?? '',
    line: first?.line ?? 1,
    value: strings.join(' | '),
    expected: '1',
    humanText: `本页的主按钮样式被写成了 ${strings.length} 套（${strings.join('；')}），同一种主操作出现了不同写法。`,
    techText: `${first?.file ?? ''}:${first?.line ?? 1} primary-class-strings:${strings.length} (${witnesses.join('; ')})`
  };
}

/** Every surface finding for a page: radius (soft/unmeasured), shadow (gap), primary. */
export function auditSurface(input: AuditInput): AuditFinding[] {
  return auditSurfaceDimension(input).findings;
}

/** The surface verdict plus whether any source was available to judge. */
export type SurfaceDimensionAudit = { findings: AuditFinding[]; judged: boolean };

/** Every surface finding, and whether the rules had a source to read. */
export function auditSurfaceDimension(input: AuditInput): SurfaceDimensionAudit {
  const findings = radiusFindings(input);
  const shadows = measureShadows(input.sources);
  const witness = shadows.find((sample) => sample.blurPx !== null) ?? shadows[0];
  if (witness !== undefined) findings.push(shadowFinding(witness));
  const primarySamples = primaryClassSamples(input.pageSources ?? input.sources);
  const strings = distinctPrimaryStrings(primarySamples);
  if (strings.length > 1) findings.push(primaryFinding(primarySamples, strings));
  return { findings, judged: input.sources.length > 0 };
}
