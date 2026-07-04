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
    const ins = db.prepare(
      `INSERT INTO bee_release (bee_name, version, source, archived_at, archived_by, user_intent_raw, description, parent_version, changelog) VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?)`
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
    db.prepare(
      `INSERT INTO bee_manifest (release_id, schema_version, description, segments_json, entrypoint_preamble, promotion, min_cycles, requires_human, requires_smoke, retire_on_misses) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      manifest.schemaVersion,
      manifest.description,
      JSON.stringify(manifest.segments.map((s) => s.name)),
      manifest.entrypoint.preamble,
      manifest.promotion_status,
      manifest.promotion.minCycles,
      manifest.promotion.requiresHumanApproval ? 1 : 0,
      manifest.promotion.requiresSmokeTest ? 1 : 0,
      manifest.promotion.retireOnMissesInRow ?? null
    );
    for (const s of manifest.segments) {
      db.prepare(
        `INSERT INTO bee_segment_ref (release_id, segment_name, inputs_json, outputs_json, side_effects) VALUES (?, ?, ?, ?, ?)`
      ).run(
        id,
        s.name,
        JSON.stringify(s.inputs),
        JSON.stringify(s.outputs),
        s.sideEffects.join(",")
      );
    }
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
