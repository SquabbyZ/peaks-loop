/**
 * The real page-usability probe, bound to one resolved engine.
 *
 * G2 and G3a share this gate, so the stats vector, the capture vector, the
 * per-session probe directory, and the "no entry path, no spawn" rule live in
 * one place. A null entry path is a failed run, never an empty `node ''` spawn;
 * the caller's own availability check normally blocks before this is reached.
 *
 * The capture writes under `<session>/design/probe/<url-slug>/`, so each page
 * keeps its own PNG instead of overwriting the previous page's evidence.
 */
import { lstatSync, mkdirSync, readdirSync, rmSync, type Dirent, type Stats } from 'node:fs';
import { dirname, join } from 'node:path';

import { getSessionDir, isSinglePathSegment } from '../session/getSessionDir.js';
import { isInsidePath, pathsEqual, stableRealPath } from '../../shared/path-utils.js';
import { buildDesignlangArgs, runDesignlang, type DesignlangRunResult } from './designlang.js';
import type { EngineAvailability } from './engine-status.js';
import { probePageUsable, type PageProbeResult } from './page-probe.js';
import { redactUrl } from './url-redact.js';

const NOT_AVAILABLE: DesignlangRunResult = {
  exitCode: -1,
  stdout: '',
  stderr: 'designlang is not available: its entry path did not resolve.',
  timedOut: false
};

/** The session G2/G3 fall back to when no `--session-id` is given. */
const LOCAL_SESSION = 'local';
/** Cap the URL-derived directory name so one long query cannot blow the path. */
const PROBE_SLUG_MAX = 80;
/** Probe dirs one URL slug keeps across sessions: the run writing now plus one. */
const KEEP_LATEST_PROBES = 2;
/** One cleanup scans and removes at most this much. */
const MAX_SCAN_SESSIONS = 64;
const MAX_PRUNE_REMOVALS = 32;

export type PageProbeContext = {
  availability: EngineAvailability;
  projectRoot: string;
  sessionId?: string;
};

/** A filesystem-safe directory name for one page URL; never empty. */
export function probeSlug(url: string): string {
  const slug = url
    .replace(/^[a-z]+:\/\//i, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, PROBE_SLUG_MAX) || 'page';
}

type ProbeDir = { ok: true; dir: string } | { ok: false };
type ProbeCandidate = { dir: string; mtimeMs: number };

/**
 * `<session>/design/probe/<url-slug>`, created before the capture runs. A
 * session id or filesystem that cannot name a dir is a refusal value, never a
 * `return null` and never a silent skip.
 */
function captureDir(context: PageProbeContext, url: string): ProbeDir {
  try {
    const dir = join(
      getSessionDir(context.projectRoot, context.sessionId ?? LOCAL_SESSION),
      'design',
      'probe',
      probeSlug(url)
    );
    mkdirSync(dir, { recursive: true });
    return { ok: true, dir };
  } catch {
    return { ok: false };
  }
}

type StatRead = { ok: true; stat: Stats } | { ok: false };

function safeLstat(path: string): StatRead {
  try {
    return { ok: true, stat: lstatSync(path) };
  } catch {
    return { ok: false };
  }
}

type RealPathRead = { ok: true; path: string } | { ok: false };

function realPathOf(path: string): RealPathRead {
  try {
    return { ok: true, path: stableRealPath(path) };
  } catch {
    return { ok: false };
  }
}

/** A real directory under one session's `design/probe` for this slug. */
type CandidateDir = { probeRoot: string; dir: string; mtimeMs: number };

function candidateDir(runtimeRoot: string, entryName: string, slug: string): CandidateDir | null {
  const probeRoot = join(runtimeRoot, entryName, 'design', 'probe');
  const dir = join(probeRoot, slug);
  const read = safeLstat(dir);
  if (!read.ok || !read.stat.isDirectory() || read.stat.isSymbolicLink()) return null;
  return { probeRoot, dir, mtimeMs: read.stat.mtimeMs };
}

/**
 * The ancestor + leaf checks that keep a removal inside the runtime root. The
 * LEAF being a real directory is not enough — a junction higher up (the probe
 * root itself) would make the recursive remove escape, so the resolved capture
 * must be a direct child of that session's real probe root and stay inside the
 * runtime root. The directory this run is writing is never a candidate.
 */
function staysInRuntime(
  realRuntime: string,
  realKeep: string | null,
  candidate: CandidateDir
): boolean {
  const realProbeRoot = realPathOf(candidate.probeRoot);
  const realCandidate = realPathOf(candidate.dir);
  if (!realProbeRoot.ok || !realCandidate.ok) return false;
  if (realKeep !== null && pathsEqual(realCandidate.path, realKeep)) return false;
  if (!pathsEqual(dirname(realCandidate.path), realProbeRoot.path)) return false;
  return isInsidePath(realCandidate.path, realRuntime);
}

/** Everything under `_runtime` for one URL slug, minus the run writing now. */
function staleCandidates(runtimeRoot: string, slug: string, keepDir: string): ProbeCandidate[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(runtimeRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const realRuntime = realPathOf(runtimeRoot);
  const realKeep = realPathOf(keepDir);
  if (!realRuntime.ok) return [];
  const candidates: ProbeCandidate[] = [];
  for (const entry of entries.slice(0, MAX_SCAN_SESSIONS)) {
    if (!entry.isDirectory() || !isSinglePathSegment(entry.name)) continue;
    const candidate = candidateDir(runtimeRoot, entry.name, slug);
    if (candidate === null) continue;
    if (!staysInRuntime(realRuntime.path, realKeep.ok ? realKeep.path : null, candidate)) continue;
    candidates.push({ dir: candidate.dir, mtimeMs: candidate.mtimeMs });
  }
  return candidates;
}

/** What one cleanup did; `failed` is a count, never a swallowed error. */
export type PruneOutcome = { removed: string[]; failed: number };

/**
 * Keep the most recent `keep` probe directories for one URL slug and remove
 * older ones, so repeated gated runs do not grow `_runtime` without bound.
 * Every candidate is resolved and checked to be exactly
 * `<runtime>/<session>/design/probe/<slug>` before removal, the directory this
 * run is writing is never touched, and a filesystem error removes nothing.
 */
export function pruneStaleProbes(
  sessionDir: string,
  url: string,
  keepDir: string,
  keep: number = KEEP_LATEST_PROBES
): PruneOutcome {
  const candidates = staleCandidates(dirname(sessionDir), probeSlug(url), keepDir);
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  const outcome: PruneOutcome = { removed: [], failed: 0 };
  for (const candidate of candidates.slice(Math.max(keep - 1, 0))) {
    if (outcome.removed.length + outcome.failed >= MAX_PRUNE_REMOVALS) break;
    try {
      rmSync(candidate.dir, { recursive: true, force: true });
      outcome.removed.push(candidate.dir);
    } catch {
      // Counted, not hidden: a probe never fails because old evidence could not go.
      outcome.failed += 1;
    }
  }
  return outcome;
}

/** The probe for one engine; each call runs stats, then the screenshot capture. */
export function buildPageProbe(
  context: PageProbeContext
): (url: string) => Promise<PageProbeResult> {
  const entryPath = context.availability.entryPath;
  const sessionDir = (): string =>
    getSessionDir(context.projectRoot, context.sessionId ?? LOCAL_SESSION);
  const run = (args: readonly string[]): Promise<DesignlangRunResult> => {
    if (entryPath === null) return Promise.resolve({ ...NOT_AVAILABLE });
    return runDesignlang({ entryPath, args });
  };
  return (url) => {
    const target = captureDir(context, url);
    if (!target.ok) {
      return Promise.resolve<PageProbeResult>({
        ok: false,
        code: 'DESIGN_PAGE_UNUSABLE',
        message: `The page ${redactUrl(url)} cannot be judged: the probe capture directory could not be resolved.`
      });
    }
    // Disk hygiene, not evidence: each gated run writes one full-page capture
    // under the gitignored runtime root, so the older sessions' copies for this
    // slug go before the new one is written. Failure to prune never blocks; the
    // outcome rides on the result so the caller can record what happened.
    const pruned = pruneStaleProbes(sessionDir(), url, target.dir);
    const runCapture = (page: string, outDir: string): Promise<DesignlangRunResult> =>
      run(buildDesignlangArgs({ kind: 'extract', url: page, outDir }));
    return probePageUsable({
      url,
      outDir: target.dir,
      runStats: (page) => run(buildDesignlangArgs({ kind: 'stats', url: page })),
      runCapture
    }).then((result) => (result.ok ? { ...result, pruned } : result));
  };
}

/**
 * The G3a variant: an unavailable engine blocks with its own code, so the
 * report says "designlang is missing", not "the page is blank".
 */
export function buildGatedPageProbe(
  context: PageProbeContext
): (url: string) => Promise<PageProbeResult> {
  if (context.availability.available) return buildPageProbe(context);
  const codes = context.availability.codes.join(', ') || 'DESIGN_ENGINE_UNAVAILABLE';
  return () =>
    Promise.resolve({
      ok: false,
      code: 'DESIGN_ENGINE_UNAVAILABLE',
      message: `designlang is unavailable (${codes}); the page-usability probe cannot run.`
    });
}
