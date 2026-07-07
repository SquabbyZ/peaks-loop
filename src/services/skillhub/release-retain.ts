import { createHash } from "node:crypto";
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import type Database from "better-sqlite3";
import type { BeeManifest } from "../sediment/types.js";

/** Compute the sha256 hash and byte length of a single file. */
export function sha256OfFile(p: string): { sha: string; bytes: number } {
  const buf = readFileSync(p);
  return { sha: createHash("sha256").update(buf).digest("hex"), bytes: buf.length };
}

/** Copy a file into the content-addressed blob store under `blobsDir/<aa>/<sha>`
 *  if not already present, and return the relative blob_path used by `bee_file`. */
export function ensureBlob(blobsDir: string, sha: string, srcPath: string): string {
  const dir = join(blobsDir, sha.slice(0, 2));
  const dest = join(dir, sha);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  if (!existsSync(dest)) writeFileSync(dest, readFileSync(srcPath));
  return `blobs/${sha.slice(0, 2)}/${sha}`;
}

export function* walk(root: string, base = root): Generator<{ abs: string; rel: string }> {
  for (const ent of readdirSync(base, { withFileTypes: true })) {
    const abs = join(base, ent.name);
    if (ent.isDirectory()) yield* walk(root, abs);
    else {
      const relPosix = relative(root, abs).split(/[\\/]/).join("/");
      yield { abs, rel: relPosix };
    }
  }
}

function warnOverflow(column: string, length: number): void {
  // Soft warning, no truncation: the spec does not mandate truncation,
  // but a stale over-16KB row would silently break downstream readers
  // that assume <16KB. Surface it for ops review.
  // eslint-disable-next-line no-console
  console.warn(`[release-retain] WARN: column ${column} overflowed 16KB guard (${length} bytes) — review and consider truncation`);
}

/**
 * Defensive 16KB check: if the value would exceed SQLite's
 * recommended 16KB single-column limit, log a warning. Not a hard
 * error — we let SQLite handle overflow. The columns covered are the
 * four TEXT columns previously unchecked: bee_manifest.segments_json,
 * bee_segment_ref.inputs_json, bee_segment_ref.outputs_json,
 * bee_segment_ref.side_effects.
 */
function checkOverflow({ table, col }: { table: string; col: string }, value: string): void {
  const len = Buffer.byteLength(value, "utf-8");
  if (len > 16 * 1024) warnOverflow(`${table}.${col}`, len);
}

export function retainRelease({
  db,
  blobsDir,
  scratchDir,
  manifest,
  version: explicitVersion,
  parentVersion,
  changelog,
}: {
  db: Database.Database;
  blobsDir: string;
  scratchDir: string;
  manifest: BeeManifest;
  version?: string;
  parentVersion?: string;
  changelog?: string;
}): number {
  const version = explicitVersion ?? "0.1.0";
  const tx = db.transaction(() => {
    // M3 / spec §4.2: `shareable` and `desktop_visible` are written
    // with their spec defaults (true). M7 will add a CLI flag to
    // override on retain; M3 keeps the defaulting on the insert path
    // so existing call sites stay source-compatible. The two new
    // columns were added by migration 004-loop-bee-extension.sql.
    const ins = db.prepare(
      `INSERT INTO bee_release (bee_name, version, source, archived_at, archived_by, user_intent_raw, description, parent_version, changelog, shareable, desktop_visible) VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?, 1, 1)`
    );
    const info = ins.run(
      manifest.name,
      version,
      new Date().toISOString(),
      "llm",
      null,
      manifest.description,
      parentVersion ?? null,
      changelog ?? null
    );
    const id = info.lastInsertRowid as number;
    db.prepare(
      `INSERT OR REPLACE INTO bee_release_pointer (bee_name, latest_version, released_at) VALUES (?, ?, ?)`
    ).run(manifest.name, version, new Date().toISOString());
    for (const s of manifest.segments) {
      const inputsJson = JSON.stringify(s.inputs);
      const outputsJson = JSON.stringify(s.outputs);
      const sideEffectsStr = s.sideEffects.join(",");
      checkOverflow({ table: "bee_segment_ref", col: "inputs_json" }, inputsJson);
      checkOverflow({ table: "bee_segment_ref", col: "outputs_json" }, outputsJson);
      checkOverflow({ table: "bee_segment_ref", col: "side_effects" }, sideEffectsStr);
      db.prepare(
        `INSERT INTO bee_segment_ref (release_id, segment_name, inputs_json, outputs_json, side_effects) VALUES (?, ?, ?, ?, ?)`
      ).run(id, s.name, inputsJson, outputsJson, sideEffectsStr);
    }
    // Also guard the manifest-level JSON column that holds the segment
    // name list (can exceed 16KB if a bee advertises thousands of
    // segments).
    const segmentsJson = JSON.stringify(manifest.segments.map((s) => s.name));
    checkOverflow({ table: "bee_manifest", col: "segments_json" }, segmentsJson);
    db.prepare(
      `INSERT INTO bee_manifest (release_id, schema_version, description, segments_json, entrypoint_preamble, promotion, min_cycles, requires_human, requires_smoke, retire_on_misses) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      manifest.schemaVersion,
      manifest.description,
      segmentsJson,
      manifest.entrypoint.preamble,
      manifest.promotion_status,
      manifest.promotion.minCycles,
      manifest.promotion.requiresHumanApproval ? 1 : 0,
      manifest.promotion.requiresSmokeTest ? 1 : 0,
      manifest.promotion.retireOnMissesInRow ?? null
    );
    const insFile = db.prepare(
      `INSERT INTO bee_file (release_id, owner_kind, owner_name, path, kind, size_bytes, sha256, blob_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const f of walk(scratchDir)) {
      const { sha, bytes } = sha256OfFile(f.abs);
      const blobPath = ensureBlob(blobsDir, sha, f.abs);
      const kind = f.rel.endsWith(".md")
        ? "markdown"
        : f.rel.startsWith("scripts/")
          ? "script"
          : f.rel.startsWith("references/")
            ? "reference"
            : "other";
      insFile.run(id, "bee", manifest.name, f.rel, kind, bytes, sha, blobPath);
    }
    return id;
  });
  return tx();
}
