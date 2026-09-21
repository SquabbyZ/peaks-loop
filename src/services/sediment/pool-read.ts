import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { resolveUserBeesDir, resolveSegmentsDir } from './pool-paths.js';
import { BeeManifestSchema } from './json-schema.js';
import type { IndexFile, IndexEntry } from './types.js';

export class POOL_READ_ERROR extends Error {}

function readBeeDir(home: string, name: string): IndexEntry | null {
  const dir = join(resolveUserBeesDir({ home }), name);
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) return null;
  // The two failures must stay DISTINCT here, and neither shipped primitive
  // keeps them apart: `tryParseJson` maps both to `null`, and `parseJson`
  // throws on both (`schema.parse(JSON.parse(raw))`). So the two steps are
  // written out.
  //
  //   not JSON        -> `JSON.parse` throws -> `peaks sediment list` fails loudly
  //   wrong shape     -> `safeParse` fails   -> this bee is skipped
  //
  // `: unknown` is not decoration: `JSON.parse` is typed `any`, so an
  // un-annotated binding would be an `any` entering the file
  // (`no-unsafe-assignment`). Annotating it is the shape the repo's other 20
  // bare `JSON.parse` reads already use, and `safeParse` accepts `unknown`,
  // so handing it on is not a `no-unsafe-argument` either.
  const decoded: unknown = JSON.parse(readFileSync(manifestPath, 'utf-8'));
  const parsed = BeeManifestSchema.safeParse(decoded);
  if (!parsed.success) return null;
  const m = parsed.data;
  return {
    name: m.name,
    kind: 'bee',
    path: `bees/${name}`,
    source: m.source,
    promotion_status: m.promotion_status,
    segments: m.segments.map((s) => s.name)
  };
}

function readSegmentDir(home: string, name: string): IndexEntry | null {
  const dir = join(resolveSegmentsDir({ home }), name);
  if (!existsSync(dir)) return null;
  return {
    name,
    kind: 'segment',
    path: `segments/${name}`,
    source: 'user',
    promotion_status: 'stable'
  };
}

/** Pure read of the in-memory pool index (Critical #2 fix).
 *
 *  CONTRACT: this function is a READ-ONLY computation. It MUST NOT
 *  write `index.json` (or any other file) as a side-effect. The
 *  "self-heal" property of rewriting index.json when it goes stale
 *  belongs to `rebuildIndexFromFs`, not here. List / search / recent /
 *  add-* verbs that need to mutate the on-disk cache should call
 *  `rebuildIndexFromFs` explicitly.
 *
 *  Edge case: if the pool root does not yet exist, this returns an
 *  empty index WITHOUT creating the directory. Callers that need a
 *  materialized root should use `rebuildIndexFromFs` or `mkdirSync`
 *  themselves.
 */
export function readPool({ home }: { home: string }): IndexFile {
  const entries: IndexEntry[] = [];
  const beesDir = resolveUserBeesDir({ home });
  if (existsSync(beesDir)) {
    for (const ent of readdirSync(beesDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      entries.push(...[readBeeDir(home, ent.name)].filter((e): e is IndexEntry => e !== null));
    }
  }
  const segsDir = resolveSegmentsDir({ home });
  if (existsSync(segsDir)) {
    for (const ent of readdirSync(segsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      entries.push(...[readSegmentDir(home, ent.name)].filter((e): e is IndexEntry => e !== null));
    }
  }
  const idx: IndexFile = {
    schemaVersion: 'peaks.pool/1',
    generatedAt: new Date().toISOString(),
    entries
  };
  // Note: NO writeFileSync here. See Critical #2 fix.
  return idx;
}
