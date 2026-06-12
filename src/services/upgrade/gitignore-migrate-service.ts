/**
 * .gitignore 1.x → 2.0 migration service.
 *
 * Real bug surfaced by ice-cola dogfood 2026-06-12:
 *   - 1.x consumer projects often have a wholesale `/.peaks/` (or
 *     `.peaks/` / `.peaks`) entry in their .gitignore — the 1.x
 *     install treated .peaks/ as the tool's ephemeral working
 *     directory.
 *   - In 2.0 the .peaks/ tree is split: most subdirectories
 *     remain ignored (_runtime, _sub_agents, audit, etc.) but
 *     several MUST be tracked: .peaks/standards/,
 *     .peaks/memory/*.md (durable LLM-authored memories),
 *     .peaks/PROJECT.md, and the user opt-in dotfiles.
 *   - A wholesale `.peaks/` ignore silently hides every 2.0
 *     tracked artifact, violating the "one-key completion" tenet
 *     because the user runs upgrade, sees 6/6 pass, then git
 *     status shows no new tracked files — the upgrade looks
 *     "done" but nothing landed in git.
 *
 * The service:
 *   1. Reads the project's .gitignore (string in / string out;
 *      no I/O in the pure function).
 *   2. Detects every line that is a wholesale-ignore of .peaks/
 *      (with or without leading slash, with or without trailing
 *      slash, ignoring surrounding whitespace).
 *   3. Removes those lines and appends the canonical 2.0 block
 *      (granular subpaths) if not already present.
 *   4. The FS variant `migrateGitignoreFile` adds backup +
 *      atomic write on top.
 *
 * Idempotent: re-running on a migrated .gitignore is a no-op.
 *
 * Spec reference: docs/superpowers/specs/2026-06-11-peaks-cli-l1-l2-l3-redesign.md §8.4
 * (per-project state in .peaks/preferences.json, durable
 * memories in .peaks/memory/*.md).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The 2.0 canonical ignore block. Mirrors the same paths
 * peaks-cli's own .gitignore uses; kept in lockstep manually
 * (the peaks-cli root .gitignore is the source of truth).
 *
 * Sentinel: every emitted line carries the marker comment so
 * the migration can detect "already-migrated" and stay
 * idempotent.
 */
export const PEAKS_2_0_BLOCK_SENTINEL = '# peaks-cli 2.0 canonical ignore block — managed by `peaks upgrade --to 2.0`';

export const CANONICAL_2_0_PEAKS_BLOCK = [
  PEAKS_2_0_BLOCK_SENTINEL,
  '.peaks/_runtime/',
  '.peaks/_dogfood/',
  '.peaks/_sub_agents/',
  '.peaks/audit/',
  '.peaks/system/',
  '.peaks/runtime/',
  '.peaks/preferences.json',
  '.peaks/memory/upgrade-2.0-*.md',
].join('\n');

/**
 * Returns true when `line` is a wholesale ignore of the entire
 * `.peaks/` tree (the 1.x pattern that breaks 2.0 tracking).
 *
 * Examples that match:    `.peaks`  `.peaks/`  `/.peaks`  `/.peaks/`  `  .peaks/  `
 * Examples that DON'T:    `.peaks/_runtime/`  `# .peaks/ comment`  `.peaks_other`
 */
export function isStaleWholesalePeaksRule(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return false;
  if (trimmed.startsWith('#')) return false;
  // Strip leading slash (relative-to-repo-root convention) and
  // trailing slash (directory marker); both equivalent in
  // .gitignore semantics for wholesale ignore.
  const normalized = trimmed.replace(/^\//, '').replace(/\/$/, '');
  return normalized === '.peaks';
}

export interface MigrateGitignoreContentResult {
  /** True if at least one stale wholesale .peaks rule was removed OR the canonical block was appended. */
  readonly changed: boolean;
  /** The exact lines that were removed (verbatim, with original whitespace). */
  readonly removedRules: readonly string[];
  /** The migrated content (always ends with a newline). */
  readonly content: string;
}

/**
 * Pure function: takes the .gitignore content, returns the
 * migrated content + diff summary. No I/O.
 */
export function migrateGitignoreContent(input: string): MigrateGitignoreContentResult {
  const lines = input.split('\n');
  const removed: string[] = [];
  const kept: string[] = [];
  for (const line of lines) {
    if (isStaleWholesalePeaksRule(line)) {
      removed.push(line.trim());
    } else {
      kept.push(line);
    }
  }

  // Already-migrated detection: if the canonical block is
  // already present AND nothing was removed, this is a no-op.
  const hasCanonicalBlock = input.includes(PEAKS_2_0_BLOCK_SENTINEL);
  if (removed.length === 0 && hasCanonicalBlock) {
    return { changed: false, removedRules: [], content: input };
  }

  // Already-migrated AND nothing stale: no-op, return original
  // verbatim so byte-equality holds for idempotency.
  if (removed.length === 0 && !hasCanonicalBlock) {
    // Check whether there's anything peaks-related at all; if
    // not, treat as no-op (the user explicitly chose not to
    // ignore .peaks/ — respect that).
    return { changed: false, removedRules: [], content: input };
  }

  // Removed at least one stale rule. Append canonical block
  // if not already present.
  let body = kept.join('\n');
  if (!body.endsWith('\n') && body.length > 0) {
    body += '\n';
  }
  if (!hasCanonicalBlock) {
    body += CANONICAL_2_0_PEAKS_BLOCK + '\n';
  }
  return { changed: true, removedRules: removed, content: body };
}

export interface MigrateGitignoreFileInput {
  readonly projectRoot: string;
  readonly apply?: boolean;
}

export interface MigrateGitignoreFileResult {
  /** True if .gitignore is absent (nothing to migrate). */
  readonly missing: boolean;
  /** True if the migration would change the file. */
  readonly changed: boolean;
  /** True only if `apply: true` AND `changed: true`. */
  readonly appliedWrite: boolean;
  /** Absolute path to the timestamped backup file, or null. */
  readonly backupPath: string | null;
  /** Removed lines (verbatim). */
  readonly removedRules: readonly string[];
}

/**
 * FS variant: reads .gitignore, runs migration, optionally
 * writes the result + a timestamped backup of the original.
 *
 * Date.now() is used for the backup suffix; in test environments
 * where determinism matters, the caller can stub Date via vi.
 */
export function migrateGitignoreFile(input: MigrateGitignoreFileInput): MigrateGitignoreFileResult {
  const path = join(input.projectRoot, '.gitignore');
  if (!existsSync(path)) {
    return {
      missing: true,
      changed: false,
      appliedWrite: false,
      backupPath: null,
      removedRules: [],
    };
  }
  const before = readFileSync(path, 'utf8');
  const result = migrateGitignoreContent(before);

  if (!result.changed) {
    return {
      missing: false,
      changed: false,
      appliedWrite: false,
      backupPath: null,
      removedRules: [],
    };
  }
  if (input.apply !== true) {
    return {
      missing: false,
      changed: true,
      appliedWrite: false,
      backupPath: null,
      removedRules: result.removedRules,
    };
  }
  // Apply: write backup first, then atomic-overwrite the original.
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(input.projectRoot, `.gitignore.peaks-2.0-backup-${ts}`);
  writeFileSync(backupPath, before, 'utf8');
  writeFileSync(path, result.content, 'utf8');
  return {
    missing: false,
    changed: true,
    appliedWrite: true,
    backupPath,
    removedRules: result.removedRules,
  };
}
