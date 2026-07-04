import { readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { assertNotSystemPath } from "../sediment/pool-paths.js";
import { runTar } from "./tar-runtime.js";

export function importRelease({
  db,
  blobsDir,
  inPath,
  asName,
}: {
  db: Database.Database;
  blobsDir: string;
  inPath: string;
  asName?: string;
}): void {
  const stageDir = inPath + ".extract";
  if (existsSync(stageDir)) rmSync(stageDir, { recursive: true, force: true });
  mkdirSync(stageDir, { recursive: true });
  runTar(["-xzf", inPath, "-C", stageDir]);
  const payload = JSON.parse(readFileSync(join(stageDir, "manifest.json"), "utf-8")) as {
    bee_name: string;
    version: string;
    manifestRows: Array<{
      schema_version: string;
      description: string;
      segments_json: string;
      entrypoint_preamble: string | null;
      promotion: string;
      min_cycles: number | null;
      requires_human: number;
      requires_smoke: number;
      retire_on_misses: number | null;
    }>;
    segRows: Array<{
      segment_name: string;
      inputs_json: string | null;
      outputs_json: string | null;
      side_effects: string | null;
    }>;
    fileRows: Array<{
      owner_kind: string;
      owner_name: string;
      path: string;
      kind: string;
      size_bytes: number;
      sha256: string;
      blob_path: string;
    }>;
    changeRows: Array<{
      change_kind: string;
      target_kind: string;
      target_name: string;
      detail: string | null;
    }>;
  };
  const beeName = asName ?? payload.bee_name;
  if (db.prepare("SELECT 1 FROM bee_release WHERE bee_name = ?").get(beeName)) {
    if (!asName) throw new Error("IMPORT_NAME_COLLIDES");
  }
  assertNotSystemPath(beeName);
  // Copy blobs
  for (const f of payload.fileRows) {
    const dest = join(blobsDir, f.sha256.slice(0, 2));
    mkdirSync(dest, { recursive: true });
    writeFileSync(join(dest, f.sha256), readFileSync(join(stageDir, "blobs", f.sha256)));
  }
  // Re-insert rows: pick a new release id, mirror payload rows
  const ins = db.prepare(
    `INSERT INTO bee_release (bee_name, version, source, archived_at, archived_by, user_intent_raw, description, parent_version, changelog) VALUES (?, ?, 'user', ?, 'user', ?, ?, ?, ?)`
  );
  const id = ins.run(
    beeName,
    payload.version,
    new Date().toISOString(),
    null,
    null,
    null,
    null
  ).lastInsertRowid as number;
  db.prepare(
    `INSERT OR REPLACE INTO bee_release_pointer (bee_name, latest_version, released_at) VALUES (?, ?, ?)`
  ).run(beeName, payload.version, new Date().toISOString());
  for (const m of payload.manifestRows) {
    db.prepare(
      `INSERT INTO bee_manifest (release_id, schema_version, description, segments_json, entrypoint_preamble, promotion, min_cycles, requires_human, requires_smoke, retire_on_misses) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      m.schema_version,
      m.description,
      m.segments_json,
      m.entrypoint_preamble,
      m.promotion,
      m.min_cycles,
      m.requires_human,
      m.requires_smoke,
      m.retire_on_misses
    );
  }
  for (const s of payload.segRows) {
    db.prepare(
      `INSERT INTO bee_segment_ref (release_id, segment_name, inputs_json, outputs_json, side_effects) VALUES (?, ?, ?, ?, ?)`
    ).run(id, s.segment_name, s.inputs_json, s.outputs_json, s.side_effects);
  }
  for (const f of payload.fileRows) {
    db.prepare(
      `INSERT INTO bee_file (release_id, owner_kind, owner_name, path, kind, size_bytes, sha256, blob_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, f.owner_kind, beeName, f.path, f.kind, f.size_bytes, f.sha256, f.blob_path);
  }
  for (const c of payload.changeRows) {
    db.prepare(
      `INSERT INTO bee_change (release_id, change_kind, target_kind, target_name, detail) VALUES (?, ?, ?, ?, ?)`
    ).run(id, c.change_kind, c.target_kind, c.target_name, c.detail);
  }
  rmSync(stageDir, { recursive: true, force: true });
}
