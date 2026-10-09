// src/cli/commands/sediment-release-commands.ts
//
// The `peaks skill sediment` verbs that act on retained releases:
// `dispose`, `releases`, `release-show`, `release-diff`, `export`, `import`,
// `gc-blobs`. Split out of `sediment-commands.ts`; every verb's args,
// envelope, stderr warning and error strings are unchanged.

import { mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  resolveStateDbPath,
  resolveBlobsDir,
  resolveUserBeesDir,
  resolveUserBeeDir
} from '../../services/sediment/pool-paths.js';
import { rebuildIndexFromFs } from '../../services/sediment/pool-rebuild-index.js';
import type { BeeManifest } from '../../services/sediment/types.js';
import { openStateDb } from '../../services/skillhub/sqlite-store.js';
import { retainRelease } from '../../services/skillhub/release-retain.js';
import { releaseDiff } from '../../services/skillhub/release-diff.js';
import { exportRelease } from '../../services/skillhub/release-export.js';
import { importRelease } from '../../services/skillhub/release-import.js';
import { gcBlobs } from '../../services/skillhub/release-gc-blobs.js';
import type {
  BeeReleaseRow,
  BeeManifestRow,
  BeeSegmentRefRow,
  BeeFileRow
} from '../../services/skillhub/types.js';
import type { ParsedFlags } from './sediment-argv-flags.js';
import type { CliResult, SedimentContext } from './sediment-command-shared.js';

const DEFAULT_RELEASE_VERSION = '0.1.0';

function beeManifestPath(home: string, name: string): string {
  return join(resolveUserBeesDir({ home }), name, 'manifest.json');
}

function readManifest(manifestPath: string): BeeManifest | null {
  if (!existsSync(manifestPath)) return null;
  return JSON.parse(readFileSync(manifestPath, 'utf-8')) as BeeManifest;
}

/** `e instanceof Error ? e.message : String(e)` — the pool's error text. */
function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * User bee destroy: remove the manifest dir from the pool. The scratch
 * materialization is cleaned up by the dispatch flow (its concern), but the
 * pool's bees/<name>/manifest.json entry is removed here so the index reflects
 * reality on next read.
 */
function destroyUserBee(home: string, name: string): CliResult {
  const beeDir = resolveUserBeeDir({ home }, name);
  rmSync(beeDir, { recursive: true, force: true });
  rebuildIndexFromFs({ home });
  return { ok: true, data: { userDestroyed: true, path: beeDir } };
}

/** User bee retain: open state.db, call retainRelease. */
function retainUserBee(home: string, manifest: BeeManifest, flags: ParsedFlags): CliResult {
  const version = flags.maybeString('version') ?? DEFAULT_RELEASE_VERSION;
  const scratchDir = flags.maybeString('scratch') ?? join(home, 'scratch');
  if (!existsSync(scratchDir)) return { ok: false, error: 'SCRATCH_NOT_FOUND' };
  const stateDbPath = resolveStateDbPath({ home });
  const blobsDir = resolveBlobsDir({ home });
  mkdirSync(blobsDir, { recursive: true });
  const db = openStateDb(stateDbPath);
  try {
    retainRelease({ db, blobsDir, scratchDir, manifest, version });
  } finally {
    db.close();
  }
  return { ok: true, data: { retained: true, version } };
}

export function dispose(ctx: SedimentContext): CliResult {
  const { home, positional, flags } = ctx;
  const name = positional[1];
  if (!name) return { ok: false, error: 'MISSING_ARG: dispose requires <name>' };
  const decision = flags.maybeString('decision') ?? '';
  if (decision !== 'destroy' && decision !== 'retain') {
    return { ok: false, error: 'MISSING_ARG: dispose requires --decision destroy|retain' };
  }
  const m = readManifest(beeManifestPath(home, name));
  if (m === null) return { ok: false, error: 'BEE_NOT_FOUND' };
  // System bees: silently destroy; refuse retain (Task 9 contract).
  if (m.source === 'system') {
    if (decision === 'retain') return { ok: false, error: 'RETAIN_SYSTEM_REFUSED' };
    return { ok: true, data: { systemDestroyed: true } };
  }
  return decision === 'destroy' ? destroyUserBee(home, name) : retainUserBee(home, m, flags);
}

const RELEASES_SQL =
  'SELECT id, bee_name, version, source, archived_at, archived_by FROM bee_release WHERE bee_name = ? ORDER BY archived_at DESC';

export function releases(ctx: SedimentContext): CliResult {
  const { home, positional } = ctx;
  const beeName = positional[1];
  if (!beeName) return { ok: false, error: 'MISSING_ARG: releases requires <bee-name>' };
  const stateDbPath = resolveStateDbPath({ home });
  const db = openStateDb(stateDbPath);
  try {
    const rows = db.prepare(RELEASES_SQL).all(beeName) as Array<{
      id: number;
      bee_name: string;
      version: string;
      source: string;
      archived_at: string;
      archived_by: string;
    }>;
    return { ok: true, data: rows };
  } finally {
    db.close();
  }
}

export function releaseShow(ctx: SedimentContext): CliResult {
  const { home, positional, flags } = ctx;
  const beeName = positional[1];
  const version = flags.maybeString('version') ?? '';
  if (!beeName || !version) {
    return {
      ok: false,
      error: 'MISSING_ARG: release-show requires <bee-name> and --version'
    };
  }
  const stateDbPath = resolveStateDbPath({ home });
  const db = openStateDb(stateDbPath);
  try {
    // Cast the row to the typed interface from skillhub/types.ts so
    // downstream consumers (LLM agents in peaks-maker, CLI JSON
    // renderers) get a structural shape rather than
    // Record<string, unknown>. Minor #12 fix.
    const row = db
      .prepare('SELECT * FROM bee_release WHERE bee_name = ? AND version = ?')
      .get(beeName, version) as BeeReleaseRow | undefined;
    if (!row) return { ok: false, error: 'VERSION_NOT_FOUND' };
    const id = row.id;
    const manifest = db.prepare('SELECT * FROM bee_manifest WHERE release_id = ?').get(id) as
      BeeManifestRow | undefined;
    const segments = db
      .prepare('SELECT * FROM bee_segment_ref WHERE release_id = ?')
      .all(id) as unknown as BeeSegmentRefRow[];
    const files = db
      .prepare('SELECT * FROM bee_file WHERE release_id = ?')
      .all(id) as unknown as BeeFileRow[];
    return { ok: true, data: { release: row, manifest, segments, files } };
  } finally {
    db.close();
  }
}

export function releaseDiffVerb(ctx: SedimentContext): CliResult {
  const { home, positional, flags } = ctx;
  const beeName = positional[1];
  const fromVersion = flags.maybeString('from') ?? '';
  const toVersion = flags.maybeString('to') ?? '';
  if (!beeName || !fromVersion || !toVersion) {
    return {
      ok: false,
      error: 'MISSING_ARG: release-diff requires <bee-name> and --from and --to'
    };
  }
  const stateDbPath = resolveStateDbPath({ home });
  const db = openStateDb(stateDbPath);
  try {
    const diff = releaseDiff({ db, beeName, fromVersion, toVersion });
    return { ok: true, data: diff };
  } catch (e: unknown) {
    return { ok: false, error: errorText(e) };
  } finally {
    db.close();
  }
}

export function exportVerb(ctx: SedimentContext): CliResult {
  const { home, positional, flags } = ctx;
  const beeName = positional[1];
  const version = flags.maybeString('version') ?? '';
  const outPath = flags.maybeString('out') ?? '';
  if (!beeName || !version || !outPath) {
    return { ok: false, error: 'MISSING_ARG: export requires <bee-name>, --version, --out' };
  }
  const stateDbPath = resolveStateDbPath({ home });
  const blobsDir = resolveBlobsDir({ home });
  const db = openStateDb(stateDbPath);
  try {
    exportRelease({ db, blobsDir, beeName, version, outPath });
  } catch (e: unknown) {
    return { ok: false, error: errorText(e) };
  } finally {
    db.close();
  }
  // M7 (spec §7A.2 / §10 RL-9): `peaks skill sediment export` is
  // an ALIAS of `peaks loop export` for one release cycle. Emit
  // the deprecation warning to stderr so downstream tooling can
  // upgrade. Future slice removes the alias.
  process.stderr.write(
    "warning: 'peaks skill sediment export' is deprecated; use 'peaks loop export' or 'peaks bee export' (peaks.bundle/1, spec §7A.2)\n"
  );
  return { ok: true, data: { outPath } };
}

export function importVerb(ctx: SedimentContext): CliResult {
  const { home, positional, flags } = ctx;
  const bundlePath = positional[1];
  const asNameRaw = flags.maybeString('as');
  const asName = asNameRaw && asNameRaw.length > 0 ? asNameRaw : undefined;
  if (!bundlePath) return { ok: false, error: 'MISSING_ARG: import requires <bundle-path>' };
  if (!existsSync(bundlePath)) return { ok: false, error: 'BUNDLE_NOT_FOUND' };
  const stateDbPath = resolveStateDbPath({ home });
  const blobsDir = resolveBlobsDir({ home });
  mkdirSync(blobsDir, { recursive: true });
  const db = openStateDb(stateDbPath);
  try {
    if (asName !== undefined) {
      importRelease({ db, blobsDir, inPath: bundlePath, asName });
    } else {
      importRelease({ db, blobsDir, inPath: bundlePath });
    }
  } catch (e: unknown) {
    return { ok: false, error: errorText(e) };
  } finally {
    db.close();
  }
  // M7 (spec §7A.2): `peaks skill sediment import` is an ALIAS of
  // `peaks loop import` for one release cycle. Emit the
  // deprecation warning so downstream tooling can upgrade.
  process.stderr.write(
    "warning: 'peaks skill sediment import' is deprecated; use 'peaks loop import' or 'peaks bee import' (peaks.bundle/1, spec §7A.2)\n"
  );
  return { ok: true, data: { asName: asName ?? basename(bundlePath) } };
}

export function gcBlobsVerb(ctx: SedimentContext): CliResult {
  const { home, flags } = ctx;
  const dryRun = flags.bool('dry-run');
  const stateDbPath = resolveStateDbPath({ home });
  const blobsDir = resolveBlobsDir({ home });
  const db = openStateDb(stateDbPath);
  try {
    const removed = gcBlobs({ db, blobsDir, dryRun });
    return { ok: true, data: { removed } };
  } catch (e: unknown) {
    return { ok: false, error: errorText(e) };
  } finally {
    db.close();
  }
}
