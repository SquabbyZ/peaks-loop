/**
 * The capture half of the page-usability probe: parse the JSON `designlang
 * extract` prints, read the PNG it wrote, and decode it into a paint metric.
 *
 * The measured capture vector (probed 2026-11-24, designlang 13.4.1, ~3.5 s):
 *
 *   node <designlang>/bin/design-extract.js <url> --json --screenshots \
 *     --no-history -o <dir> --quiet
 *
 * It writes `<dir>/screenshots/full-page.png` and reports that same relative
 * path as `componentScreenshots.fullPage.path`. Playwright writes 2560×1600
 * (a 1280×800 viewport at deviceScaleFactor 2), 8-bit RGB, non-interlaced.
 *
 * Route identity (bounded, and its exact limit is measured): the same document
 * DOES expose rendered text — `meta.title` and `voice.sampleHeadings` (the
 * text of headings inside semantic sections). The probe blocks when either one
 * starts with an explicitly listed unusable marker below. It is deliberately
 * not a general identity check: on the measured sign-in fixture the `<h1>` sits
 * inside a `<form>`, which designlang does not collect as a section, so
 * `voice.sampleHeadings` was empty and `meta.title` was the constant SPA title.
 * A page whose marker text is not in a section heading therefore carries no
 * identity signal, and none is invented for it.
 */
import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import { parseJsonObject } from './designlang-evidence.js';
import type { DesignlangRunResult } from './designlang.js';
import { isNearUniform, measurePng, type PaintMetric } from './paint-metric.js';
import { redactUrl } from './url-redact.js';

/** The one shape `designlang` writes; anything else is refused by the decoder. */
export type CaptureDocument = {
  /** The PNG path, relative to the capture out dir, as designlang reported it. */
  pngPath: string;
  /** `<title>` text, or null when the document did not carry one. */
  title: string | null;
  /** Rendered headings designlang collected from semantic sections. */
  headings: string[];
};

export type CaptureDocumentRead =
  { ok: true; document: CaptureDocument } | { ok: false; reason: string };

export type PaintProbeRead =
  { ok: true; metric: PaintMetric; document: CaptureDocument } | { ok: false; reason: string };

/**
 * Unusable-page markers, checked against the START of `<title>` and of each
 * rendered heading. Anchoring is deliberate: a docs heading like "How to
 * handle 404 errors" is real content, while "404 Not Found", "Sign in" and
 * "401 Unauthorized Access" are the states the pilot measured as unusable.
 */
export const UNUSABLE_PAGE_MARKERS: readonly {
  readonly label: string;
  readonly pattern: RegExp;
}[] = [
  { label: 'a sign-in heading', pattern: /^(sign|log)[\s-]?in\b/i },
  { label: 'a not-found heading', pattern: /^page not found\b/i },
  { label: 'a not-found heading', pattern: /^not found\b/i },
  { label: 'an HTTP error heading', pattern: /^(400|401|403|404|405|500|502|503)\b/ },
  { label: 'an access-denied heading', pattern: /^(unauthori[sz]ed|access denied|forbidden)\b/i }
];

/** The first marker the title or a heading starts with, or null. */
export function unusableMarker(
  title: string | null,
  headings: readonly string[]
): { label: string; text: string } | null {
  for (const candidate of [title, ...headings]) {
    if (candidate === null) continue;
    const text = candidate.trim().replace(/\s+/g, ' ');
    for (const marker of UNUSABLE_PAGE_MARKERS) {
      if (marker.pattern.test(text)) return { label: marker.label, text };
    }
  }
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function headingsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** A reported PNG path is relative and stays inside the capture out dir. */
function resolveInside(outDir: string, reported: string): string | null {
  if (reported.trim() === '' || isAbsolute(reported)) return null;
  const base = resolve(outDir);
  const full = resolve(base, reported);
  const inside = relative(base, full);
  if (inside === '' || inside.startsWith('..') || isAbsolute(inside)) return null;
  return full;
}

/** A plain-object view of an unknown JSON value; anything else is empty. */
function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

/** The `componentScreenshots.fullPage.path` string, or null when absent. */
function fullPagePath(parsed: Record<string, unknown>): string | null {
  return asString(recordOf(recordOf(parsed.componentScreenshots).fullPage).path);
}

/** Parse `designlang extract --json` stdout into the capture document it names. */
export function readCaptureDocument(stdout: string, outDir: string): CaptureDocumentRead {
  const parsed = parseJsonObject(stdout);
  if (parsed === null) return { ok: false, reason: 'the capture printed no JSON document' };
  const reported = fullPagePath(parsed);
  if (reported === null) {
    return { ok: false, reason: 'the capture JSON named no componentScreenshots.fullPage.path' };
  }
  const pngPath = resolveInside(outDir, reported);
  if (pngPath === null) {
    return { ok: false, reason: `the capture reported a path outside its out dir (${reported})` };
  }
  const meta = recordOf(parsed.meta);
  const voice = recordOf(parsed.voice);
  return {
    ok: true,
    document: {
      pngPath,
      title: asString(meta.title),
      headings: headingsOf(voice.sampleHeadings)
    }
  };
}

/**
 * Read and decode the PNG the capture named. A missing file, an unreadable
 * file, or a PNG shape the decoder refuses is a value the probe blocks on —
 * never a pass and never a throw.
 */
export async function measureCapture(
  stdout: string,
  outDir: string,
  readBytes: (path: string) => Promise<Uint8Array> = (path) => readFile(path)
): Promise<PaintProbeRead> {
  const read = readCaptureDocument(stdout, outDir);
  if (!read.ok) return read;
  let bytes: Uint8Array;
  try {
    bytes = await readBytes(read.document.pngPath);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `the captured PNG could not be read (${detail})` };
  }
  const measured = measurePng(bytes);
  if (!measured.ok)
    return { ok: false, reason: `the captured PNG was refused: ${measured.reason}` };
  return { ok: true, metric: measured.metric, document: read.document };
}

export type CapturePaintInput = {
  url: string;
  outDir: string;
  /** Spawns the probed capture vector; injected so no unit test launches a browser. */
  runCapture: (url: string, outDir: string) => Promise<DesignlangRunResult>;
  /** Defaults to the real file read; tests may replay bytes. */
  readBytes?: (path: string) => Promise<Uint8Array>;
};

/**
 * Run one capture and measure its PNG. A spawn throw, a timeout, a capture
 * that printed no JSON, a missing file, or an undecodable PNG is a refusal
 * value — the probe blocks on it and never turns it into a pass.
 */
export async function capturePaint(input: CapturePaintInput): Promise<PaintProbeRead> {
  let result: DesignlangRunResult;
  try {
    result = await input.runCapture(input.url, input.outDir);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `the viewport capture threw before printing: ${detail}` };
  }
  if (result.timedOut) return { ok: false, reason: 'the viewport capture timed out' };
  const measured = await measureCapture(
    result.stdout,
    input.outDir,
    input.readBytes ?? ((path) => readFile(path))
  );
  if (!measured.ok) {
    return { ok: false, reason: `${measured.reason} (capture exited ${String(result.exitCode)})` };
  }
  return measured;
}

/** The measured paint fields a block message carries, and never a score. */
export function describePaint(
  page: { readonly status: number | null; readonly finalUrl: string | null },
  metric: PaintMetric
): string {
  const status = page.status === null ? 'no response' : String(page.status);
  // A redirect's final URL is page-controlled and may carry userinfo.
  const finalUrl = page.finalUrl === null ? 'no response' : redactUrl(page.finalUrl);
  return `status ${status}, finalUrl ${finalUrl}, nonModalPct ${metric.nonModalPct.toFixed(2)}, quantisedColours ${String(metric.quantisedColours)}, luminanceStd ${metric.luminanceStd.toFixed(2)}`;
}

export type PaintPage = {
  status: number | null;
  finalUrl: string | null;
  pageTitle: string | null;
  pageHeadings: readonly string[];
  paint: PaintMetric;
};

/**
 * Why the capture makes this page unusable, or null when it may proceed.
 * The route-identity marker is checked first: a sign-in or error page can be
 * perfectly non-uniform and would otherwise pass the paint test.
 */
export function paintRefusal(page: PaintPage): string | null {
  const marker = unusableMarker(page.pageTitle, page.pageHeadings);
  if (marker !== null) {
    return (
      `it rendered ${marker.label} ("${marker.text}"), not the route under check ` +
      `(${describePaint(page, page.paint)})`
    );
  }
  if (isNearUniform(page.paint)) {
    return (
      'its viewport capture is near-uniform, so the page was blank or still hydrating ' +
      `(${describePaint(page, page.paint)})`
    );
  }
  return null;
}
