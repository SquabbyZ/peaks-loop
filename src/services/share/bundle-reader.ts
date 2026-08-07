/**
 * bundle-reader.ts — readBundle(inPath) (spec §7A.2).
 *
 * M7 / spec §7A.2 / §10 RL-9 / acceptance AC-25 / AC-26.
 *
 * Reads a `peaks.bundle/1` tar.gz and lands the contained release
 * on the local SkillHub. The reader is the symmetrical counterpart
 * of `bundle-writer.ts` — same layout, same content-addressed
 * blobs/, but with three hard guards:
 *
 *   1. `format_version_major !== 1` is a HARD block. The reader
 *      throws `SHARE_BUNDLE_MAJOR_VERSION_MISMATCH` before any
 *      SQL side-effect. (Major-version bumps are reserved for
 *      breaking schema changes; the receiver is not assumed to
 *      know how to translate.)
 *   2. `format_version_minor` mismatch is a non-fatal warn (the
 *      reader collects it as a warning on the return envelope).
 *   3. The imported release ALWAYS lands as `candidate`. The
 *      reader refuses to write any other status; the receiver
 *      MUST run an independent evaluation before promoting the
 *      imported release to `stable` (AC-26 — peaks loop promote
 *      reads evolution_evaluation rows).
 *
 * Slice 4 (PRD-002b): split the four high-cohort functions
 * (readBundle 15, importLoopBundle 20, materialiseRelatedBees 28,
 * importBeeBundle arrow 38) into small helpers with table dispatch
 * for kind routing and early-return for guard paths. Public API
 * (readBundle, ReadBundleArgs, ReadBundleResult, the four error
 * classes) is preserved verbatim.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { ZodError } from "zod";
import type Database from "better-sqlite3";
import { runTar } from "../skillhub/tar-runtime.js";
import {
  PEAKS_BUNDLE_FORMAT_VERSION_MAJOR,
  PEAKS_BUNDLE_SCHEMA_VERSIONS,
  SHARE_BUNDLE_ERROR_CODES,
  BundleManifestSchema,
  type BundleManifest,
  type PeaksBundleKind,
} from "./bundle-types.js";

/* ---------------------------------------------------------------------- */
/* Reader errors                                                            */
/* ---------------------------------------------------------------------- */

/**
 * Thrown when `format_version_major !== 1`. This is the explicit
 * HARD block per spec §7A.2 (major mismatch).
 */
export class BundleMajorVersionMismatchError extends Error {
  readonly code: typeof SHARE_BUNDLE_ERROR_CODES.MAJOR_VERSION_MISMATCH;
  readonly receivedMajor: number;
  constructor(receivedMajor: number) {
    super(
      `bundle declares format_version_major=${receivedMajor}; the only supported major is ${PEAKS_BUNDLE_FORMAT_VERSION_MAJOR} (spec §7A.2)`
    );
    this.name = "BundleMajorVersionMismatchError";
    this.code = SHARE_BUNDLE_ERROR_CODES.MAJOR_VERSION_MISMATCH;
    this.receivedMajor = receivedMajor;
  }
}

/**
 * Thrown when the schema-versions mapping is missing or carries
 * non-canonical literals.
 */
export class BundleSchemaVersionsMismatchError extends Error {
  readonly code: typeof SHARE_BUNDLE_ERROR_CODES.SCHEMA_VERSIONS_MISMATCH;
  readonly received: Record<string, unknown> | undefined;
  constructor(received: Record<string, unknown> | undefined) {
    super(
      `bundle schema_versions mapping is missing or carries non-canonical literals (spec §7A.2). expected=${JSON.stringify(
        PEAKS_BUNDLE_SCHEMA_VERSIONS
      )} received=${JSON.stringify(received)}`
    );
    this.name = "BundleSchemaVersionsMismatchError";
    this.code = SHARE_BUNDLE_ERROR_CODES.SCHEMA_VERSIONS_MISMATCH;
    this.received = received;
  }
}

/**
 * Thrown when the caller asks to land as anything other than
 * `candidate` (the only allowed target status).
 */
export class BundleImportToStableForbiddenError extends Error {
  readonly code: typeof SHARE_BUNDLE_ERROR_CODES.IMPORT_TO_STABLE_FORBIDDEN;
  constructor(receivedStatus: string) {
    super(
      `bundles cannot land as '${receivedStatus}'; the only allowed target is 'candidate' (spec §7A.2). promotion to stable requires an evolution_evaluation row with an independent_scorer_verdict`
    );
    this.name = "BundleImportToStableForbiddenError";
    this.code = SHARE_BUNDLE_ERROR_CODES.IMPORT_TO_STABLE_FORBIDDEN;
  }
}

/**
 * Thrown when the bundle tarball is malformed (no manifest.json,
 * bad JSON, etc.). Distinct from a ZodError so the CLI can map
 * to a single BUNDLE_MALFORMED code.
 */
export class BundleMalformedError extends Error {
  readonly code: typeof SHARE_BUNDLE_ERROR_CODES.BUNDLE_MALFORMED;
  constructor(message: string) {
    super(`bundle is malformed: ${message}`);
    this.name = "BundleMalformedError";
    this.code = SHARE_BUNDLE_ERROR_CODES.BUNDLE_MALFORMED;
  }
}

/* ---------------------------------------------------------------------- */
/* Inputs                                                                   */
/* ---------------------------------------------------------------------- */

export type ReadBundleArgs = {
  db: Database.Database;
  /** Blobs root for content-addressed file write-back. */
  blobsDir: string;
  /** Input `.tar.gz` bundle path. */
  inPath: string;
  /**
   * Optional rename for the anchor asset on import. For `loop`
   * bundles this is the loop id to overwrite the source id; for
   * `bee` bundles this is the `--as` bee name.
   */
  asName?: string;
};

/**
 * Successful read result. The reader lands the bundle as a
 * `candidate` regardless of any other lifecycle status on the
 * source — this is the hard import rule per spec §7A.2 / AC-25.
 */
export type ReadBundleResult = {
  /** Anchor asset id actually written. */
  assetId: string | number;
  kind: PeaksBundleKind;
  /** Always `candidate` — the reader does not honor any other status. */
  importedAs: "candidate";
  /** Non-fatal warnings (e.g. minor-version mismatch). */
  warnings: string[];
  /** Count of crystallization_event rows imported. */
  evidenceBriefCount: number;
};

/* ---------------------------------------------------------------------- */
/* Stage helpers (slice 4)                                                  */
/* ---------------------------------------------------------------------- */

/** SHA-256 content-hash filename pattern. */
const SHA256_RE = /^[0-9a-f]{64}$/;

/** Coerce a possibly-unknown value to a string lifecycle status, defaulting to "candidate". */
function readSourceLifecycle(release: Record<string, unknown>): string {
  return typeof release.lifecycle_status === "string"
    ? release.lifecycle_status
    : "candidate";
}

/**
 * Enforce the AC-25 hard rule: bundles always land as `candidate`;
 * any other source status is refused. Layered at every import site
 * for defense in depth.
 */
function enforceImportAsCandidate(status: string): void {
  if (status !== "candidate") {
    throw new BundleImportToStableForbiddenError(status);
  }
}

/** Coerce an unknown value to a boolean-ish 0/1 column value. */
function bool01(value: unknown, defaultValue: 0 | 1): 0 | 1 {
  if (value === undefined) return defaultValue;
  return value ? 1 : 0;
}

/** Coerce an unknown value to a string column value (empty string default). */
function str(value: unknown, defaultValue = ""): string {
  return typeof value === "string" ? value : defaultValue;
}

/** Coerce an unknown value to a string-or-null column value. */
function strOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/** Coerce an unknown value to a JSON-stringified column value. */
function jsonArr(value: unknown): string {
  return JSON.stringify((value as unknown[]) ?? []);
}

/** Coerce an unknown value to an ISO-8601 string (now() default). */
function isoOrNow(value: unknown): string {
  return typeof value === "string" ? value : new Date().toISOString();
}

/** Now as an ISO string. */
function nowIso(): string {
  return new Date().toISOString();
}

/** Safe directory listing (returns [] on error). */
function readDirEntries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** Read and JSON.parse a file, throwing BundleMalformedError on parse failure. */
function readJsonOrThrow(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err: unknown) {
    throw new BundleMalformedError(
      `manifest.json could not be parsed: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/* ---------------------------------------------------------------------- */
/* Main entrypoint                                                           */
/* ---------------------------------------------------------------------- */

export function readBundle(args: ReadBundleArgs): ReadBundleResult {
  const { db, blobsDir, inPath } = args;
  if (!existsSync(inPath)) {
    throw new BundleMalformedError(`bundle file not found at '${inPath}'`);
  }

  const stageDir = inPath + ".extract";
  resetStageDir(stageDir);
  try {
    runTar(["-xzf", inPath, "-C", stageDir]);
    const manifest = loadStageManifest(stageDir);
    materialiseBlobs(stageDir, blobsDir);
    const assetId = KIND_IMPORTERS[manifest.kind](db, manifest, blobsDir, args.asName);
    return buildReadResult(manifest, assetId);
  } finally {
    if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
  }
}

/**
 * Clean any prior extract dir, then recreate it. Split out of
 * readBundle so the main orchestrator stays branch-light.
 */
function resetStageDir(stageDir: string): void {
  if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
}

/**
 * Read and parse the staged manifest.json, raising a
 * BundleMalformedError if the file is missing.
 */
function loadStageManifest(stageDir: string): BundleManifest {
  const manifestPath = join(stageDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new BundleMalformedError(
      "bundle is missing manifest.json (writer is required to emit it)"
    );
  }
  return parseManifest(readJsonOrThrow(manifestPath));
}

/**
 * Re-materialise content-addressed blobs regardless of kind —
 * the layout (`blobs/<sha256>`) is identical for both.
 */
function materialiseBlobs(stageDir: string, blobsDir: string): void {
  const blobsStageDir = join(stageDir, "blobs");
  if (!existsSync(blobsStageDir)) return;
  mkdirSync(blobsDir, { recursive: true });
  for (const fname of readDirEntries(blobsStageDir)) {
    if (!fname.match(SHA256_RE)) continue;
    const destDir = join(blobsDir, fname.slice(0, 2));
    mkdirSync(destDir, { recursive: true });
    const destPath = join(destDir, fname);
    if (existsSync(destPath)) continue;
    writeFileSync(destPath, readFileSync(join(blobsStageDir, fname)));
  }
}

/**
 * Build the read-result envelope, including the minor-version
 * warning if the bundle is not on the default minor.
 */
function buildReadResult(
  manifest: BundleManifest,
  assetId: string | number
): ReadBundleResult {
  const warnings: string[] =
    manifest.format_version_minor === 0
      ? []
      : [
          `minor-version=${manifest.format_version_minor}; supported but flagging for awareness`,
        ];
  return {
    assetId,
    kind: manifest.kind,
    importedAs: "candidate",
    warnings,
    evidenceBriefCount: manifest.evidence_briefs.length,
  };
}

/* ---------------------------------------------------------------------- */
/* Manifest parsing — enforces the major-version hard block                  */
/* ---------------------------------------------------------------------- */

function parseManifest(raw: unknown): BundleManifest {
  if (
    !raw ||
    typeof raw !== "object" ||
    Array.isArray(raw)
  ) {
    throw new BundleMalformedError("manifest must be a JSON object");
  }
  // Defense in depth: even if Zod would accept, we layer an early
  // major-mismatch guard so the CLI can surface a specific error
  // code (SHARE_BUNDLE_MAJOR_VERSION_MISMATCH) before the Zod
  // schema-version mapping fatal-error path fires.
  const candidate = raw as Record<string, unknown>;
  if (
    typeof candidate.format_version_major === "number" &&
    candidate.format_version_major !== PEAKS_BUNDLE_FORMAT_VERSION_MAJOR
  ) {
    throw new BundleMajorVersionMismatchError(
      candidate.format_version_major as number
    );
  }
  if (typeof candidate.format_constant !== "string") {
    throw new BundleMalformedError("manifest is missing format_constant");
  }
  if (candidate.format_constant !== "peaks.bundle/1") {
    throw new BundleMalformedError(
      `format_constant must be "peaks.bundle/1"; received '${candidate.format_constant}'`
    );
  }
  if (
    !("schema_versions" in candidate) ||
    typeof candidate.schema_versions !== "object" ||
    candidate.schema_versions === null ||
    Array.isArray(candidate.schema_versions)
  ) {
    throw new BundleSchemaVersionsMismatchError(undefined);
  }
  try {
    return BundleManifestSchema.parse(raw) as BundleManifest;
  } catch (err: unknown) {
    if (err instanceof ZodError) {
      const schemaIssue = err.issues.find(
        (i) => i.path[0] === "schema_versions"
      );
      if (schemaIssue) {
        throw new BundleSchemaVersionsMismatchError(
          candidate.schema_versions as Record<string, unknown>
        );
      }
      throw new BundleMalformedError(
        `manifest failed schema validation: ${err.issues
          .map((i) => `${i.path.join(".")}:${i.message}`)
          .join("; ")}`
      );
    }
    throw err;
  }
}

/* ---------------------------------------------------------------------- */
/* Kind dispatch (table — replaces if/else on manifest.kind)                 */
/* ---------------------------------------------------------------------- */

type KindImporter = (
  db: Database.Database,
  manifest: BundleManifest,
  blobsDir: string,
  asName: string | undefined
) => string | number;

const KIND_IMPORTERS: Record<PeaksBundleKind, KindImporter> = {
  loop: (db, manifest, _blobsDir, asName) =>
    importLoopBundle(db, manifest, asName),
  bee: (db, manifest, blobsDir, asName) =>
    importBeeBundle(db, manifest, blobsDir, asName),
};

/* ---------------------------------------------------------------------- */
/* Loop import                                                              */
/* ---------------------------------------------------------------------- */

function importLoopBundle(
  db: Database.Database,
  manifest: BundleManifest,
  asName: string | undefined
): string {
  const srcLoop = manifest.loop_release as Record<string, unknown>;
  const srcId = String(srcLoop.id ?? "");
  if (!srcId) throw new BundleMalformedError("loop_release is missing id");

  const srcStatus = readSourceLifecycle(srcLoop);
  enforceImportAsCandidate(srcStatus);

  const targetId = asName ?? srcId;
  const loopRow = buildLoopRow(srcLoop, targetId);
  enforceImportAsCandidate(loopRow.lifecycle_status);

  // First materialise related bee_release rows. The bundle's
  // loop_bee_relations reference these bee ids; re-stamping the
  // relations before the bee rows land would FK-constraint fail
  // on the receiver.
  const beeIdMap = materialiseRelatedBees(db, manifest.related_bee_releases);

  const tx = db.transaction(() => {
    insertLoopReleaseRow(db, loopRow);
    insertLoopBeeRelations(db, manifest, beeIdMap, targetId);
  });
  tx();
  return targetId;
}

/**
 * Pure mapping from a raw loop_release row to the column-shape
 * the receiver writes to `loop_release`. Split out so the SQL
 * INSERT can stay isolated.
 */
function buildLoopRow(
  srcLoop: Record<string, unknown>,
  targetId: string
): LoopRow {
  return {
    id: targetId,
    name: srcLoop.name,
    scenario: srcLoop.scenario,
    trigger_policy: srcLoop.trigger_policy,
    success_criteria_json: jsonArr(srcLoop.success_criteria),
    interaction_policy: srcLoop.interaction_policy,
    feedback_policy: srcLoop.feedback_policy,
    evolution_policy: srcLoop.evolution_policy,
    evaluator_policy_json: jsonArr(srcLoop.evaluator_policy),
    linked_bees_json: jsonArr(srcLoop.linked_bees),
    run_history_json: jsonArr(srcLoop.run_history),
    crystallization_evidence_json: jsonArr(srcLoop.crystallization_evidence),
    // The reader always lands as candidate — the source's lifecycle
    // status is silently overridden (spec §7A.2 hard rule).
    lifecycle_status: "candidate",
    version: srcLoop.version,
    schema_version: srcLoop.schema_version ?? PEAKS_BUNDLE_SCHEMA_VERSIONS.loop,
    archived_at: isoOrNow(srcLoop.archived_at),
    shareable: bool01(srcLoop.shareable, 1),
    share_excluded_paths: jsonArr(srcLoop.share_excluded_paths),
    desktop_visible: bool01(srcLoop.desktop_visible, 1),
    export_bundle_format:
      typeof srcLoop.export_bundle_format === "string"
        ? srcLoop.export_bundle_format
        : "peaks.bundle/1",
  };
}

type LoopRow = {
  id: string;
  name: unknown;
  scenario: unknown;
  trigger_policy: unknown;
  success_criteria_json: string;
  interaction_policy: unknown;
  feedback_policy: unknown;
  evolution_policy: unknown;
  evaluator_policy_json: string;
  linked_bees_json: string;
  run_history_json: string;
  crystallization_evidence_json: string;
  lifecycle_status: "candidate";
  version: unknown;
  schema_version: string;
  archived_at: string;
  shareable: 0 | 1;
  share_excluded_paths: string;
  desktop_visible: 0 | 1;
  export_bundle_format: string;
};

const LOOP_RELEASE_COLUMNS = [
  "id", "name", "scenario", "trigger_policy",
  "success_criteria_json", "interaction_policy", "feedback_policy", "evolution_policy",
  "evaluator_policy_json", "linked_bees_json", "run_history_json", "crystallization_evidence_json",
  "lifecycle_status", "version", "schema_version", "archived_at",
  "shareable", "share_excluded_paths", "desktop_visible", "export_bundle_format",
] as const;

/** Insert one loop_release row (or replace on conflict). */
function insertLoopReleaseRow(
  db: Database.Database,
  row: Record<string, unknown>
): void {
  const placeholders = LOOP_RELEASE_COLUMNS.map(() => "?").join(", ");
  db.prepare(
    `INSERT OR REPLACE INTO loop_release (${LOOP_RELEASE_COLUMNS.join(", ")}) VALUES (${placeholders})`
  ).run(...LOOP_RELEASE_COLUMNS.map((c) => row[c] as never));
}

/**
 * Re-stamp relations (preserving source row content, but the
 * loop_id is rewritten if `asName` was supplied).
 */
function insertLoopBeeRelations(
  db: Database.Database,
  manifest: BundleManifest,
  beeIdMap: Map<number, number>,
  loopReleaseId: string
): void {
  const stmt = db.prepare(
    `INSERT OR REPLACE INTO loop_bee_relation (
       loop_release_id, bee_release_id, role, reason, schema_version, created_at
     ) VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const rel of manifest.loop_bee_relations) {
    const r = rel as Record<string, unknown>;
    const originalBeeId = Number(r.bee_release_id);
    const newBeeId = beeIdMap.get(originalBeeId) ?? originalBeeId;
    stmt.run(
      loopReleaseId,
      newBeeId,
      str(r.role),
      str(r.reason),
      str(r.schema_version, PEAKS_BUNDLE_SCHEMA_VERSIONS.loop_bee_relation),
      isoOrNow(r.created_at)
    );
  }
}

/* ---------------------------------------------------------------------- */
/* Related-bees materialisation                                            */
/* ---------------------------------------------------------------------- */

type BeeBundleEntry = {
  bee_release: Record<string, unknown>;
  manifest: Record<string, unknown> | undefined;
  segments: Array<Record<string, unknown>>;
  files: Array<Record<string, unknown>>;
  changes: Array<Record<string, unknown>>;
};

/**
 * Materialise the related_bee_releases rows in `db`. Returns a map
 * from source bee_release.id → new bee_release.id so the loop /
 * relations re-write can redirect the foreign keys.
 *
 * On a hash collision (a bee_name already exists on the receiver),
 * we preserve the source row content but keep the existing
 * `id`; the relations then skip the redirect for that bee. This
 * is the safest cross-user behaviour: the receiver's existing
 * bee_name wins, and we never overwrite user data.
 */
function materialiseRelatedBees(
  db: Database.Database,
  relatedBees: ReadonlyArray<unknown>
): Map<number, number> {
  const map = new Map<number, number>();
  if (relatedBees.length === 0) return map;
  for (const raw of relatedBees) {
    const entry = raw as BeeBundleEntry;
    const inserted = materialiseSingleRelatedBee(db, entry);
    if (inserted !== null) map.set(inserted.srcId, inserted.newId);
  }
  return map;
}

/**
 * Materialise one related bee. Returns null if the entry is not
 * importable (missing id or bee_name). Otherwise returns the
 * src→new id pair so the caller can record it in the redirect map.
 */
function materialiseSingleRelatedBee(
  db: Database.Database,
  entry: BeeBundleEntry
): { srcId: number; newId: number } | null {
  const release = entry.bee_release ?? {};
  const srcId = Number(release.id);
  if (!Number.isInteger(srcId) || srcId <= 0) return null;
  const beeName = String(release.bee_name ?? "");
  if (!beeName) return null;

  // Honour the same non-candidate hard rule at the bee row.
  enforceImportAsCandidate(readSourceLifecycle(release));

  // Pre-existing receiver-side bee with the same name → keep its id.
  const existing = db
    .prepare("SELECT id FROM bee_release WHERE bee_name = ?")
    .get(beeName) as { id: number } | undefined;
  if (existing) return { srcId, newId: existing.id };

  return { srcId, newId: insertNewRelatedBee(db, release, entry.manifest) };
}

function insertNewRelatedBee(
  db: Database.Database,
  release: Record<string, unknown>,
  manifest: Record<string, unknown> | undefined
): number {
  const info = db
    .prepare(
      `INSERT INTO bee_release (
         bee_name, version, source, archived_at, archived_by, user_intent_raw,
         description, parent_version, changelog, shareable, desktop_visible
       ) VALUES (?, ?, 'user', ?, 'user', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      String(release.bee_name ?? ""),
      String(release.version ?? "0.0.0"),
      nowIso(),
      release.user_intent_raw ?? null,
      release.description ?? null,
      release.parent_version ?? null,
      release.changelog ?? null,
      release.shareable === false ? 0 : 1,
      release.desktop_visible === false ? 0 : 1
    );
  const newId = Number(info.lastInsertRowid);
  if (manifest) insertBeeManifestRow(db, newId, manifest);
  return newId;
}

/* ---------------------------------------------------------------------- */
/* Bee import                                                                */
/* ---------------------------------------------------------------------- */

function importBeeBundle(
  db: Database.Database,
  manifest: BundleManifest,
  _blobsDir: string,
  asName: string | undefined
): number {
  const beeObj = manifest.bee_release as BeeBundleEntry | undefined;
  if (!beeObj) {
    throw new BundleMalformedError("bee_release payload missing from bee bundle");
  }
  const release = beeObj.bee_release;
  const newBeeName = asName ?? String(release.bee_name ?? "");
  if (!newBeeName) throw new BundleMalformedError("bee_release.bee_name missing");
  // Same hard rule: any non-candidate import is refused. The reader
  // does not honor --as-stable switches.
  enforceImportAsCandidate(readSourceLifecycle(release));

  const tx = db.transaction(() => {
    const newId = insertAnchorBeeRelease(db, release, newBeeName);
    if (beeObj.manifest) insertBeeManifestRow(db, newId, beeObj.manifest);
    insertBeeSegmentRows(db, newId, beeObj.segments ?? []);
    insertBeeFileRows(db, newId, newBeeName, beeObj.files ?? []);
    insertBeeChangeRows(db, newId, beeObj.changes ?? []);
    return newId;
  });
  return tx();
}

/** Insert the anchor bee_release row for a `bee` bundle and return its new id. */
function insertAnchorBeeRelease(
  db: Database.Database,
  release: Record<string, unknown>,
  beeName: string
): number {
  const info = db
    .prepare(
      `INSERT INTO bee_release (
         bee_name, version, source, archived_at, archived_by, user_intent_raw,
         description, parent_version, changelog, shareable, desktop_visible
       ) VALUES (?, ?, 'user', ?, 'user', ?, ?, ?, ?, ?, ?)`
    )
    .run(
      beeName,
      String(release.version ?? "0.0.0"),
      nowIso(),
      release.user_intent_raw ?? null,
      release.description ?? null,
      release.parent_version ?? null,
      release.changelog ?? null,
      release.shareable === false ? 0 : 1,
      release.desktop_visible === false ? 0 : 1
    );
  return Number(info.lastInsertRowid);
}

/** Insert one bee_manifest row. */
function insertBeeManifestRow(
  db: Database.Database,
  releaseId: number,
  manifest: Record<string, unknown>
): void {
  db.prepare(
    `INSERT INTO bee_manifest (
       release_id, schema_version, description, segments_json,
       entrypoint_preamble, promotion, min_cycles,
       requires_human, requires_smoke, retire_on_misses
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    releaseId,
    String(manifest.schema_version ?? "peaks.bee/1"),
    String(manifest.description ?? ""),
    JSON.stringify(manifest.segments_json ?? []),
    strOrNull(manifest.entrypoint_preamble),
    String(manifest.promotion ?? "manual"),
    (manifest.min_cycles as number | null) ?? null,
    manifest.requires_human === undefined ? 1 : Number(manifest.requires_human),
    manifest.requires_smoke === undefined ? 1 : Number(manifest.requires_smoke),
    (manifest.retire_on_misses as number | null) ?? null
  );
}

/** Insert bee_segment_ref rows. */
function insertBeeSegmentRows(
  db: Database.Database,
  releaseId: number,
  segments: ReadonlyArray<Record<string, unknown>>
): void {
  if (segments.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO bee_segment_ref (
       release_id, segment_name, inputs_json, outputs_json, side_effects
     ) VALUES (?, ?, ?, ?, ?)`
  );
  for (const s of segments) {
    stmt.run(
      releaseId,
      String(s.segment_name ?? ""),
      strOrNull(s.inputs_json),
      strOrNull(s.outputs_json),
      strOrNull(s.side_effects)
    );
  }
}

/** Insert bee_file rows. */
function insertBeeFileRows(
  db: Database.Database,
  releaseId: number,
  beeName: string,
  files: ReadonlyArray<Record<string, unknown>>
): void {
  if (files.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO bee_file (
       release_id, owner_kind, owner_name, path, kind, size_bytes, sha256, blob_path
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const f of files) {
    stmt.run(
      releaseId,
      String(f.owner_kind ?? "bee"),
      beeName,
      String(f.path ?? ""),
      String(f.kind ?? "other"),
      Number(f.size_bytes ?? 0),
      String(f.sha256 ?? ""),
      String(f.blob_path ?? "")
    );
  }
}

/** Insert bee_change rows. */
function insertBeeChangeRows(
  db: Database.Database,
  releaseId: number,
  changes: ReadonlyArray<Record<string, unknown>>
): void {
  if (changes.length === 0) return;
  const stmt = db.prepare(
    `INSERT INTO bee_change (
       release_id, change_kind, target_kind, target_name, detail
     ) VALUES (?, ?, ?, ?, ?)`
  );
  for (const c of changes) {
    stmt.run(
      releaseId,
      String(c.change_kind ?? ""),
      String(c.target_kind ?? ""),
      String(c.target_name ?? ""),
      strOrNull(c.detail)
    );
  }
}
