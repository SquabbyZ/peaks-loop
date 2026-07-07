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
 * The reader is also the integration point for AC-26 — the loop
 * promote path (which lives in a future slice / CLI command) checks
 * `evolution_evaluation.independent_scorer_verdict` before allowing
 * a candidate → stable transition; this slice does not add a new
 * `peaks loop promote` because `peaks asset crystallize` already
 * enforces the brief-section + pre-run gates and creates the
 * initial `candidate` row. The integration test for AC-26 verifies
 * that a freshly imported bundle has no `evolution_evaluation`
 * row and that promotion therefore cannot proceed.
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
/* Main entrypoint                                                           */
/* ---------------------------------------------------------------------- */

export function readBundle(args: ReadBundleArgs): ReadBundleResult {
  const { db, blobsDir, inPath } = args;
  if (!existsSync(inPath)) {
    throw new BundleMalformedError(`bundle file not found at '${inPath}'`);
  }

  const stageDir = inPath + ".extract";
  if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });

  let extractOk = false;
  try {
    runTar(["-xzf", inPath, "-C", stageDir]);
    extractOk = true;
  } finally {
    if (!extractOk) rmSync(stageDir, { recursive: true, force: true });
  }

  try {
    const manifestPath = join(stageDir, "manifest.json");
    if (!existsSync(manifestPath)) {
      throw new BundleMalformedError(
        "bundle is missing manifest.json (writer is required to emit it)"
      );
    }
    let rawManifest: unknown;
    try {
      rawManifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch (err: unknown) {
      throw new BundleMalformedError(
        `manifest.json could not be parsed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
    const manifest = parseManifest(rawManifest);

    // Re-materialise content-addressed blobs regardless of kind —
    // the layout (`blobs/<sha256>`) is identical for both.
    const blobsStageDir = join(stageDir, "blobs");
    if (existsSync(blobsStageDir)) {
      mkdirSync(blobsDir, { recursive: true });
      const blobsOut = blobsDir;
      for (const fname of readDirEntries(blobsStageDir)) {
        const src = join(blobsStageDir, fname);
        if (!fname.match(/^[0-9a-f]{64}$/)) continue;
        const destDir = join(blobsOut, fname.slice(0, 2));
        mkdirSync(destDir, { recursive: true });
        const destPath = join(destDir, fname);
        if (!existsSync(destPath)) {
          writeFileSync(destPath, readFileSync(src));
        }
      }
    }

    if (manifest.kind === "loop") {
      const assetId = importLoopBundle(db, manifest, args.asName);
      return {
        assetId,
        kind: "loop",
        importedAs: "candidate",
        warnings: manifest.format_version_minor === 0 ? [] : [
          `minor-version=${manifest.format_version_minor}; supported but flagging for awareness`,
        ],
        evidenceBriefCount: manifest.evidence_briefs.length,
      };
    }
    const beeId = importBeeBundle(db, manifest, blobsDir, args.asName);
    return {
      assetId: beeId,
      kind: "bee",
      importedAs: "candidate",
      warnings: manifest.format_version_minor === 0 ? [] : [
        `minor-version=${manifest.format_version_minor}; supported but flagging for awareness`,
      ],
      evidenceBriefCount: manifest.evidence_briefs.length,
    };
  } finally {
    if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
  }
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
/* Loop import                                                              */
/* ---------------------------------------------------------------------- */

function importLoopBundle(
  db: Database.Database,
  manifest: BundleManifest,
  asName?: string
): string {
  const srcLoop = manifest.loop_release as Record<string, unknown>;
  const srcId = String(srcLoop.id ?? "");
  if (!srcId) throw new BundleMalformedError("loop_release is missing id");
  const targetId = asName ?? srcId;

  // Hard-block per spec §7A.2 / AC-25: bundles MAY ONLY land as
  // candidate. A non-candidate source lifecycle is REFUSED; we
  // never silently coerce away a stable / retired source.
  const srcStatus =
    typeof srcLoop.lifecycle_status === "string"
      ? srcLoop.lifecycle_status
      : "candidate";
  if (srcStatus !== "candidate") {
    throw new BundleImportToStableForbiddenError(srcStatus);
  }

  // The reader always lands as candidate — the source's lifecycle
  // status is silently overridden (spec §7A.2 hard rule).
  const loopRow = {
    id: targetId,
    name: srcLoop.name,
    scenario: srcLoop.scenario,
    trigger_policy: srcLoop.trigger_policy,
    success_criteria_json: JSON.stringify(
      (srcLoop.success_criteria as unknown[]) ?? []
    ),
    interaction_policy: srcLoop.interaction_policy,
    feedback_policy: srcLoop.feedback_policy,
    evolution_policy: srcLoop.evolution_policy,
    evaluator_policy_json: JSON.stringify(
      (srcLoop.evaluator_policy as unknown[]) ?? []
    ),
    linked_bees_json: JSON.stringify((srcLoop.linked_bees as unknown[]) ?? []),
    run_history_json: JSON.stringify((srcLoop.run_history as unknown[]) ?? []),
    crystallization_evidence_json: JSON.stringify(
      (srcLoop.crystallization_evidence as unknown[]) ?? []
    ),
    lifecycle_status: "candidate",
    version: srcLoop.version,
    schema_version: srcLoop.schema_version ?? PEAKS_BUNDLE_SCHEMA_VERSIONS.loop,
    archived_at:
      typeof srcLoop.archived_at === "string"
        ? srcLoop.archived_at
        : new Date().toISOString(),
    shareable:
      srcLoop.shareable === undefined ? 1 : srcLoop.shareable ? 1 : 0,
    share_excluded_paths: JSON.stringify(
      (srcLoop.share_excluded_paths as unknown[]) ?? []
    ),
    desktop_visible:
      srcLoop.desktop_visible === undefined
        ? 1
        : srcLoop.desktop_visible
          ? 1
          : 0,
    export_bundle_format:
      typeof srcLoop.export_bundle_format === "string"
        ? srcLoop.export_bundle_format
        : "peaks.bundle/1",
  };

  // Defense-in-depth: refuse if lifecycle was anything other than
  // candidate. (The schema parse above already pinned the constant,
  // but we layer this so any future schema relaxation cannot
  // bypass the import-to-candidate rule.)
  if (loopRow.lifecycle_status !== "candidate") {
    throw new BundleImportToStableForbiddenError(loopRow.lifecycle_status);
  }

  // First materialise related bee_release rows. The bundle's
  // loop_bee_relations reference these bee ids; re-stamping the
  // relations before the bee rows land would FK-constraint fail
  // on the receiver.
  const beeIdMap = materialiseRelatedBees(db, manifest.related_bee_releases);

  const tx = db.transaction(() => {
    db.prepare(
      `INSERT OR REPLACE INTO loop_release (
         id, name, scenario, trigger_policy,
         success_criteria_json, interaction_policy, feedback_policy, evolution_policy,
         evaluator_policy_json, linked_bees_json, run_history_json, crystallization_evidence_json,
         lifecycle_status, version, schema_version, archived_at,
         shareable, share_excluded_paths, desktop_visible, export_bundle_format
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      loopRow.id,
      loopRow.name,
      loopRow.scenario,
      loopRow.trigger_policy,
      loopRow.success_criteria_json,
      loopRow.interaction_policy,
      loopRow.feedback_policy,
      loopRow.evolution_policy,
      loopRow.evaluator_policy_json,
      loopRow.linked_bees_json,
      loopRow.run_history_json,
      loopRow.crystallization_evidence_json,
      loopRow.lifecycle_status,
      loopRow.version,
      loopRow.schema_version,
      loopRow.archived_at,
      loopRow.shareable,
      loopRow.share_excluded_paths,
      loopRow.desktop_visible,
      loopRow.export_bundle_format
    );

    // Re-stamp relations (preserving source row content, but the
    // loop_id is rewritten if `asName` was supplied).
    for (const rel of manifest.loop_bee_relations) {
      const r = rel as Record<string, unknown>;
      const originalBeeId = Number(r.bee_release_id);
      const newBeeId = beeIdMap.get(originalBeeId) ?? originalBeeId;
      db.prepare(
        `INSERT OR REPLACE INTO loop_bee_relation (
           loop_release_id, bee_release_id, role, reason, schema_version, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        asName ?? String(r.loop_release_id),
        newBeeId,
        String(r.role),
        String(r.reason ?? ""),
        String(
          r.schema_version ?? PEAKS_BUNDLE_SCHEMA_VERSIONS.loop_bee_relation
        ),
        typeof r.created_at === "string"
          ? r.created_at
          : new Date().toISOString()
      );
    }
  });

  tx();
  return targetId;
}

/* ---------------------------------------------------------------------- */
/* Related-bees materialisation                                            */
/* ---------------------------------------------------------------------- */

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
    const obj = raw as {
      bee_release: Record<string, unknown>;
      manifest: Record<string, unknown> | undefined;
      segments: Array<Record<string, unknown>>;
      files: Array<Record<string, unknown>>;
      changes: Array<Record<string, unknown>>;
    };
    const release = obj.bee_release ?? {};
    const srcId = Number(release.id);
    if (!Number.isInteger(srcId) || srcId <= 0) continue;
    const beeName = String(release.bee_name ?? "");
    if (!beeName) continue;
    // Honour the same non-candidate hard rule at the bee row.
    const srcStatus =
      typeof release.lifecycle_status === "string"
        ? release.lifecycle_status
        : "candidate";
    if (srcStatus !== "candidate") {
      throw new BundleImportToStableForbiddenError(srcStatus);
    }

    // Pre-existing receiver-side bee with the same name → keep its id.
    const existing = db
      .prepare("SELECT id FROM bee_release WHERE bee_name = ?")
      .get(beeName) as { id: number } | undefined;
    let newId: number;
    if (existing) {
      newId = existing.id;
    } else {
      const ins = db.prepare(
        `INSERT INTO bee_release (
           bee_name, version, source, archived_at, archived_by, user_intent_raw,
           description, parent_version, changelog, shareable, desktop_visible
         ) VALUES (?, ?, 'user', ?, 'user', ?, ?, ?, ?, ?, ?)`
      );
      const info = ins.run(
        beeName,
        String(release.version ?? "0.0.0"),
        new Date().toISOString(),
        release.user_intent_raw ?? null,
        release.description ?? null,
        release.parent_version ?? null,
        release.changelog ?? null,
        release.shareable === false ? 0 : 1,
        release.desktop_visible === false ? 0 : 1
      );
      newId = Number(info.lastInsertRowid);
      if (obj.manifest) {
        const m = obj.manifest;
        db.prepare(
          `INSERT INTO bee_manifest (
             release_id, schema_version, description, segments_json,
             entrypoint_preamble, promotion, min_cycles,
             requires_human, requires_smoke, retire_on_misses
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          newId,
          String(m.schema_version ?? "peaks.bee/1"),
          String(m.description ?? ""),
          JSON.stringify(m.segments_json ?? []),
          (m.entrypoint_preamble as string | null) ?? null,
          String(m.promotion ?? "manual"),
          (m.min_cycles as number | null) ?? null,
          m.requires_human === undefined ? 1 : Number(m.requires_human),
          m.requires_smoke === undefined ? 1 : Number(m.requires_smoke),
          (m.retire_on_misses as number | null) ?? null
        );
      }
    }
    map.set(srcId, newId);
  }
  return map;
}

/* ---------------------------------------------------------------------- */
/* Bee import                                                                */
/* ---------------------------------------------------------------------- */

function importBeeBundle(
  db: Database.Database,
  manifest: BundleManifest,
  _blobsDir: string,
  asName?: string
): number {
  if (!manifest.bee_release) {
    throw new BundleMalformedError("bee_release payload missing from bee bundle");
  }
  const beeObj = manifest.bee_release as {
    bee_release: Record<string, unknown>;
    manifest: Record<string, unknown> | undefined;
    segments: Array<Record<string, unknown>>;
    files: Array<Record<string, unknown>>;
    changes: Array<Record<string, unknown>>;
  };
  const release = beeObj.bee_release;
  const newBeeName =
    asName ?? String(release.bee_name ?? "");
  if (!newBeeName) throw new BundleMalformedError("bee_release.bee_name missing");

  // Same hard rule: any non-candidate import is refused. The reader
  // does not honor --as-stable switches.
  const srcStatus =
    typeof release.lifecycle_status === "string"
      ? release.lifecycle_status
      : "candidate";
  if (srcStatus !== "candidate") {
    throw new BundleImportToStableForbiddenError(srcStatus);
  }

  let newId = -1;
  const tx = db.transaction(() => {
    const ins = db.prepare(
      `INSERT INTO bee_release (
         bee_name, version, source, archived_at, archived_by, user_intent_raw,
         description, parent_version, changelog, shareable, desktop_visible
       ) VALUES (?, ?, 'user', ?, 'user', ?, ?, ?, ?, ?, ?)`
    );
    const info = ins.run(
      newBeeName,
      String(release.version ?? "0.0.0"),
      new Date().toISOString(),
      release.user_intent_raw ?? null,
      release.description ?? null,
      release.parent_version ?? null,
      release.changelog ?? null,
      release.shareable === false ? 0 : 1,
      release.desktop_visible === false ? 0 : 1
    );
    newId = Number(info.lastInsertRowid);
    if (beeObj.manifest) {
      const m = beeObj.manifest;
      db.prepare(
        `INSERT INTO bee_manifest (
           release_id, schema_version, description, segments_json,
           entrypoint_preamble, promotion, min_cycles,
           requires_human, requires_smoke, retire_on_misses
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId,
        String(m.schema_version ?? "peaks.bee/1"),
        String(m.description ?? ""),
        JSON.stringify(m.segments_json ?? []),
        (m.entrypoint_preamble as string | null) ?? null,
        String(m.promotion ?? "manual"),
        (m.min_cycles as number | null) ?? null,
        m.requires_human === undefined ? 1 : Number(m.requires_human),
        m.requires_smoke === undefined ? 1 : Number(m.requires_smoke),
        (m.retire_on_misses as number | null) ?? null
      );
    }
    for (const s of beeObj.segments ?? []) {
      db.prepare(
        `INSERT INTO bee_segment_ref (
           release_id, segment_name, inputs_json, outputs_json, side_effects
         ) VALUES (?, ?, ?, ?, ?)`
      ).run(
        newId,
        String(s.segment_name ?? ""),
        (s.inputs_json as string | null) ?? null,
        (s.outputs_json as string | null) ?? null,
        (s.side_effects as string | null) ?? null
      );
    }
    for (const f of beeObj.files ?? []) {
      db.prepare(
        `INSERT INTO bee_file (
           release_id, owner_kind, owner_name, path, kind, size_bytes, sha256, blob_path
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        newId,
        String(f.owner_kind ?? "bee"),
        newBeeName,
        String(f.path ?? ""),
        String(f.kind ?? "other"),
        Number(f.size_bytes ?? 0),
        String(f.sha256 ?? ""),
        String(f.blob_path ?? "")
      );
    }
    for (const c of beeObj.changes ?? []) {
      db.prepare(
        `INSERT INTO bee_change (
           release_id, change_kind, target_kind, target_name, detail
         ) VALUES (?, ?, ?, ?, ?)`
      ).run(
        newId,
        String(c.change_kind ?? ""),
        String(c.target_kind ?? ""),
        String(c.target_name ?? ""),
        (c.detail as string | null) ?? null
      );
    }
  });
  tx();
  return newId;
}

/* ---------------------------------------------------------------------- */
/* Utility                                                                  */
/* ---------------------------------------------------------------------- */

function readDirEntries(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
