// src/services/codegraph/codegraph-exclude-repair.ts
//
// Slice S2 of `2026-09-12-codegraph-exclude-integrity` — the WRITE path.
// WIDENED by slice-002 of `2026-09-16-codegraph-index-integrity` from one
// axis to BOTH config axes; the file name and the entry point's name are
// retained because three seams import them by name and the exclude axis is
// still the entry condition. See the ordering note below — the widening is
// not a second feature bolted on, it is what makes the exclude repair
// correct.
//
// The reconcilers compute; this module applies. Two callers are allowed to
// reach it and nothing else is:
//
//   1. `peaks codegraph init` — after a fresh upstream init (which
//      always writes upstream's 99-rule default `exclude` template AND
//      its 32-entry default `include` template), so a brand new clone /
//      new machine ends up with a complete index instead of silently
//      dropping tracked source files.
//   2. `peaks codegraph repair-exclude` (exclude axis, incremental
//      rebuild) and `peaks codegraph repair-index` (both axes, FORCED
//      rebuild) — the explicit repair for a workspace that was
//      initialized before this shipped, or whose config drifted.
//
// `status` and the doctor check deliberately do NOT live here: they
// read the integrity inspectors and never write.
//
// ── WHY THE INCLUDE AXIS IS PART OF *THIS* REPAIR ─────────────────────
//
// Slice-001's RD measured the reason with a real test failure: an
// `exclude` rule that blocks ONLY a file `include` already drops
// reconciles COMPLETELY CLEAN today — `include: ['**/*.ts']` with
// `exclude: ['**/tool.mjs']` reports `gap:false, rulesToRemove:[]` even
// though that rule is actively harmful. The moment `include` is widened
// (which is exactly what repairing the include axis does) the rule starts
// biting, and the exclude reconciliation is the only thing that can see it.
//
// So the ORDER IS LOAD-BEARING and is enforced structurally rather than by
// comment: `repairCodegraphExcludeFromProject` reconciles `exclude` against
// the NORMALIZED include list, never against the on-disk one. Reconciling
// first would bless a rule that the same run was about to make harmful —
// the repair would report success over a config it had just broken.
//
// Safety posture (the file being edited belongs to a THIRD-PARTY tool):
//   - `rulesToRemove` comes from the exclude reconciler, which only ever
//     lists a rule that actually blocks at least one git-tracked source
//     file AFTER include normalization. A rule that matches nothing
//     tracked is never dropped.
//   - `includePatternsToAdd` comes from the include reconciler, which only
//     ever appends a bare-extension pattern for an extension upstream's
//     extractor supports and its own template omits. User entries are
//     never removed, reordered or rewritten.
//   - Nothing is written when both lists are empty — the config bytes, and
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
//   - Both axes move in ONE rewrite through a same-directory temp file plus
//     `renameSync`, so the config is never observed half-written, there is
//     never a moment where `include` is widened but `exclude` still holds
//     the rules the widened list just made harmful, and one backup covers
//     both.
//   - Every other key of the config survives verbatim, in its original
//     position; only `include` and `exclude` change.

import { join } from 'node:path';

import {
  CODEGRAPH_CONFIG_FILENAME,
  filterAdmittedTrackedFiles,
  readCodegraphProjectInputs,
  reconcileCodegraphExclude
} from './codegraph-exclude-reconciler.js';
import {
  normalizeCodegraphInclude,
  upstreamUnnamedIncludeExtensions
} from './codegraph-include-reconciler.js';
import { upstreamSupportsPath } from './codegraph-index-integrity.js';
import {
  CODEGRAPH_DIR_NAME,
  createCodegraphInvocation,
  executeCodegraphInvocation,
  type CodegraphProcessRunner
} from './codegraph-service.js';
import {
  applyCodegraphConfigRepair,
  CODEGRAPH_CONFIG_BACKUP_SUFFIX,
  repairCodegraphExclude,
  repairCodegraphInclude,
  type CodegraphConfigRepairOutcome,
  type CodegraphConfigRepairPlan,
  type CodegraphExcludeRepairPlan
} from './codegraph-config-repair-writer.js';

// ─────────────────────────────────────────────────────────────────────
// Public surface, unchanged
// ─────────────────────────────────────────────────────────────────────

// Re-exported so every existing `codegraph-exclude-repair.js` import site
// keeps resolving: the extraction moved the definitions, not the contract.
export {
  applyCodegraphConfigRepair,
  CODEGRAPH_CONFIG_BACKUP_SUFFIX,
  repairCodegraphExclude,
  repairCodegraphInclude
};
export type {
  CodegraphConfigRepairOutcome,
  CodegraphConfigRepairPlan,
  CodegraphExcludeRepairPlan
};

// ─────────────────────────────────────────────────────────────────────
// Reconcile → repair → reindex, as one never-throwing step
// ─────────────────────────────────────────────────────────────────────

export type CodegraphExcludeRepairReport = {
  /** True when the config was actually rewritten. */
  readonly applied: boolean;
  /** Rules dropped from `exclude`. */
  readonly rulesRemoved: readonly string[];
  /**
   * Patterns appended to `include` (slice-002). Always a subset of the
   * include reconciler's candidates that were not already admitted.
   */
  readonly includePatternsAdded: readonly string[];
  /** Distinct tracked source files the dropped rules had been hiding. */
  readonly filesRecovered: number;
  /**
   * Distinct tracked source files the WIDENED `include` list newly admits —
   * the INCLUDE axis' counterpart of `filesRecovered`, and a DIFFERENT
   * number on purpose.
   *
   * `filesRecovered` counts the exclude axis only. Before this field
   * existed, `appliedRepairNote` printed `filesRecovered` inside a sentence
   * whose subject was both axes, so the measured run that added 5 include
   * patterns for 31 tracked `.mjs`/`.cjs` files reported "removed 0 exclude
   * rule(s), recovering 0 tracked source file(s)" — a true statement about
   * one axis read as a verdict on both (defect A1 of
   * `2026-09-17-codegraph-msg-and-refresh`).
   *
   * It is a measured DELTA, not a re-report of an absolute count:
   * `includeAdmittedAfter` minus the same admission measurement taken over
   * the ON-DISK include list. Reporting `includeAdmittedAfter` itself as
   * "recovered" would be the tautology slice-002 removed from the
   * coverage ratio (an absolute count says nothing about what changed).
   *
   * Zero by construction when the include plan did not change — the
   * normalized list IS the on-disk list then — which is also why the extra
   * admission pass is gated on `includePlan.changed`: the no-op path (every
   * automatic seam, every re-run) pays nothing for it, unlike the pass
   * slice-002 removed (that one ran on ALL seams, including no-ops).
   */
  readonly includeFilesRecovered: number;
  /**
   * Tracked files the normalized `include` list admits — the NUMERATOR of
   * the coverage ratio. Identical to
   * `reconcileCodegraphExclude`'s `trackedSourceCount` for the normalized
   * list, so it costs no second filtering pass.
   */
  readonly includeAdmittedAfter: number;
  /**
   * Tracked files upstream's extractor would ingest (any supported
   * extension) — the DENOMINATOR, and the same quantity the index axis
   * reports under this same field name (`CodegraphIndexIntegrityReport`).
   *
   * It is measured independently of `includeAdmittedAfter` (an extension
   * decision per tracked file, not a glob match), so the two CAN differ and
   * the ratio can report a shortfall. The field used to be fed from the
   * reconciler's admitted count, i.e. the numerator again, which made every
   * "N of N" the consumers printed a tautology.
   */
  readonly trackedSourceCount: number;
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

function configPathOf(projectRoot: string): string {
  return join(projectRoot, CODEGRAPH_DIR_NAME, CODEGRAPH_CONFIG_FILENAME);
}

function emptyRepairReport(warning: string): CodegraphExcludeRepairReport {
  return {
    applied: false,
    rulesRemoved: [],
    includePatternsAdded: [],
    filesRecovered: 0,
    includeFilesRecovered: 0,
    includeAdmittedAfter: 0,
    trackedSourceCount: 0,
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
 * Reconcile `projectRoot`'s config against its tracked files — normalize
 * `include`, then drop the `exclude` rules that block tracked source files
 * — and rebuild the index so the recovered files actually land in it.
 *
 * ORDER IS LOAD-BEARING. `exclude` is reconciled against the NORMALIZED
 * include list, never the on-disk one: an `exclude` rule that blocks only a
 * file `include` drops reconciles clean today and starts biting the moment
 * `include` is widened, so reconciling before normalizing would let this
 * run report success over a config it had just made worse. See the module
 * header.
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
  let includePlan;
  try {
    // Read once, in the one place that owns the readers. The exclude
    // reconciler is then fed the NORMALIZED include list below, which is
    // what makes the ordering guarantee structural: there is no code path
    // here that reconciles against the on-disk include.
    ({ trackedFiles, config } = readCodegraphProjectInputs(projectRoot));

    // INSIDE the guard on purpose. The adapter loads upstream's own
    // `types.js` / `extraction/grammars.js` out of the installed package and
    // throws if the pinned install is damaged or its `dist/` layout moved;
    // this function's contract is "never throws", and the alternative is
    // that `repair-exclude` / `repair-index` escape to the CLI's generic
    // UNHANDLED_ERROR (and `init` prints FAILURE for an init that already
    // succeeded). A failure here is reported as a warning like every other
    // one.
    includePlan = normalizeCodegraphInclude({
      include: config.include,
      candidateExtensions: upstreamUnnamedIncludeExtensions()
    });
  } catch (error) {
    return emptyRepairReport(`codegraph exclude reconcile skipped: ${errorMessage(error)}`);
  }

  // AFTER normalization, never before. `admitted` here is the normalized
  // admission set, so a rule that the widening would make harmful is
  // visible to this reconciliation in the SAME run that widens.
  const reconcile = reconcileCodegraphExclude({
    trackedFiles,
    include: includePlan.include,
    exclude: config.exclude
  });

  // The numerator is the normalized admission count, which the reconciliation
  // just computed — it is not re-filtered here.
  const includeAdmittedAfter = reconcile.trackedSourceCount;
  // The denominator is a DIFFERENT measurement over the same file list: an
  // extension decision per tracked file (`upstreamSupportsPath`, the same
  // oracle the index axis uses), not a glob match. Two independent
  // measurements can disagree, which is the whole point — a ratio whose
  // numerator and denominator are the same expression cannot report the
  // shortfall it exists to report. It is also cheap: no glob is compiled.
  //
  // This replaced a full `filterAdmittedTrackedFiles(trackedFiles,
  // config.include)` pass whose only consumer was the on-disk "was N"
  // trailer of a user-facing sentence. Perf measured that second pass at
  // 11.73 ms of the repair entry's +14.13 ms (83 %), on ALL THREE automatic
  // seams and both repair commands, including no-ops; the trailer was not
  // worth it. Measured again here on this repo (2,104 tracked files x 32
  // include rules, paired runs): the removed pass 9.78 ms median, this
  // extension check 0.18 ms — and it reports the same 1,240 the status line
  // reports as the denominator, which is the point of using one oracle.
  const trackedSourceCount = trackedFiles.filter((file) => upstreamSupportsPath(file)).length;

  // A1 (2026-09-17): the include axis' own file count, measured as a DELTA
  // against the ON-DISK include list — `includeAdmittedAfter` is the count
  // for the NORMALIZED list, so the difference is exactly the tracked files
  // this run's appends newly admit. Never negative: `includePlan.include` is
  // a superset of `config.include` and admission is monotone in the rule
  // list, so the before-count cannot exceed the after-count.
  //
  // GATED on `includePlan.changed`, which is exact rather than an
  // optimization: when nothing was appended the normalized list IS the
  // on-disk list, so the delta is 0 without measuring anything. The pass
  // this gate keeps off the hot path is the one slice-002 deleted for cost
  // (see the `trackedSourceCount` note above) — the difference is that THIS
  // pass runs only on the one run per project that actually widens
  // `include`, where a repair is about to spend seconds rebuilding an index.
  const includeFilesRecovered = includePlan.changed
    ? includeAdmittedAfter -
      filterAdmittedTrackedFiles(trackedFiles, config.include).length
    : 0;

  const nothingToRepair =
    includePlan.addedPatterns.length === 0 && reconcile.rulesToRemove.length === 0;

  const unchanged = {
    applied: false,
    rulesRemoved: [],
    includePatternsAdded: [],
    filesRecovered: 0,
    includeFilesRecovered: 0,
    includeAdmittedAfter,
    trackedSourceCount,
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
        rulesToRemove: reconcile.rulesToRemove,
        includePatternsToAdd: includePlan.addedPatterns
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
    includePatternsAdded: outcome?.addedIncludePatterns ?? [],
    filesRecovered: reconcile.excludedTrackedCount,
    includeFilesRecovered,
    includeAdmittedAfter,
    trackedSourceCount,
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

// "2 exclude rule(s) removed, 5 include pattern(s) added" — the trailing
// half of every degraded-path warning above. Written once so the four
// warnings cannot drift from each other, and it names BOTH axes because
// either may be the one that changed.
function describeRepair(outcome: CodegraphConfigRepairOutcome | null): string {
  if (outcome === null || !outcome.applied) {
    return 'nothing written';
  }

  return `${outcome.removedRules.length} exclude rule(s) removed, ${outcome.addedIncludePatterns.length} include pattern(s) added`;
}
