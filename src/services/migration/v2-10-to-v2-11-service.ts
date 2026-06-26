/**
 * v2.11.0 — Group E (Tier 8) migration service.
 *
 * Scans pre-v2.11.0 sessions for `rd/tech-doc.md` files and tags each
 * with a deprecation banner (Karpathy §3 surgical: text-only, no file
 * moves). Idempotent: re-running produces no diff on a previously-
 * migrated repo.
 *
 * === Why text-only (no move / no prune) ===
 *
 * v2.11.0 introduces the immutable peaks-prd handoff at
 * `.peaks/_runtime/<sid>/prd/handoff.md` as the source of truth. The
 * old `rd/tech-doc.md` is no longer required by any CLI gate, but the
 * historical content still has audit value. Removing it silently would
 * lose the diff; renaming would orphan any external reference (e.g.,
 * commit messages, blog posts). The least-risky path is: tag in place
 * with a banner; let the user decide when/whether to prune in a future
 * slice.
 *
 * === Banner shape (locked) ===
 *
 * The banner is prepended (NOT wrapped) — keeps existing body intact,
 * Git blame still works for the original content lines.
 *
 * === Source: peaks-rd/references/writing-handoff-frontmatter.md §"v2.11.0" ===
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { DEPRECATION_BANNER, type MigrationEntry, type MigrationPlan, type MigrationResult, type MigrationReason } from './v2-10-to-v2-11-types.js';

const SKIP_DIRS = new Set([
  'memory',
  'PROJECT.md',
  'retrospective',
  'scope',
  '.peaks-init-hooks-decision.json',
  'session.json',
  '.session.json',
  '_runtime',
  '_sub_agents',
  'change',
  'caller',
  'callers',
  'sop-state',
  'system',
  'active-skill.json',
  '.active-skill.json'
]);

const SESSION_DIR_RE = /^\d{4}-\d{2}-\d{2}-session-/;

const TECH_DOC_MARKERS = ['## Architecture', '## Component', '## API', '## Dependencies'];

function sha256(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

function hasExistingFrontmatter(body: string): boolean {
  const lines = body.split(/\r?\n/).slice(0, 10);
  return lines.some((line) => line.trim() === '---');
}

function looksLikeTechDoc(body: string): boolean {
  return TECH_DOC_MARKERS.some((marker) => body.includes(marker));
}

function isAlreadyDeprecated(body: string): boolean {
  return body.startsWith(DEPRECATION_BANNER);
}

function enumerateSessionDirs(projectRoot: string): string[] {
  const peaksRoot = join(projectRoot, '.peaks');
  if (!existsSync(peaksRoot)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(peaksRoot)) {
    if (SKIP_DIRS.has(entry)) continue;
    if (entry.startsWith('.')) continue;
    if (SESSION_DIR_RE.test(entry)) out.push(entry);
  }
  return out;
}

function buildEntryForFile(sessionId: string, filePath: string): MigrationEntry | null {
  if (!existsSync(filePath)) return null;
  const body = readFileSync(filePath, 'utf8');
  const fromHash = sha256(body);

  if (isAlreadyDeprecated(body)) {
    return {
      sessionId,
      filePath,
      fromHash,
      toHash: fromHash,
      reason: 'already-deprecated',
      skippedBytes: 0
    };
  }

  if (hasExistingFrontmatter(body)) {
    return {
      sessionId,
      filePath,
      fromHash,
      toHash: fromHash,
      reason: 'not-a-tech-doc',
      skippedBytes: 0
    };
  }

  if (!looksLikeTechDoc(body)) {
    return {
      sessionId,
      filePath,
      fromHash,
      toHash: fromHash,
      reason: 'not-a-tech-doc',
      skippedBytes: 0
    };
  }

  const newBody = DEPRECATION_BANNER + body;
  return {
    sessionId,
    filePath,
    fromHash,
    toHash: sha256(newBody),
    reason: 'will-deprecate',
    skippedBytes: 0
  };
}

export function enumerateTechDocs(projectRoot: string): ReadonlyArray<{ readonly sessionId: string; readonly filePath: string }> {
  const out: Array<{ sessionId: string; filePath: string }> = [];
  for (const sid of enumerateSessionDirs(projectRoot)) {
    const filePath = join(projectRoot, '.peaks', sid, 'rd', 'tech-doc.md');
    if (existsSync(filePath)) out.push({ sessionId: sid, filePath });
  }
  return out;
}

export function planV2ToV11Migration(projectRoot: string): MigrationPlan {
  const entries: MigrationEntry[] = [];
  let willDeprecateCount = 0;
  let alreadyDeprecatedCount = 0;
  let notTechDocCount = 0;
  for (const { sessionId, filePath } of enumerateTechDocs(projectRoot)) {
    const entry = buildEntryForFile(sessionId, filePath);
    if (entry === null) continue;
    entries.push(entry);
    if (entry.reason === 'will-deprecate') willDeprecateCount++;
    else if (entry.reason === 'already-deprecated') alreadyDeprecatedCount++;
    else notTechDocCount++;
  }
  return {
    projectRoot,
    entries,
    willDeprecateCount,
    alreadyDeprecatedCount,
    notTechDocCount
  };
}

export function applyV2ToV11Migration(plan: MigrationPlan): MigrationResult {
  const errors: Array<{ path: string; message: string }> = [];
  let writtenCount = 0;
  for (const entry of plan.entries) {
    if (entry.reason !== 'will-deprecate') continue;
    try {
      const body = readFileSync(entry.filePath, 'utf8');
      const newBody = DEPRECATION_BANNER + body;
      writeFileSync(entry.filePath, newBody, 'utf8');
      writtenCount++;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push({ path: entry.filePath, message });
    }
  }
  return {
    plan,
    applied: true,
    writtenCount,
    errors
  };
}

export interface DryRunResult {
  readonly plan: MigrationPlan;
  readonly applied: false;
  readonly writtenCount: 0;
  readonly errors: ReadonlyArray<{ readonly path: string; readonly message: string }>;
}

export function dryRunV2ToV11Migration(projectRoot: string): DryRunResult {
  const plan = planV2ToV11Migration(projectRoot);
  return {
    plan,
    applied: false,
    writtenCount: 0,
    errors: []
  };
}

export type { MigrationEntry, MigrationPlan, MigrationReason, MigrationResult };
