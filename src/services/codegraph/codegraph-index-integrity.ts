// src/services/codegraph/codegraph-index-integrity.ts
//
// Slice-001 of `2026-09-16-codegraph-index-integrity` — the READ-ONLY
// integrity report for the two index defects the exclude gate cannot see.
// Shared by `peaks codegraph status` and the
// `capability:codegraph-index-integrity` doctor check.
//
// The exclude gate (`codegraph-exclude-integrity.ts`) answers "do the
// config's `exclude` rules block a tracked source file". It runs the
// `include` filter FIRST and only reconciles `exclude` against the
// survivors, and it never looks at the index contents. So two classes of
// defect are structurally invisible to it:
//
//   ① INCLUDE-AXIS GAP — a git-tracked file whose extension the upstream
//     extractor supports, but which the config's `include` globs do not
//     admit, is silently absent from the index. Upstream's default
//     `include` template has no `**/*.mjs` / `**/*.cjs`, so every `.mjs`
//     in a repo is dropped while `status` still says the index is fine.
//
//   ② STALENESS — the index holds `files` rows for paths that no longer
//     exist on disk (deleted or renamed upstream). Incremental `index`
//     never deletes them, so the graph keeps answering about files that
//     are gone.
//
// Both are DETECTION ONLY here. Repair is slice-002; this module NEVER
// writes `.codegraph/config.json` and never invokes the upstream binary.
// Its only IO is: read git's tracked-file list, read the config, read the
// index's `files` table, and probe path existence.
//
// "Read-only" is exact, not approximate: the index db is opened
// `readonly: true` and its bytes/mtime are never written, but a read-only
// open of a WAL database still creates/updates SQLite's own
// `codegraph.db-shm` / `codegraph.db-wal` sidecars in `.codegraph/`
// (gitignored, untracked, and required by SQLite itself). See
// `readIndexedFilePaths`.
//
// SEVERITY (user decision 2026-09-16, option C): a detected gap is
// ADVISORY by default — it reports as a warning and the command exits 0,
// so upgrading peaks-loop cannot red-light a downstream project's CI. A
// project may opt in to blocking with `PEAKS_CODEGRAPH_INDEX_STRICT=1`.
// "Could not evaluate" is NOT advisory: it has its own exit code, because
// a gate that cannot read its input must never report "fine".
//
// Genericity (binding): no hardcoded extension list, no hardcoded rule
// names, no project-specific paths. "Which files would upstream ingest" is
// answered by calling upstream's OWN `detectLanguage` + `isLanguageSupported`
// — the same two functions `extraction/index.js` calls — so this gate
// tracks upstream instead of drifting from a list we would have to maintain.

import { createRequire } from 'node:module';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import Database from 'better-sqlite3';

import { normalizePath } from '../../shared/path-utils.js';
import { CODEGRAPH_DB_NAME, CODEGRAPH_DIR_NAME } from './codegraph-service.js';
import {
  CODEGRAPH_CONFIG_FILENAME,
  filterAdmittedTrackedFiles,
  resolveSharedConfig,
  resolveSharedTrackedFiles,
  type ReadCodegraphExcludeConfig,
  type ReadTrackedFiles
} from './codegraph-exclude-reconciler.js';

/**
 * Exit code `peaks codegraph status` uses when the index itself is
 * incomplete or stale — distinct from `CODEGRAPH_INTEGRITY_EXIT_CODE` (74,
 * the exclude-rule gate) and from `CODEGRAPH_INIT_CONFLICT_EXIT_CODE` (73).
 *
 * Why distinct rather than reusing 74: the two gates have different
 * REMEDIATIONS. 74 means "these `exclude` rules must be dropped", and a CI
 * job keyed on 74 already knows to run `repair-exclude`. 75 means "the
 * index content does not match the repository — a supported tracked file
 * is missing from it, or it holds rows for files that are gone". Folding
 * that into 74 would silently re-point an existing consumer at a different
 * fix. When BOTH gates fire, 74 wins (the exclude gap is the upstream
 * cause; repairing it and rebuilding also clears staleness).
 *
 * NOTE (2026-09-16 policy change): 75 is only reachable in STRICT mode.
 * See `isCodegraphIndexStrictMode`.
 */
export const CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE = 75;

/**
 * Exit code for "the index axis could not be measured at all" — the db is
 * present but unreadable, or its schema no longer has the `files` table
 * (an upstream bump), or `git ls-files` / the config read failed.
 *
 * Distinct from BOTH 0 and 75 on purpose, and it applies in every mode
 * including the advisory default:
 *
 *   - 0 would say "I checked and it is fine". It does not.
 *   - 75 would say "I checked and the index does not cover the
 *     repository", which asserts a measurement that never happened.
 *
 * Why it is not merely advisory (the user's option C covers `gap`, not
 * this): option C exists so that upgrading peaks-loop cannot turn a
 * *healthy* project red — the three downstream triggers it names (a
 * tracked `.mjs`, an un-purged dead row, a deliberately narrowed
 * `include`) are all `gap`-class. "Could not read my own input" is never a
 * healthy-project condition: it requires `.codegraph/codegraph.db` to be
 * present but unreadable, and `.codegraph/` is gitignored, so a downstream
 * CI checkout normally has no index at all and reports `not-applicable`
 * (exit 0, no output). This is the exact failure class
 * `codegraph-exclude-reconciler.ts:76-82` documents as the reason that
 * module exists.
 */
export const CODEGRAPH_INDEX_UNEVALUABLE_EXIT_CODE = 76;

/**
 * The one command that repairs what this axis detects (slice-002). Exported
 * as a constant rather than spelled out at each site so the human line, the
 * doctor message and the JSON `nextActions` cannot name three different
 * things: the renderer below, the doctor check and the CLI envelope all
 * interpolate this value.
 *
 * It repairs BOTH axes in one run — `include` normalization, `exclude` rule
 * drops against the normalized include, then a FORCED index rebuild (the
 * only upstream path that drops rows for files deleted in an earlier
 * commit; see `CodegraphExcludeRepairOptions.reindex`).
 */
export const CODEGRAPH_REPAIR_INDEX_COMMAND = 'peaks codegraph repair-index --project <root>';

/**
 * Opt-in switch for the user's option C decision (advisory by default,
 * blocking on request). Set `PEAKS_CODEGRAPH_INDEX_STRICT=1` (or `true`)
 * to make a detected index gap block: `status` exits 75 and the doctor
 * check loses its `severity: 'warning'` tag and flips the doctor exit code.
 *
 * Why an environment variable rather than a config key or a CLI flag:
 *
 *   - ONE mechanism covers both consumers. `peaks codegraph status` and
 *     `peaks doctor` are separate command surfaces; a CLI flag would have
 *     to be threaded through the doctor's option plumbing as well, and the
 *     default doctor probe takes no arguments.
 *   - CI is where the need lives, and CI sets environment variables.
 *   - A config key would have to live in the gitignored
 *     `.codegraph/config.json` (upstream's file, which this slice must
 *     never write) — so it would not survive a clone and could not
 *     configure a CI job at all.
 *   - It writes no state, so it does not weaken the read-only contract.
 *
 * Discoverability: the advisory warning text names this variable
 * verbatim, so an operator who wants blocking is told how to get it at
 * the moment they see the finding.
 */
export const CODEGRAPH_INDEX_STRICT_ENV_VAR = 'PEAKS_CODEGRAPH_INDEX_STRICT';

/** True when the project opted in to blocking index-gap verdicts. */
export function isCodegraphIndexStrictMode(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return env[CODEGRAPH_INDEX_STRICT_ENV_VAR] === '1' || env[CODEGRAPH_INDEX_STRICT_ENV_VAR] === 'true';
}

/**
 * The four outcomes of the index axis, kept apart so that no consumer
 * that CAN carry four outcomes collapses two:
 *
 *   - `clean`         — measured, nothing wrong.
 *   - `gap`           — measured, the index does not cover the repository.
 *   - `not-evaluated` — the axis was attempted and FAILED (unreadable db,
 *                       schema drift, no git work tree, malformed/missing
 *                       config). The index is NOT known to be fine.
 *   - `not-applicable`— there is no index here at all (no `codegraph.db`):
 *                       the pre-init / dangling state, which is not a defect.
 *
 * `not-evaluated` and `not-applicable` both used to be `null` in the
 * machine envelope, which is how "I could not check" came to be reported
 * identically to "there is nothing to check".
 *
 * SCOPE OF THE CLAIM (narrowed under R12-2 — the earlier wording, "no
 * consumer can collapse two of them", was overbroad). This module keeps
 * all four apart, and so do `peaks codegraph status`'s two channels (the
 * `[FAIL]`/`[WARN]` tags and `indexIntegrityVerdict` + the exit codes 0 /
 * 75 / 76). The DOCTOR does not: its check shape is `{ok, severity?}`
 * (legacy `DoctorCheck`, kept back-compatible on purpose), so
 * `not-evaluated` and an advisory `gap` are BOTH `ok:false,
 * severity:'warning'` and are told apart by message text alone — see
 * `doctor-service/checks/codegraph-index-integrity.ts`. That collapse is
 * recorded, not fixed: neither state reads as `ok:true`, so the invariant
 * this axis exists for ("could not evaluate" must never pass as "verified
 * clean") still holds there, and in the advisory default neither state
 * moves the doctor exit code — so no exit-code consumer is misled by it.
 * Under `PEAKS_CODEGRAPH_INDEX_STRICT=1` the two ARE separated in the
 * machine fields (`severity` survives on `not-evaluated`, is dropped from
 * `gap`), which is pinned by a test.
 */
export type CodegraphIndexIntegrityVerdict = 'clean' | 'gap' | 'not-evaluated' | 'not-applicable';

/**
 * Fold the inspected report (null when there is no index to inspect) and
 * the caught failure (null when nothing threw) into one verdict. This is
 * the single place the four outcomes are distinguished, so a caller
 * cannot re-derive them differently.
 */
export function resolveCodegraphIndexIntegrityVerdict(
  report: CodegraphIndexIntegrityReport | null,
  warning: string | null
): CodegraphIndexIntegrityVerdict {
  if (warning !== null) {
    return 'not-evaluated';
  }
  if (report === null) {
    return 'not-applicable';
  }

  return report.gap ? 'gap' : 'clean';
}

/**
 * The exit code the index axis contributes, or `null` when it
 * contributes none (clean / not-applicable → the caller's exit code is
 * left alone).
 */
export function codegraphIndexIntegrityExitCode(
  verdict: CodegraphIndexIntegrityVerdict,
  strict: boolean
): number | null {
  if (verdict === 'not-evaluated') {
    return CODEGRAPH_INDEX_UNEVALUABLE_EXIT_CODE;
  }
  if (verdict === 'gap' && strict) {
    return CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE;
  }

  return null;
}

/** How many offending paths we name per axis on the human path. */
const MAX_REPORTED_PATHS = 10;

export type CodegraphIndexIntegrityReport = {
  /** Absolute path of the inspected `.codegraph/config.json`. */
  readonly configPath: string;
  /** Absolute path of the inspected index database. */
  readonly databasePath: string;
  /** True when either axis is non-empty. `[OK]` must not be printed then. */
  readonly gap: boolean;
  /** Git-tracked files upstream's extractor would ingest (any extension). */
  readonly trackedSourceCount: number;
  /** Of those, the ones the config's `include` globs admit. */
  readonly admittedTrackedCount: number;
  /** Class ① — supported tracked files `include` does not admit. */
  readonly includeGap: readonly string[];
  /** Rows in the index's `files` table. */
  readonly indexedFileCount: number;
  /** Class ② — index rows whose path no longer exists on disk. */
  readonly deadRows: readonly string[];
};

/**
 * Everything `inspectCodegraphIndexIntegrityFrom` needs, already resolved.
 * Pure input: no fs, no spawn, no clock — the adapters below supply it.
 */
export type CodegraphIndexIntegrityInput = {
  readonly configPath: string;
  readonly databasePath: string;
  readonly trackedFiles: readonly string[];
  readonly include: readonly string[];
  /** Project-relative paths carried by the index's `files` table. */
  readonly indexedPaths: readonly string[];
  /** True when upstream's extractor supports `filePath`'s language. */
  readonly supportsPath: (filePath: string) => boolean;
  /** True when a project-relative index path still exists on disk. */
  readonly pathExists: (projectRelativePath: string) => boolean;
};

/**
 * Pure fold over already-resolved data. Both axes are set differences, so
 * neither can be satisfied by a self-consistency assertion: axis ① compares
 * git's tracked set against the `include` matcher, axis ② compares the
 * index's own rows against the filesystem.
 */
export function inspectCodegraphIndexIntegrityFrom(
  input: CodegraphIndexIntegrityInput
): CodegraphIndexIntegrityReport {
  // Reuse the exclude reconciler's matcher so the two axes cannot disagree
  // about what `include` admits (AC6) — this is the same function the
  // exclude gate filters with, not a second implementation of it.
  const admitted = filterAdmittedTrackedFiles(input.trackedFiles, input.include);
  const admittedSet = new Set(admitted);

  // The `include` filter is a path test, not an extension test, so a file
  // it drops could be dropped for a directory reason rather than an
  // extension reason. Only the extension axis is this gate's business:
  // upstream would not ingest a markdown file either way, and reporting it
  // as a gap would be a false positive.
  const supportedTracked = input.trackedFiles
    .map((file) => normalizePath(file))
    .filter((file) => input.supportsPath(file));

  const includeGap = supportedTracked.filter((file) => !admittedSet.has(file));

  const deadRows = input.indexedPaths
    .map((indexedPath) => normalizePath(indexedPath))
    .filter((indexedPath) => !input.pathExists(indexedPath));

  return {
    configPath: input.configPath,
    databasePath: input.databasePath,
    gap: includeGap.length > 0 || deadRows.length > 0,
    trackedSourceCount: supportedTracked.length,
    admittedTrackedCount: supportedTracked.length - includeGap.length,
    includeGap,
    indexedFileCount: input.indexedPaths.length,
    deadRows
  };
}

/* ──────────────────────────────────────────────────────────────────────
 * Upstream oracle — "would the extractor ingest this path"
 * ────────────────────────────────────────────────────────────────────── */

type UpstreamGrammars = {
  readonly detectLanguage: (filePath: string, source?: string) => string;
  readonly isLanguageSupported: (language: string) => boolean;
};

let cachedUpstreamGrammars: UpstreamGrammars | null = null;

/**
 * Load upstream's own `grammars` module and return the two functions
 * `extraction/index.js` itself calls to decide whether to parse a file.
 *
 * Why reach into upstream's internals rather than ship a list: a hardcoded
 * extension list drifts from upstream silently, and a list derived from
 * `EXTENSION_MAP` would still be a re-derivation of a decision upstream
 * already implements. Calling the decision is exact by construction. The
 * module path is resolved from the package's own `package.json` (the same
 * seam `codegraph-service.ts` uses for the binary), so it follows whichever
 * `@colbymchenry/codegraph` instance this install actually runs.
 *
 * Node's `require` cache makes the second and later loads free; the module
 * body only defines tables and functions (grammar WASM loading is a
 * separate, explicitly-invoked `initGrammars`).
 */
function loadUpstreamGrammars(): UpstreamGrammars {
  if (cachedUpstreamGrammars === null) {
    const require = createRequire(import.meta.url);
    const packageJsonPath = require.resolve('@colbymchenry/codegraph/package.json');
    const grammarsPath = join(dirname(packageJsonPath), 'dist', 'extraction', 'grammars.js');
    cachedUpstreamGrammars = require(grammarsPath) as UpstreamGrammars;
  }

  return cachedUpstreamGrammars;
}

/** The upstream decision, verbatim: detect the language, then ask if it has a grammar. */
export function upstreamSupportsPath(filePath: string): boolean {
  const grammars = loadUpstreamGrammars();

  return grammars.isLanguageSupported(grammars.detectLanguage(filePath));
}

/* ──────────────────────────────────────────────────────────────────────
 * Boundary adapters — READ ONLY
 * ────────────────────────────────────────────────────────────────────── */

/**
 * The project-relative paths recorded in the index's `files` table.
 *
 * Opened `readonly: true` so the gate can never mutate the index's
 * CONTENT, and `fileMustExist: true` so a missing/not-yet-initialized db
 * throws instead of silently creating an empty one (which would report a
 * 100% stale index).
 *
 * Read-only, exactly stated: opening a WAL database (`journal_mode = wal`
 * is what upstream `dist/db/index.js` sets, and what this repo's own index
 * uses) read-only makes SQLite create/update the gitignored
 * `codegraph.db-shm` / `codegraph.db-wal` sidecars next to it, because a
 * read-only WAL reader still needs the shared-memory index. The db file
 * itself is never opened for writing (a write through this handle returns
 * `SQLITE_READONLY`) and its bytes and mtime are unchanged. The sidecars
 * are ignored by `.codegraph/.gitignore`, so no tracked repo state moves.
 *
 * Throws when the schema has no `files` table — an upstream schema change
 * must be loud, not a silent zero-row pass.
 */
function readIndexedFilePaths(projectRoot: string): readonly string[] {
  const databasePath = join(projectRoot, CODEGRAPH_DIR_NAME, CODEGRAPH_DB_NAME);
  let db: Database.Database;
  try {
    db = new Database(databasePath, { readonly: true, fileMustExist: true });
  } catch (error) {
    // sqlite's own message ("unable to open database file") does not name
    // the path, and this text reaches the operator as the `status` warning
    // line. Name it, matching the config reader's convention.
    throw new Error(
      `codegraph index ${databasePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  try {
    // The SELECT is inside the `try` but OUTSIDE a `catch`, deliberately:
    // a query failure is not an open failure (upstream schema drift gives
    // "no such table: files"), and sqlite's message for it names neither
    // the database nor the cause. Left raw it reaches the operator as
    // `no such table: files` with no indication of WHICH file, so it is
    // wrapped with the same path context the open failure carries.
    return queryIndexedPaths(db, databasePath);
  } finally {
    db.close();
  }
}

function queryIndexedPaths(db: Database.Database, databasePath: string): readonly string[] {
  let rows: readonly { readonly path: string }[];
  try {
    rows = db.prepare('SELECT path FROM files').all() as readonly { readonly path: string }[];
  } catch (error) {
    throw new Error(
      `codegraph index ${databasePath}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  return rows.map((row) => normalizePath(row.path));
}

/**
 * Project-relative index path → does that file still exist on disk?
 *
 * THE AUTHORITY. Whatever else changes around it, this is the only
 * predicate that decides "absent from disk", and it is preserved verbatim
 * so the answer cannot drift.
 *
 * Two cheaper predicates are WRONG here, and both have been proposed:
 *
 *   - `git ls-files` MEMBERSHIP is not this question. An orchestrator
 *     scratch script used it and reported 11 dead rows where the disk says
 *     4: a project's own uncommitted-but-present files are absent from
 *     `git ls-files`, so a tracked-only predicate calls live files dead.
 *     The predicate is "absent from disk", full stop.
 *   - A directory walk that answers `true` for every name `readdir`
 *     reports is not this question either: `readdir` lists a BROKEN
 *     symlink, and `existsSync` on it is false.
 */
function codegraphIndexPathExists(projectRoot: string, projectRelativePath: string): boolean {
  return existsSync(join(projectRoot, projectRelativePath));
}

/** One directory's trusted entries, or `null` when it could not be listed. */
type DirectoryListing = ReadonlySet<string> | null;

/**
 * Per-call, bounded replacement for the per-row `existsSync` above.
 *
 * WHY: the fold calls `pathExists` once per index row (`inspectCodegraph
 * IndexIntegrityFrom`), so the gate is O(rows) full-path stats at ~13.5 µs
 * each — 35 ms at 1.2k rows, 1,923 ms at 100x. It is unbounded in the size
 * of the index. What is replaced is the COST, not the authority: a row is
 * confirmed PRESENT by looking its basename up in one cached listing of its
 * parent directory, so the number of filesystem calls is bounded by the
 * number of DISTINCT DIRECTORIES the index names — which is bounded by the
 * repository, not by the index.
 *
 * A listing may only answer `true`, and only for an entry whose dirent is
 * positively a plain file or a plain directory. For exactly those entries,
 * "the name is in `readdir`" and "`existsSync` on the joined path is true"
 * cannot disagree. Everything else falls through to
 * `codegraphIndexPathExists` — the old implementation, verbatim — so the
 * classes this cache cannot decide are decided exactly as they always were:
 *
 *   - a symlink or junction entry (`isSymbolicLink()`, Windows included:
 *     a junction reports `isDirectory() === false`), because a BROKEN link
 *     is listed by `readdir` and is absent from disk;
 *   - a case-differing path on a case-insensitive filesystem — the listing
 *     carries the on-disk spelling, so `SRC/OK.TS` misses and the stat
 *     decides (true on Windows, false on Linux, exactly as before);
 *   - a path naming a directory, or any non-file special entry;
 *   - a parent that is missing, unreadable, or not a directory at all
 *     (`readdir` throws → `null`, memoized so the failure costs one call);
 *   - a trailing-slash or empty row, and a project root that does not exist.
 *
 * The cache lives for ONE `inspectCodegraphIndexIntegrity` call, so a
 * second command re-reads the tree and cannot be served a stale listing.
 * Within a call, a listing taken before a concurrent delete is the only
 * divergence from the old code — both implementations race the filesystem,
 * and neither holds a snapshot.
 */
export function createCodegraphIndexPathExists(): (
  projectRoot: string,
  projectRelativePath: string
) => boolean {
  const listings = new Map<string, DirectoryListing>();

  const listDirectory = (absoluteDirectory: string): DirectoryListing => {
    const cached = listings.get(absoluteDirectory);
    if (cached !== undefined) {
      return cached;
    }

    let listing: DirectoryListing;
    try {
      listing = new Set(
        readdirSync(absoluteDirectory, { withFileTypes: true })
          .filter((entry) => entry.isFile() || entry.isDirectory())
          .map((entry) => entry.name)
      );
    } catch {
      listing = null;
    }
    listings.set(absoluteDirectory, listing);

    return listing;
  };

  return (projectRoot, projectRelativePath) => {
    // Split at the LAST separator, so `parent` + `basename` re-join to the
    // same path `join(projectRoot, projectRelativePath)` produces after
    // normalization — including repeated separators.
    const separatorIndex = projectRelativePath.lastIndexOf('/');
    const basename = projectRelativePath.slice(separatorIndex + 1);
    if (basename.length > 0) {
      const parent = separatorIndex === -1 ? '' : projectRelativePath.slice(0, separatorIndex);
      const listing = listDirectory(join(projectRoot, parent));
      if (listing !== null && listing.has(basename)) {
        return true;
      }
    }

    return codegraphIndexPathExists(projectRoot, projectRelativePath);
  };
}

/**
 * Injection seam for `inspectCodegraphIndexIntegrity`.
 *
 * `trackedFiles` / `config` are the ALREADY-READ shared inputs (perf audit
 * F1) — the CLI reads them once and hands the same values to both codegraph
 * axes, so the `git ls-files` spawn, the config read and the `include`
 * glob compilation happen once per command instead of twice. They are
 * values, not reader functions, because that is what the caller has: the
 * read has already happened by the time either axis runs.
 *
 * Both are READ-MARKED (code review R4-1): only a value returned by the
 * readers is admissible. An explicit `[]` — which the seam used to accept
 * and which silently meant "nothing is tracked", erasing every include-gap
 * — is now a compile error and a run-time throw. `undefined`/omitted still
 * means "read it yourself", exactly as before.
 *
 * The three remaining fields are genuine per-call adapters, used by tests
 * to drive the fold without touching a real db or the real oracle.
 */
export type CodegraphIndexIntegrityDeps = {
  readonly trackedFiles?: ReadTrackedFiles | undefined;
  readonly config?: ReadCodegraphExcludeConfig | undefined;
  readonly readIndexedPaths?: (projectRoot: string) => readonly string[];
  readonly supportsPath?: (filePath: string) => boolean;
  readonly pathExists?: (projectRoot: string, projectRelativePath: string) => boolean;
};

/**
 * Read-only entry point: resolve git's tracked files, the config's
 * `include` globs and the index's own rows from disk, then fold them into
 * one report. Throws (never silently degrades) when the project is not a
 * git work tree, the config is missing/malformed, or the index is absent —
 * callers that must stay alive (`status`, doctor) catch and surface it.
 */
export function inspectCodegraphIndexIntegrity(
  projectRoot: string,
  deps: CodegraphIndexIntegrityDeps = {}
): CodegraphIndexIntegrityReport {
  const readIndexed = deps.readIndexedPaths ?? readIndexedFilePaths;
  const supports = deps.supportsPath ?? upstreamSupportsPath;
  // Perf audit F1/D2: one bounded resolver per call, so the directory
  // listings are shared by every row of THIS inspection and are re-read by
  // the next one. A caller that injects `pathExists` keeps its own.
  const exists = deps.pathExists ?? createCodegraphIndexPathExists();

  // Already-read inputs win; otherwise read them here exactly as before.
  // (A caller that also runs the exclude axis should pass
  // `readCodegraphProjectInputs(projectRoot)` to both — see the deps type.)
  // Only a read-marked value can win: an unmarked one throws here rather
  // than being mistaken for a real read (code review R4-1).
  const config = resolveSharedConfig(deps.config, projectRoot);
  const trackedFiles = resolveSharedTrackedFiles(deps.trackedFiles, projectRoot);

  return inspectCodegraphIndexIntegrityFrom({
    configPath: join(projectRoot, CODEGRAPH_DIR_NAME, CODEGRAPH_CONFIG_FILENAME),
    databasePath: join(projectRoot, CODEGRAPH_DIR_NAME, CODEGRAPH_DB_NAME),
    trackedFiles,
    include: config.include,
    indexedPaths: readIndexed(projectRoot),
    supportsPath: supports,
    pathExists: (projectRelativePath) => exists(projectRoot, projectRelativePath)
  });
}

/**
 * Human-readable detail lines for a gapped report, grouped by axis so an
 * operator can tell which defect they have (and whether they have both).
 *
 * Returns an empty array for a clean report — the caller decides whether
 * "clean" is worth printing at all.
 *
 * `blocking` is the user's option C switch, and it changes the TAG, not
 * the finding: advisory (the default) prints `[WARN]` and the command
 * exits 0; strict prints `[FAIL]` and the command exits 75. The verdict
 * word is chosen here rather than by the caller so the two channels
 * cannot disagree about the same report.
 *
 * The remediation sentence NAMES the real command (`peaks codegraph
 * repair-index`). Slice-001 deliberately named none, because naming a
 * command that does not exist yet reproduces the exact failure this gate
 * exists to prevent (an operator following a hint into "command not
 * found"). Slice-002 shipped that command, so the obligation recorded in
 * slice-001's design decision 4 is discharged here — and the name is
 * exported as a constant so the renderer, the doctor message and the
 * error envelope cannot drift from the command that is actually
 * registered.
 */
export function renderCodegraphIndexIntegrityLines(
  report: CodegraphIndexIntegrityReport,
  blocking: boolean
): readonly string[] {
  if (!report.gap) {
    return [];
  }

  const lines: string[] = [
    `${blocking ? '[FAIL]' : '[WARN]'} codegraph index does not cover the repository: ${report.includeGap.length} supported tracked file(s) are not admitted by the config's include globs, and ${report.deadRows.length} index row(s) point at files that no longer exist.`
  ];

  if (report.includeGap.length > 0) {
    lines.push(
      `  include gap: ${report.admittedTrackedCount} of ${report.trackedSourceCount} extractor-supported tracked file(s) are admitted by include`
    );
    for (const filePath of report.includeGap.slice(0, MAX_REPORTED_PATHS)) {
      lines.push(`  not admitted: ${filePath}`);
    }
    if (report.includeGap.length > MAX_REPORTED_PATHS) {
      lines.push(`  … and ${report.includeGap.length - MAX_REPORTED_PATHS} more not-admitted file(s)`);
    }
  }

  if (report.deadRows.length > 0) {
    lines.push(`  stale rows: ${report.deadRows.length} of ${report.indexedFileCount} indexed file(s) are gone from disk`);
    for (const filePath of report.deadRows.slice(0, MAX_REPORTED_PATHS)) {
      lines.push(`  stale: ${filePath}`);
    }
    if (report.deadRows.length > MAX_REPORTED_PATHS) {
      lines.push(`  … and ${report.deadRows.length - MAX_REPORTED_PATHS} more stale row(s)`);
    }
  }

  if (!blocking) {
    lines.push(
      `  advisory: this does not fail the command. Set ${CODEGRAPH_INDEX_STRICT_ENV_VAR}=1 to make it block (exit ${CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE}).`
    );
  }

  lines.push(
    `  fix: run \`${CODEGRAPH_REPAIR_INDEX_COMMAND}\` — it appends the missing include pattern(s), re-checks the exclude rules against the widened list, and rebuilds the index from scratch (that rebuild is what drops the stale rows).`
  );

  return lines;
}
