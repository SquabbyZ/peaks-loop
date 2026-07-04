import type Database from "better-sqlite3";

export interface ReleaseDiff {
  added: string[];
  removed: string[];
  modified: string[];
}

/**
 * Compare two releases of the same bee and report which file paths were
 * added, removed, or had their content (sha256) changed.
 *
 * Throws `VERSION_NOT_FOUND` if either (bee_name, version) tuple is missing.
 */
export function releaseDiff({
  db,
  beeName,
  fromVersion,
  toVersion,
}: {
  db: Database.Database;
  beeName: string;
  fromVersion: string;
  toVersion: string;
}): ReleaseDiff {
  const aRow = db
    .prepare("SELECT id FROM bee_release WHERE bee_name = ? AND version = ?")
    .get(beeName, fromVersion) as { id: number } | undefined;
  const bRow = db
    .prepare("SELECT id FROM bee_release WHERE bee_name = ? AND version = ?")
    .get(beeName, toVersion) as { id: number } | undefined;
  if (!aRow || !bRow) throw new Error("VERSION_NOT_FOUND");
  const a = aRow.id;
  const b = bRow.id;
  const aFiles = new Map<string, string>(
    (
      db
        .prepare("SELECT path, sha256 FROM bee_file WHERE release_id = ?")
        .all(a) as Array<{ path: string; sha256: string }>
    ).map((r) => [r.path, r.sha256])
  );
  const bFiles = new Map<string, string>(
    (
      db
        .prepare("SELECT path, sha256 FROM bee_file WHERE release_id = ?")
        .all(b) as Array<{ path: string; sha256: string }>
    ).map((r) => [r.path, r.sha256])
  );
  const added: string[] = [];
  const removed: string[] = [];
  const modified: string[] = [];
  for (const [p, sha] of bFiles) {
    if (!aFiles.has(p)) added.push(p);
    else if (aFiles.get(p) !== sha) modified.push(p);
  }
  for (const [p] of aFiles) {
    if (!bFiles.has(p)) removed.push(p);
  }
  return { added, removed, modified };
}
