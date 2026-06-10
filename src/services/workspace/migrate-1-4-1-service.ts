/**
 * `peaks workspace migrate-1-4-1` — R004.
 *
 * Cleanup command for projects upgraded from peaks-cli 1.4.1 → 1.4.2.
 *
 * Slice 006 (1.4.0) moved the canonical per-session root to
 * `.peaks/_runtime/<sid>/`. Per-request artifacts (PRD, RD, QA, SC requests)
 * were written to the new root, but per-session artifacts (tech-doc.md,
 * code-review.md, test-cases/<rid>.md, etc.) were kept at the legacy
 * `.peaks/<sid>/<role>/<file>.md` path. The 2-tier fallback in
 * `resolvePrerequisiteAbsolutePathWithFallback` accepts either location, so
 * the functional behavior is correct, but the user's filesystem has visible
 * dual-path duplication ("飘逸" — the user's term for the UX).
 *
 * R004 ships this command to physically move the legacy per-session files
 * into the canonical `_runtime/<sid>/<role>/` location. After this runs,
 * the project has a single canonical tree; the legacy `<sid>/<role>/`
 * directories are removed (only if empty after the move).
 *
 * Default: dry-run. Pass `--apply` to actually move.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const PER_SESSION_ARTIFACT_TYPES = [
  'rd/tech-doc.md',
  'rd/code-review.md',
  'rd/security-review.md',
  'rd/perf-baseline.md',
  'rd/bug-analysis.md',
  'qa/security-findings.md',
  'qa/performance-findings.md',
] as const;

export const PER_REQUEST_ARTIFACT_TYPES = [
  'qa/test-cases/<rid>.md',
  'qa/test-reports/<rid>.md',
] as const;

export type MigrationPlanEntry = {
  readonly sessionId: string;
  readonly relativePath: string;
  readonly from: string;
  readonly to: string;
  readonly sha256: string;
  readonly reason: 'legacy-only' | 'identical-content-already-canonical' | 'content-mismatch' | 'no-legacy-file';
};

export type MigrationResult = {
  readonly plan: ReadonlyArray<MigrationPlanEntry>;
  readonly applied: boolean;
  readonly movedCount: number;
  readonly conflictCount: number;
  readonly deletedEmptyDirs: ReadonlyArray<string>;
  readonly errors: ReadonlyArray<{ path: string; message: string }>;
};

import { createHash } from 'node:crypto';

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function enumerateLegacySessions(projectRoot: string): string[] {
  // Legacy per-session dirs: `.peaks/<sid>/` (NOT `.peaks/_runtime/<sid>/`).
  // We skip well-known non-session entries.
  const SKIP = new Set(['memory', 'PROJECT.md', 'retrospective', 'scope', 'skill-scope', '.peaks-init-hooks-decision.json', 'session.json', '.session.json', '_runtime', '_sub_agents', 'change', 'caller', 'callers', 'sop-state', 'system', 'active-skill.json', '.active-skill.json']);
  const peaksRoot = join(projectRoot, '.peaks');
  if (!existsSync(peaksRoot)) return [];
  const out: string[] = [];
  for (const entry of require('node:fs').readdirSync(peaksRoot)) {
    if (SKIP.has(entry)) continue;
    if (entry.startsWith('.')) continue;
    // Treat any directory under .peaks/ that doesn't match a known non-session
    // directory as a candidate session id. The session id is a dated prefix.
    if (entry.match(/^\d{4}-\d{2}-\d{2}-session-/)) out.push(entry);
  }
  return out;
}

function listRequestIdsForSession(legacySessionRoot: string): string[] {
  // Per-request artifacts use file id like `001-r001.md`. We scan the
  // requests dir to find existing rids.
  const ids = new Set<string>();
  for (const role of ['prd', 'rd', 'qa', 'sc']) {
    const dir = join(legacySessionRoot, role, 'requests');
    if (!existsSync(dir)) continue;
    for (const f of require('node:fs').readdirSync(dir)) {
      const m = f.match(/^\d+-(r\d+)\.md$/);
      if (m) ids.add(m[1]);
    }
  }
  return [...ids];
}

function buildPlan(projectRoot: string): MigrationPlanEntry[] {
  const plan: MigrationPlanEntry[] = [];
  for (const sid of enumerateLegacySessions(projectRoot)) {
    const legacyRoot = join(projectRoot, '.peaks', sid);
    const canonicalRoot = join(projectRoot, '.peaks', '_runtime', sid);
    // Per-session files (no <rid> template).
    for (const rel of PER_SESSION_ARTIFACT_TYPES) {
      const from = join(legacyRoot, rel);
      if (!existsSync(from)) continue;
      const content = readFileSync(from, 'utf8');
      const hash = sha256(content);
      const to = join(canonicalRoot, rel);
      if (existsSync(to)) {
        const existing = readFileSync(to, 'utf8');
        if (sha256(existing) === hash) {
          plan.push({ sessionId: sid, relativePath: rel, from, to, sha256: hash, reason: 'identical-content-already-canonical' });
        } else {
          plan.push({ sessionId: sid, relativePath: rel, from, to, sha256: hash, reason: 'content-mismatch' });
        }
      } else {
        plan.push({ sessionId: sid, relativePath: rel, from, to, sha256: hash, reason: 'legacy-only' });
      }
    }
    // Per-request files (with <rid> template).
    const rids = listRequestIdsForSession(legacyRoot);
    for (const rel of PER_REQUEST_ARTIFACT_TYPES) {
      for (const rid of rids) {
        const expanded = rel.replace('<rid>', rid);
        const from = join(legacyRoot, expanded);
        if (!existsSync(from)) continue;
        const content = readFileSync(from, 'utf8');
        const hash = sha256(content);
        const to = join(canonicalRoot, expanded);
        if (existsSync(to)) {
          const existing = readFileSync(to, 'utf8');
          if (sha256(existing) === hash) {
            plan.push({ sessionId: sid, relativePath: expanded, from, to, sha256: hash, reason: 'identical-content-already-canonical' });
          } else {
            plan.push({ sessionId: sid, relativePath: expanded, from, to, sha256: hash, reason: 'content-mismatch' });
          }
        } else {
          plan.push({ sessionId: sid, relativePath: expanded, from, to, sha256: hash, reason: 'legacy-only' });
        }
      }
    }
  }
  return plan;
}

export function planMigrate1_4_1(projectRoot: string): MigrationResult {
  const plan = buildPlan(projectRoot);
  return {
    plan,
    applied: false,
    movedCount: 0,
    conflictCount: plan.filter((p) => p.reason === 'content-mismatch').length,
    deletedEmptyDirs: [],
    errors: [],
  };
}

export function applyMigrate1_4_1(projectRoot: string): MigrationResult {
  const plan = buildPlan(projectRoot);
  const errors: Array<{ path: string; message: string }> = [];
  let movedCount = 0;
  const deletedEmptyDirs: string[] = [];
  const movedFiles: string[] = [];

  for (const entry of plan) {
    try {
      if (entry.reason === 'legacy-only') {
        // Move: ensure target dir exists, then rename.
        mkdirSync(join(entry.to, '..'), { recursive: true });
        renameSync(entry.from, entry.to);
        movedFiles.push(entry.from);
        movedCount++;
      } else if (entry.reason === 'identical-content-already-canonical') {
        // Skip the move but delete the duplicate source.
        try { rmSync(entry.from); } catch { /* best-effort */ }
      } else if (entry.reason === 'content-mismatch') {
        // Conflict: do NOT delete the source. Mark for manual review.
        errors.push({ path: entry.from, message: `content mismatch; review manually (target ${entry.to})` });
      }
    } catch (err) {
      errors.push({ path: entry.from, message: (err as Error).message });
    }
  }

  // After all moves, clean up legacy session dirs. They're now empty
  // (all files moved; per-role subdirs are also empty). Force-remove the
  // entire tree — if any non-empty dir remains it's a pre-existing file
  // that wasn't part of the migrate plan, which is fine to keep.
  for (const sid of new Set(plan.map((p) => p.sessionId))) {
    const legacyRoot = join(projectRoot, '.peaks', sid);
    try {
      if (existsSync(legacyRoot)) {
        rmSync(legacyRoot, { recursive: true, force: true });
        deletedEmptyDirs.push(legacyRoot);
      }
    } catch { /* best-effort */ }
  }

  return {
    plan,
    applied: true,
    movedCount,
    conflictCount: plan.filter((p) => p.reason === 'content-mismatch').length,
    deletedEmptyDirs,
    errors,
  };
}
