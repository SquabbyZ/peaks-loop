// src/services/codegraph/codegraph-exclude-repair.ts
//
// Slice S2 of `2026-09-12-codegraph-exclude-integrity` — the WRITE path.
//
// S1 computes `rulesToRemove`; this module applies it. Two callers are
// allowed to reach it and nothing else is:
//
//   1. `peaks codegraph init` — after a fresh upstream init (which
//      always writes upstream's 99-rule default template), so a brand
//      new clone / new machine ends up with a complete index instead
//      of silently dropping tracked source files.
//   2. `peaks codegraph repair-exclude` — the explicit repair for a
//      workspace that was initialized before this slice shipped, or
//      whose config drifted.
//
// `status` and the doctor check deliberately do NOT live here: they
// read `codegraph-exclude-integrity.ts` and never write.
//
// Safety posture (the file being edited belongs to a THIRD-PARTY tool):
//   - `rulesToRemove` comes from S1, which only ever lists a rule that
//     actually blocks at least one git-tracked source file. A rule that
//     matches nothing tracked is never dropped.
//   - Nothing is written when `rulesToRemove` is empty — the config
//     bytes, and its mtime, are untouched.
//   - The original bytes are copied to `config.json.bak` before the
//     rewrite, so a rollback is byte-exact.
//   - The rewrite itself goes through a same-directory temp file plus
//     `renameSync`, so the config is never observed half-written.
//   - Every other key of the config survives verbatim, in its original
//     position; only `exclude` changes.

import { randomBytes } from 'node:crypto';
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  assertStringArray,
  CODEGRAPH_CONFIG_FILENAME
} from './codegraph-exclude-reconciler.js';
import {
  CODEGRAPH_DIR_NAME,
  createCodegraphInvocation,
  executeCodegraphInvocation,
  type CodegraphProcessRunner
} from './codegraph-service.js';
import { inspectCodegraphExcludeIntegrity } from './codegraph-exclude-integrity.js';

/** Suffix of the byte-exact pre-repair copy kept next to the config. */
export const CODEGRAPH_CONFIG_BACKUP_SUFFIX = '.bak';

// ─────────────────────────────────────────────────────────────────────
// Pure plan
// ─────────────────────────────────────────────────────────────────────

export type CodegraphExcludeRepairPlan = {
  /** True when at least one rule would actually be dropped. */
  readonly changed: boolean;
  /** The `exclude` array after the removal. */
  readonly exclude: readonly string[];
  /** Rules actually present in `exclude` and dropped, in config order. */
  readonly removedRules: readonly string[];
};

/**
 * Pure: given the current `exclude` list and the rules to drop, return
 * the new list. No fs, no clock, no serialization.
 *
 * A rule named in `rulesToRemove` but absent from `exclude` is NOT
 * invented — the result is a subset of the input, so a caller can
 * never add a rule by accident. Removing an already-absent rule is a
 * no-op, which is what makes the whole repair idempotent: feeding the
 * repaired list back in yields `changed: false`.
 */
export function repairCodegraphExclude(input: {
  readonly exclude: readonly string[];
  readonly rulesToRemove: readonly string[];
}): CodegraphExcludeRepairPlan {
  const removable = new Set(input.rulesToRemove);
  // De-duplicated, order-preserving. A config that lists the same rule
  // twice would otherwise be counted twice here, and this array is what
  // the caller reports to the user as "rules removed".
  const removedRules = [...new Set(input.exclude.filter((rule) => removable.has(rule)))];

  if (removedRules.length === 0) {
    return { changed: false, exclude: input.exclude, removedRules: [] };
  }

  return {
    changed: true,
    exclude: input.exclude.filter((rule) => !removable.has(rule)),
    removedRules
  };
}

// ─────────────────────────────────────────────────────────────────────
// Writer
// ─────────────────────────────────────────────────────────────────────

export type CodegraphExcludeRepairOutcome =
  | { readonly applied: false; readonly reason: 'no-rules-to-remove'; readonly removedRules: readonly string[] }
  | {
      readonly applied: true;
      readonly configPath: string;
      readonly backupPath: string;
      readonly removedRules: readonly string[];
      readonly excludeCountBefore: number;
      readonly excludeCountAfter: number;
    };

/**
 * Detect the indentation the config already uses so the rewrite keeps
 * the file's shape instead of reformatting a third-party tool's file.
 *
 * A single-line (minified) config has no indentation to copy: `0` tells
 * `JSON.stringify` to emit compact JSON, so the file comes back as the
 * one-liner it went in as. `0` is NOT the same as "not set" here — an
 * omitted indent would also be compact, but returning a number keeps the
 * intent explicit at the call site.
 *
 * Falls back to two spaces when the file spans lines but has no indented
 * member.
 */
function detectIndent(text: string): string | number {
  if (!text.trimEnd().includes('\n')) {
    return 0;
  }
  const match = /\n([ \t]+)"/.exec(text);
  return match?.[1] ?? 2;
}

function serializeConfig(config: Record<string, unknown>, originalText: string): string {
  const body = JSON.stringify(config, null, detectIndent(originalText));
  return originalText.endsWith('\n') ? `${body}\n` : body;
}

/**
 * Write `content` to `filePath` atomically: same-directory temp file,
 * then `renameSync` over the target.
 *
 * The file being written belongs to a THIRD-PARTY tool, so a crash or a
 * full disk mid-`writeFileSync` must never leave a half-written config
 * behind. `rename` within one directory is atomic, so a reader sees
 * either the old bytes or the new ones, never a prefix of the new ones.
 * The temp file lives next to the target (same directory ⇒ same
 * filesystem ⇒ the rename cannot degrade to a cross-device copy) and is
 * removed if the write or the rename fails.
 *
 * N5: the temp name carries the pid plus 6 random bytes. A FIXED
 * `${filePath}.tmp` is single-writer only, and this writer has three
 * reachable concurrent callers — a fresh `peaks codegraph init` (which
 * repairs then indexes), the pre-dispatch preflight, and the post-slice
 * autorefresh. Two overlapping writers sharing one temp name let one
 * `renameSync` publish a file the other was still writing, which is
 * exactly the half-written config the temp file exists to prevent. The
 * suffix keeps the temp in the SAME directory, so the rename stays
 * within one filesystem and therefore stays atomic.
 */
function writeConfigAtomic(filePath: string, content: string): void {
  const tempPath = `${filePath}.${String(process.pid)}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(tempPath, content, 'utf8');
    renameSync(tempPath, filePath);
  } catch (error) {
    rmSync(tempPath, { force: true });
    throw error;
  }
}

/**
 * Apply the repair to `<projectRoot>/.codegraph/config.json`.
 *
 * No-op (and no write, no mtime change, no backup) when
 * `rulesToRemove` is empty. Otherwise: back up the original bytes to
 * `config.json.bak`, then rewrite the file with `exclude` reduced by
 * exactly the rules that were both requested and present.
 *
 * Throws only on real fs/parse failures — the caller decides whether
 * that is fatal (`repair-exclude` → non-zero exit) or a surfaced
 * warning (`init` → keep going, the init itself already succeeded).
 */
export function applyCodegraphExcludeRepair(
  projectRoot: string,
  rulesToRemove: readonly string[]
): CodegraphExcludeRepairOutcome {
  if (rulesToRemove.length === 0) {
    return { applied: false, reason: 'no-rules-to-remove', removedRules: [] };
  }

  const configPath = join(projectRoot, CODEGRAPH_DIR_NAME, CODEGRAPH_CONFIG_FILENAME);
  const originalText = readFileSync(configPath, 'utf8');

  const parsed: unknown = JSON.parse(originalText);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`codegraph config ${configPath}: expected a JSON object`);
  }
  const record = parsed as Record<string, unknown>;
  const exclude = assertStringArray(record.exclude, 'exclude', configPath);

  const plan = repairCodegraphExclude({ exclude, rulesToRemove });
  if (!plan.changed) {
    return { applied: false, reason: 'no-rules-to-remove', removedRules: [] };
  }

  const backupPath = `${configPath}${CODEGRAPH_CONFIG_BACKUP_SUFFIX}`;
  writeFileSync(backupPath, originalText, 'utf8');

  // Spread first, then replace `exclude` — every other key keeps its
  // original value AND its original position in the serialized object.
  writeConfigAtomic(configPath, serializeConfig({ ...record, exclude: plan.exclude }, originalText));

  return {
    applied: true,
    configPath,
    backupPath,
    removedRules: plan.removedRules,
    excludeCountBefore: exclude.length,
    excludeCountAfter: plan.exclude.length
  };
}

// ─────────────────────────────────────────────────────────────────────
// Reconcile → repair → reindex, as one never-throwing step
// ─────────────────────────────────────────────────────────────────────

export type CodegraphExcludeRepairReport = {
  /** True when the config was actually rewritten. */
  readonly applied: boolean;
  /** Rules dropped from `exclude`. */
  readonly rulesRemoved: readonly string[];
  /** Distinct tracked source files the dropped rules had been hiding. */
  readonly filesRecovered: number;
  /** Tracked files the config's `include` filter admits at all. */
  readonly trackedSourceCount: number;
  /** Absolute path of the rewritten config (empty when nothing was written). */
  readonly configPath: string;
  /** Byte-exact rollback copy (null when nothing was written). */
  readonly backupPath: string | null;
  /** True when the post-repair `codegraph index` finished successfully. */
  readonly reindexed: boolean;
  /**
   * Non-null when the step could not run to completion (no git repo,
   * missing config, malformed config, upstream index failure, …).
   * Always reported, never swallowed — but never thrown either, so a
   * successful `peaks codegraph init` is never undone by it.
   */
  readonly warning: string | null;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyRepairReport(warning: string): CodegraphExcludeRepairReport {
  return {
    applied: false,
    rulesRemoved: [],
    filesRecovered: 0,
    trackedSourceCount: 0,
    configPath: '',
    backupPath: null,
    reindexed: false,
    warning
  };
}

export type CodegraphExcludeRepairOptions = {
  /**
   * When `false`, skip the follow-up `codegraph index` rebuild and
   * return `reindexed: false` (with no warning — nothing went wrong).
   *
   * Set by callers that run their OWN index immediately after this
   * step: the pre-dispatch preflight and the post-slice autorefresh
   * both call `init` → `index`, and an index is expensive enough
   * (5-30 s on this repo) that a fresh init must not pay for it twice.
   */
  readonly reindex?: boolean;
};

/**
 * Reconcile `projectRoot`'s exclude list, drop the rules that block
 * tracked source files, and rebuild the index so the recovered files
 * actually land in it.
 *
 * This is the ONE shared "after upstream init" self-heal: the CLI's
 * fresh `peaks codegraph init`, the pre-dispatch preflight and the
 * post-slice autorefresh all call it, so a fresh clone cannot end up
 * with a peaks-loop marker stamped over an incomplete index that no
 * later `init` would ever repair.
 *
 * Never throws. Every failure becomes a populated `warning` field, so
 * the caller can surface it without the step being able to break the
 * command it is attached to — including the fail-soft preflight and
 * the never-throwing `refreshCodegraphAfterSlice`.
 */
export async function repairCodegraphExcludeFromProject(
  projectRoot: string,
  runner?: CodegraphProcessRunner,
  options: CodegraphExcludeRepairOptions = {}
): Promise<CodegraphExcludeRepairReport> {
  let integrity;
  try {
    integrity = inspectCodegraphExcludeIntegrity(projectRoot);
  } catch (error) {
    return emptyRepairReport(`codegraph exclude reconcile skipped: ${errorMessage(error)}`);
  }

  if (integrity.rulesToRemove.length === 0) {
    return {
      applied: false,
      rulesRemoved: [],
      filesRecovered: 0,
      trackedSourceCount: integrity.trackedSourceCount,
      configPath: integrity.configPath,
      backupPath: null,
      reindexed: false,
      warning: null
    };
  }

  let outcome: CodegraphExcludeRepairOutcome;
  try {
    outcome = applyCodegraphExcludeRepair(projectRoot, integrity.rulesToRemove);
  } catch (error) {
    return emptyRepairReport(
      `codegraph exclude repair failed for ${integrity.configPath}: ${errorMessage(error)}`
    );
  }

  if (!outcome.applied) {
    return {
      applied: false,
      rulesRemoved: [],
      filesRecovered: 0,
      trackedSourceCount: integrity.trackedSourceCount,
      configPath: integrity.configPath,
      backupPath: null,
      reindexed: false,
      warning: null
    };
  }

  const base = {
    applied: true,
    rulesRemoved: outcome.removedRules,
    filesRecovered: integrity.excludedTrackedCount,
    trackedSourceCount: integrity.trackedSourceCount,
    configPath: outcome.configPath,
    backupPath: outcome.backupPath
  };

  if (options.reindex === false) {
    // The caller indexes immediately after this returns, so doing it
    // here too would index the same tree twice for no extra coverage.
    return { ...base, reindexed: false, warning: null };
  }

  // The recovered files are on disk but not in the index yet. Rebuild
  // it now — that is the whole point of repairing at init time.
  try {
    const result = await executeCodegraphInvocation(
      createCodegraphInvocation({ subcommand: 'index', project: projectRoot, quiet: true }),
      runner
    );

    if (result.exitCode !== 0) {
      return {
        ...base,
        reindexed: false,
        warning: `codegraph exclude repaired (${outcome.removedRules.length} rule(s) removed) but the follow-up index failed (exit ${String(result.exitCode)}); run \`peaks codegraph index --project <root>\`.`
      };
    }

    return { ...base, reindexed: true, warning: null };
  } catch (error) {
    return {
      ...base,
      reindexed: false,
      warning: `codegraph exclude repaired (${outcome.removedRules.length} rule(s) removed) but the follow-up index could not run: ${errorMessage(error)}`
    };
  }
}
