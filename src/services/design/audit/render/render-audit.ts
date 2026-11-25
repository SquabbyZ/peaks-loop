/**
 * The render evidence and the findings no page owns (S8 Tasks 2–4), merged
 * from the former `render-evidence.ts` and `overflow.ts` when the S8 close-out
 * removed cap-only splits.
 *
 * A capture is the fixed-path `full-page.png` the S6/S5 probe writes, its route
 * (derived the same way G3 derives a route from a page file) OR the probe slug
 * the `--render` reader found, and the background kind the capture's payload
 * declared. The audit binds a frame to a page by ROUTE or by SLUG (`probeSlug`
 * of the page's route); a page with no capture simply has no render dimension
 * and keeps its S7 source behaviour.
 *
 * `background` is measured from the decoded PIXELS, never taken from the
 * payload's `gradients[]`: that list went `[]` → two green gradients between
 * two runs on the same pages with nothing visibly painted (D3). A pair measured
 * over `gradient` / `image` / `unknown` is `unmeasured`, never a pass.
 *
 * CONTRAST FALLBACK (close-out M4). S7's token ratios are used ONLY when no
 * capture was supplied at all. A capture that was supplied but refused makes
 * the dimension `unmeasured` naming the refusal — it must never fall back to a
 * token-only pass beside a capture the audit could not read.
 *
 * Overflow honesty (Task 4). The spike proved no overflow signal is available
 * today, so S8 ships the only honest branch: one fixed `unmeasured` row naming
 * the missing capability, and a `knownGaps` reason carrying the measured
 * numbers. No heuristic may fire as overflow.
 */

import type { AuditDimension, AuditFinding } from '../audit-finding.js';
import { auditContrast } from '../audit-contrast.js';
import { sanitizeFindings } from '../audit-echo.js';
import type { AuditContract } from '../audit-unit.js';
import { auditRenderedContrast } from './contrast-presence.js';
import {
  auditDeclaredLadder,
  declaredChromaticFamilies,
  paletteCaptureUnmeasured,
  paletteOracleUnmeasured
} from './palette.js';
import { measurePalette, type PaletteRead } from './palette-measure.js';
import type { RenderBackground } from './render-background.js';

export type { RenderBackground } from './render-background.js';

export type RenderCapture = {
  /** The PNG bytes read from the capture's fixed path. */
  png: Uint8Array;
  /** The capture path reported in findings (render- or repository-relative). */
  capture: string;
  /** The rendered route, when the caller knows it; the page binding key. */
  route?: string;
  /** The probe slug (`probeSlug(url)`) when the caller read a capture directory. */
  slug?: string;
};

/** One decoded (or refused) frame, ready for a page and the contrast reader. */
export type RenderFrame = {
  capture: string;
  route: string | null;
  slug: string | null;
  background: RenderBackground;
  palette: PaletteRead;
};

/**
 * Decode every supplied capture once; a refusal is a value, never a throw. The
 * background kind comes from the PIXELS (`palette.measurement.background`), not
 * from the payload's gradient list: that list flipped between runs on the same
 * pages while no gradient was painted (D3).
 */
export function readRenderFrames(captures: readonly RenderCapture[]): RenderFrame[] {
  return captures.map((capture) => {
    const palette = measurePalette(capture.png);
    return {
      capture: capture.capture,
      route: capture.route ?? null,
      slug: capture.slug ?? null,
      background: palette.ok ? palette.measurement.background : 'unknown',
      palette
    };
  });
}

/** One capture as the report names it: file, decoded?, non-app share, page. */
export type RenderUsage = {
  capture: string;
  slug: string | null;
  decoded: boolean;
  maskShare: number | null;
  boundTo: string | null;
};

/** The report's render-evidence summary (also the `--render` read gap). */
export type RenderEvidenceSummary = {
  captures: RenderUsage[];
  gap: string | null;
};

/** Every capture with what was measured from it and which page it bound to. */
export function renderUsage(
  frames: readonly RenderFrame[],
  boundBy: ReadonlyMap<string, string>
): RenderUsage[] {
  return frames.map((frame) => ({
    capture: frame.capture,
    slug: frame.slug,
    decoded: frame.palette.ok,
    maskShare: frame.palette.ok ? frame.palette.measurement.maskShare : null,
    boundTo: boundBy.get(frame.capture) ?? null
  }));
}

/** The measured reason, shared by the finding and the fixed known gap. */
export const OVERFLOW_UNAVAILABLE_REASON =
  'the capture carries no scroll/client/overflow geometry: designlang extract exposes only 2–5 top-level regions[].bounds, --width 390 still reports w=1280, and --responsive-shots is a dead flag in 13.4.1; a real two-viewport capture is a new capture mode measured at ~7 s/page';

/** The fixed known-gap entry the report always prints. */
export const OVERFLOW_KNOWN_GAP = {
  id: 'responsive-overflow',
  text: 'responsive overflow — needs the rendered page (S8)',
  reason: OVERFLOW_UNAVAILABLE_REASON
} as const;

/** The one fixed overflow row. */
export function overflowGapFinding(file: string): AuditFinding {
  return {
    dimension: 'overflow',
    severity: 'unmeasured',
    file,
    line: 1,
    value: 'responsive-overflow',
    expected: 'a two-viewport capture (desktop + 390 px)',
    humanText: `页面在手机宽度下是否溢出无法判定：截图里没有 scroll/client/overflow 几何信息（extract 只有 2–5 个顶层 regions[].bounds，--width 390 仍报告 w=1280，--responsive-shots 在 designlang 13.4.1 是空操作），双视口截图是每页约 7 秒的新采集模式，本切片没有实现。`,
    techText: `${file}:1 overflow:responsive-overflow unmeasured (${OVERFLOW_UNAVAILABLE_REASON})`
  };
}

/**
 * A capture the caller supplied but the decoder refused. Render contrast cannot
 * fall back to S7's token ratios: that would report a judged 100 from a capture
 * the audit could not read. The refusal is the finding.
 */
export function contrastCaptureUnmeasured(capture: string, reason: string): AuditFinding {
  return {
    dimension: 'contrast',
    severity: 'unmeasured',
    file: capture,
    line: 1,
    value: 'capture',
    expected: 'a decodable full-page.png',
    humanText: `截图 ${capture} 无法解码（${reason}），这个配对的渲染对比度无法验证，不能退回到 token 计算。`,
    techText: `${capture}:1 contrast unmeasured (capture refused, no token fallback: ${reason})`
  };
}

export type RenderGlobalAudit = {
  findings: AuditFinding[];
  contractJudged: Partial<Record<AuditDimension, boolean>>;
};

/** S7's token-pair audit, used only when NO capture was supplied. */
function sourceContrast(contract: AuditContract, tokensFile: string): AuditFinding[] {
  return auditContrast(
    {
      ...(contract.color === undefined ? {} : { color: contract.color }),
      pairs: contract.pairs
    },
    tokensFile
  );
}

/** The contrast contract shape `auditRenderedContrast` reads. */
function contrastContract(contract: AuditContract) {
  return {
    ...(contract.color === undefined ? {} : { color: contract.color }),
    pairs: contract.pairs
  };
}

/**
 * Contrast's three branches, in order: no capture (S7 tokens), captures but
 * none decodable (refusal only), captures decodable (rendered presence). A
 * capture that was supplied is never allowed to fall back to tokens.
 */
function contrastAudit(input: {
  contract: AuditContract;
  frames: readonly RenderFrame[];
  tokensFile: string;
}): { findings: AuditFinding[]; judged: boolean } {
  const { contract, frames, tokensFile } = input;
  if (frames.length === 0) {
    return { findings: sourceContrast(contract, tokensFile), judged: contract.pairs.length > 0 };
  }
  const decoded = frames.filter((frame) => frame.palette.ok);
  if (decoded.length === 0) {
    const findings = frames.flatMap((frame) =>
      frame.palette.ok ? [] : [contrastCaptureUnmeasured(frame.capture, frame.palette.reason)]
    );
    return { findings, judged: false };
  }
  if (contract.pairs.length === 0) {
    return { findings: sourceContrast(contract, tokensFile), judged: false };
  }
  return auditRenderedContrast(contrastContract(contract), decoded, tokensFile);
}

/**
 * Every finding no page owns, sanitised once at this boundary. `frames` may be
 * empty (no capture supplied) or entirely refused; a refused capture is named
 * as a gap on BOTH render dimensions, never scored as a pass.
 */
export function collectRenderFindings(input: {
  contract: AuditContract;
  frames: readonly RenderFrame[];
  tokensFile: string;
  probeFile: string;
}): RenderGlobalAudit {
  const { contract, frames, tokensFile, probeFile } = input;
  const paletteGaps = frames.flatMap((frame) =>
    frame.palette.ok ? [] : [paletteCaptureUnmeasured(frame.capture, frame.palette.reason)]
  );
  const firstDecoded = frames.find((frame) => frame.palette.ok);
  const oracleGap =
    firstDecoded !== undefined &&
    firstDecoded.palette.ok &&
    declaredChromaticFamilies(contract.color).length === 0
      ? [paletteOracleUnmeasured(firstDecoded.capture, firstDecoded.palette.measurement)]
      : [];
  const ladder = auditDeclaredLadder(contract.color, tokensFile, contract.visibleDeltaE);
  const contrast = contrastAudit({ contract, frames, tokensFile });
  return {
    findings: sanitizeFindings([
      overflowGapFinding(probeFile),
      ...paletteGaps,
      ...oracleGap,
      ...ladder,
      ...contrast.findings
    ]),
    contractJudged: { contrast: contrast.judged }
  };
}
