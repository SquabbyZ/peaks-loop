import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isDirectory, pathExists } from 'peaks-loop-shared/fs';

import { isPathInsideArtifactRoot } from '../../shared/path-safety.js';
import type {
  MigrateFilePlan,
  MigrateOptions,
  MigrateResult,
  MigrateSessionPlan,
  MigrateToRuntimeFilePlan
} from './migrate-types.js';

const ROLE_DIRS = new Set(['prd', 'ui', 'rd', 'qa', 'sc', 'system']);

/** Top-level dirs in `.peaks/` that are NEVER legacy session dirs
 * (regardless of mtime/name) and must be skipped by the migration scan. */
const PROTECTED_TOP_LEVEL_DIRS = new Set([
  '_runtime',
  'retrospective',
  '_dogfood',
  'memory',
  'sops',
  'project-scan',
  'perf-baseline',
]);

/** Files inside a session dir that are transient runtime state, not reviewable. */
const TRANSIENT_FILES = new Set(['session.json']);

/** Per-role subdir inside a change-id dir (mirrors the canonical layout). */
function dirToRole(subdir: string): MigrateFilePlan['role'] {
  if (subdir === 'prd' || subdir === 'ui' || subdir === 'rd' || subdir === 'qa' || subdir === 'sc') {
    return subdir;
  }
  if (subdir === 'system') {
    return 'system';
  }
  return 'unknown';
}

/**
 * Tier 1 — filename regex: REQUIRES a 1-3 digit number prefix.
 * 4-digit year prefixes (e.g. `2026-...`) are part of the change-id,
 * NOT a sequence number, so they don't trigger tier 1.
 *
 * `001-2026-05-29-custom-sop-gate-metering.md`  →  `2026-05-29-custom-sop-gate-metering`
 * `2026-05-29-default-session.md`               →  null  (4-digit prefix; fall through to H1 / frontmatter)
 * `tech-doc.md`                                →  null  (no number prefix; fall through)
 */
const FILENAME_CHANGE_ID_RE = /^\d{1,3}-([A-Za-z0-9][A-Za-z0-9._-]*)\.md$/;

/** Tier 2 — content H1: `# Tech Doc: <change-id>`, `# Code Review <change-id>`,
 * `# QA Security Findings: <change-id>`, `# Project Scan: <name>`, etc.
 * The exact prefix varies by file role and the slice's life stage, so
 * we match "H1 ends with `: <something>`" OR "H1 starts with a known
 * role prefix and ends with an identifier".
 */
const H1_CHANGE_ID_PATTERNS: Array<{ test: (h1: string) => boolean; extract: (h1: string) => string | null }> = [
  // "# Tech Doc: <change-id>" / "# Tech Doc — RD <change-id>"
  { test: (h) => /^#\s*Tech\s*Doc[\s:—–-]+(?:RD\s+)?(.+)$/i.test(h), extract: (h) => /^#\s*Tech\s*Doc[\s:—–-]+(?:RD\s+)?(.+)$/i.exec(h)?.[1]?.trim() ?? null },
  // "# Code Review <change-id>"
  { test: (h) => /^#\s*Code\s+Review\s+(.+)$/i.test(h), extract: (h) => /^#\s*Code\s+Review\s+(.+)$/i.exec(h)?.[1]?.trim() ?? null },
  // "# Security Review <change-id>" / "# Security Review: <change-id>"
  { test: (h) => /^#\s*Security\s+Review[\s:—–-]+(.+)$/i.test(h), extract: (h) => /^#\s*Security\s+Review[\s:—–-]+(.+)$/i.exec(h)?.[1]?.trim() ?? null },
  // "# Bug Analysis: <change-id>" / "# Bug Analysis — <change-id>"
  { test: (h) => /^#\s*Bug\s+Analysis[\s:—–-]+(.+)$/i.test(h), extract: (h) => /^#\s*Bug\s+Analysis[\s:—–-]+(.+)$/i.exec(h)?.[1]?.trim() ?? null },
  // "# Performance Baseline" / "# Perf Baseline" / "# Perf Baseline: <slice>"
  //   → cross-cutting, NOT a per-slice change-id (return null)
  { test: (h) => /^#\s*(?:Performance|Perf)\s+Baseline(?:\s*:.*)?$/i.test(h), extract: () => null },
  // "# Project Scan: <name>" → cross-cutting, returns the name but caller treats as cross-cutting
  { test: (h) => /^#\s*Project\s+Scan(?:\s*:.*)?$/i.test(h), extract: () => null },
  // "# Handoff: <slice>" / "# Handoff — RD <slice>"
  { test: (h) => /^#\s*Handoff[\s:—–-]+(?:RD\s+)?(.+)$/i.test(h), extract: (h) => /^#\s*Handoff[\s:—–-]+(?:RD\s+)?(.+)$/i.exec(h)?.[1]?.trim() ?? null },
  // "# Test Cases: <slice>" / "# Test Report: <slice>" / "# Security Findings: <slice>"
  { test: (h) => /^#\s*(?:Test\s+Cases|Test\s+Report|Security\s+Findings)[\s:—–-]+(.+)$/i.test(h), extract: (h) => /^#\s*(?:Test\s+Cases|Test\s+Report|Security\s+Findings)[\s:—–-]+(.+)$/i.exec(h)?.[1]?.trim() ?? null },
  // "# PRD Request <change-id>" / "# PRD Request: <change-id>" (legacy request artifact H1)
  { test: (h) => /^#\s*PRD\s+Request[\s:—–-]+(.+)$/i.test(h), extract: (h) => /^#\s*PRD\s+Request[\s:—–-]+(.+)$/i.exec(h)?.[1]?.trim() ?? null },
  // "# RD Request <change-id>" / "# RD Request: <change-id>" (legacy RD request artifact H1)
  { test: (h) => /^#\s*RD\s+Request[\s:—–-]+(.+)$/i.test(h), extract: (h) => /^#\s*RD\s+Request[\s:—–-]+(.+)$/i.exec(h)?.[1]?.trim() ?? null },
  // "# QA Request <change-id>" / "# QA Request: <change-id>"
  { test: (h) => /^#\s*QA\s+Request[\s:—–-]+(.+)$/i.test(h), extract: (h) => /^#\s*QA\s+Request[\s:—–-]+(.+)$/i.exec(h)?.[1]?.trim() ?? null },
  // "# UI Request <change-id>" / "# SC Request <change-id>"
  { test: (h) => /^#\s*(?:UI|SC)\s+Request[\s:—–-]+(.+)$/i.test(h), extract: (h) => /^#\s*(?:UI|SC)\s+Request[\s:—–-]+(.+)$/i.exec(h)?.[1]?.trim() ?? null },
];

/** Tier 3 — body frontmatter: `- rid: <change-id>` OR `- linked-rd: .peaks/_runtime/<sid>/<role>/<num>-<change-id>.md`
 * The legacy request artifact template writes `- rid:` and the linked-* lines.
 */
const FRONTMATTER_RID_RE = /^-\s*rid\s*:\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*$/m;
const FRONTMATTER_LINKED_RE = /-\s*linked-(?:prd|rd|qa|sc|ui)\s*:\s*\.peaks\/[^/]+\/[^/]+\/\d+[-/]([A-Za-z0-9][A-Za-z0-9._-]*)\.md/m;

interface ParsedFile {
  /** The role inferred from the directory layout. */
  role: MigrateFilePlan['role'];
  /** The relative path within the session dir, e.g. `rd/requests/001-...md`. */
  relativePath: string;
  /** Absolute source path. */
  absPath: string;
  /** Markdown content if the file was read; null if not applicable. */
  content: string | null;
}

async function collectFiles(sessionPath: string): Promise<ParsedFile[]> {
  const out: ParsedFile[] = [];
  const roleDirs = await readdir(sessionPath, { withFileTypes: true });
  for (const roleEntry of roleDirs) {
    if (!roleEntry.isDirectory()) continue;
    const role = dirToRole(roleEntry.name);
    if (role === 'unknown') continue;
    const rolePath = join(sessionPath, roleEntry.name);
    await collectFilesRecursive(rolePath, role, roleEntry.name, out);
  }
  return out;
}

async function collectFilesRecursive(
  basePath: string,
  role: MigrateFilePlan['role'],
  relativeBase: string,
  out: ParsedFile[]
): Promise<void> {
  const entries = await readdir(basePath, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(basePath, entry.name);
    const rel = `${relativeBase}/${entry.name}`;
    if (entry.isDirectory()) {
      await collectFilesRecursive(abs, role, rel, out);
    } else if (entry.isFile()) {
      // Read all files (not just .md/.json) so that JSON `system/`
      // files get their content checked for change-id metadata too.
      // Reading is cheap and we already do try/catch.
      let content: string | null = null;
      try {
        content = await readFile(abs, 'utf8');
      } catch {
        content = null;
      }
      out.push({ role, relativePath: rel, absPath: abs, content });
    }
  }
}

interface ExtractedChangeId {
  sessionId: string;
  source: Exclude<MigrateFilePlan['source'], 'cross-cutting' | null>;
}

/** Try the 4 tiers in order and return the first non-null result. */
function extractChangeId(
  fileName: string,
  content: string | null,
  fallbackChangeId: string | null
): ExtractedChangeId | null {
  // Slice 2026-06-29-change-id-root-removal: `validateChangeIdOrThrow`
  // was removed with the change-id axis. The structural regex check
  // it ran against the matched identifier is no longer enforced at
  // this site — callers accept any identifier shape that the tier-1
  // regex / tier-2 H1 match / tier-3 frontmatter match produces. The
  // request-artifact content validation in `request-artifact-service`
  // still applies its own `REQUEST_ID_PATTERN` for *new* request files.
  // Tier 1: filename regex
  const baseName = fileName;
  const m = FILENAME_CHANGE_ID_RE.exec(baseName);
  if (m && m[1] && m[1].length > 0) {
    return { sessionId: m[1], source: 'filename-regex' };
  }

  // Tier 2: content H1
  if (content !== null) {
    const h1Match = content.split(/\r?\n/, 1)[0] ?? '';
    for (const { test, extract } of H1_CHANGE_ID_PATTERNS) {
      if (test(h1Match)) {
        const cid = extract(h1Match);
        if (cid !== null) {
          return { sessionId: cid, source: 'content-h1' };
        }
      }
    }
  }

  // Tier 3: body frontmatter
  if (content !== null) {
    const ridMatch = FRONTMATTER_RID_RE.exec(content);
    if (ridMatch && ridMatch[1]) {
      return { sessionId: ridMatch[1], source: 'content-frontmatter' };
    }
    const linkedMatch = FRONTMATTER_LINKED_RE.exec(content);
    if (linkedMatch && linkedMatch[1]) {
      return { sessionId: linkedMatch[1], source: 'content-frontmatter' };
    }
  }

  // Tier 4: per-session fallback (most recent change-id from rd/requests/)
  if (fallbackChangeId !== null) {
    return { sessionId: fallbackChangeId, source: 'session-fallback' };
  }

  return null;
}

/** Per-session fallback: read every file under `<session>/rd/requests/` and
 * pick the most-recent (by filename lexicographic order, which puts newer
 * 3-digit prefixes later) and extract its change-id. If the session has
 * no rd/requests/ at all, returns null. */
async function deriveFallbackChangeId(sessionPath: string): Promise<string | null> {
  const requestsPath = join(sessionPath, 'rd', 'requests');
  if (!(await pathExists(requestsPath))) return null;
  const files = await readdir(requestsPath, { withFileTypes: true });
  const requestFiles = files
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort()
    .reverse(); // most-recent first
  for (const fileName of requestFiles) {
    const content = await readFile(join(requestsPath, fileName), 'utf8').catch(() => null);
    const extracted = extractChangeId(fileName, content, null);
    if (extracted !== null) return extracted.sessionId;
  }
  return null;
}

function isCrossCuttingFile(relativePath: string): boolean {
  // `rd/project-scan.md` and `rd/perf-baseline.md` (and the `rd/perf baseline.md`
  // variant with a space — observed in some downstream trees) are
  // cross-cutting artifacts. They belong at the TOP of `.peaks/`
  // (e.g. `.peaks/project-scan/rd/project-scan.md`), not under
  // retrospective/. They never carry a per-slice change-id.
  if (relativePath === 'rd/project-scan.md') return true;
  if (relativePath === 'rd/perf-baseline.md') return true;
  if (relativePath === 'rd/perf baseline.md') return true;
  return false;
}

/** Map a cross-cutting file's relative path to its dedicated top-level
 * dir name (the change-id field for cross-cutting routing). */
function deriveCrossCuttingDirName(relativePath: string): string {
  if (relativePath === 'rd/project-scan.md') return 'project-scan';
  if (relativePath === 'rd/perf-baseline.md') return 'perf-baseline';
  if (relativePath === 'rd/perf baseline.md') return 'perf-baseline';
  return 'unknown-cross-cutting';
}

function isTransientRuntimeFile(relativePath: string): boolean {
  if (relativePath === 'session.json') return true;
  if (relativePath === '.gitkeep') return true;
  return false;
}

async function planSession(
  sessionId: string,
  sessionPath: string,
  peaksRoot: string
): Promise<MigrateSessionPlan> {
  const fallback = await deriveFallbackChangeId(sessionPath);
  const files = await collectFiles(sessionPath);
  const plans: MigrateFilePlan[] = [];
  let empty = true;

  for (const f of files) {
    if (isTransientRuntimeFile(f.relativePath)) {
      plans.push({
        from: f.absPath,
        to: f.absPath, // no move
        sessionId,
        targetSessionId: '',
        role: f.role,
        relativePath: f.relativePath,
        source: null,
        skipped: true,
        skipReason: 'transient-runtime'
      });
      continue;
    }

    if (isCrossCuttingFile(f.relativePath)) {
      // Cross-cutting files (rd/project-scan.md, rd/perf-baseline.md) belong
      // at the TOP level of `.peaks/` (e.g. `.peaks/project-scan/rd/project-scan.md`).
      // They are single artifacts that span every slice, not tied to any
      // session-id. Move them to their dedicated top-level dir as part of the
      // same migration pass.
      const crossCuttingDir = deriveCrossCuttingDirName(f.relativePath);
      const to = join(peaksRoot, crossCuttingDir, f.relativePath);
      empty = false;
      plans.push({
        from: f.absPath,
        to,
        sessionId,
        targetSessionId: crossCuttingDir, // the top-level dir name acts as the target session-id
        role: f.role,
        relativePath: f.relativePath,
        source: 'cross-cutting'
      });
      continue;
    }

    if (f.role === 'system') {
      plans.push({
        from: f.absPath,
        to: f.absPath,
        sessionId,
        targetSessionId: '',
        role: 'system',
        relativePath: f.relativePath,
        source: null,
        skipped: true,
        skipReason: 'transient-runtime'
      });
      continue;
    }

    if (f.role === 'unknown') {
      plans.push({
        from: f.absPath,
        to: f.absPath,
        sessionId,
        targetSessionId: '',
        role: 'unknown',
        relativePath: f.relativePath,
        source: null,
        skipped: true,
        skipReason: 'unsupported-role'
      });
      continue;
    }

    const extracted = extractChangeId(f.relativePath.split('/').pop() ?? '', f.content, fallback);
    if (extracted === null) {
      plans.push({
        from: f.absPath,
        to: f.absPath,
        sessionId,
        targetSessionId: '',
        role: f.role,
        relativePath: f.relativePath,
        source: null,
        skipped: true,
        skipReason: 'no-change-id'
      });
      continue;
    }

    empty = false;
    const to = join(peaksRoot, 'retrospective', extracted.sessionId, f.relativePath);
    plans.push({
      from: f.absPath,
      to,
      sessionId,
      targetSessionId: extracted.sessionId,
      role: f.role,
      relativePath: f.relativePath,
      source: extracted.source
    });
  }

  return { sessionId, path: sessionPath, empty: empty && plans.every((p) => p.skipped), files: plans, fallbackChangeId: fallback };
}

/**
 * Slice 003 (2026-06-06-session-layout-canonicalize): one-shot
 * consolidation of every top-level `.peaks/_runtime/<sid>/` into
 * `.peaks/_runtime/<sid>/`. Idempotent:
 *
 *   - If `.peaks/_runtime/<sid>/` does not exist → `fs.rename` the
 *     top-level dir to the runtime location.
 *   - If `.peaks/_runtime/<sid>/` already exists with the same
 *     content → no-op, reported as `skipped-already-canonical`.
 *   - If `.peaks/_runtime/<sid>/` already exists with different
 *     content → log a conflict, do NOT overwrite.
 *   - **F15 carve-out**: if `<sid>/rd/project-scan.md` differs from
 *     the runtime copy already in place, log a
 *     `f15-conflict-project-scan` and leave the file in place.
 *
 * Path-traversal is impossible because the target is always
 * `peaks/_runtime/<sid>/` and the directory listing only returns
 * names matching the session-id regex.
 */
async function migrateToRuntime(
  projectRoot: string,
  peaksRoot: string,
  apply: boolean
): Promise<{
  plans: MigrateToRuntimeFilePlan[];
  moved: string[];
  skipped: string[];
  conflicts: Array<{ from: string; to: string; reason: string }>;
}> {
  void projectRoot;
  const plans: MigrateToRuntimeFilePlan[] = [];
  const moved: string[] = [];
  const skipped: string[] = [];
  const conflicts: Array<{ from: string; to: string; reason: string }> = [];

  const runtimeRoot = join(peaksRoot, '_runtime');
  let topLevelEntries: import('node:fs').Dirent[];
  try {
    topLevelEntries = await readdir(peaksRoot, { withFileTypes: true });
  } catch {
    return { plans, moved, skipped, conflicts };
  }

  for (const entry of topLevelEntries) {
    if (!entry.isDirectory()) continue;
    if (PROTECTED_TOP_LEVEL_DIRS.has(entry.name)) continue;
    if (!/^\d{4}-\d{2}-\d{2}-session-/.test(entry.name)) continue;

    const sessionId = entry.name;
    const fromPath = join(peaksRoot, sessionId);
    const toPath = join(runtimeRoot, sessionId);

    if (await isDirectory(toPath)) {
      // F15 carve-out check
      const fromScan = join(fromPath, 'rd', 'project-scan.md');
      const toScan = join(toPath, 'rd', 'project-scan.md');
      if (await pathExists(fromScan) && await pathExists(toScan)) {
        const fromContent = await readFile(fromScan, 'utf8').catch(() => null);
        const toContent = await readFile(toScan, 'utf8').catch(() => null);
        if (fromContent !== null && toContent !== null && fromContent !== toContent) {
          plans.push({
            from: fromPath,
            to: toPath,
            sessionId,
            action: 'f15-conflict-project-scan',
            reason: 'F15 carve-out: top-level rd/project-scan.md differs from runtime copy; left in place.'
          });
          conflicts.push({
            from: fromScan,
            to: toScan,
            reason: 'f15-conflict-project-scan'
          });
          continue;
        }
      }
      plans.push({
        from: fromPath,
        to: toPath,
        sessionId,
        action: 'skipped-already-canonical',
        reason: 'target _runtime/<sid>/ already exists'
      });
      skipped.push(sessionId);
      continue;
    }

    plans.push({
      from: fromPath,
      to: toPath,
      sessionId,
      action: 'moved',
      reason: 'top-level session dir will be moved to _runtime/'
    });
    if (apply) {
      try {
        await mkdir(runtimeRoot, { recursive: true });
        await rename(fromPath, toPath);
        moved.push(sessionId);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        conflicts.push({
          from: fromPath,
          to: toPath,
          reason: `rename failed: ${msg}`
        });
      }
    }
  }

  return { plans, moved, skipped, conflicts };
}

async function gitMv(from: string, to: string, projectRoot: string): Promise<void> {
  const parentDir = join(to, '..');
  await mkdir(parentDir, { recursive: true });
  // Prefer plain fs.rename: it works regardless of git state, including
  // for untracked files (which is the common case during a migrate).
  // For tracked files in a real git repo, `git mv` would record the
  // rename, but `git status` will still pick up the rename correctly
  // because git auto-detects content-hash-matched renames at add time.
  // Plain rename is sufficient for the migrate use case.
  const { rename } = await import('node:fs/promises');
  try {
    await rename(from, to);
  } catch (error) {
    // Last-resort: try git mv with the project's git cwd. The git
    // command must be run from inside the project so it can locate
    // .git/ (the migrate target may be a temp dir created by tests).
    try {
      execFileSync('git', ['mv', from, to], { cwd: projectRoot, stdio: 'pipe' });
    } catch {
      throw error;
    }
  }
}

export async function migrateWorkspace(options: MigrateOptions): Promise<MigrateResult> {
  const peaksRoot = join(options.projectRoot, '.peaks');
  if (!(await isDirectory(peaksRoot))) {
    return {
      projectRoot: options.projectRoot,
      sessions: [],
      wouldMove: [],
      moved: [],
      deletedSessions: [],
      wouldDeleteSessions: [],
      conflicts: [],
      apply: options.apply,
      totalFilesMoved: 0
    };
  }

  const topLevel = await readdir(peaksRoot, { withFileTypes: true });
  const sessionPlans: MigrateSessionPlan[] = [];
  const discoveredSessions = new Set<string>();
  for (const entry of topLevel) {
    if (!entry.isDirectory()) continue;
    if (PROTECTED_TOP_LEVEL_DIRS.has(entry.name)) continue;
    // Only treat dirs matching the legacy session pattern as sessions.
    if (!/^\d{4}-\d{2}-\d{2}-session-/.test(entry.name)) continue;
    const sessionPath = join(peaksRoot, entry.name);
    const plan = await planSession(entry.name, sessionPath, peaksRoot);
    sessionPlans.push(plan);
    discoveredSessions.add(entry.name);
  }

  // Slice 003 (canonical): also discover sessions under `.peaks/_runtime/<sid>/`.
  // The pre-canonical legacy walker above already handles legacy layouts;
  // this branch handles the post-canonical layout where every session
  // lives under `_runtime/`. We dedupe by session id so a session that
  // exists in both locations is only planned once (legacy takes
  // precedence — `_runtime/` is the canonical form, and the legacy
  // tree is the migration source).
  const runtimeRoot = join(peaksRoot, '_runtime');
  if (await isDirectory(runtimeRoot)) {
    const runtimeEntries = await readdir(runtimeRoot, { withFileTypes: true });
    for (const entry of runtimeEntries) {
      if (!entry.isDirectory()) continue;
      if (discoveredSessions.has(entry.name)) continue;
      if (!/^\d{4}-\d{2}-\d{2}-session-/.test(entry.name)) continue;
      const sessionPath = join(runtimeRoot, entry.name);
      const plan = await planSession(entry.name, sessionPath, peaksRoot);
      sessionPlans.push(plan);
      discoveredSessions.add(entry.name);
    }
  }

  const wouldMove: MigrateFilePlan[] = [];
  const moved: MigrateFilePlan[] = [];
  const conflicts: Array<{ from: string; to: string; reason: string }> = [];
  const willDeleteAfter: string[] = [];

  // Dry-run pass: compute the moves, detect collisions, and bucket.
  for (const session of sessionPlans) {
    for (const file of session.files) {
      if (file.skipped) continue;
      wouldMove.push(file);
      if (options.apply) {
        if (await pathExists(file.to)) {
          // Collision: target already exists. Compare content; if
          // identical, skip; otherwise warn and skip (refuse to
          // overwrite without --force).
          const sourceContent = await readFile(file.from, 'utf8').catch(() => null);
          const targetContent = await readFile(file.to, 'utf8').catch(() => null);
          if (sourceContent === targetContent) {
            conflicts.push({ from: file.from, to: file.to, reason: 'identical-content-already-migrated' });
            continue;
          }
          conflicts.push({ from: file.from, to: file.to, reason: 'target-exists-with-different-content' });
          continue;
        }
        await gitMv(file.from, file.to, options.projectRoot);
        moved.push(file);
      }
    }
    // After the move, count remaining files (excluding session.json
    // and the dirs we kept). If the session is empty, schedule deletion.
    // The "remaining" counter is the number of files that are STILL on
    // disk under the session dir post-migration: that includes transient
    // skipped files (session.json, system/) AND conflict files whose
    // source remains because the target was already taken.
    let remaining = 0;
    for (const file of session.files) {
      if (file.skipped) {
        // Skipped files (transient / cross-cutting) remain on disk.
        remaining++;
        continue;
      }
      if (options.apply) {
        if (await pathExists(file.to)) {
          // The target exists, so the source EITHER moved successfully
          // (file is gone from session) OR was a conflict (source is
          // still in session, which the existence-of-target proves the
          // source was NOT moved to that target). Distinguish by
          // checking the source path: if the source is still on disk,
          // the move was a conflict and the file remains in the
          // session.
          if (await pathExists(file.from)) {
            // Conflict: source still on disk, target exists with
            // different/identical content. Counts as remaining.
            remaining++;
          }
          // else: successful move, source gone — not remaining
          continue;
        }
        // Target doesn't exist; move must have failed (shouldn't
        // happen but be defensive). Count as remaining.
        remaining++;
      } else {
        // dry-run: every planned file is "remaining" in the session
        // (it hasn't been moved yet).
        remaining++;
      }
    }
    if (remaining === 0) {
      willDeleteAfter.push(session.sessionId);
    }
  }

  const wouldDeleteSessions = options.apply ? [] : willDeleteAfter;
  const deletedSessions: string[] = [];
  if (options.apply) {
    for (const session of sessionPlans) {
      if (!willDeleteAfter.includes(session.sessionId)) continue;
      // Only remove the session dir if every reviewable file was actually
      // moved (or the dir was already empty). Use isPathInsideArtifactRoot
      // as a safety check: never `rm -rf` a dir that isn't under the
      // project's .peaks/ tree.
      const sessionPath = session.path;
      if (!isPathInsideArtifactRoot(sessionPath, peaksRoot)) continue;
      // Remove the empty session dir (including its session.json +
      // system/ subdirs that we explicitly skipped).
      await rm(sessionPath, { recursive: true, force: true });
      deletedSessions.push(session.sessionId);
    }
  }

  // Slice 003: the `--to-runtime` step. When set, move every
  // top-level `.peaks/_runtime/<sid>/` to `.peaks/_runtime/<sid>/`. Idempotent.
  // The F15 carve-out (rd/project-scan.md) is honored: when the
  // top-level `<sid>/rd/project-scan.md` differs from the runtime
  // `<sid>/rd/project-scan.md` already in place, the file is
  // left at the top-level and a conflict is recorded.
  let toRuntimePlans: MigrateToRuntimeFilePlan[] = [];
  let toRuntimeMoved: string[] = [];
  let toRuntimeSkipped: string[] = [];
  let toRuntimeConflicts: Array<{ from: string; to: string; reason: string }> = [];
  if (options.toRuntime === true) {
    const result = await migrateToRuntime(options.projectRoot, peaksRoot, options.apply);
    toRuntimePlans = result.plans;
    toRuntimeMoved = result.moved;
    toRuntimeSkipped = result.skipped;
    toRuntimeConflicts = result.conflicts;
  }

  return {
    projectRoot: options.projectRoot,
    sessions: sessionPlans,
    wouldMove: wouldMove,
    moved: options.apply ? moved : [],
    deletedSessions: options.apply ? deletedSessions : [],
    wouldDeleteSessions: wouldDeleteSessions,
    conflicts,
    apply: options.apply,
    totalFilesMoved: options.apply ? moved.length : 0,
    toRuntimePlans,
    toRuntimeMoved,
    toRuntimeSkipped,
    toRuntimeConflicts
  };
}
