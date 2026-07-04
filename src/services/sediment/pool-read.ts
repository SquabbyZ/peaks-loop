import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { resolvePoolRoot, resolveUserBeesDir, resolveSegmentsDir } from "./pool-paths.js";
import { lintManifest } from "./manifest-lint.js";
import type { IndexFile, IndexEntry, BeeManifest } from "./types.js";

export class POOL_READ_ERROR extends Error {}

function readJsonIfExists<T>(p: string): T | null {
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8")) as T;
}

function readBeeDir(home: string, name: string): IndexEntry | null {
  const dir = join(resolveUserBeesDir({ home }), name);
  const manifestPath = join(dir, "manifest.json");
  const m = readJsonIfExists<BeeManifest>(manifestPath);
  if (!m) return null;
  const r = lintManifest(m);
  if (!r.ok) return null;
  return {
    name: m.name,
    kind: "bee",
    path: `bees/${name}`,
    source: m.source,
    promotion_status: m.promotion_status,
    segments: m.segments.map((s) => s.name),
  };
}

function readSegmentDir(home: string, name: string): IndexEntry | null {
  const dir = join(resolveSegmentsDir({ home }), name);
  if (!existsSync(dir)) return null;
  return {
    name, kind: "segment", path: `segments/${name}`, source: "user", promotion_status: "stable",
  };
}

export function readPool({ home }: { home: string }): IndexFile {
  const root = resolvePoolRoot({ home });
  if (!existsSync(root)) mkdirSync(root, { recursive: true });
  const entries: IndexEntry[] = [];
  const beesDir = resolveUserBeesDir({ home });
  if (existsSync(beesDir)) {
    for (const name of readdirSync(beesDir)) entries.push(...[readBeeDir(home, name)].filter((e): e is IndexEntry => e !== null));
  }
  const segsDir = resolveSegmentsDir({ home });
  if (existsSync(segsDir)) {
    for (const name of readdirSync(segsDir)) entries.push(...[readSegmentDir(home, name)].filter((e): e is IndexEntry => e !== null));
  }
  const idx: IndexFile = { schemaVersion: "peaks.pool/1", generatedAt: new Date().toISOString(), entries };
  writeFileSync(join(root, "index.json"), JSON.stringify(idx, null, 2) + "\n");
  return idx;
}