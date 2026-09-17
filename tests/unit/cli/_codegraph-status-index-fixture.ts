// tests/unit/cli/_codegraph-status-index-fixture.ts
//
// Shared fixture for `codegraph-status-index-integrity.test.ts`: the real git
// work tree + real `.codegraph/codegraph.db` seeder, its report/envelope
// types, and the two small drivers every case in that file uses.
//
// Extracted verbatim from the spec (rid 2026-09-17-oversize-and-scale, D1 —
// the 800-line file-size cap) so the spec fits the cap. Nothing here changed:
// every moved line is byte-identical. `vi.mock`, `beforeEach` and
// `afterEach` deliberately STAYED in the spec, because vitest hoists
// `vi.mock` per FILE — a mock declared here would not apply to the spec that
// imports it.
//
// Not a spec: the leading `_` keeps it out of vitest's `*.test.ts` glob.

import { Command } from 'commander';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import { makeCapturedIo } from '../_setup/io.js';
import type { TmpWorkspace } from '../_setup/tmp-workspace.js';
import { registerCodegraphCommands } from '../../../src/cli/commands/codegraph-commands.js';
import { CODEGRAPH_INDEX_STRICT_ENV_VAR } from '../../../src/services/codegraph/codegraph-index-integrity.js';

export type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

// Upstream's real `files` table schema, trimmed to the columns the gate
// reads plus the NOT NULL ones a real index always carries.
const FILES_TABLE_SQL =
  'CREATE TABLE files (path TEXT PRIMARY KEY, content_hash TEXT NOT NULL, language TEXT NOT NULL, size INTEGER NOT NULL, modified_at INTEGER NOT NULL, indexed_at INTEGER NOT NULL, node_count INTEGER DEFAULT 0, errors TEXT)';

export type Fixture = {
  /** `include` globs written to the config. */
  include: string[];
  /** `exclude` globs written to the config. */
  exclude: string[];
  /** Project-relative paths seeded into the real SQLite index. */
  indexedPaths: string[];
  /**
   * `false` builds a db whose schema has NO `files` table — upstream
   * schema drift. The gate must report that it could not evaluate rather
   * than a zero-row "clean".
   */
  filesTable?: boolean;
  /**
   * `false` omits `.codegraph/config.json` while keeping the index. That is
   * the "initialized but the config is gone" state of R12-1: the index axis
   * is evaluable (the db is the subject) and its only input is missing, so
   * it is UNEVALUABLE — never silent, and never exit 0.
   */
  config?: boolean;
  /**
   * `false` omits `.codegraph/codegraph.db` while keeping the config — the
   * pre-init / dangling state, where there is genuinely nothing to measure.
   */
  database?: boolean;
};

/**
 * A real git work tree with a real `.codegraph/codegraph.db`:
 *   - `src/ok.ts`       tracked, admitted, indexed  (the healthy baseline)
 *   - `scripts/tool.mjs` tracked, supported, NOT admitted by `**\/*.ts`
 *   - `src/deleted.ts`  NOT tracked, NOT on disk, but held by the index
 *
 * The db is created in `journal_mode = WAL`, which is what upstream
 * `dist/db/index.js` sets on a real index. It matters: a read-only open
 * of a WAL database makes SQLite create the `-shm`/`-wal` sidecars, so a
 * fixture in `journal_mode = delete` cannot reproduce the production
 * condition and its "read-only" assertions cannot fail on it.
 */
export function seedProject(ws: TmpWorkspace, fixture: Fixture): string {
  execFileSync('git', ['-C', ws.path, 'init', '-q'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', ws.path, 'config', 'user.email', 'peaks-test@example.com'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', ws.path, 'config', 'user.name', 'peaks test'], { stdio: 'ignore', windowsHide: true });

  mkdirSync(join(ws.path, 'src'), { recursive: true });
  mkdirSync(join(ws.path, 'scripts'), { recursive: true });
  writeFileSync(join(ws.path, 'src', 'ok.ts'), 'export const ok = 1;\n', 'utf8');
  writeFileSync(join(ws.path, 'scripts', 'tool.mjs'), 'export const tool = 1;\n', 'utf8');
  execFileSync('git', ['-C', ws.path, 'add', '-A'], { stdio: 'ignore', windowsHide: true });
  execFileSync('git', ['-C', ws.path, 'commit', '-qm', 'fixture'], { stdio: 'ignore', windowsHide: true });

  mkdirSync(join(ws.path, '.codegraph'), { recursive: true });
  if (fixture.config !== false) {
    writeFileSync(
      join(ws.path, '.codegraph', 'config.json'),
      `${JSON.stringify({ version: 1, include: fixture.include, exclude: fixture.exclude }, null, 2)}\n`,
      'utf8'
    );
  }

  if (fixture.database !== false) {
    const db = new Database(join(ws.path, '.codegraph', 'codegraph.db'));
    db.pragma('journal_mode = WAL');
    if (fixture.filesTable !== false) {
      db.exec(FILES_TABLE_SQL);
      const insert = db.prepare(
        'INSERT INTO files (path, content_hash, language, size, modified_at, indexed_at) VALUES (?, ?, ?, 0, 0, 0)'
      );
      for (const indexedPath of fixture.indexedPaths) {
        insert.run(indexedPath, 'hash', 'typescript');
      }
    } else {
      // A schema upstream could drift to: the db opens, the query cannot.
      db.exec('CREATE TABLE unrelated (id INTEGER PRIMARY KEY)');
    }
    db.close();
  }

  return ws.path;
}

type Envelope = {
  ok: boolean;
  code?: string;
  data: {
    integrity?: { gap: boolean } | null;
    indexIntegrity?: {
      gap: boolean;
      includeGap: string[];
      deadRows: string[];
      trackedSourceCount: number;
      admittedTrackedCount: number;
      indexedFileCount: number;
    } | null;
    indexIntegrityVerdict?: string;
    indexIntegritySeverity?: string | null;
    indexIntegrityWarning?: string | null;
  };
};

export function parseJson(captured: CapturedIo): Envelope {
  return JSON.parse(captured.stdout.join('\n')) as Envelope;
}

/** Run `body` with the index gate opted in to blocking, then restore. */
export async function withStrictMode<T>(body: () => Promise<T>): Promise<T> {
  const previous = process.env[CODEGRAPH_INDEX_STRICT_ENV_VAR];
  process.env[CODEGRAPH_INDEX_STRICT_ENV_VAR] = '1';
  try {
    return await body();
  } finally {
    if (previous === undefined) {
      delete process.env[CODEGRAPH_INDEX_STRICT_ENV_VAR];
    } else {
      process.env[CODEGRAPH_INDEX_STRICT_ENV_VAR] = previous;
    }
  }
}
