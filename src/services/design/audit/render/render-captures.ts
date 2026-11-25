/**
 * The `--render <dir>` reader (S8 close-out A).
 *
 * The directory holds the page probe's capture layout: one directory per
 * `probeSlug(url)`, each with `screenshots/full-page.png` (the fixed path the
 * screenshot call always writes) or a bare `full-page.png`. This module is the
 * only place under `audit/render/` that touches the filesystem, and it exists
 * because the render path was otherwise unreachable from `peaks design audit`.
 *
 * THREE BOUNDS, each reported instead of silent:
 *   - CONTAINMENT. A relative `--render` must resolve inside the app root; an
 *     absolute one is an explicit choice and may sit elsewhere (the pilot's
 *     evidence lives under `.peaks/_runtime`). EVERY capture file is resolved
 *     with `stableRealPath` and must land inside that resolved root, so a
 *     symlink or NTFS junction inside the directory cannot read outside it.
 *   - FRAMES. At most `MAX_RENDER_FRAMES` captures are READ and decoded; the
 *     remainder are counted from metadata, never loaded, and named in the
 *     report's read gap.
 *   - BYTES. A capture file past `MAX_RENDER_CAPTURE_BYTES` is skipped by name;
 *     the PNG decoder's own pixel cap still applies downstream.
 *
 * A capture is bound to a page by `captureMatchesRoute`: the page's derived
 * route is slugged with the probe's own `probeSlug`, and the capture directory
 * must equal it or end with `-<slug>` (the directory normally carries the
 * host:port prefix). A page with no capture has no render row, never a zero.
 */

/* eslint-disable no-magic-numbers -- the frame and byte bounds are stated caps. */

import { readdirSync, readFileSync, statSync, type Dirent } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import { isInsidePath, normalizePath, stableRealPath } from '../../../../shared/path-utils.js';
import { probeSlug } from '../../page-probe-deps.js';
import type { RenderCapture } from './render-audit.js';

/** At most this many captures are decoded per audit. */
export const MAX_RENDER_FRAMES = 32;
/** One capture larger than this is skipped instead of loaded. */
export const MAX_RENDER_CAPTURE_BYTES = 64 * 1024 * 1024;
/** The two layouts a probe directory may use; the first wins. */
const CAPTURE_LAYOUTS = [['screenshots', 'full-page.png'], ['full-page.png']] as const;

export type RenderDirErrorCode =
  'DESIGN_AUDIT_RENDER_UNAVAILABLE' | 'DESIGN_AUDIT_RENDER_ESCAPE' | 'DESIGN_AUDIT_RENDER_EMPTY';

export type RenderDirRead =
  | {
      ok: true;
      captures: RenderCapture[];
      found: number;
      skipped: string[];
      truncated: boolean;
    }
  | { ok: false; code: RenderDirErrorCode; message: string };

/**
 * True when one capture directory is the probe slug of `route`. `/about` →
 * `about`; a directory `127-0-0-1-7421-about` ends with `-about`. The root
 * route slugs to `page`, so a host-only directory (`localhost-7421`, no route
 * tail) is the root capture.
 */
export function captureMatchesRoute(slug: string, route: string): boolean {
  const target = probeSlug(route);
  if (slug === target) return true;
  if (slug.endsWith(`-${target}`)) return true;
  // The root route slugs to `page`; a host[:port] directory ends with `-<port>`.
  return target === 'page' && /-[0-9]{2,5}$/.test(slug);
}

/** The first existing regular file of the probe layout, or null. */
function captureFile(root: string, slug: string): string | null {
  for (const layout of CAPTURE_LAYOUTS) {
    const candidate = join(root, slug, ...layout);
    try {
      const stat = statSync(candidate);
      if (stat.isFile()) return candidate;
    } catch {
      // Try the next layout; a missing file is not an error on its own.
      continue;
    }
  }
  return null;
}

/**
 * Resolve one capture file: it must be a regular file whose REAL path stays
 * inside the already-resolved render root. A link that escapes is a named
 * refusal, never a read.
 */
function insideCapture(
  root: string,
  file: string
): { ok: true; real: string } | { ok: false; code: RenderDirErrorCode; message: string } {
  let real: string;
  try {
    real = stableRealPath(file);
  } catch {
    return {
      ok: false,
      code: 'DESIGN_AUDIT_RENDER_UNAVAILABLE',
      message: `The capture ${file} could not be resolved.`
    };
  }
  if (!isInsidePath(real, root)) {
    return {
      ok: false,
      code: 'DESIGN_AUDIT_RENDER_ESCAPE',
      message: `The capture ${file} resolves outside the render directory (${real}); a symlink or junction refuses rather than reads.`
    };
  }
  return { ok: true, real };
}

type CaptureLoad =
  | { kind: 'capture'; capture: RenderCapture }
  | { kind: 'skip'; note: string }
  | { kind: 'error'; code: RenderDirErrorCode; message: string };

type Located = { file: string; capture: string; slug: string };
type LocateLoad =
  | { kind: 'located'; located: Located }
  | { kind: 'skip'; note: string }
  | { kind: 'error'; code: RenderDirErrorCode; message: string };

/**
 * Locate one slug directory's capture from METADATA only — no bytes are read,
 * so the frame bound can be applied before any capture is loaded. The link
 * check comes FIRST: a junction Dirent reports `isDirectory() === false`, so a
 * directory-then-link order would skip it with an empty note and the named
 * reason would never print.
 */
function locateCapture(root: string, entry: Dirent): LocateLoad {
  if (entry.isSymbolicLink()) {
    return { kind: 'skip', note: `${entry.name} (directory link not followed)` };
  }
  if (!entry.isDirectory()) return { kind: 'skip', note: '' };
  const file = captureFile(root, entry.name);
  if (file === null) return { kind: 'skip', note: '' };
  const inside = insideCapture(root, file);
  if (!inside.ok) return { kind: 'error', code: inside.code, message: inside.message };
  let size = 0;
  try {
    size = statSync(inside.real).size;
  } catch {
    return { kind: 'skip', note: `${entry.name} (capture vanished before it was read)` };
  }
  if (size > MAX_RENDER_CAPTURE_BYTES) {
    return {
      kind: 'skip',
      note: `${entry.name} (${size} bytes exceeds the ${MAX_RENDER_CAPTURE_BYTES}-byte cap)`
    };
  }
  return {
    kind: 'located',
    located: {
      file: inside.real,
      capture: normalizePath(relative(root, inside.real)),
      slug: entry.name
    }
  };
}

/** Read one already-validated capture; a read failure is a named skip. */
function readCapture(located: Located): CaptureLoad {
  try {
    return {
      kind: 'capture',
      capture: {
        png: readFileSync(located.file),
        capture: located.capture,
        slug: located.slug
      }
    };
  } catch {
    return { kind: 'skip', note: `${located.slug} (capture could not be read)` };
  }
}

type ScanRead =
  | { ok: true; captures: RenderCapture[]; found: number; skipped: string[]; truncated: boolean }
  | { ok: false; code: RenderDirErrorCode; message: string };

/** Every capture directly under `root`, bounded and sorted by slug. */
function scanCaptures(root: string, maxFrames: number): ScanRead {
  let entries: Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return {
      ok: false,
      code: 'DESIGN_AUDIT_RENDER_UNAVAILABLE',
      message: `The render directory ${root} could not be listed.`
    };
  }
  const skipped: string[] = [];
  const located: Located[] = [];
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    const found = locateCapture(root, entry);
    if (found.kind === 'error') {
      return { ok: false, code: found.code, message: found.message };
    }
    if (found.kind === 'skip') {
      if (found.note !== '') skipped.push(found.note);
      continue;
    }
    located.push(found.located);
  }
  // The frame bound is a READ bound, not just a decode bound: a capture past
  // `maxFrames` is counted but its bytes are never loaded.
  const captures: RenderCapture[] = [];
  for (const keep of located.slice(0, maxFrames)) {
    const loaded = readCapture(keep);
    if (loaded.kind === 'capture') captures.push(loaded.capture);
    else if (loaded.kind === 'skip' && loaded.note !== '') skipped.push(loaded.note);
  }
  return {
    ok: true,
    captures,
    found: located.length,
    skipped,
    truncated: located.length > maxFrames
  };
}

/** Resolve `--render` against the app root; a relative path may not escape it. */
function resolveRenderRoot(
  dir: string,
  appRoot: string
): { ok: true; root: string } | { ok: false; code: RenderDirErrorCode; message: string } {
  const requested = isAbsolute(dir) ? resolve(dir) : resolve(appRoot, dir);
  try {
    const root = stableRealPath(requested);
    const appRootReal = stableRealPath(resolve(appRoot));
    if (!isAbsolute(dir) && !isInsidePath(root, appRootReal)) {
      return {
        ok: false,
        code: 'DESIGN_AUDIT_RENDER_ESCAPE',
        message: `The relative render directory ${dir} resolves outside the app root (${root}); pass an absolute path to choose it explicitly.`
      };
    }
    return { ok: true, root };
  } catch {
    return {
      ok: false,
      code: 'DESIGN_AUDIT_RENDER_UNAVAILABLE',
      message: `The render directory ${requested} does not exist or cannot be resolved.`
    };
  }
}

/** Read the capture directory; a refusal is a named value, never a throw. */
export function readRenderDir(input: {
  dir: string;
  appRoot: string;
  maxFrames?: number;
}): RenderDirRead {
  const rootRead = resolveRenderRoot(input.dir, input.appRoot);
  if (!rootRead.ok) return rootRead;
  const scanned = scanCaptures(rootRead.root, input.maxFrames ?? MAX_RENDER_FRAMES);
  if (!scanned.ok) return scanned;
  if (scanned.captures.length === 0) {
    return {
      ok: false,
      code: 'DESIGN_AUDIT_RENDER_EMPTY',
      message: `No page capture was found under ${rootRead.root} (expected <probe-slug>/screenshots/full-page.png).`
    };
  }
  return scanned;
}
