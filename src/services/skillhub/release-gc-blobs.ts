import { readdirSync, rmSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import type Database from "better-sqlite3";

/**
 * Garbage-collect content-addressed blobs under `blobsDir/<aa>/<sha>` that
 * no `bee_file` row currently references.
 *
 * @param dryRun if true, list removed SHAs without deleting files.
 * @returns the list of removed SHA names.
 */
export function gcBlobs({
  db,
  blobsDir,
  dryRun,
}: {
  db: Database.Database;
  blobsDir: string;
  dryRun: boolean;
}): string[] {
  const refs = new Set<string>(
    (
      db.prepare("SELECT DISTINCT sha256 FROM bee_file").all() as Array<{
        sha256: string;
      }>
    ).map((r) => r.sha256)
  );
  const removed: string[] = [];
  if (!existsSync(blobsDir)) return removed;
  for (const sub of readdirSync(blobsDir)) {
    const subDir = join(blobsDir, sub);
    if (!statSync(subDir).isDirectory()) continue;
    for (const sha of readdirSync(subDir)) {
      if (refs.has(sha)) continue;
      const p = join(subDir, sha);
      if (dryRun) {
        removed.push(sha);
        continue;
      }
      rmSync(p);
      removed.push(sha);
    }
  }
  return removed;
}
