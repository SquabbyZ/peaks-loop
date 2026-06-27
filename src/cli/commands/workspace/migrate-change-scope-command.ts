/**
 * `peaks workspace migrate-change-scope` — slice 2026-06-28-solo-mode-bypass-fix.
 *
 * Migrates misplaced change-id content from the legacy
 * `.peaks/_runtime/<changeId>/` (and the rarer
 * `.peaks/<changeId>/`) form into the canonical
 * `.peaks/_runtime/change/<changeId>/` layout.
 *
 * Why: pre-1.3.0 write paths emitted reviewable artifacts at
 * `.peaks/_runtime/<changeId>/<role>/...`, which is the SKILL.md 2.8.3
 * hard-ban shape (sibling of `.peaks/_runtime/`). The canonical
 * location is `.peaks/_runtime/change/<changeId>/<role>/...` per
 * `change-scope-service.ts`. This CLI is the one-shot migration tool.
 *
 * Default: dry-run. Pass --apply to actually `renameSync` the misplaced
 * dirs. Idempotent: re-running on a clean workspace reports no work.
 *
 * Refusal conditions (slice 2026-06-28):
 *   - <changeId> collides with a date-stamped session id
 *     (e.g. `2026-06-28-session-abc123`). We refuse to move because
 *     the source dir IS a session workspace, not a misplaced
 *     change-id dir. → MIGRATION_REFUSED_SESSION_ID_COLLISION
 *   - Target dir exists and is non-empty AND not byte-equal to the
 *     source contents (idempotency check: if the target is an exact
 *     mirror, we leave it; otherwise we refuse to clobber).
 *     → MIGRATION_REFUSED_TARGET_NOT_EMPTY
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Command } from 'commander';
import { resolveCanonicalProjectRoot } from '../../../services/config/config-service.js';
import { fail, ok } from '../../../shared/result.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../../cli-helpers.js';

type MigrateChangeScopeOptions = {
  project: string;
  apply?: boolean;
  json?: boolean;
};

// Session-id canonical form: `YYYY-MM-DD-session-<random>`. A bare
// date prefix (e.g. `2026-06-27-foo`) is NOT a session id — it could
// be a date-stamped change-id like `2026-06-27-verdict-aggregator`.
// The discriminator is the literal `session-` token after the date.
const SESSION_ID_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-session-/;

// Whitelist of `.peaks/` top-level entries that are NEVER change-ids
// (project-level data dirs, gitignore internals, sub-agent runtime).
// Anything not in this list AND matching `isSafeChangeScopeId` is
// considered a potential misplaced change-id. This is a DENY-list
// approach (defensive) so unknown project data dirs are NOT moved by
// accident — the operator must add a new entry to this list
// explicitly to whitelist a new project-level data dir.
const PEAKS_TOP_LEVEL_DENY: ReadonlySet<string> = new Set([
  'PROJECT.md',
  'preferences.json',
  'memory',
  'project-scan',
  'retrospective',
  'sc',
  'sops',
  'standards',
  '_runtime',
  '_sub_agents',
  '.session.json',
  '.peaks-openspec-opt-in.json',
  'current-change',
  'active-skill.json',
  'callers',
  '_change-marker',
  'workflow-state'
]);

// Runtime-layer entries (under `.peaks/_runtime/`) that are NEVER
// change-ids: session dirs (which look like `<YYYY-MM-DD-session-X>`),
// the `change/` canonical parent, and runtime-metadata files.
const RUNTIME_DENY: ReadonlySet<string> = new Set([
  'change',
  'session.json',
  'current-change',
  'active-skill.json',
  'callers',
  '_change-marker',
  'workflow-state'
]);

const SAFE_CHANGE_SCOPE_ID_PATTERN = /^[A-Za-z0-9._-]+$/;

function looksLikeChangeScopeId(entry: string): boolean {
  // Mirrors `isSafeChangeScopeId` in change-scope-service.ts.
  if (entry.length === 0) return false;
  if (entry === '.' || entry === '..') return false;
  if (entry.includes('/') || entry.includes('\\')) return false;
  if (/\s/.test(entry)) return false;
  return SAFE_CHANGE_SCOPE_ID_PATTERN.test(entry);
}

export type MigrateChangeScopePlan = {
  readonly changeId: string;
  readonly source: string;
  readonly target: string;
  readonly action: 'would-move' | 'moved' | 'skipped-already-canonical' | 'refused-session-id-collision' | 'refused-target-not-empty';
  readonly reason?: string;
};

export type MigrateChangeScopeResult = {
  readonly projectRoot: string;
  readonly apply: boolean;
  readonly plans: readonly MigrateChangeScopePlan[];
  readonly moved: readonly MigrateChangeScopePlan[];
  readonly skipped: readonly MigrateChangeScopePlan[];
  readonly refused: readonly MigrateChangeScopePlan[];
};

/** Returns true when `<changeId>` looks like a date-stamped session id. */
function looksLikeSessionId(changeId: string): boolean {
  return SESSION_ID_PATTERN.test(changeId);
}

/** Top-level candidates that may hold misplaced change-id content.
 *  Excludes `.peaks/`-level project data dirs (memory, standards, etc.)
 *  AND `.peaks/_runtime/`-level session dirs / runtime metadata.
 *  An entry is a candidate ONLY if it passes the change-scope id
 *  structural pattern (letters/digits/dots/underscores/dashes) and is
 *  not in the explicit deny-list. Belt + braces: a project-level data
 *  dir like `memory` is structurally a valid change-id-shape string,
 *  so the deny-list is the only protection. */
function listTopLevelChangeIdDirs(runtimeRoot: string): string[] {
  if (!existsSync(runtimeRoot)) return [];
  const entries = readdirSync(runtimeRoot);
  return entries.filter((entry) => {
    if (RUNTIME_DENY.has(entry)) return false;
    if (entry.startsWith('.')) return false;
    if (!looksLikeChangeScopeId(entry)) return false;
    return true;
  });
}

/** Compute whether two directory contents are byte-equal (best-effort
 *  1-level recursion: compares file sizes at the top level AND inside
 *  every immediate subdirectory). Returns `false` on any IO error or
 *  structural mismatch. The compare is intentionally conservative — a
 *  false-negative (saying they differ when actually equal) is harmless
 *  (we refuse to migrate), a false-positive (saying they're equal when
 *  they differ) would silently lose data. */
function shallowContentEqual(srcDir: string, tgtDir: string): boolean {
  if (!existsSync(srcDir) || !existsSync(tgtDir)) return false;
  const srcStat = statSync(srcDir);
  const tgtStat = statSync(tgtDir);
  if (!srcStat.isDirectory() || !tgtStat.isDirectory()) return false;
  let srcEntries: string[];
  let tgtEntries: string[];
  try {
    srcEntries = readdirSync(srcDir);
    tgtEntries = readdirSync(tgtDir);
  } catch {
    return false;
  }
  if (srcEntries.length !== tgtEntries.length) return false;
  for (const entry of srcEntries) {
    if (!tgtEntries.includes(entry)) return false;
    const srcPath = join(srcDir, entry);
    const tgtPath = join(tgtDir, entry);
    const sStat = statSync(srcPath);
    const tStat = statSync(tgtPath);
    if (sStat.isDirectory() !== tStat.isDirectory()) return false;
    if (sStat.isDirectory()) {
      // Recurse one level so we catch mismatched QA / RD subdirs.
      let sChildren: string[];
      let tChildren: string[];
      try {
        sChildren = readdirSync(srcPath);
        tChildren = readdirSync(tgtPath);
      } catch {
        return false;
      }
      if (sChildren.length !== tChildren.length) return false;
      for (const child of sChildren) {
        if (!tChildren.includes(child)) return false;
        const sChildSize = statSync(join(srcPath, child)).size;
        const tChildSize = statSync(join(tgtPath, child)).size;
        if (sChildSize !== tChildSize) return false;
      }
    } else {
      if (sStat.size !== tStat.size) return false;
    }
  }
  return true;
}

/** Plan + execute (when apply=true) the migration for a single misplaced
 *  top-level entry under `.peaks/_runtime/`. */
function migrateOne(args: {
  projectRoot: string;
  changeId: string;
  apply: boolean;
}): MigrateChangeScopePlan {
  const sourceRuntimeTop = join(args.projectRoot, '.peaks', '_runtime', args.changeId);
  const sourcePeaksTop = join(args.projectRoot, '.peaks', args.changeId);
  const canonicalDir = join(args.projectRoot, '.peaks', '_runtime', 'change', args.changeId);

  // Pick the first source that exists.
  const source = existsSync(sourceRuntimeTop)
    ? sourceRuntimeTop
    : existsSync(sourcePeaksTop) ? sourcePeaksTop : '';

  if (source === '') {
    return {
      changeId: args.changeId,
      source: '(none)',
      target: canonicalDir,
      action: 'skipped-already-canonical',
      reason: 'no misplaced source found'
    };
  }

  // Refusal: looks like a session id.
  if (looksLikeSessionId(args.changeId)) {
    return {
      changeId: args.changeId,
      source,
      target: canonicalDir,
      action: 'refused-session-id-collision',
      reason: `${args.changeId} looks like a date-stamped session id; refusing to move`
    };
  }

  // Idempotency check.
  if (existsSync(canonicalDir)) {
    if (shallowContentEqual(source, canonicalDir)) {
      // Source is an exact mirror of the canonical dir — drop the
      // misplaced copy to converge the workspace.
      if (args.apply) {
        rmSync(source, { recursive: true, force: true });
      }
      return {
        changeId: args.changeId,
        source,
        target: canonicalDir,
        action: args.apply ? 'moved' : 'would-move',
        reason: 'canonical dir already byte-equal; would delete the misplaced source'
      };
    }
    return {
      changeId: args.changeId,
      source,
      target: canonicalDir,
      action: 'refused-target-not-empty',
      reason: `canonical dir ${canonicalDir} exists and differs from source; refusing to clobber`
    };
  }

  if (!args.apply) {
    return {
      changeId: args.changeId,
      source,
      target: canonicalDir,
      action: 'would-move'
    };
  }

  // Apply: ensure the canonical parent exists, then rename.
  const canonicalParent = join(args.projectRoot, '.peaks', '_runtime', 'change');
  if (!existsSync(canonicalParent)) {
    mkdirSync(canonicalParent, { recursive: true });
  }
  renameSync(source, canonicalDir);

  // Write a migration marker so future audits can detect that this
  // dir was relocated.
  const markerPath = join(canonicalDir, '.peaks-migration.json');
  writeFileSync(
    markerPath,
    JSON.stringify({
      schemaVersion: 1,
      migratedAt: new Date().toISOString(),
      from: source,
      slice: '2026-06-28-solo-mode-bypass-fix',
      tool: 'peaks workspace migrate-change-scope'
    }, null, 2),
    'utf8'
  );

  return {
    changeId: args.changeId,
    source,
    target: canonicalDir,
    action: 'moved'
  };
}

export function migrateChangeScope(args: {
  projectRoot: string;
  apply: boolean;
}): MigrateChangeScopeResult {
  const root = resolve(args.projectRoot);
  const runtimeRoot = join(root, '.peaks', '_runtime');
  const candidates = listTopLevelChangeIdDirs(runtimeRoot);
  // Also include entries under `.peaks/` that are misplaced (rare but
  // a real edge case from very early releases).
  const peaksRoot = join(root, '.peaks');
  if (existsSync(peaksRoot)) {
    for (const entry of readdirSync(peaksRoot)) {
      if (PEAKS_TOP_LEVEL_DENY.has(entry)) continue;
      if (entry.startsWith('.')) continue;
      if (!looksLikeChangeScopeId(entry)) continue;
      const candidate = join(peaksRoot, entry);
      if (existsSync(candidate) && statSync(candidate).isDirectory() && !candidates.includes(entry)) {
        candidates.push(entry);
      }
    }
  }

  const plans: MigrateChangeScopePlan[] = candidates.map((changeId) =>
    migrateOne({ projectRoot: root, changeId, apply: args.apply })
  );

  const moved = plans.filter((p) => p.action === 'moved');
  const skipped = plans.filter((p) => p.action === 'would-move' || p.action === 'skipped-already-canonical');
  const refused = plans.filter((p) => p.action === 'refused-session-id-collision' || p.action === 'refused-target-not-empty');

  return { projectRoot: root, apply: args.apply, plans, moved, skipped, refused };
}

export function registerMigrateChangeScopeCommand(workspace: Command, io: ProgramIO): void {
  addJsonOption(
    workspace
      .command('migrate-change-scope')
      .description(
        'Slice 2026-06-28-solo-mode-bypass-fix: migrate misplaced change-id content from the legacy ' +
          '`.peaks/_runtime/<changeId>/` (or `.peaks/<changeId>/`) form into the canonical ' +
          '`.peaks/_runtime/change/<changeId>/` location. Default is dry-run; pass --apply to ' +
          'actually rename. Idempotent. Refuses to move entries that look like date-stamped ' +
          'session ids (refusal code MIGRATION_REFUSED_SESSION_ID_COLLISION) or whose target dir ' +
          'exists with non-equal contents (refusal code MIGRATION_REFUSED_TARGET_NOT_EMPTY).'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--apply', 'actually rename the misplaced dirs (destructive); without it, dry-run only', false)
  ).action(async (options: MigrateChangeScopeOptions) => {
    try {
      const projectRoot = resolveCanonicalProjectRoot(options.project);
      const apply = options.apply === true;
      const result = migrateChangeScope({ projectRoot, apply });

      const warnings: string[] = [];
      if (result.plans.length === 0) {
        warnings.push('No misplaced change-id dirs found under .peaks/_runtime/ or .peaks/. Nothing to migrate.');
      } else if (!apply && result.plans.every((p) => p.action === 'would-move' || p.action === 'skipped-already-canonical')) {
        warnings.push(`Dry-run only. Re-run with --apply to perform ${result.plans.filter((p) => p.action === 'would-move').length} move(s).`);
      }
      if (result.refused.length > 0) {
        warnings.push(`${result.refused.length} refusal(s); see plans[].action for the per-entry refusal code.`);
      }

      const nextActions: string[] = [];
      if (!apply && result.plans.some((p) => p.action === 'would-move')) {
        nextActions.push(`Re-run with --apply to perform ${result.plans.filter((p) => p.action === 'would-move').length} move(s).`);
      }
      if (apply && result.moved.length > 0) {
        nextActions.push(`Migrated ${result.moved.length} change-id dir(s) into .peaks/_runtime/change/.`);
      }
      nextActions.push('After migration, re-run `peaks workflow verify-pipeline --rid <rid> --project .` to confirm gates resolve against the canonical path.');

      printResult(io, ok('workspace.migrate-change-scope', result, warnings, nextActions), options.json ?? false);
    } catch (error) {
      printResult(io, fail('workspace.migrate-change-scope', 'WORKSPACE_MIGRATE_FAILED', getErrorMessage(error), { projectRoot: options.project }, ['Verify the project path exists and is writable']), options.json ?? false);
      process.exitCode = 1;
    }
  });
}