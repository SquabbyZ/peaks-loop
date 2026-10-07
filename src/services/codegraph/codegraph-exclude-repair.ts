// src/services/codegraph/codegraph-exclude-repair.ts
//
// reconcilers to the config axes; the file name and the entry point's name are
// retained because three seams import them by name and the exclude axis is
// still the entry condition.
//
// ── THE INCLUDE AXIS IS GONE (1.6.2 upgrade) ──────────────────────────
//
// This seam used to repair BOTH axes: it appended the extensions upstream's
// own default `include` template omitted, then reconciled `exclude` against
// that widened list. 1.6.x removed both halves of the premise. It ships no
// `include` template at all, and it inverted what `include` MEANS: upstream's
// own description is now "first-party source to force INTO the index even when
// `.gitignore` drops it", while selection became `.gitignore`-driven. So the
// candidate set stopped being "the five extensions the template forgot" and
// became every extension the extractor supports — and appending those would
// not have covered a gap, it would have told upstream to index gitignored
// source. That is a defect, not a deferral, so the axis and its reconciler
// were deleted rather than left pending.
//
// The exclude axis survives, and its job is now STRICTLY NARROWER than it was.
// It used to hunt two things: a rule from upstream's 99-entry default template
// that collided with real source (1.6.x ships no such template, so that class
// is gone), and a rule a project AUTHORED that blocks its own tracked source.
// The second is live — `codegraph.json`'s `exclude` still means "keep OUT of
// the index even when git-tracked" — and it is what this seam repairs.
//
// The reconcilers compute; this module applies. Two callers are allowed to
// reach it and nothing else is:
//
//   1. `peaks codegraph init` — after a fresh upstream init, so a brand new
//      clone / new machine ends up with an index that does not silently drop
//      tracked source files.
//   2. `peaks codegraph repair-exclude` (incremental rebuild) and
//      `peaks codegraph repair-index` (FORCED rebuild) — the explicit repair
//      for a workspace whose config drifted.
//
// `status` and the doctor check deliberately do NOT live here: they
// read the integrity inspectors and never write.
//
// Safety posture (the file being edited belongs to a THIRD-PARTY tool):
//   - `rulesToRemove` comes from the exclude reconciler, which only ever
//     lists a rule that actually blocks at least one git-tracked source
//     file. A rule that matches nothing tracked is never dropped, and no
//     user entry is ever added, removed, reordered or rewritten.
//   - Nothing is written when the list is empty — the config bytes, and
//     its mtime, are untouched.
//   - The original bytes are copied to `config.json.bak` before the
//     rewrite, so a rollback is byte-exact *whenever that copy is THIS
//     writer's own*: the backup is written through the same CSPRNG-named
//     temp + `renameSync` as the config, and the write REFUSES a link at
//     the backup path (see `writeConfigBackup`). The path is fixed and
//     therefore guessable, so a repo that commits
//     `.codegraph/config.json.bak` as a symlink or a hard link would
//     otherwise redirect the copy into an arbitrary file — a
//     write-what-where with attacker-chosen content, reachable with no
//     explicit command. `.codegraph/` receives no gitignore coverage in a
//     consumer project (`config.json.bak` matches neither the peaks-loop
//     snippet nor upstream's own `.codegraph/.gitignore`), so both files
//     are committable.
//   - `rollbackCodegraphConfig` is that copy's READER, and it is reached by the
//     EXPLICIT `peaks codegraph config-restore` verb — never from here. A
//     repair must not undo itself: this seam's job is to close the gap, so a
//     run that restored its own write would leave the config exactly as it
//     found it and `peaks codegraph status` still reporting the gap (exit 75
//     never clearing). Rolling back is an operator decision, not a step.
//   - The DIRECTORY both paths live in is contained: `assertCodegraphDirContained`
//     refuses when `<projectRoot>/.codegraph` resolves (junction or symlink)
//     outside the canonical project root, so neither the read nor either
//     write can be redirected into another project's `.codegraph/`
//     (security R1). Containment is the predicate, not link-ness — see the
//     function's own note on why an in-project link is allowed.
//   - The rewrite is ONE same-directory temp file plus `renameSync`, so the
//     config is never observed half-written.
//   - Every other key of the config survives verbatim, in its original
//     position; only `exclude` changes.

import {
  readCodegraphProjectInputs,
  reconcileCodegraphExclude
} from './codegraph-exclude-reconciler.js';
import { upstreamSupportsPath } from './codegraph-index-integrity.js';
import { resolveCodegraphConfigSource } from './codegraph-project-config.js';
import {
  createCodegraphInvocation,
  executeCodegraphInvocation,
  type CodegraphProcessRunner
} from './codegraph-service.js';
import {
  applyCodegraphConfigRepair,
  CODEGRAPH_CONFIG_BACKUP_SUFFIX,
  repairCodegraphExclude,
  type CodegraphConfigRepairOutcome,
  type CodegraphConfigRepairPlan,
  type CodegraphExcludeRepairPlan
} from './codegraph-config-repair-writer.js';

// ─────────────────────────────────────────────────────────────────────
// Public surface, unchanged
// ─────────────────────────────────────────────────────────────────────

// Re-exported so every existing `codegraph-exclude-repair.js` import site
// keeps resolving: the extraction moved the definitions, not the contract.
export { applyCodegraphConfigRepair, CODEGRAPH_CONFIG_BACKUP_SUFFIX, repairCodegraphExclude };
export type { CodegraphConfigRepairOutcome, CodegraphConfigRepairPlan, CodegraphExcludeRepairPlan };

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
  /**
   * Absolute path of the rewritten config. Empty when nothing was written
   * AND the reads failed (there is no config to name).
   */
  readonly configPath: string;
  /**
   * Byte-exact rollback copy (null when nothing was written).
   *
   * It is a rollback POINT, not a rollback: nothing in this seam reads it back.
   * Putting the config back is the separate, explicit
   * `peaks codegraph config-restore` verb, so this field is what that verb
   * would read — and its presence is the one guarantee that a restore is
   * possible at all.
   */
  readonly backupPath: string | null;
  /** True when the post-repair `codegraph index` finished successfully. */
  readonly reindexed: boolean;
  /**
   * True when the follow-up index was run with upstream's `--force`, i.e.
   * as a full rebuild that drops rows for files that no longer exist. An
   * incremental index cannot do that — see `CodegraphExcludeRepairOptions`.
   */
  readonly forcedRebuild: boolean;
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

// The config this seam reads and writes is the one the installed upstream
// consults, so the path comes from that one resolver rather than being spelled
// here — see `codegraph-project-config.ts`. Called on failure paths too, which
// is safe: resolving is a probe, not a read, so it names the file even when
// opening it is what failed.
function configPathOf(projectRoot: string): string {
  return resolveCodegraphConfigSource(projectRoot).configPath;
}

function emptyRepairReport(warning: string): CodegraphExcludeRepairReport {
  return {
    applied: false,
    rulesRemoved: [],
    filesRecovered: 0,
    configPath: '',
    backupPath: null,
    reindexed: false,
    forcedRebuild: false,
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
   *
   * When `'force'`, run `codegraph index --force` instead: upstream's
   * `--force` is `clear()` + full re-index, and it is the ONLY documented
   * way to drop rows for files deleted in an earlier commit. Verified in
   * the installed upstream source (0.7.10):
   *
   *   - `dist/bin/codegraph.js` → `index --force` calls `cg.clear()` then
   *     `cg.indexAll()`;
   *   - `dist/db/queries.js` `clear()` deletes unresolved_refs, edges,
   *     nodes and files;
   *   - plain `indexAll()` (`dist/extraction/index.js`) scans and upserts
   *     every file but never removes a row, so an incremental index keeps
   *     rows for paths that are gone;
   *   - `codegraph sync` DOES delete them, but only for the deletions
   *     `git status --porcelain` reports in the WORKING TREE. Measured on
   *     this repo: all four dead rows are committed deletions, invisible to
   *     `git status`, so `sync` would purge none of them.
   *
   * Cost note. The PARSE half of the old claim here was exactly true and
   * is kept: plain `indexAll()` already re-reads and re-parses EVERY file
   * (its only skip is `maxFileSize`). The PRICE half was wrong and is
   * corrected to the perf audit's measurements, because it is the sentence
   * a future reader would quote: `storeExtractionResult`
   * (`dist/extraction/index.js`) hash-skips all WRITES for unchanged files
   * in a plain `index`, so `--force` additionally pays a full re-insert of
   * every node and edge after `clear()`. Executed with the real binary on a
   * 2,100-file fixture, paired 5 runs: plain median 3,810 ms vs forced
   * 5,400 ms = +1,590 ms (+42 %), positive 5/5; on a copy of this repo's db,
   * `clear()` alone is 414/462/537 ms while clear+reinsert is 2.7-6.2 s.
   * "Forced" is a real cost, not a rounding error.
   *
   * That does NOT change the policy: the reason the automatic seams do not
   * force is policy, not cost. The advisory-by-default decision (user option
   * C) exists so that upgrading peaks-loop cannot change a downstream
   * project's cost profile, and purging dead rows is the caller's explicit
   * request instead.
   *
   * `'force'` changes ONLY the rebuild, never the config: it is the same
   * two-axis repair as `'exclude'`, followed by `cg.clear()` + `indexAll()`
   * instead of an incremental index. The config repair STAYS — that is what
   * makes the force mode worth its cost, because `include` has to be widened
   * before a rebuild can admit the files the config was dropping.
   *
   * Not a self-cancelling run, and that is a design decision rather than a
   * detail: a mode that wrote the repair and then restored the pre-repair bytes
   * would leave the config exactly as it found it, `peaks codegraph status`
   * would still report the gap, and exit 75 would never clear. Putting the
   * config BACK is the explicit `peaks codegraph config-restore` verb, which
   * reads the `.bak` this run leaves — an operator decision, not a side effect
   * of asking for a rebuild.
   */
  readonly reindex?: boolean | 'force';
};

/**
 * Reconcile `projectRoot`'s config against its tracked files — drop the
 * `exclude` rules that block tracked source files — and rebuild the index so
 * the recovered files actually land in it.
 *
 * The reconciliation runs the config's OWN `include` filter first, exactly as
 * upstream applies it, so a rule that only blocks files the index would not
 * ingest anyway is not a violation. See the module header for what this seam
 * no longer does and why.
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
  const forcedRebuild = options.reindex === 'force';
  let trackedFiles;
  let config;
  try {
    // Read once, in the one place that owns the readers. The config this
    // returns is the one the installed upstream consults, and `exclude` is
    // reconciled against the on-disk list exactly as upstream would apply it.
    ({ trackedFiles, config } = readCodegraphProjectInputs(projectRoot));
  } catch (error) {
    return emptyRepairReport(`codegraph exclude reconcile skipped: ${errorMessage(error)}`);
  }

  const reconcile = reconcileCodegraphExclude({
    trackedFiles,
    include: config.include,
    exclude: config.exclude,
    admissionModel: config.model,
    // Same oracle as the index axis — see `excludeCandidates`.
    supportsPath: upstreamSupportsPath
  });

  const nothingToRepair = reconcile.rulesToRemove.length === 0;

  const unchanged = {
    applied: false,
    rulesRemoved: [],
    filesRecovered: 0,
    configPath: configPathOf(projectRoot),
    backupPath: null,
    reindexed: false,
    forcedRebuild: false,
    warning: null
  };

  // Nothing to write AND no rebuild was asked for: the config bytes and
  // their mtime are untouched, and no upstream process is spawned.
  //
  // A FORCED rebuild is exempt on purpose: `repair-index`'s contract is
  // "make the index match the repository", and a clean reconciliation does
  // NOT prove the index is complete — the gate's coverage verdict is
  // admission-only (a file `include` admits that upstream skipped for
  // `maxFileSize` or on an extraction error is not visible to it at all;
  // slice-001 recorded that as a known limitation). So the operator who
  // asked for a forced rebuild gets one.
  if (nothingToRepair && !forcedRebuild) {
    return unchanged;
  }

  let outcome: CodegraphConfigRepairOutcome | null = null;
  if (!nothingToRepair) {
    try {
      outcome = applyCodegraphConfigRepair(projectRoot, {
        rulesToRemove: reconcile.rulesToRemove
      });
    } catch (error) {
      return emptyRepairReport(
        `codegraph exclude repair failed for ${configPathOf(projectRoot)}: ${errorMessage(error)}`
      );
    }

    // The plan said there was work and the writer found none (a config that
    // changed underneath us, or a rule/pattern already applied). Report the
    // read-side numbers and write nothing further.
    if (!outcome.applied) {
      return unchanged;
    }
  }

  const base = {
    applied: outcome !== null,
    rulesRemoved: outcome?.removedRules ?? [],
    filesRecovered: reconcile.excludedTrackedCount,
    configPath: configPathOf(projectRoot),
    backupPath: outcome?.backupPath ?? null
  };

  if (options.reindex === false) {
    // The caller indexes immediately after this returns, so doing it
    // here too would index the same tree twice for no extra coverage.
    return { ...base, reindexed: false, forcedRebuild: false, warning: null };
  }

  // The recovered files are on disk but not in the index yet, and (under
  // `'force'`) rows for files that are gone may still be in it. Rebuild now
  // — that is the whole point of repairing.
  const repairedSummary = describeRepair(outcome);
  try {
    const result = await executeCodegraphInvocation(
      createCodegraphInvocation({
        subcommand: 'index',
        project: projectRoot,
        quiet: true,
        ...(forcedRebuild ? { force: true } : {})
      }),
      runner
    );

    if (result.exitCode !== 0) {
      // `forcedRebuild` reports what WAS ATTEMPTED, not what completed:
      // upstream's `index --force` runs `cg.clear()` BEFORE `indexAll()`, so
      // a forced run that failed has already deleted the rows. Hardcoding
      // `false` here (as this did) made the envelope unable to distinguish
      // "no forced purge ever ran" from "the forced purge ran and the
      // rebuild then failed" — the one case where a JSON consumer most needs
      // to know. `reindexed: false` carries "did not complete".
      return {
        ...base,
        reindexed: false,
        forcedRebuild,
        warning: `codegraph config repaired (${repairedSummary}) but the follow-up index failed (exit ${String(result.exitCode)}); run \`peaks codegraph index --project <root>\`.`
      };
    }

    return { ...base, reindexed: true, forcedRebuild, warning: null };
  } catch (error) {
    // Same reasoning as the non-zero exit above: the invocation may have
    // reached upstream's `clear()` before the failure.
    return {
      ...base,
      reindexed: false,
      forcedRebuild,
      warning: `codegraph config repaired (${repairedSummary}) but the follow-up index could not run: ${errorMessage(error)}`
    };
  }
}

// "2 exclude rule(s) removed" — the trailing half of every degraded-path
// warning above. Written once so the four warnings cannot drift from each
// other.
function describeRepair(outcome: CodegraphConfigRepairOutcome | null): string {
  if (outcome === null || !outcome.applied) {
    return 'nothing written';
  }

  return `${outcome.removedRules.length} exclude rule(s) removed`;
}
