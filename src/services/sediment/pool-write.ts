import { writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { assertNotSystemPath, resolveUserBeeDir } from "./pool-paths.js";
import { lintManifestStrict } from "./manifest-lint.js";
import type { BeeManifest } from "./types.js";

/**
 * Atomically writes a BeeManifest to <home>/.peaks/skills/bees/<name>/manifest.json.
 *
 * Defense in depth:
 *  - re-validates the manifest via lintManifestStrict (zod) before any FS work
 *  - refuses to write under any path segment equal to ".system" (soft-protection)
 *
 * Atomicity is achieved via write-to-tmp + renameSync so readers either see the
 * old file or the fully-written new file, never a half-written one.
 */
export function writeBeeManifest({ home }: { home: string }, m: BeeManifest): void {
  const validated = lintManifestStrict(m);
  const dir = resolveUserBeeDir({ home }, validated.name);
  assertNotSystemPath(dir);
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "manifest.json");
  assertNotSystemPath(file);
  const tmp = file + ".tmp";
  writeFileSync(tmp, JSON.stringify(validated, null, 2) + "\n");
  renameSync(tmp, file);
}