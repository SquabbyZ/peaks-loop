/**
 * The Stage A and Stage B readers of the page-usability probe.
 *
 * Split out of `page-probe.ts` when the route stage moved in front of the
 * screenshot: the orchestration is now four stages plus a judgment, and these
 * readers keep their own module so neither file needs its comments trimmed.
 *
 * Stage A is the bounded HTTP GET (`page-probe-http.ts`). Stage B is one
 * `designlang stats --as-json`, which blocks when no rendered text element
 * carries a font family. That catches a genuinely empty shell, but on the pilot
 * it PASSES a blank route (stats sees the global stylesheet: fontFamilyCount 1,
 * typeScale 7) because the DOM counts overlap — which is why Stage C's measured
 * paint signal exists.
 */
import { parseJsonObject } from './designlang-evidence.js';
import type { DesignlangRunResult } from './designlang.js';
import type { PageHttpObservation } from './page-probe-http.js';
import type { PageStatsObservation } from './page-probe.js';

/** The injected Stage A fetch, replaying a measured page in unit tests. */
type FetchPage = (url: string) => Promise<PageHttpObservation>;
/** The injected Stage B stats run, so unit tests spawn no browser. */
type RunStats = (url: string) => Promise<DesignlangRunResult>;

type StatsRead = { ok: true; observation: PageStatsObservation } | { ok: false; detail: string };

/** A finite number, or null for anything else (including `NaN`/`Infinity`). */
function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Stage A: the real fetch, with a thrown fetch degraded to "did not answer". */
export async function readHttp(url: string, fetchPage: FetchPage): Promise<PageHttpObservation> {
  try {
    return await fetchPage(url);
  } catch {
    return { status: null, finalUrl: null, textChars: 0, hasPasswordField: false };
  }
}

/** Stage B: one stats run; a failed or shapeless run blocks, never passes. */
export async function readStats(runStats: RunStats, url: string): Promise<StatsRead> {
  let result: DesignlangRunResult;
  try {
    result = await runStats(url);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, detail: `designlang stats threw before printing: ${detail}` };
  }
  const parsed = parseJsonObject(result.stdout);
  if (parsed === null) {
    return {
      ok: false,
      detail: `designlang stats exited ${String(result.exitCode)} without a JSON document`
    };
  }
  const fontFamilyCount = finiteNumber(parsed.fontFamilyCount);
  if (fontFamilyCount === null) {
    return {
      ok: false,
      detail: `designlang stats exited ${String(result.exitCode)} without a fontFamilyCount`
    };
  }
  return { ok: true, observation: { fontFamilyCount, typeScale: finiteNumber(parsed.typeScale) } };
}

/** Why Stage B refuses this observation, or null when the page rendered text. */
export function statsRefusal(stats: PageStatsObservation): string | null {
  const { fontFamilyCount, typeScale } = stats;
  if (fontFamilyCount === 0 && (typeScale === null || typeScale <= 1)) {
    return 'no rendered text element carries a font family, so the page is blank or artwork-only';
  }
  return null;
}
