import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolvePoolRoot } from "./pool-paths.js";
import { readPool } from "./pool-read.js";
import type { IndexFile } from "./types.js";

/**
 * Rebuilds index.json from on-disk manifests/segments and writes the result.
 *
 * After the Critical #2 fix, `readPool` is a pure read (no filesystem
 * side-effects). `rebuildIndexFromFs` is the single writer of
 * `index.json`: it materializes the pool root if needed, walks the
 * filesystem to build the in-memory index via `readPool`, and persists
 * the result. Callers that need the on-disk cache up-to-date should
 * call this function (or one of the add-* / rebuild-index CLI verbs
 * which call it internally).
 */
export function rebuildIndexFromFs({ home }: { home: string }): IndexFile {
  const root = resolvePoolRoot({ home });
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const idx = readPool({ home });
  // Trailing newline: POSIX-friendly (`cat`, `git diff`, log tailers all
  // expect a final \n). The Minor #14 review confirmed we keep the current
  // behavior rather than drop it — both are JSON-valid but the trailing
  // newline matches the convention used by every other peaks-*.json file
  // in the project (manifest.json, segment.json, etc.).
  writeFileSync(join(root, "index.json"), JSON.stringify(idx, null, 2) + "\n");
  return idx;
}
