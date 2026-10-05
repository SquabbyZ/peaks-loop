// tests/unit/services/loop/loop-bee-relation-integrity.test.ts
//
// The friendly integrity codes this service promises (TWO_MAIN_BEES, DUP_RELATION,
// FK_LOOP_NOT_FOUND, FK_BEE_NOT_FOUND) are produced by reading WHICH constraint the
// database violated — so they are only as real as that reading.
//
// Nothing in the suite drove them before this file. A search for the four code strings
// across `tests/` returned only a comment in the driver's own test, which is the shape of
// dead branch: the mapping lives in a `catch` that no arm reaches, so it can be wrong for
// months and the suite stays green. It became wrong exactly once so far — when the driver
// changed and `err.code` stopped being `SQLITE_CONSTRAINT_UNIQUE` (node:sqlite answers the
// generic `ERR_SQLITE_ERROR` and puts the extended result code in `errcode`; measured 2067
// and 787 here). Two of these four arms come from the database itself, and those are the
// ones that would have silently started throwing a raw sqlite message at an operator.
//
// The fixture is a real state.db built by `openStateDb`, not a hand-written schema: the
// migrations are what define the partial unique index that makes "a second main bee" a
// distinct violation from "the same pair again", and a test that re-declared the index
// would be testing its own copy.
//
// Dimensions:
//   - behavior:    each violation maps to its documented code, not to a driver string
//   - integration: real migrations, real index, real constraint engine
//   - render:      the error message an operator sees names the loop, not the sqlite call
//   - a11y:        OMITTED — throws an Error object; no rendered surface

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  LoopBeeRelationIntegrityError,
  LoopBeeRelationService
} from '../../../../src/services/loop/loop-bee-relation-service.js';
import { openStateDb } from '../../../../src/services/skillhub/sqlite-store.js';
import type { SqliteDatabase } from '../../../../src/services/sqlite/sqlite-driver.js';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/loop/loop-bee-relation-integrity.test.ts',
  ['behavior', 'integration', 'render'],
  [{ dim: 'a11y', reason: 'throws Error objects; renders no human-facing surface of its own' }]
);

let root = '';
let db: SqliteDatabase;
let service: LoopBeeRelationService;
let caseCount = 0;

/** One loop and one bee, inserted raw: the point is the RELATION's constraints. */
function seedParentRows(): void {
  db.prepare(
    `INSERT INTO loop_release (
       id, name, scenario, trigger_policy, success_criteria_json, interaction_policy,
       feedback_policy, evolution_policy, evaluator_policy_json, lifecycle_status,
       version, schema_version, archived_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    'loop-integrity-1',
    'integrity loop',
    'scenario',
    'manual',
    '[]',
    'interactive',
    'explicit',
    'conservative',
    '[]',
    'candidate',
    '1.0.0',
    'peaks.loop/1',
    '2026-10-05T00:00:00.000Z'
  );
  db.prepare(
    `INSERT INTO bee_release (bee_name, version, source, archived_at, archived_by)
     VALUES (?, ?, 'user', ?, 'user')`
  ).run('bee-integrity-1', '1.0.0', '2026-10-05T00:00:00.000Z');
  // A SECOND real bee: "a different main bee for the same loop" has to violate the partial
  // unique index, not the foreign key. An invented id is caught by the pre-check and the
  // arm then proves nothing about the constraint it names.
  db.prepare(
    `INSERT INTO bee_release (bee_name, version, source, archived_at, archived_by)
     VALUES (?, ?, 'user', ?, 'user')`
  ).run('bee-integrity-2', '1.0.0', '2026-10-05T00:00:00.000Z');
}

function beeId(name = 'bee-integrity-1'): number {
  const row = db.prepare('SELECT id FROM bee_release WHERE bee_name = ?').get(name) as
    { id: number } | undefined;
  return Number(row?.id);
}

function relationInput(role: 'main' | 'supporting', bee?: number) {
  return {
    loop_release_id: 'loop-integrity-1',
    bee_release_id: bee ?? beeId(),
    role,
    reason: 'pinned by the integrity arms'
  };
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-bee-relation-integrity-'));
});

afterEach(() => {
  // Close before the directory is removed. On Windows an open SQLite handle keeps
  // `state.db` and its `-wal`/`-shm` sidecars busy, so skipping this turns `afterAll`'s
  // `rmSync` into EPERM and the failure looks like a product bug instead of a leak.
  db.close();
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// One database per arm. `seedParentRows()` inserts the same loop id every time, and a
// shared file makes the SECOND arm fail on `UNIQUE constraint failed: loop_release.id`
// before it ever reaches the relation constraint under test — the failure looks like a
// product bug and is the fixture.
beforeEach(() => {
  caseCount += 1;
  db = openStateDb(join(root, `state-${String(caseCount)}.db`));
  seedParentRows();
  service = new LoopBeeRelationService(db);
});

describe('the documented integrity codes, driven through the real index', () => {
  it('turns a second main bee into TWO_MAIN_BEES rather than a sqlite message', () => {
    // The partial unique index `idx_loop_bee_relation_one_main_per_loop` is what this
    // violates, and its message names only `loop_bee_relation.loop_release_id` — the
    // service distinguishes it from the composite UNIQUE by the ABSENCE of
    // bee_release_id. Both halves of that reading are exercised here.
    service.create(relationInput('main'));
    let caught: unknown;
    try {
      service.create({ ...relationInput('main'), bee_release_id: beeId('bee-integrity-2') });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LoopBeeRelationIntegrityError);
    expect((caught as LoopBeeRelationIntegrityError).code).toBe('TWO_MAIN_BEES');
  });

  it('turns a repeated (loop, bee) pair into DUP_RELATION', () => {
    service.create(relationInput('main'));
    let caught: unknown;
    try {
      service.create(relationInput('supporting'));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(LoopBeeRelationIntegrityError);
    expect((caught as LoopBeeRelationIntegrityError).code).toBe('DUP_RELATION');
  });

  it('names the loop in the operator-facing message, not the sqlite call', () => {
    service.create(relationInput('main'));
    try {
      service.create({ ...relationInput('main'), bee_release_id: beeId('bee-integrity-2') });
      throw new Error('expected TWO_MAIN_BEES');
    } catch (error) {
      expect(String(error)).toContain('loop-integrity-1');
      expect(String(error)).not.toMatch(/UNIQUE constraint failed/i);
    }
  });

  it('still reports the pre-checked absences, which never reach the driver', () => {
    expect(() =>
      service.create({ ...relationInput('main'), loop_release_id: 'loop-does-not-exist' })
    ).toThrow(/FK_LOOP_NOT_FOUND|does not exist/);
    expect(() => service.create(relationInput('supporting', 424242))).toThrow(/does not exist/);
  });
});
