// tests/unit/services/sqlite/sqlite-driver.test.ts
//
// The driver seam for the SQLite-backed stores, pinned BEFORE the stores are moved onto
// it. It exists because `better-sqlite3` is a native module: every consumer of the CLI
// needed either a prebuilt binary for their exact Node ABI or a C++ toolchain, and a
// missing binding is discovered at runtime, not at install. Node's own `node:sqlite`
// removes that requirement, and the two are NOT the same library, so this file names the
// four differences the stores actually depend on rather than trusting a README claim:
//
//   - nesting. `db.transaction(fn)` in better-sqlite3 nests with SAVEPOINTs for free.
//     `BEGIN` inside a transaction on node:sqlite is an error, which is measured here
//     (arm 7) so the helper's nesting is a tested behaviour and not an assumption.
//   - pragmas. node:sqlite has no `pragma()`; `exec('PRAGMA …')` returns no value, so
//     reading a setting back needs a statement (arms 3 and 4 prove the two settings the
//     stores set really take effect).
//   - rollback. A thrown body must leave NOTHING written (arm 5) — the crystallization
//     path writes four tables in one body and its whole contract is atomicity.
//   - the driver itself. `openSqlite` must return a `node:sqlite` database (arm 8), so a
//     reverted import cannot keep the suite green while the shipped binary still needs a
//     compiler.
//
// Dimensions:
//   - behavior:    the roundtrip, the pragma effects, commit/rollback, nesting
//   - integration: real file-backed databases through node:sqlite — the point of the seam
//   - render:      OMITTED — it returns no human-facing text; callers format their own
//   - a11y:        OMITTED — no human-facing surface

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  applyPragmas,
  openSqlite,
  pragmaValue,
  withTransaction
} from '../../../../src/services/sqlite/sqlite-driver.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/sqlite/sqlite-driver.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'returns no human-facing text; callers format their own' },
    { dim: 'a11y', reason: 'no human-facing surface' }
  ]
);

let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-sqlite-driver-'));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A database file unique to this arm, so WAL sidecars cannot cross-contaminate. */
function dbPath(name: string): string {
  return join(root, `${name}.sqlite`);
}

function createTable(db: DatabaseSync): void {
  db.exec('CREATE TABLE IF NOT EXISTS item (id INTEGER PRIMARY KEY, label TEXT)');
}

describe('openSqlite — the seam over node:sqlite', () => {
  it('writes and reads back through the driver it claims to use', () => {
    const path = dbPath('roundtrip');
    const db = openSqlite(path);
    try {
      createTable(db);
      db.prepare('INSERT INTO item (label) VALUES (?)').run('a');
      const row = db.prepare('SELECT id, label FROM item WHERE label = ?').get('a');
      expect(row).toMatchObject({ id: 1, label: 'a' });
      // Arm 8: the instance must be node:sqlite's own. An import quietly reverted to
      // better-sqlite3 would pass every other arm in this file and still ship a native
      // dependency, which is the whole thing this slice is about.
      expect(db).toBeInstanceOf(DatabaseSync);
      expect(readFileSync(path, 'utf8')).not.toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('refuses a read-only open of a database that is not there', () => {
    // `codegraph-index-integrity` opens the index read-only and must not CREATE an empty
    // database when the index is missing — that empty file is then "an index with no
    // rows", and the staleness gate reports a clean graph instead of an absent one.
    const missing = join(root, 'never-created.sqlite');
    expect(() => openSqlite(missing, { readOnly: true })).toThrow(/no such file|does not exist/i);
  });
});

describe('applyPragmas — the settings the stores turn on', () => {
  it('puts a file database into WAL', () => {
    const db = openSqlite(dbPath('wal'));
    try {
      applyPragmas(db, ['journal_mode = WAL']);
      expect(pragmaValue(db, 'journal_mode')).toBe('wal');
    } finally {
      db.close();
    }
  });

  it('starts with foreign keys ON where better-sqlite3 started OFF, and OFF really turns them off', () => {
    // The one measured difference that runs the opposite way from everything else here:
    // node:sqlite enforces FKs before any pragma is issued. The stores that ask for
    // `foreign_keys = ON` are unaffected, but a site that never asked — the capability
    // guard's `:memory:` probe — silently gains constraints, so write order that used to
    // work can start failing. Pinned as a test because it is a fact about the driver that
    // no import statement would reveal.
    const db = openSqlite(dbPath('fk'));
    try {
      expect(pragmaValue(db, 'foreign_keys')).toBe(1);
      db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY)');
      db.exec(
        'CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parent(id))'
      );
      expect(() => db.prepare('INSERT INTO child (parent_id) VALUES (?)').run(999)).toThrow(
        /FOREIGN KEY|constraint failed/i
      );
      // …and turning them OFF must actually take effect. If `applyPragmas` were a silent
      // no-op, this is the arm that would say so.
      applyPragmas(db, ['foreign_keys = OFF']);
      expect(pragmaValue(db, 'foreign_keys')).toBe(0);
      expect(() => db.prepare('INSERT INTO child (parent_id) VALUES (?)').run(998)).not.toThrow();
    } finally {
      db.close();
    }
  });

  it('refuses a pragma string that carries a second statement', () => {
    // The strings are literals today, and a guard costs nothing; the shape that would
    // hurt is a future caller interpolating a path or name and landing `; DROP …` inside
    // one exec() call.
    const db = openSqlite(dbPath('guard'));
    try {
      expect(() => applyPragmas(db, ['journal_mode = WAL; DELETE FROM item'])).toThrow(/one/);
    } finally {
      db.close();
    }
  });
});

describe('withTransaction — atomicity and nesting', () => {
  it('commits the body and returns its value', () => {
    const db = openSqlite(dbPath('commit'));
    try {
      createTable(db);
      const written = withTransaction(db, () => {
        db.prepare('INSERT INTO item (label) VALUES (?)').run('kept');
        return 1;
      });
      expect(written).toBe(1);
      expect(db.prepare('SELECT COUNT(*) AS n FROM item').get()).toMatchObject({ n: 1 });
    } finally {
      db.close();
    }
  });

  it('rolls the whole body back when it throws', () => {
    const db = openSqlite(dbPath('rollback'));
    try {
      createTable(db);
      expect(() =>
        withTransaction(db, () => {
          db.prepare('INSERT INTO item (label) VALUES (?)').run('first');
          throw new Error('the second write failed');
        })
      ).toThrow('the second write failed');
      // The error must propagate — a helper that swallows it turns a failed crystallize
      // into a silently partial row set.
      expect(db.prepare('SELECT COUNT(*) AS n FROM item').get()).toMatchObject({ n: 0 });
    } finally {
      db.close();
    }
  });

  it('lets an inner unit fail without undoing the outer one', () => {
    // The arm that makes the nesting real. better-sqlite3 got this from
    // `db.transaction()`; node:sqlite rejects `BEGIN` inside a transaction, so a naive
    // port would throw the moment one store body called another — and the crash would
    // land on the least-tested path in the product.
    const db = openSqlite(dbPath('nest-inner'));
    try {
      createTable(db);
      withTransaction(db, () => {
        db.prepare('INSERT INTO item (label) VALUES (?)').run('outer');
        expect(() =>
          withTransaction(db, () => {
            db.prepare('INSERT INTO item (label) VALUES (?)').run('inner');
            throw new Error('inner failed');
          })
        ).toThrow('inner failed');
        // Inside the OUTER transaction still: its own row is visible, the inner one is
        // gone. This is the state a savepoint rollback has to leave, and a bare BEGIN
        // would not have reached it — it would have thrown at the second BEGIN.
        expect(db.prepare('SELECT COUNT(*) AS n FROM item').get()).toMatchObject({ n: 1 });
        db.prepare('INSERT INTO item (label) VALUES (?)').run('after');
      });
      expect(db.prepare('SELECT label FROM item ORDER BY id').all()).toEqual([
        { label: 'outer' },
        { label: 'after' }
      ]);
    } finally {
      db.close();
    }
  });

  it('rolls the inner AND the outer back when the outer fails after a successful inner', () => {
    // The other half of savepoint semantics: a RELEASEd inner unit is not committed, it is
    // still inside the outer. If this passes only because the inner committed early, the
    // stores look atomic and are not.
    const db = openSqlite(dbPath('nest-outer'));
    try {
      createTable(db);
      expect(() =>
        withTransaction(db, () => {
          db.prepare('INSERT INTO item (label) VALUES (?)').run('doomed-outer');
          withTransaction(db, () => {
            db.prepare('INSERT INTO item (label) VALUES (?)').run('doomed-inner');
          });
          throw new Error('outer failed after a successful inner');
        })
      ).toThrow('outer failed after a successful inner');
      expect(db.prepare('SELECT COUNT(*) AS n FROM item').get()).toMatchObject({ n: 0 });
    } finally {
      db.close();
    }
  });
});
