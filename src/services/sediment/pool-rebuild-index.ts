import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { resolvePoolRoot } from "./pool-paths.js";
import { readPool } from "./pool-read.js";
import type { IndexFile } from "./types.js";

/**
 * Rebuilds index.json from on-disk manifests/segments and writes the result.
 *
 * Thin wrapper over readPool: readPool already self-heals by writing index.json
 * whenever it runs. We just re-write to be explicit (and to give downstream
 * callers like `peaks skill sediment rebuild-index` a deterministic anchor).
 */
export function rebuildIndexFromFs({ home }: { home: string }): IndexFile {
  const idx = readPool({ home });
  writeFileSync(join(resolvePoolRoot({ home }), "index.json"), JSON.stringify(idx, null, 2) + "\n");
  return idx;
}