/**
 * `peaks session migrate-skill-name` core service (slice 2 of the
 * peaks-code → peaks-code rename plan).
 *
 * Walks `.peaks/_runtime/**` and rewrites two patterns:
 *   1. Key-value:   `"skill": "<old>"`  →  `"skill": "<new>"`
 *   2. Slash-trig:  `/<old>`            →  `/<new>`
 *
 * Files under known skip-paths (`.peaks/memory/**`,
 * `.peaks/skills/.system/bees/<old>/manifest.json`) are recorded in
 * `skipped` but never opened. The operation is idempotent: re-running
 * with the same `--from` on a tree already migrated reports 0
 * modifications.
 *
 * Dry-run (`apply: false`) counts what WOULD change without writing;
 * apply (`apply: true`) validates each `.json` payload with
 * `JSON.parse` before writing so a broken mid-edit never lands on
 * disk. Errors are pushed into `result.errors` (never swallowed).
 */
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { MigrateResult } from './schema.js';

export interface MigrateOpts {
  projectRoot: string;
  from: string;
  to: string;
  /** false = dry-run (default); true = write through. */
  apply: boolean;
}

/**
 * Skip-paths are matched against the path relative to `projectRoot`,
 * forward-slashed (Windows-friendly). Each entry is a SUBSTRING —
 * the brief pins two specific exclusions: the memory dir, and the
 * .system bee manifest for the old skill (which the renamer must
 * leave alone until the bee itself is moved in a later slice).
 */
const SKIP_DIRS = ['.peaks/memory', '.peaks/skills/.system/bees'] as const;
const TARGET_ROOT = '.peaks/_runtime';

const KEY_VALUE_PATTERN = (from: string, to: string): RegExp =>
  new RegExp(`"skill"\\s*:\\s*"${escapeRe(from)}"`, 'g');
const STRING_PATTERN = (from: string, to: string): RegExp =>
  new RegExp(`/${escapeRe(from)}`, 'g');

/**
 * Escape regex metachars so an aggressive `--from` value (e.g.
 * `peaks.code`) doesn't blow up the regex compiler. The two regexes
 * above use `from` inside both body and character-class territory,
 * so escaping is the safe path regardless of input.
 */
function escapeRe(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True iff `absPath` falls under any skip-path (substring match). */
export function shouldSkip(projectRoot: string, absPath: string): boolean {
  const rel = relative(projectRoot, absPath).replace(/\\/g, '/');
  return SKIP_DIRS.some((skip) => rel.includes(skip));
}

/**
 * Recursively walk a directory and return every `.json` / `.md`
 * path. Missing root → empty list (the CLI reports scannedFiles:0,
 * which is the truthful "nothing to look at" signal).
 */
export function walkRuntimeFiles(root: string): string[] {
  const out: string[] = [];
  if (!existsSync(root)) return out;
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        visit(full);
      } else if (entry.endsWith('.json') || entry.endsWith('.md')) {
        out.push(full);
      }
    }
  };
  visit(root);
  return out;
}

export function migrateSkillName(opts: MigrateOpts): MigrateResult {
  const runtimeRoot = join(opts.projectRoot, TARGET_ROOT);
  const files = walkRuntimeFiles(runtimeRoot);
  const result: MigrateResult = {
    ok: true,
    scannedFiles: files.length,
    modifiedFiles: 0,
    keyValueReplacements: 0,
    stringReplacements: 0,
    skipped: [...SKIP_DIRS],
    errors: [],
  };

  for (const file of files) {
    if (shouldSkip(opts.projectRoot, file)) continue;

    let original: string;
    try {
      original = readFileSync(file, 'utf-8');
    } catch (e) {
      // Unreadable file: surface the error and keep going (other
      // files may be fine). `ok` flips to false; reporting stops
      // hiding the failure from the operator.
      result.errors.push(`${file}: read failed: ${(e as Error).message}`);
      result.ok = false;
      continue;
    }

    // Pin the broken-JSON test: any .json runtime file that fails
    // to parse MUST be surfaced as an error, EVEN when it does not
    // contain the from-name (the operator still needs to know the
    // file is unparseable so they can fix it before re-running).
    // Per Karpathy §4 honesty, silent skip is the worst kind of
    // fake-green.
    if (file.endsWith('.json')) {
      try {
        JSON.parse(original);
      } catch (e) {
        result.errors.push(`${file}: invalid JSON: ${(e as Error).message}`);
        result.ok = false;
        continue;
      }
    }

    let mutated = original;

    const kvPattern = KEY_VALUE_PATTERN(opts.from, opts.to);
    const kvMatches = mutated.match(kvPattern);
    if (kvMatches) {
      mutated = mutated.replace(kvPattern, `"skill": "${opts.to}"`);
      result.keyValueReplacements += kvMatches.length;
    }

    const strPattern = STRING_PATTERN(opts.from, opts.to);
    const strMatches = mutated.match(strPattern);
    if (strMatches) {
      mutated = mutated.replace(strPattern, `/${opts.to}`);
      result.stringReplacements += strMatches.length;
    }

    if (mutated === original) continue;

    if (opts.apply) {
      try {
        if (file.endsWith('.json')) {
          // Validate the post-edit JSON before touching the disk —
          // catches accidents (e.g., stray quotes in the renamed
          // from/to values) without leaving a corrupted runtime file
          // behind.
          JSON.parse(mutated);
        }
        writeFileSync(file, mutated, 'utf-8');
        result.modifiedFiles += 1;
      } catch (e) {
        result.errors.push(`${file}: ${(e as Error).message}`);
        result.ok = false;
      }
    }
    // Dry-run path intentionally does not bump `modifiedFiles` —
    // pin: `expect(result.modifiedFiles).toBe(0)` in the dry-run
    // test. The would-be count lives implicitly in the *Replacement
    // counters, which both dry-run and apply share.
  }

  return result;
}
