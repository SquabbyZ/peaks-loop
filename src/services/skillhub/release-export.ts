import { mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { runTar } from "./tar-runtime.js";

export function exportRelease({
  db,
  blobsDir,
  beeName,
  version,
  outPath,
}: {
  db: Database.Database;
  blobsDir: string;
  beeName: string;
  version: string;
  outPath: string;
}): void {
  const id = (
    db
      .prepare("SELECT id FROM bee_release WHERE bee_name = ? AND version = ?")
      .get(beeName, version) as { id: number } | undefined
  )?.id;
  if (!id) throw new Error("VERSION_NOT_FOUND");
  const manifestRows = db.prepare("SELECT * FROM bee_manifest WHERE release_id = ?").all(id);
  const segRows = db.prepare("SELECT * FROM bee_segment_ref WHERE release_id = ?").all(id);
  const fileRows = db
    .prepare("SELECT * FROM bee_file WHERE release_id = ?")
    .all(id) as Array<{ sha256: string }>;
  const changeRows = db.prepare("SELECT * FROM bee_change WHERE release_id = ?").all(id);
  const stageDir = join(outPath + ".stage");
  mkdirSync(stageDir, { recursive: true });
  writeFileSync(
    join(stageDir, "manifest.json"),
    JSON.stringify(
      { bee_name: beeName, version, manifestRows, segRows, fileRows, changeRows },
      null,
      2
    )
  );
  mkdirSync(join(stageDir, "blobs"), { recursive: true });
  for (const f of fileRows) {
    const src = join(blobsDir, f.sha256.slice(0, 2), f.sha256);
    const dest = join(stageDir, "blobs", f.sha256);
    writeFileSync(dest, readFileSync(src));
  }
  try {
    runTar(["-czf", outPath, "-C", stageDir, "."]);
  } finally {
    rmSync(stageDir, { recursive: true, force: true });
  }
}
