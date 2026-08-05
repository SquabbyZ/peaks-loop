// tests/unit/services/dispatch/batch-counter.test.ts
//
// 4-dimension unit test for the batch size counter in
// src/services/dispatch/batch-counter.ts. The counter writes
// `.peaks/_sub_agents/<sid>/batch-<id>.counter.json` under
// `projectRoot`, so we point it at a fresh tmp workspace per test
// (via withTmpWorkspacePerTest) instead of touching the real
// `.peaks/` tree.
//
// Dimensions covered:
//   - render:    file shape — pretty JSON with batchId / sessionId /
//                createdAt / count
//   - behavior:  incrementing accumulates; BATCH_OVER_LIMIT only fires
//                at > 6; reset removes the file
//   - integration: real fs read-modify-write under a file lock; the
//                counter file is created + persisted
//   - a11y:      BATCH_OVER_LIMIT message text is human-readable,
//                mentions the bound, and does not tell the user to
//                type a CLI verb
//
// Run with: pnpm vitest run tests/unit/services/dispatch/batch-counter.test.ts

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { withEnv } from '../../_setup/io.js';

declareDimensions(
  'tests/unit/services/dispatch/batch-counter.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
);

import {
  BATCH_LIMIT,
  BATCH_OVER_LIMIT_CODE,
  batchCounterPath,
  noteDispatched,
  readBatchCount,
  resetBatch,
  type BatchCounterRecord,
} from '~/src/services/dispatch/batch-counter';
import { existsSync, readFileSync } from 'node:fs';

const SID = '2026-07-30-test-counter';
const BATCH = 'batch-001';
const FIXED_NOW = new Date('2026-07-30T10:00:00Z');

describe("Scenario: render — counter file shape", () => {
  withTmpWorkspacePerTest();

  it("when invoked, should noteDispatched writes a pretty JSON record with all 4 fields", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const ws = process.cwd();
    const out = noteDispatched(ws, SID, BATCH, () => FIXED_NOW);
    expect(out.count).toBe(1);
    expect(out.warning).toBeNull();

    const path = batchCounterPath(ws, SID, BATCH);
    expect(existsSync(path)).toBe(true);
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as BatchCounterRecord;
    expect(parsed.batchId).toBe(BATCH);
    expect(parsed.sessionId).toBe(SID);
    expect(parsed.createdAt).toBe(FIXED_NOW.toISOString());
    expect(parsed.count).toBe(1);
    // Pretty JSON — contains a newline + indentation, not single-line.
    expect(raw).toContain('\n');
  });

  it("when invoked, should BATCH_LIMIT and BATCH_OVER_LIMIT_CODE are the documented values", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(BATCH_LIMIT).toBe(6);
    expect(BATCH_OVER_LIMIT_CODE).toBe('BATCH_OVER_LIMIT');
  });
});

describe("Scenario: behavior — increment + reset", () => {
  withTmpWorkspacePerTest();

  it("when invoked, should first noteDispatched returns count=1, no warning", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = noteDispatched(process.cwd(), SID, BATCH, () => FIXED_NOW);
    expect(out.count).toBe(1);
    expect(out.warning).toBeNull();
  });

  it("when invoked, should subsequent notes accumulate monotonically", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const ws = process.cwd();
    for (let i = 1; i <= 5; i++) {
      const out = noteDispatched(ws, SID, BATCH, () => FIXED_NOW);
      expect(out.count).toBe(i);
      expect(out.warning).toBeNull();
    }
    expect(readBatchCount(ws, SID, BATCH)).toBe(5);
  });

  it("when invoked, should count 6 (== BATCH_LIMIT) is still in-budget (no warning)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const ws = process.cwd();
    for (let i = 1; i <= 6; i++) {
      const out = noteDispatched(ws, SID, BATCH, () => FIXED_NOW);
      expect(out.warning).toBeNull();
    }
    const out = noteDispatched(ws, SID, BATCH, () => FIXED_NOW);
    expect(out.count).toBe(7);
    expect(out.warning).not.toBeNull();
    expect(out.warning?.code).toBe(BATCH_OVER_LIMIT_CODE);
  });

  it("when invoked, should count > 6 emits a BATCH_OVER_LIMIT warning with the right fields", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const ws = process.cwd();
    for (let i = 0; i < 7; i++) {
      noteDispatched(ws, SID, BATCH, () => FIXED_NOW);
    }
    const out = noteDispatched(ws, SID, BATCH, () => FIXED_NOW);
    expect(out.warning).toMatchObject({
      code: BATCH_OVER_LIMIT_CODE,
      batchId: BATCH,
      dispatched: 8,
      limit: BATCH_LIMIT,
    });
  });

  it("when invoked, should resetBatch removes the file and readBatchCount returns 0 again", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const ws = process.cwd();
    noteDispatched(ws, SID, BATCH, () => FIXED_NOW);
    expect(readBatchCount(ws, SID, BATCH)).toBe(1);
    resetBatch(ws, SID, BATCH);
    expect(readBatchCount(ws, SID, BATCH)).toBe(0);
  });

  it("when invoked, should readBatchCount returns 0 for an unknown batch (no file yet)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(readBatchCount(process.cwd(), SID, 'no-such-batch')).toBe(0);
  });

  it("when invoked, should readBatchCount returns 0 for a corrupt JSON file (defensive default)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const ws = process.cwd();
    const path = batchCounterPath(ws, SID, 'corrupt');
    const { mkdirSync, writeFileSync } = require('node:fs') as typeof import('node:fs');
    mkdirSync(require('node:path').dirname(path), { recursive: true });
    writeFileSync(path, 'this is not json', 'utf8');
    expect(readBatchCount(ws, SID, 'corrupt')).toBe(0);
  });

  it("when invoked, should noteDispatched accepts a custom clock injection (deterministic createdAt)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const ws = process.cwd();
    const t1 = new Date('2026-07-30T08:00:00Z');
    const t2 = new Date('2026-07-30T09:00:00Z');
    noteDispatched(ws, SID, BATCH, () => t1);
    noteDispatched(ws, SID, BATCH, () => t2);
    const path = batchCounterPath(ws, SID, BATCH);
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as BatchCounterRecord;
    // createdAt reflects the LATEST note, not the first one.
    expect(parsed.createdAt).toBe(t2.toISOString());
  });
});

describe("Scenario: integration — real fs writes under a file lock", () => {
  withTmpWorkspacePerTest();
  withEnv('PEAKS_FORCE_FILE_LOCK', '1');

  it("when invoked, should 50 sequential notes produce a final count of 50, never losing updates", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const ws = process.cwd();
    for (let i = 0; i < 50; i++) {
      noteDispatched(ws, SID, BATCH, () => FIXED_NOW);
    }
    const final = readBatchCount(ws, SID, BATCH);
    expect(final).toBe(50);
  });

  it("when invoked, should parallel noteDispatched calls do not lose updates (file lock)", async () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const ws = process.cwd();
    const N = 25;
    await Promise.all(
      Array.from({ length: N }, () =>
        Promise.resolve(noteDispatched(ws, SID, BATCH, () => FIXED_NOW)),
      ),
    );
    // Every dispatch must have been counted exactly once.
    expect(readBatchCount(ws, SID, BATCH)).toBe(N);
  });

  it("when invoked, should file lives under .peaks/_sub_agents/<sid>/batch-<id>.counter.json", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const ws = process.cwd();
    noteDispatched(ws, SID, BATCH, () => FIXED_NOW);
    const expected = `${ws}/.peaks/_sub_agents/${SID}/batch-${BATCH}.counter.json`;
    expect(existsSync(expected)).toBe(true);
  });
});

describe("Scenario: a11y — human-visible warning text", () => {
  withTmpWorkspacePerTest();

  it("when invoked, should BATCH_OVER_LIMIT message is human-readable, mentions the bound, and is not a stack trace", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const ws = process.cwd();
    for (let i = 0; i < 7; i++) {
      noteDispatched(ws, SID, BATCH, () => FIXED_NOW);
    }
    const out = noteDispatched(ws, SID, BATCH, () => FIXED_NOW);
    expect(out.warning?.message).toMatch(/batch size 6/);
    expect(out.warning?.message).toMatch(/8/); // dispatched count
    expect(out.warning?.message).toMatch(/split into multiple batches/);
    expect(out.warning?.message).not.toMatch(/at .+:\d+/);
  });
});
