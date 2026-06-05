import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { isDirectory, pathExists } from '../../shared/fs.js';
import { isPathInsideArtifactRoot, validateChangeIdOrThrow } from '../../shared/change-id.js';
import type { MigrateFilePlan, MigrateOptions, MigrateResult, MigrateSessionPlan } from './migrate-types.js';

const ROLE_DIRS = new Set(['prd', 'ui', 'rd', 'qa', 'sc', 'system']);

/** Top-level dirs in `.peaks/` that are NEVER legacy session dirs
 * (regardless of mtime/name) and must be skipped by the migration scan. */
const PROTECTED_TOP_LEVEL_DIRS = new Set([
  '_runtime',
  'retrospective',
  'issues',
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

/** Tier 3 — body frontmatter: `- rid: <change-id>` OR `- linked-rd: .peaks/<sid>/<role>/<num>-<change-id>.md`
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
  changeId: string;
  source: Exclude<MigrateFilePlan['source'], 'cross-cutting' | null>;
}

/** Try the 4 tiers in order and return the first non-null result. */
function extractChangeId(
  fileName: string,
  content: string | null,
  fallbackChangeId: string | null
): ExtractedChangeId | null {
  // Tier 1: filename regex
  const baseName = fileName;
  const m = FILENAME_CHANGE_ID_RE.exec(baseName);
  if (m && m[1] && m[1].length > 0) {
    try {
      validateChangeIdOrThrow(m[1]);
      return { changeId: m[1], source: 'filename-regex' };
    } catch {
      // fall through to H1
    }
  }

  // Tier 2: content H1
  if (content !== null) {
    const h1Match = content.split(/\r?\n/, 1)[0] ?? '';
    for (const { test, extract } of H1_CHANGE_ID_PATTERNS) {
      if (test(h1Match)) {
        const cid = extract(h1Match);
        if (cid !== null) {
          try {
            validateChangeIdOrThrow(cid);
            return { changeId: cid, source: 'content-h1' };
          } catch {
            // fall through to frontmatter
          }
        }
      }
    }
  }

  // Tier 3: body frontmatter
  if (content !== null) {
    const ridMatch = FRONTMATTER_RID_RE.exec(content);
    if (ridMatch && ridMatch[1]) {
      try {
        validateChangeIdOrThrow(ridMatch[1]);
        return { changeId: ridMatch[1], source: 'content-frontmatter' };
      } catch {
        // fall through
      }
    }
    const linkedMatch = FRONTMATTER_LINKED_RE.exec(content);
    if (linkedMatch && linkedMatch[1]) {
      try {
        validateChangeIdOrThrow(linkedMatch[1]);
        return { changeId: linkedMatch[1], source: 'content-frontmatter' };
      } catch {
        // fall through
      }
    }
  }

  // Tier 4: per-session fallback (most recent change-id from rd/requests/)
  if (fallbackChangeId !== null) {
    return { changeId: fallbackChangeId, source: 'session-fallback' };
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
    if (extracted !== null) return extracted.changeId;
  }
  return null;
}

function isCrossCuttingFile(relativePath: string): boolean {
  // `rd/project-scan.md` and `rd/perf-baseline.md` are cross-cutting and
  // belong at the TOP of `.peaks/` (e.g. `.peaks/project-scan/rd/...`),
  // not under retrospective/. They never carry a per-slice change-id.
  if (relativePath === 'rd/project-scan.md') return true;
  if (relativePath === 'rd/perf-baseline.md') return true;
  return false;
}

function isTransientRuntimeFile(relativePath: string): boolean {
  if (relativePath === 'session.json') return true;
  if (relativePath === '.gitkeep') return true;
  return false;
}

async function planSession(
  sessionId: string,
  sessionPath: string
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
        changeId: '',
        role: f.role,
        relativePath: f.relativePath,
        source: null,
        skipped: true,
        skipReason: 'transient-runtime'
      });
      continue;
    }

    if (isCrossCuttingFile(f.relativePath)) {
      // These stay at .peaks/<cross-cutting-dir>/<role>/<file>; not part
      // of the retrospective migration. The user has them at the top
      // level already (.peaks/project-scan/, .peaks/perf-baseline/), so
      // we mark them as skipped.
      plans.push({
        from: f.absPath,
        to: f.absPath,
        sessionId,
        changeId: '',
        role: f.role,
        relativePath: f.relativePath,
        source: 'cross-cutting',
        skipped: true,
        skipReason: 'cross-cutting'
      });
      continue;
    }

    if (f.role === 'system') {
      plans.push({
        from: f.absPath,
        to: f.absPath,
        sessionId,
        changeId: '',
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
        changeId: '',
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
        changeId: '',
        role: f.role,
        relativePath: f.relativePath,
        source: null,
        skipped: true,
        skipReason: 'no-change-id'
      });
      continue;
    }

    empty = false;
    const to = join(sessionPath, '..', 'retrospective', extracted.changeId, f.relativePath);
    plans.push({
      from: f.absPath,
      to,
      sessionId,
      changeId: extracted.changeId,
      role: f.role,
      relativePath: f.relativePath,
      source: extracted.source
    });
  }

  return { sessionId, path: sessionPath, empty: empty && plans.every((p) => p.skipped), files: plans, fallbackChangeId: fallback };
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
  for (const entry of topLevel) {
    if (!entry.isDirectory()) continue;
    if (PROTECTED_TOP_LEVEL_DIRS.has(entry.name)) continue;
    // Only treat dirs matching the legacy session pattern as sessions.
    if (!/^\d{4}-\d{2}-\d{2}-session-/.test(entry.name)) continue;
    const sessionPath = join(peaksRoot, entry.name);
    const plan = await planSession(entry.name, sessionPath);
    sessionPlans.push(plan);
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

  return {
    projectRoot: options.projectRoot,
    sessions: sessionPlans,
    wouldMove: wouldMove,
    moved: options.apply ? moved : [],
    deletedSessions: options.apply ? deletedSessions : [],
    wouldDeleteSessions: wouldDeleteSessions,
    conflicts,
    apply: options.apply,
    totalFilesMoved: options.apply ? moved.length : 0
  };
}
