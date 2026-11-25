/**
 * The capture half of the page-usability probe. Two bounded invocations,
 * because round 4 measured that one cannot do both jobs on an auth-gated route:
 * `extract <url> --json --screenshots` never printed its JSON within 120 s
 * (>381 s, captured on a 504-retry loop), while the same extract WITHOUT
 * `--screenshots` finished in 3.0 s. So:
 *
 *   1. identity: `extract <url> --json --no-history -o <dir> --quiet`
 *      (no `--screenshots`) — the JSON `meta.title` and `voice.sampleHeadings`.
 *      Measured 2.9–3.4 s on the pilot's `/channels`, `/sign-in`, and 404 card.
 *   2. screenshot: `extract <url> --screenshots --no-history -o <dir> --quiet`
 *      (no `--json`) — it writes `<dir>/screenshots/full-page.png` and prints a
 *      file list, not JSON. Measured 7.2–8.8 s on the same pilot routes.
 *
 * They are two separate entry points, not one function: the route stage judges
 * the identity document BETWEEN them, so a refused route never runs the
 * screenshot it does not need (round 6 measured that capture at 7.6 s, 60 s at
 * worst, and >381 s on an auth-gated page).
 *
 * The screenshot PNG path is fixed, so no untrusted path is read back from JSON.
 * Each call has its own budget; a screenshot that overruns blocks the page with
 * cause `capture-timeout` and the measured elapsed time, never a score and
 * never a 120 s wait for JSON that cannot come.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { parseJsonObject } from './designlang-evidence.js';
import type { DesignlangRunResult } from './designlang.js';
import { measurePng, type PaintMetric } from './paint-metric.js';
import { readRenderedIdentity, type IdentityDocument } from './route-observation.js';

/** The identity extract's budget; it measured 2.9–3.4 s on the pilot. */
export const IDENTITY_TIMEOUT_MS = 60_000;

/**
 * The screenshot half's own, shorter budget. It measured 7.2–8.8 s on the
 * pilot, but round 4 measured >381 s on a 504-retry loop; a capture that
 * overruns must block promptly instead of holding the old 120 s run.
 */
export const CAPTURE_TIMEOUT_MS = 60_000;

/** The PNG `--screenshots` always writes, relative to its out dir. */
const SCREENSHOT_RELATIVE_PATH = join('screenshots', 'full-page.png');

export type CaptureDocumentRead =
  { ok: true; document: IdentityDocument } | { ok: false; reason: string };

type PaintMeasurement = { ok: true; metric: PaintMetric } | { ok: false; reason: string };

/** Which half of the capture failed, so a timeout is never a generic refusal. */
export type PaintFailureCause =
  'identity-failed' | 'identity-timeout' | 'capture-failed' | 'capture-timeout';

export type IdentityProbeRead =
  | { ok: true; document: IdentityDocument; elapsedMs: number }
  | { ok: false; cause: PaintFailureCause; reason: string; elapsedMs: number };

export type ScreenshotProbeRead =
  | { ok: true; metric: PaintMetric; elapsedMs: number }
  | { ok: false; cause: PaintFailureCause; reason: string; elapsedMs: number };

/**
 * Parse the identity extract's stdout. The screenshot call is not consulted:
 * it prints a file list, and the PNG's path is fixed and computed here. The
 * payload mapping (title, headings, buttons, sample text, input count) lives in
 * `route-observation.ts`; a field it does not expose stays absent.
 */
export function readIdentityDocument(stdout: string): CaptureDocumentRead {
  const parsed = parseJsonObject(stdout);
  if (parsed === null) {
    return { ok: false, reason: 'the identity extract printed no JSON document' };
  }
  return { ok: true, document: readRenderedIdentity(parsed) };
}

/**
 * Read and decode the PNG the screenshot call wrote at its fixed path. A
 * missing file, an unreadable file, or a PNG shape the decoder refuses is a
 * value the probe blocks on — never a pass and never a throw.
 */
export async function measureCapture(
  outDir: string,
  readBytes: (path: string) => Promise<Uint8Array> = (path) => readFile(path)
): Promise<PaintMeasurement> {
  const pngPath = join(outDir, SCREENSHOT_RELATIVE_PATH);
  let bytes: Uint8Array;
  try {
    bytes = await readBytes(pngPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `the captured PNG could not be read (${detail})` };
  }
  const measured = measurePng(bytes);
  if (!measured.ok)
    return { ok: false, reason: `the captured PNG was refused: ${measured.reason}` };
  return { ok: true, metric: measured.metric };
}

export type CaptureIdentityInput = {
  url: string;
  /** The screenshot-free identity extract; injected so tests launch no browser. */
  runIdentity: (url: string) => Promise<DesignlangRunResult>;
  /** Defaults to `Date.now`; tests advance it to pin the measured elapsedMs. */
  now?: () => number;
};

export type CaptureScreenshotInput = {
  url: string;
  outDir: string;
  /** The screenshot-only extract; injected so tests launch no browser. */
  runScreenshot: (url: string, outDir: string) => Promise<DesignlangRunResult>;
  /** Defaults to the real file read; tests may replay bytes. */
  readBytes?: (path: string) => Promise<Uint8Array>;
  /** Defaults to `Date.now`; tests advance it to pin the measured elapsedMs. */
  now?: () => number;
};

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The screenshot-free extract, timed to the millisecond. Its JSON must be
 * readable before a paint is worth taking, and the route stage reads it.
 */
export async function captureIdentity(input: CaptureIdentityInput): Promise<IdentityProbeRead> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  let result: DesignlangRunResult;
  try {
    result = await input.runIdentity(input.url);
  } catch (error) {
    return {
      ok: false,
      cause: 'identity-failed',
      reason: `the identity extract threw before printing: ${errorText(error)}`,
      elapsedMs: now() - startedAt
    };
  }
  const elapsedMs = now() - startedAt;
  if (result.timedOut) {
    return {
      ok: false,
      cause: 'identity-timeout',
      reason: 'the identity extract timed out',
      elapsedMs
    };
  }
  const read = readIdentityDocument(result.stdout);
  if (!read.ok) {
    return {
      ok: false,
      cause: 'identity-failed',
      reason: `${read.reason} (identity extract exited ${String(result.exitCode)})`,
      elapsedMs
    };
  }
  return { ok: true, document: read.document, elapsedMs };
}

/**
 * The screenshot-only extract, then the fixed-path PNG decode; both timed. Run
 * only after the route stage found the page plausible, so the capture is paid
 * for a page that may actually be judged.
 */
export async function captureScreenshot(
  input: CaptureScreenshotInput
): Promise<ScreenshotProbeRead> {
  const now = input.now ?? Date.now;
  const startedAt = now();
  let result: DesignlangRunResult;
  try {
    result = await input.runScreenshot(input.url, input.outDir);
  } catch (error) {
    return {
      ok: false,
      cause: 'capture-failed',
      reason: `the viewport screenshot threw before writing: ${errorText(error)}`,
      elapsedMs: now() - startedAt
    };
  }
  const elapsedMs = now() - startedAt;
  if (result.timedOut) {
    return {
      ok: false,
      cause: 'capture-timeout',
      reason: 'the viewport screenshot timed out',
      elapsedMs
    };
  }
  const measured = await measureCapture(
    input.outDir,
    input.readBytes ?? ((path) => readFile(path))
  );
  if (!measured.ok) {
    return {
      ok: false,
      cause: 'capture-failed',
      reason: `${measured.reason} (screenshot exited ${String(result.exitCode)})`,
      elapsedMs
    };
  }
  return { ok: true, metric: measured.metric, elapsedMs };
}
