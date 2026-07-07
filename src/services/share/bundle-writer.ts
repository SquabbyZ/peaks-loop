/**
 * bundle-writer.ts — writeBundle(loopOrBeeId, outPath) (spec §7A.2).
 *
 * M7 / spec §7A.2 / §10 RL-9.
 *
 * Writes a `peaks.bundle/1` tar.gz that captures:
 *
 *   - One anchor asset: a loop_release (kind='loop') OR a single
 *     bee_release (kind='bee'). A loop bundle additionally carries
 *     related_bee_releases (all loop↔bee relations resolved) and
 *     loop_bee_relations rows.
 *   - All evidence_briefs (crystallization_event rows) that
 *     reference the anchor (created_loop_release_id /
 *     updated_loop_release_id / created_bee_release_id /
 *     updated_bee_release_id).
 *
 * Hard rules enforced at THIS layer:
 *
 *   - The source release MUST have `shareable !== false`. A
 *     `shareable=false` source THROWS
 *     `SHARE_BUNDLE_NOT_SHAREABLE` BEFORE the tarball is written.
 *     The CLI layer is the canonical gate (per spec §7A.2 /
 *     §10 RL-9); the writer enforces the same gate at the
 *     service boundary for defense in depth.
 *   - The bundle NEVER captures private run_state, the personal
 *     `.peaks/memory/personal/` directory, or raw `state.db`
 *     rows. The exclusion is declared in the manifest's
 *     `exclusion_manifest` field; physically, the writer only
 *     pulls rows from the structured tables.
 *   - The bundle is a tarball whose root contains `manifest.json`,
 *     `relations.json`, `evidence_briefs/*.json`, and
 *     `blobs/<sha256>` content-addressed blobs (mirroring the
 *     SkillHub release pattern).
 *
 * The writer runs `tar -czf <outPath> -C <stageDir> .` exactly the
 * same way `release-export.ts` does — same layout, same tar
 * invocation, so the `bundle-reader.ts` symmetrical side can
 * extract via `runTar(['-xzf', inPath, '-C', stageDir])` with no
 * extra plumbing.
 */

import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { runTar } from "../skillhub/tar-runtime.js";
import {
  PEAKS_BUNDLE_DEFAULT_MINOR_VERSION,
  PEAKS_BUNDLE_FORMAT_CONSTANT,
  PEAKS_BUNDLE_FORMAT_VERSION_MAJOR,
  PEAKS_BUNDLE_SCHEMA_VERSIONS,
  SHARE_BUNDLE_ERROR_CODES,
  type BundleManifest,
  type PeaksBundleKind,
} from "./bundle-types.js";

/* ---------------------------------------------------------------------- */
/* Inputs                                                                   */
/* ---------------------------------------------------------------------- */

/**
 * Inputs to `writeBundle`. `kind` decides which asset table the
 * `id` resolves against; the writer throws on unknown assets and
 * on `shareable=false` sources.
 */
export type WriteBundleArgs = {
  db: Database.Database;
  /** Blobs root for content-addressed file lookup. */
  blobsDir: string;
  /** Bundle kind — `loop` or `bee`. */
  kind: PeaksBundleKind;
  /** The asset id — loop id (kebab-case) for `kind:'loop'`, integer bee_release.id for `kind:'bee'`. */
  id: string | number;
  /** Output `.tar.gz` path. */
  outPath: string;
};

/* ---------------------------------------------------------------------- */
/* Hard-block errors                                                        */
/* ---------------------------------------------------------------------- */

/**
 * Thrown when the source release has `shareable === false`. The
 * writer throws BEFORE any tarball work; the CLI layer surfaces
 * `code = SHARE_BUNDLE_NOT_SHAREABLE`.
 */
export class BundleNotShareableError extends Error {
  readonly code: typeof SHARE_BUNDLE_ERROR_CODES.NOT_SHAREABLE;
  constructor(message: string) {
    super(message);
    this.name = "BundleNotShareableError";
    this.code = SHARE_BUNDLE_ERROR_CODES.NOT_SHAREABLE;
  }
}

/**
 * Thrown when the writer cannot locate the source asset (loop id
 * not present in `loop_release`, or bee_release.id not present).
 * Includes both `LOOP_NOT_FOUND` and `BEE_NOT_FOUND` flavors —
 * both fall under `BUNDLE_ASSET_NOT_FOUND` for the CLI envelope.
 */
export class BundleAssetNotFoundError extends Error {
  readonly code: "BUNDLE_ASSET_NOT_FOUND";
  readonly assetKind: PeaksBundleKind;
  readonly assetId: string | number;
  constructor(assetKind: PeaksBundleKind, assetId: string | number) {
    super(`${assetKind} asset not found for id='${String(assetId)}'`);
    this.name = "BundleAssetNotFoundError";
    this.code = "BUNDLE_ASSET_NOT_FOUND";
    this.assetKind = assetKind;
    this.assetId = assetId;
  }
}

/* ---------------------------------------------------------------------- */
/* Manifest builder                                                         */
/* ---------------------------------------------------------------------- */

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Internal: extract a serialized LoopRelease row ready for the
 * bundle manifest. The writer does NOT validate with
 * `LoopReleaseSchema` at write time — the source row was already
 * validated when it was written to the DB; the reader validates
 * on the way back in.
 */
function readLoopReleaseRow(
  db: Database.Database,
  id: string
): Record<string, unknown> | undefined {
  const row = db.prepare("SELECT * FROM loop_release WHERE id = ?").get(id) as
    | Record<string, unknown>
    | undefined;
  if (!row) return undefined;
  // Re-shape SQLite 0/1 INTEGER convention to JS boolean; keep
  // JSON-shaped columns as their parsed-text representation so the
  // JSON.stringify round-trip preserves fidelity.
  return {
    id: row.id,
    name: row.name,
    scenario: row.scenario,
    trigger_policy: row.trigger_policy,
    success_criteria: JSON.parse(String(row.success_criteria_json ?? "[]")),
    interaction_policy: row.interaction_policy,
    feedback_policy: row.feedback_policy,
    evolution_policy: row.evolution_policy,
    evaluator_policy: JSON.parse(String(row.evaluator_policy_json ?? "[]")),
    linked_bees: JSON.parse(String(row.linked_bees_json ?? "[]")),
    run_history: JSON.parse(String(row.run_history_json ?? "[]")),
    crystallization_evidence: JSON.parse(
      String(row.crystallization_evidence_json ?? "[]")
    ),
    lifecycle_status: row.lifecycle_status,
    version: row.version,
    schema_version: row.schema_version,
    archived_at: row.archived_at,
    shareable: row.shareable === 1,
    share_excluded_paths: JSON.parse(
      String(row.share_excluded_paths ?? "[]")
    ),
    desktop_visible: row.desktop_visible === 1,
    export_bundle_format: row.export_bundle_format,
  };
}

/**
 * Internal: read a single `bee_release` row + its relations/segments/files
 * for the bundle manifest. Mirrors the existing
 * `src/services/skillhub/release-export.ts` shape — the writer
 * includes `bee_release`, plus the inline manifest/segment/file/change
 * rows so the receiver can re-materialize the full bee.
 */
function readBeeReleaseBundle(
  db: Database.Database,
  id: number
): Record<string, unknown> | undefined {
  const release = db
    .prepare("SELECT * FROM bee_release WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;
  if (!release) return undefined;
  const manifest = db
    .prepare("SELECT * FROM bee_manifest WHERE release_id = ?")
    .get(id) as Record<string, unknown> | undefined;
  const segments = db
    .prepare("SELECT * FROM bee_segment_ref WHERE release_id = ?")
    .all(id) as Array<Record<string, unknown>>;
  const files = db
    .prepare("SELECT * FROM bee_file WHERE release_id = ?")
    .all(id) as Array<Record<string, unknown>>;
  const changes = db
    .prepare("SELECT * FROM bee_change WHERE release_id = ?")
    .all(id) as Array<Record<string, unknown>>;
  return {
    bee_release: release,
    manifest,
    segments,
    files,
    changes,
  };
}

/**
 * Internal: read loop_bee_relation rows for a given loop.
 */
function readLoopBeeRelationsForLoop(
  db: Database.Database,
  loopId: string
): Array<Record<string, unknown>> {
  return db
    .prepare(
      "SELECT * FROM loop_bee_relation WHERE loop_release_id = ? ORDER BY id ASC"
    )
    .all(loopId) as Array<Record<string, unknown>>;
}

/**
 * Internal: read loop_bee_relation rows for a given bee.
 */
function readLoopBeeRelationsForBee(
  db: Database.Database,
  beeReleaseId: number
): Array<Record<string, unknown>> {
  return db
    .prepare(
      "SELECT * FROM loop_bee_relation WHERE bee_release_id = ? ORDER BY id ASC"
    )
    .all(beeReleaseId) as Array<Record<string, unknown>>;
}

/**
 * Internal: read evidence briefs (crystallization_event rows) that
 * reference a given loop / bee. Includes both created_* and
 * updated_* FK pointers so any crystallization event that touched
 * the asset is captured.
 */
function readEvidenceBriefsForAsset(
  db: Database.Database,
  refs: { loopId?: string; beeReleaseId?: number }
): Array<Record<string, unknown>> {
  const wheres: string[] = [];
  const params: unknown[] = [];
  if (refs.loopId !== undefined) {
    wheres.push("created_loop_release_id = ?");
    params.push(refs.loopId);
    wheres.push("updated_loop_release_id = ?");
    params.push(refs.loopId);
  }
  if (refs.beeReleaseId !== undefined) {
    wheres.push("created_bee_release_id = ?");
    params.push(refs.beeReleaseId);
    wheres.push("updated_bee_release_id = ?");
    params.push(refs.beeReleaseId);
  }
  if (wheres.length === 0) return [];
  const whereSql = wheres.join(" OR ");
  const rows = db
    .prepare(`SELECT * FROM crystallization_event WHERE ${whereSql} ORDER BY created_at DESC`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: row.id,
    trigger: row.trigger,
    evidence_brief: JSON.parse(String(row.evidence_brief_json ?? "{}")),
    evidence_bullets: JSON.parse(String(row.evidence_bullets_json ?? "[]")),
    source_trace_pointers: JSON.parse(
      String(row.source_trace_pointers_json ?? "[]")
    ),
    evaluator_summary: row.evaluator_summary,
    user_decision_summary: row.user_decision_summary,
    created_loop_release_id: row.created_loop_release_id ?? undefined,
    updated_loop_release_id: row.updated_loop_release_id ?? undefined,
    created_bee_release_id: row.created_bee_release_id ?? undefined,
    updated_bee_release_id: row.updated_bee_release_id ?? undefined,
    lifecycle_status: row.lifecycle_status,
    schema_version: row.schema_version,
    created_at: row.created_at,
  }));
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/* ---------------------------------------------------------------------- */
/* Main entrypoint                                                           */
/* ---------------------------------------------------------------------- */

/**
 * Write a `peaks.bundle/1` tar.gz to `outPath`. The bundle
 * captures ONE anchor asset (`loop` or `bee`) plus its relations,
 * supporting bees (loop kind only), and evidence briefs.
 *
 * Hard blocks raised at THIS layer:
 *
 *   - `BundleNotShareableError`: the source has `shareable === false`.
 *   - `BundleAssetNotFoundError`: the source id was not present in the table.
 *
 * On success the call returns the resolved asset id and kind; the
 * CLI layer uses this to render a one-line status.
 */
export function writeBundle(args: WriteBundleArgs): {
  outPath: string;
  kind: PeaksBundleKind;
  assetId: string | number;
} {
  const { db, blobsDir, outPath } = args;

  if (args.kind === "loop") {
    return writeLoopBundle({
      db,
      blobsDir,
      loopId: String(args.id),
      outPath,
    });
  }
  return writeBeeBundle({
    db,
    blobsDir,
    beeReleaseId: typeof args.id === "number" ? args.id : Number(args.id),
    outPath,
  });
}

/* ---------------------------------------------------------------------- */
/* Loop bundle writer                                                        */
/* ---------------------------------------------------------------------- */

function writeLoopBundle(args: {
  db: Database.Database;
  blobsDir: string;
  loopId: string;
  outPath: string;
}): { outPath: string; kind: "loop"; assetId: string } {
  const loopRow = args.db
    .prepare("SELECT * FROM loop_release WHERE id = ?")
    .get(args.loopId) as
    | { shareable: 0 | 1 }
    | undefined;
  if (!loopRow) throw new BundleAssetNotFoundError("loop", args.loopId);
  // spec §7A.2 hard block: shareable=false blocks the export at the
  // CLI layer. We re-enforce at the writer for defense in depth.
  if (loopRow.shareable === 0) {
    throw new BundleNotShareableError(
      `loop_release '${args.loopId}' has shareable=false; bundles cannot be exported for non-shareable assets (spec §7A.2)`
    );
  }

  const loop = readLoopReleaseRow(args.db, args.loopId);
  if (!loop) throw new BundleAssetNotFoundError("loop", args.loopId);

  const relations = readLoopBeeRelationsForLoop(args.db, args.loopId);

  const relatedBees: Array<{
    bee_release: Record<string, unknown>;
    manifest: Record<string, unknown> | undefined;
    segments: Array<Record<string, unknown>>;
    files: Array<Record<string, unknown>>;
    changes: Array<Record<string, unknown>>;
  }> = [];
  const blobHashes = new Set<string>();
  for (const rel of relations) {
    const beeId = Number(rel.bee_release_id);
    const bee = readBeeReleaseBundle(args.db, beeId);
    if (bee) {
      relatedBees.push(
        bee as {
          bee_release: Record<string, unknown>;
          manifest: Record<string, unknown> | undefined;
          segments: Array<Record<string, unknown>>;
          files: Array<Record<string, unknown>>;
          changes: Array<Record<string, unknown>>;
        }
      );
      // Pull every content-addressed sha256 across all bee_files rows.
      for (const f of bee.files) {
        const sha = String((f as { sha256?: string }).sha256 ?? "");
        if (sha) blobHashes.add(sha);
      }
    }
  }

  const evidenceBriefs = readEvidenceBriefsForAsset(args.db, {
    loopId: args.loopId,
  });

  const manifest: BundleManifest = {
    format_constant: PEAKS_BUNDLE_FORMAT_CONSTANT,
    format_version_major: PEAKS_BUNDLE_FORMAT_VERSION_MAJOR,
    format_version_minor: PEAKS_BUNDLE_DEFAULT_MINOR_VERSION,
    schema_versions: {
      loop: PEAKS_BUNDLE_SCHEMA_VERSIONS.loop,
      bee: PEAKS_BUNDLE_SCHEMA_VERSIONS.bee,
      loop_bee_relation: PEAKS_BUNDLE_SCHEMA_VERSIONS.loop_bee_relation,
      crystallization: PEAKS_BUNDLE_SCHEMA_VERSIONS.crystallization,
    },
    kind: "loop",
    loop_release: loop,
    bee_release: undefined,
    related_bee_releases: relatedBees,
    loop_bee_relations: relations,
    evidence_briefs: evidenceBriefs,
    exclusion_manifest: {
      private_run_state: "excluded",
      personal_memory: "excluded",
      state_db_rows: "excluded",
    },
  };

  runStageTarball({
    outPath: args.outPath,
    blobsDir: args.blobsDir,
    blobHashes,
    manifest,
  });

  return { outPath: args.outPath, kind: "loop", assetId: args.loopId };
}

/* ---------------------------------------------------------------------- */
/* Bee bundle writer                                                         */
/* ---------------------------------------------------------------------- */

function writeBeeBundle(args: {
  db: Database.Database;
  blobsDir: string;
  beeReleaseId: number;
  outPath: string;
}): { outPath: string; kind: "bee"; assetId: number } {
  const releaseRow = args.db
    .prepare("SELECT * FROM bee_release WHERE id = ?")
    .get(args.beeReleaseId) as
    | { shareable: 0 | 1 }
    | undefined;
  if (!releaseRow)
    throw new BundleAssetNotFoundError("bee", args.beeReleaseId);
  // spec §7A.2 hard block: same as loop kind.
  if (releaseRow.shareable === 0) {
    throw new BundleNotShareableError(
      `bee_release id='${args.beeReleaseId}' has shareable=false; bundles cannot be exported for non-shareable assets (spec §7A.2)`
    );
  }

  const bee = readBeeReleaseBundle(args.db, args.beeReleaseId);
  if (!bee) throw new BundleAssetNotFoundError("bee", args.beeReleaseId);

  const relations = readLoopBeeRelationsForBee(args.db, args.beeReleaseId);

  const evidenceBriefs = readEvidenceBriefsForAsset(args.db, {
    beeReleaseId: args.beeReleaseId,
  });

  const blobHashes = new Set<string>();
  for (const f of (bee as { files: Array<Record<string, unknown>> }).files) {
    const sha = String((f as { sha256?: string }).sha256 ?? "");
    if (sha) blobHashes.add(sha);
  }

  const manifest: BundleManifest = {
    format_constant: PEAKS_BUNDLE_FORMAT_CONSTANT,
    format_version_major: PEAKS_BUNDLE_FORMAT_VERSION_MAJOR,
    format_version_minor: PEAKS_BUNDLE_DEFAULT_MINOR_VERSION,
    schema_versions: {
      loop: PEAKS_BUNDLE_SCHEMA_VERSIONS.loop,
      bee: PEAKS_BUNDLE_SCHEMA_VERSIONS.bee,
      loop_bee_relation: PEAKS_BUNDLE_SCHEMA_VERSIONS.loop_bee_relation,
      crystallization: PEAKS_BUNDLE_SCHEMA_VERSIONS.crystallization,
    },
    kind: "bee",
    loop_release: undefined,
    bee_release: bee,
    related_bee_releases: [],
    loop_bee_relations: relations,
    evidence_briefs: evidenceBriefs,
    exclusion_manifest: {
      private_run_state: "excluded",
      personal_memory: "excluded",
      state_db_rows: "excluded",
    },
  };

  runStageTarball({
    outPath: args.outPath,
    blobsDir: args.blobsDir,
    blobHashes,
    manifest,
  });

  return { outPath: args.outPath, kind: "bee", assetId: args.beeReleaseId };
}

/* ---------------------------------------------------------------------- */
/* Stage tarball — write the directory, then tar.gz it.                     */
/* ---------------------------------------------------------------------- */

function runStageTarball(args: {
  outPath: string;
  blobsDir: string;
  blobHashes: Set<string>;
  manifest: BundleManifest;
}): void {
  const { outPath, blobsDir, blobHashes, manifest } = args;
  const stageDir = outPath + ".stage";
  if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  let tarOk = false;
  try {
    writeFileSync(
      join(stageDir, "manifest.json"),
      JSON.stringify(manifest, null, 2)
    );
    mkdirSync(join(stageDir, "evidence_briefs"), { recursive: true });
    for (const brief of manifest.evidence_briefs) {
      const id = String(
        (brief as { id?: string | number }).id ?? Math.random().toString(16).slice(2)
      );
      writeFileSync(
        join(stageDir, "evidence_briefs", `${id}.json`),
        JSON.stringify(brief, null, 2)
      );
    }
    writeFileSync(
      join(stageDir, "relations.json"),
      JSON.stringify(
        {
          loop_bee_relations: manifest.loop_bee_relations,
          related_bee_releases: manifest.related_bee_releases,
        },
        null,
        2
      )
    );
    // Copy content-addressed blobs (only ones the bundle actually
    // references). The reader's blob re-materialisation
    // (see bundle-reader.ts) uses the same content-addressed
    // `blobs/<sha256>` layout as the existing SkillHub hashing.
    if (blobHashes.size > 0) {
      mkdirSync(join(stageDir, "blobs"), { recursive: true });
      for (const sha of blobHashes) {
        const src = join(blobsDir, sha.slice(0, 2), sha);
        if (!existsSync(src)) continue;
        writeFileSync(join(stageDir, "blobs", sha), readFileSync(src));
      }
    }
    // Write EVALUATION_REQUIRED.md — a marker that signals the
    // receiver to run an independent evaluation before any durable
    // change. Spec §7A.2 hard rules (5th bullet).
    writeFileSync(
      join(stageDir, "EVALUATION_REQUIRED.md"),
      [
        "# EVALUATION_REQUIRED",
        "",
        "The receiver MUST run an independent evaluation before",
        "any durable change to this loop / bee. Bundles always",
        "import as `candidate`; promotion to `stable` requires",
        "an `evolution_evaluation` row with an",
        "`independent_scorer_verdict` (spec §7A.2 / §10 RL-9).",
        "",
      ].join("\n")
    );
    runTar(["-czf", outPath, "-C", stageDir, "."]);
    tarOk = true;
  } finally {
    if (existsSync(stageDir) && !tarOk) {
      rmSync(stageDir, { recursive: true, force: true });
    }
    // Always remove the stage dir after tar succeeds too — the
    // bundle lives entirely on disk at outPath.
    if (tarOk && existsSync(stageDir)) {
      rmSync(stageDir, { recursive: true, force: true });
    }
  }
}
