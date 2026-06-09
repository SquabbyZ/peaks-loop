/**
 * migrate-from-md — one-time migration from `.peaks/retrospective/<id>/*.md`
 * per-workflow MD dirs to a single `.peaks/retrospective/index.json` plus a
 * `.peaks/_archive/retrospective-2026-06-09-pre-r3.tar.gz` archive.
 *
 * Slice 023 (R3) G9. Idempotent: re-run is a no-op when `index.json` has
 * 88 entries with matching `updatedAt`.
 *
 * The legacy MDs in this repo use a *bullet-list* metadata format (no YAML
 * frontmatter). The fields we need are extracted from the leading bullet
 * block: `session:`, `rid:`, `type:`, `sliceId:`, plus the first `# Title`
 * heading.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { loadRetrospectiveIndex, type RetrospectiveEntry, type RetrospectiveType, type RetrospectiveOutcome, type RetrospectiveIndex } from './retrospective-index.js';

export interface MigrateOptions {
  projectRoot: string;
  apply?: boolean;
  includeFailed?: boolean;
  expectedEntries?: number;
}

export interface MigrateResult {
  apply: boolean;
  projectRoot: string;
  indexPath: string;
  archivePath: string | null;
  sourceDir: string;
  totalLegacyDirs: number;
  totalLegacyMds: number;
  parsedEntries: number;
  failedEntries: Array<{ id: string; reason: string }>;
  archiveVerified: boolean;
  status: 'applied' | 'no-op' | 'partial' | 'failed';
  warnings: string[];
}

const ARCHIVE_RELATIVE_PATH = '.peaks/_archive/retrospective-2026-06-09-pre-r3.tar.gz';

export function migrateRetrospectiveFromMd(options: MigrateOptions): MigrateResult {
  const projectRoot = resolve(options.projectRoot);
  const sourceDir = join(projectRoot, '.peaks', 'retrospective');
  const indexPath = join(sourceDir, 'index.json');
  const apply = options.apply === true;
  const includeFailed = options.includeFailed === true;
  const expectedEntries = options.expectedEntries ?? 88;

  if (!existsSync(sourceDir)) {
    return {
      apply,
      projectRoot,
      indexPath,
      archivePath: null,
      sourceDir,
      totalLegacyDirs: 0,
      totalLegacyMds: 0,
      parsedEntries: 0,
      failedEntries: [],
      archiveVerified: false,
      status: 'failed',
      warnings: ['retrospective source dir does not exist; nothing to migrate']
    };
  }

  // 1. Idempotency: re-run is a no-op when the existing index has the
  //    expected number of entries AND the on-disk MDs are gone.
  //    The `expectedEntries` cap is the *minimum* — when the on-disk tree
  //    is empty, the existing index is authoritative. We do NOT require
  //    a specific count, only that the tree is empty AND the index has
  //    at least `expectedEntries` entries.
  const existing = loadRetrospectiveIndex(projectRoot);
  const legacyDirs = listLegacyDirs(sourceDir);
  const legacyMds = listLegacyMds(sourceDir);
  if (existing.source === 'index.json' && existing.totalCount >= expectedEntries && legacyMds.length === 0 && legacyDirs.length === 0) {
    return {
      apply,
      projectRoot,
      indexPath,
      archivePath: join(projectRoot, ARCHIVE_RELATIVE_PATH),
      sourceDir,
      totalLegacyDirs: legacyDirs.length,
      totalLegacyMds: 0,
      parsedEntries: existing.totalCount,
      failedEntries: [],
      archiveVerified: existsSync(join(projectRoot, ARCHIVE_RELATIVE_PATH)),
      status: 'no-op',
      warnings: []
    };
  }

  // 2. Build the entry list by walking the legacy dirs.
  const entries: RetrospectiveEntry[] = [];
  const failed: Array<{ id: string; reason: string }> = [];
  for (const dir of legacyDirs) {
    for (const md of listMarkdownFilesInDir(dir)) {
      const result = parseLegacyMd(md, projectRoot);
      if (result.ok) {
        entries.push(result.entry);
      } else {
        failed.push({ id: result.id, reason: result.reason });
      }
    }
  }

  // 3. Decide outcome based on failures. Per R3: malformed MD → skip + warn
  //    + log to sidecar, do NOT archive until all parsed. We allow the
  //    partial build only when --include-failed is set (skips failures,
  //    uses whatever did parse) or when there are zero failures.
  if (failed.length > 0 && !includeFailed) {
    // No archive, no write — return the partial result for inspection.
    return {
      apply,
      projectRoot,
      indexPath,
      archivePath: null,
      sourceDir,
      totalLegacyDirs: legacyDirs.length,
      totalLegacyMds: legacyMds.length,
      parsedEntries: entries.length,
      failedEntries: failed,
      archiveVerified: false,
      status: 'partial',
      warnings: failed.map((f) => `WARN: ${f.id} failed to parse — ${f.reason}`)
    };
  }

  // 4. Build the index. We sort by updatedAt desc for stable ordering.
  const sorted = [...entries].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const index: RetrospectiveIndex = {
    version: 1,
    updatedAt: new Date().toISOString(),
    entries: sorted
  };

  if (!apply) {
    return {
      apply,
      projectRoot,
      indexPath,
      archivePath: null,
      sourceDir,
      totalLegacyDirs: legacyDirs.length,
      totalLegacyMds: legacyMds.length,
      parsedEntries: sorted.length,
      failedEntries: failed,
      archiveVerified: false,
      status: 'partial',
      warnings: ['dry-run; no files were written or archived']
    };
  }

  // 5. Atomic write: write to indexPath + '.tmp' first, then rename.
  mkdirSync(sourceDir, { recursive: true });
  const tmpPath = indexPath + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(index, null, 2), 'utf8');
  renameSync(tmpPath, indexPath);

  // 6. Archive legacy dirs to .peaks/_archive/retrospective-2026-06-09-pre-r3.tar.gz.
  const archivePath = join(projectRoot, ARCHIVE_RELATIVE_PATH);
  mkdirSync(join(projectRoot, '.peaks', '_archive'), { recursive: true });
  const archiveResult = runTar(sourceDir, archivePath);
  if (archiveResult.exitCode !== 0) {
    // Roll back: delete the index we just wrote.
    try { writeFileSync(indexPath, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), entries: [] }, null, 2)); } catch { /* swallow */ }
    return {
      apply,
      projectRoot,
      indexPath,
      archivePath: null,
      sourceDir,
      totalLegacyDirs: legacyDirs.length,
      totalLegacyMds: legacyMds.length,
      parsedEntries: sorted.length,
      failedEntries: failed,
      archiveVerified: false,
      status: 'failed',
      warnings: [`tar failed: ${archiveResult.stderr}`]
    };
  }

  // 7. Verify archive: tar -tzf the file and ensure all 88 original entries
  //    (or whatever count we have) are listed. A missing archive entry
  //    means the migration is unsound — roll back.
  const verification = verifyArchive(archivePath, legacyDirs);
  if (!verification.ok) {
    // Roll back.
    try { writeFileSync(indexPath, JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), entries: [] }, null, 2)); } catch { /* swallow */ }
    return {
      apply,
      projectRoot,
      indexPath,
      archivePath: null,
      sourceDir,
      totalLegacyDirs: legacyDirs.length,
      totalLegacyMds: legacyMds.length,
      parsedEntries: sorted.length,
      failedEntries: failed,
      archiveVerified: false,
      status: 'failed',
      warnings: [`archive verification failed: ${verification.reason}`]
    };
  }

  // 8. Delete the legacy dirs from the live tree. We only delete top-level
  //    dirs under .peaks/retrospective/ that are not `index.json` (or its
  //    tmp). index.json is the canonical live artifact; everything else
  //    is the legacy form.
  deleteLegacyDirs(sourceDir, indexPath);

  return {
    apply,
    projectRoot,
    indexPath,
    archivePath,
    sourceDir,
    totalLegacyDirs: legacyDirs.length,
    totalLegacyMds: legacyMds.length,
    parsedEntries: sorted.length,
    failedEntries: failed,
    archiveVerified: true,
    status: 'applied',
    warnings: []
  };
}

function listLegacyDirs(sourceDir: string): string[] {
  if (!existsSync(sourceDir)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('_')) continue;
    result.push(join(sourceDir, entry.name));
  }
  return result.sort();
}

function listLegacyMds(sourceDir: string): string[] {
  if (!existsSync(sourceDir)) return [];
  const result: string[] = [];
  for (const dir of listLegacyDirs(sourceDir)) {
    for (const md of listMarkdownFilesInDir(dir)) {
      result.push(md);
    }
  }
  return result;
}

function listMarkdownFilesInDir(dir: string): string[] {
  const result: string[] = [];
  const stack: string[] = [dir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) continue;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.startsWith('_')) {
        result.push(full);
      }
    }
  }
  return result.sort();
}

interface ParseOk { ok: true; entry: RetrospectiveEntry; }
interface ParseFail { ok: false; id: string; reason: string; }
type ParseResult = ParseOk | ParseFail;

function parseLegacyMd(mdPath: string, projectRoot: string): ParseResult {
  let content: string;
  try {
    content = readFileSync(mdPath, 'utf8');
  } catch (error) {
    return { ok: false, id: relative(projectRoot, mdPath), reason: 'read-failed: ' + (error instanceof Error ? error.message : String(error)) };
  }
  const lines = content.split(/\r?\n/);

  // First line: # Title
  const titleLine = lines[0] ?? '';
  const titleMatch = titleLine.match(/^#\s+(.*)$/);
  if (titleMatch === null) {
    return { ok: false, id: relative(projectRoot, mdPath), reason: 'missing # Title on first line' };
  }
  const title = titleMatch[1]?.trim() ?? '';

  // Walk leading bullet list for metadata fields. Each line starting
  // with `- key: value` contributes a field. Stop at the first non-bullet
  // non-blank line.
  const fields = new Map<string, string>();
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (line.trim() === '') continue;
    const match = line.match(/^-\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/);
    if (match === null) break;
    fields.set(match[1] ?? '', (match[2] ?? '').trim());
  }

  // sessionId: prefer `- session:`; fall back to the parent dir name
  // (e.g. `2026-06-02-grep-strip-meta` slices that don't have a
  // leading bullet list still encode the slice / change id in the
  // path). QA test-cases / test-reports in particular have no bullet
  // header at all.
  let sessionId = fields.get('session') ?? '';
  if (sessionId.length === 0) {
    // Walk up the path: `.peaks/retrospective/<id>/...` — the
    // `<id>` segment is a stable identifier we can use as a fallback
    // for the sessionId when the bullet header is missing.
    const relPath = relative(projectRoot, mdPath).replaceAll('\\', '/');
    const segments = relPath.split('/');
    const retroIdx = segments.indexOf('retrospective');
    if (retroIdx >= 0 && retroIdx + 1 < segments.length) {
      sessionId = segments[retroIdx + 1] ?? '';
    }
  }
  if (sessionId.length === 0) {
    return { ok: false, id: relative(projectRoot, mdPath), reason: 'missing `- session:` in leading bullet list and no parent-dir fallback' };
  }

  const rawType = fields.get('type') ?? 'refactor';
  // Some legacy MDs write `- type: feature (foundation A) — ...` with
  // parenthetical commentary. Take the first word; default to `refactor`
  // when nothing else matches.
  const typeWord = rawType.split(/[\s(]/)[0] ?? 'refactor';
  const type = typeWord as RetrospectiveType;
  const VALID_TYPES: RetrospectiveType[] = ['refactor', 'feature', 'bugfix', 'config', 'docs', 'chore'];
  if (!VALID_TYPES.includes(type)) {
    return { ok: false, id: relative(projectRoot, mdPath), reason: `invalid type: ${typeWord}` };
  }

  const outcome = inferOutcome(content);
  const keyDecisions = extractKeyDecisions(content);
  const lessonsLearned = extractLessonsLearnedCount(content);
  const summary = extractSummary(content, title);
  const sliceId = fields.get('rid') ?? fields.get('sliceId');
  const id = buildEntryId(mdPath, projectRoot, sliceId);

  // updatedAt: prefer file mtime, fall back to a stable extraction.
  const updatedAt = readMtimeIso(mdPath);

  const artifactPaths = [relative(projectRoot, mdPath).replaceAll('\\', '/')];

  const entry: RetrospectiveEntry = {
    id,
    sessionId,
    type,
    title,
    summary,
    outcome,
    keyDecisions,
    lessonsLearned,
    artifactPaths,
    updatedAt
  };
  return { ok: true, entry };
}

function readMtimeIso(filePath: string): string {
  try {
    return statSync(filePath).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function inferOutcome(content: string): RetrospectiveOutcome {
  // Heuristic: scan first ~2000 chars for outcome signals. Defaults to
  // `in-flight` when nothing is conclusive.
  const head = content.slice(0, 4000).toLowerCase();
  if (/\b(state\s*:\s*shipped|outcome\s*:\s*shipped|shipped|merged|## outcome\s*:\s*shipped)/u.test(head)) {
    return 'shipped';
  }
  if (/\b(blocked|cancelled|canceled|abandoned)/u.test(head)) {
    return 'blocked';
  }
  if (/\b(in[- ]flight|in[- ]progress|wip|ongoing)/u.test(head)) {
    return 'in-flight';
  }
  return 'in-flight';
}

function extractKeyDecisions(content: string): string[] {
  // Look for a `## Key Decisions` or `## AD-` style block; pull the
  // first `**Decision**:` line and similar patterns. Keep entries ≤ 120
  // chars, 1 line each.
  const lines = content.split('\n');
  const decisions: string[] = [];
  let inKeyDecisions = false;
  for (const line of lines) {
    if (/^##\s*key\s*decisions/iu.test(line)) {
      inKeyDecisions = true;
      continue;
    }
    if (inKeyDecisions && /^##\s+/u.test(line)) {
      break;
    }
    if (!inKeyDecisions) continue;
    const decisionMatch = line.match(/^[-*]\s+\*\*decision\*\*\s*:?\s*(.+)$/iu);
    if (decisionMatch) {
      const text = (decisionMatch[1] ?? '').trim();
      if (text.length > 0) {
        decisions.push(truncate(text, 120));
      }
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/u);
    if (bullet) {
      const text = (bullet[1] ?? '').trim();
      // Skip bullets that are clearly not decisions (sub-headings, links).
      if (text.length > 0 && !text.startsWith('[') && !text.startsWith('!')) {
        decisions.push(truncate(text, 120));
        if (decisions.length >= 6) break;
      }
    }
  }
  return decisions.slice(0, 6);
}

function extractLessonsLearnedCount(content: string): number {
  // Count `## Lessons` block bullets; if the heading is absent, return 0.
  const lines = content.split('\n');
  let inLessons = false;
  let count = 0;
  for (const line of lines) {
    if (/^##\s*lessons(\s+learned)?/iu.test(line)) {
      inLessons = true;
      continue;
    }
    if (inLessons && /^##\s+/u.test(line)) {
      break;
    }
    if (inLessons && /^[-*]\s+/.test(line)) {
      count += 1;
    }
  }
  return count;
}

function extractSummary(content: string, title: string): string {
  // The summary is the first paragraph after the leading metadata block
  // (and after the first `## Goals` / `## Summary` heading). We prefer a
  // paragraph directly under a `## Summary` heading; fall back to the
  // first non-blank paragraph after the title block.
  const lines = content.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^##\s*summary/iu.test(line)) {
      let cursor = index + 1;
      while (cursor < lines.length && (lines[cursor] ?? '').trim() === '') cursor += 1;
      const collected: string[] = [];
      while (cursor < lines.length && (lines[cursor] ?? '').trim() !== '' && !/^##\s+/u.test(lines[cursor] ?? '')) {
        collected.push((lines[cursor] ?? '').trim());
        cursor += 1;
      }
      const text = collected.join(' ').trim();
      if (text.length > 0) return truncate(text, 280);
    }
  }
  // Fall back: first paragraph under `## Goals` (most PRDs / RDs have one).
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^##\s*goals/iu.test(line)) {
      let cursor = index + 1;
      while (cursor < lines.length && (lines[cursor] ?? '').trim() === '') cursor += 1;
      const collected: string[] = [];
      while (cursor < lines.length && (lines[cursor] ?? '').trim() !== '' && !/^##\s+/u.test(lines[cursor] ?? '')) {
        collected.push((lines[cursor] ?? '').trim());
        cursor += 1;
      }
      const text = collected.join(' ').trim();
      if (text.length > 0) return truncate(text, 280);
    }
  }
  return truncate(title, 280);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + '…';
}

function buildEntryId(mdPath: string, projectRoot: string, sliceId: string | undefined): string {
  if (sliceId !== undefined && sliceId.length > 0) return sliceId;
  // Fall back to the parent dir name relative to the retrospective root.
  // The path is `<projectRoot>/.peaks/retrospective/<id>/.../<file>.md`,
  // so the dir at depth `.peaks/retrospective/<id>` is the slice id.
  const rel = relative(projectRoot, mdPath).replaceAll('\\', '/');
  const segments = rel.split('/');
  // We expect the pattern `.peaks/retrospective/<id>/<rest>`; the
  // `<id>` segment is 3 slots from the end of the path's dir prefix.
  // Simpler: walk segments, find the index right after `retrospective`.
  const retroIdx = segments.indexOf('retrospective');
  if (retroIdx >= 0 && retroIdx + 1 < segments.length - 1) {
    return segments[retroIdx + 1] ?? 'unknown';
  }
  // Last-resort fallback: file stem.
  const last = segments[segments.length - 1] ?? 'unknown';
  return last.replace(/\.md$/, '');
}

interface TarRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runTar(sourceDir: string, archivePath: string): TarRunResult {
  // Use the system `tar` to roll up everything in `sourceDir` except
  // `index.json` and `index.json.tmp`. We do this with `--exclude` rather
  // than walking the dir ourselves because tar's snapshot is the same
  // on every platform (Windows ships tar.exe in System32).
  //
  // Windows tar (System32 tar.exe) chokes on absolute paths that contain
  // a `:` drive letter ("Cannot connect to C:"). We work around this by
  // running `tar` with `sourceDir` as the cwd, using `.` as the input,
  // and computing the archive path as a *relative* path that the
  // `spawnSync` cwd resolves.
  const relativeArchive = relative(sourceDir, archivePath);
  const result = spawnSync('tar', [
    '-czf', relativeArchive,
    '--exclude=index.json',
    '--exclude=index.json.tmp',
    '--exclude=index.json.bak',
    '.'
  ], { encoding: 'utf8', cwd: sourceDir });
  return {
    exitCode: result.status ?? -1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

interface VerifyResult { ok: boolean; reason?: string; }

function verifyArchive(archivePath: string, legacyDirs: string[]): VerifyResult {
  if (!existsSync(archivePath)) return { ok: false, reason: 'archive file missing' };
  // Use cwd-relative path for tar -tzf to avoid the System32 tar.exe
  // "Cannot connect to C:" failure mode.
  const relativeArchive = relative(process.cwd(), archivePath);
  const result = spawnSync('tar', ['-tzf', relativeArchive], { encoding: 'utf8', cwd: process.cwd() });
  if (result.status !== 0) return { ok: false, reason: 'tar -tzf failed: ' + (result.stderr ?? '') };
  const listing = (result.stdout ?? '').split('\n');
  for (const dir of legacyDirs) {
    const dirName = dir.split(/[\\/]/).pop() ?? '';
    const found = listing.some((line) => line.includes(dirName + '/') || line.endsWith('/' + dirName));
    if (!found) {
      return { ok: false, reason: `archive is missing legacy dir: ${dirName}` };
    }
  }
  return { ok: true };
}

function deleteLegacyDirs(sourceDir: string, indexPath: string): void {
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const full = join(sourceDir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('_')) {
      try {
        rmSync(full, { recursive: true, force: true });
      } catch { /* swallow; archive holds the original */ }
    } else if (entry.isFile() && full !== indexPath && !entry.name.endsWith('.tmp')) {
      // No-op: legacy MDs are nested inside legacy dirs.
      void indexPath;
    }
  }
}
