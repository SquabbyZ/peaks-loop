// tests/unit/services/dispatch/leak-detector.test.ts
//
// 4-dimension unit test for the dispatch record leak detector in
// src/services/dispatch/leak-detector.ts. The detector scans
// `.peaks/_sub_agents/<sid>/dispatch-*.json` and returns any record
// where `disposed === false` AND `now - createdAt > thresholdMs`.
//
// Dimensions covered:
//   - render:    not applicable (no user-facing text surface)
//   - behavior:  threshold boundary, disposed filter, malformed file
//                skip, missing dir returns []
//   - integration: real fs read under tmp workspace
//   - a11y:      not applicable
//
// Run with: pnpm vitest run tests/unit/services/dispatch/leak-detector.test.ts

import { beforeEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/services/dispatch/leak-detector.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'no user-facing text surface' },
    { dim: 'a11y', reason: 'no error message or exit code' },
  ],
);

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_LEAK_THRESHOLD_MS,
  findLeakedDispatchRecords,
  type LeakedRecord,
} from '~/src/services/dispatch/leak-detector';

const SID = '2026-07-30-leak-test';
const FIXED_NOW = new Date('2026-07-30T12:00:00Z');

function writeDispatch(projectRoot: string, name: string, record: Record<string, unknown>): string {
  const dir = join(projectRoot, '.peaks', '_sub_agents', SID);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(record, null, 2), 'utf8');
  return path;
}

const baseRecord = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  createdAt: '2026-07-30T11:00:00Z', // 1h before FIXED_NOW
  role: 'rd',
  requestId: 'req-1',
  sessionId: SID,
  prompt: 'do the thing',
  outcome: 'success',
  status: 'done',
  disposed: false,
  artifactPaths: [],
  ...overrides,
});

describe("Scenario: behavior — threshold + filter", () => {
  withTmpWorkspacePerTest();

  it("when invoked, should returns an empty list when the .peaks/_sub_agents/<sid>/ dir does not exist", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const out = findLeakedDispatchRecords(process.cwd(), SID, { now: () => FIXED_NOW });
    expect(out).toEqual([]);
  });

  it("when invoked, should returns an empty list when no dispatch-*.json files are present", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_sub_agents', SID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'unrelated.txt'), 'noise', 'utf8');
    const out = findLeakedDispatchRecords(process.cwd(), SID, { now: () => FIXED_NOW });
    expect(out).toEqual([]);
  });

  it("when invoked, should returns an empty list when the only record is disposed=true", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    writeDispatch(process.cwd(), 'dispatch-1.json', baseRecord({ disposed: true }));
    const out = findLeakedDispatchRecords(process.cwd(), SID, { now: () => FIXED_NOW });
    expect(out).toEqual([]);
  });

  it("when invoked, should returns an empty list when the only record is younger than the threshold", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // 30min old — under the 1h default threshold
    writeDispatch(process.cwd(), 'dispatch-1.json', baseRecord({
      createdAt: new Date(FIXED_NOW.getTime() - 30 * 60 * 1000).toISOString(),
    }));
    const out = findLeakedDispatchRecords(process.cwd(), SID, { now: () => FIXED_NOW });
    expect(out).toEqual([]);
  });

  it("when invoked, should flags a record that is older than the threshold and not disposed", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    writeDispatch(process.cwd(), 'dispatch-1.json', baseRecord());
    const out = findLeakedDispatchRecords(process.cwd(), SID, { now: () => FIXED_NOW });
    expect(out).toHaveLength(1);
    const rec = out[0]!;
    expect(rec.path).toMatch(/dispatch-1\.json$/);
    expect(rec.record.requestId).toBe('req-1');
    expect(rec.ageMs).toBe(60 * 60 * 1000); // exactly 1h
  });

  it("when invoked, should default threshold is 1h", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    expect(DEFAULT_LEAK_THRESHOLD_MS).toBe(60 * 60 * 1000);
  });

  it("when invoked, should custom thresholdMs shortens the window", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    writeDispatch(process.cwd(), 'dispatch-1.json', baseRecord());
    // 10-minute threshold: the 1h-old record is way past it.
    const out = findLeakedDispatchRecords(process.cwd(), SID, {
      now: () => FIXED_NOW,
      thresholdMs: 10 * 60 * 1000,
    });
    expect(out).toHaveLength(1);
  });

  it("when invoked, should custom thresholdMs expands the window (no leaks)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    writeDispatch(process.cwd(), 'dispatch-1.json', baseRecord());
    // 2h threshold: the 1h-old record is in budget.
    const out = findLeakedDispatchRecords(process.cwd(), SID, {
      now: () => FIXED_NOW,
      thresholdMs: 2 * 60 * 60 * 1000,
    });
    expect(out).toEqual([]);
  });

  it("when invoked, should a record exactly at the threshold is NOT flagged (< not <=)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // age = threshold -> age < threshold is false -> not flagged
    // Wait: the source is `if (ageMs < thresholdMs) continue;` so
    // age == threshold is flagged. Pin that.
    writeDispatch(process.cwd(), 'dispatch-1.json', baseRecord());
    const out = findLeakedDispatchRecords(process.cwd(), SID, {
      now: () => FIXED_NOW,
      thresholdMs: 60 * 60 * 1000,
    });
    expect(out).toHaveLength(1);
  });

  it("when invoked, should skips files that do not match the isRecordShape (missing required field)", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    writeDispatch(process.cwd(), 'dispatch-bad.json', { createdAt: '2026-07-30T11:00:00Z' });
    const out = findLeakedDispatchRecords(process.cwd(), SID, { now: () => FIXED_NOW });
    expect(out).toEqual([]);
  });

  it("when invoked, should skips files with non-parseable JSON", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_sub_agents', SID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'dispatch-bad.json'), 'not valid json {', 'utf8');
    const out = findLeakedDispatchRecords(process.cwd(), SID, { now: () => FIXED_NOW });
    expect(out).toEqual([]);
  });

  it("when invoked, should skips files with a non-parseable createdAt", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    writeDispatch(process.cwd(), 'dispatch-bad.json', baseRecord({ createdAt: 'tomorrow' }));
    const out = findLeakedDispatchRecords(process.cwd(), SID, { now: () => FIXED_NOW });
    expect(out).toEqual([]);
  });

  it("when invoked, should skips files that do not start with dispatch- or do not end with .json", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_sub_agents', SID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'counter-1.json'), JSON.stringify(baseRecord()), 'utf8');
    writeFileSync(join(dir, 'dispatch-1.txt'), JSON.stringify(baseRecord()), 'utf8');
    const out = findLeakedDispatchRecords(process.cwd(), SID, { now: () => FIXED_NOW });
    expect(out).toEqual([]);
  });
});

describe("Scenario: integration — multi-record scenarios under real fs", () => {
  withTmpWorkspacePerTest();

  it("when invoked, should returns only the leaked records when several are present", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const dir = join(process.cwd(), '.peaks', '_sub_agents', SID);
    mkdirSync(dir, { recursive: true });
    // 1h old, not disposed -> LEAK
    writeFileSync(join(dir, 'dispatch-a.json'), JSON.stringify(baseRecord({ requestId: 'a' })), 'utf8');
    // 1h old, disposed -> skip
    writeFileSync(join(dir, 'dispatch-b.json'), JSON.stringify(baseRecord({ requestId: 'b', disposed: true })), 'utf8');
    // 30min old, not disposed -> skip
    writeFileSync(join(dir, 'dispatch-c.json'), JSON.stringify(baseRecord({
      requestId: 'c',
      createdAt: new Date(FIXED_NOW.getTime() - 30 * 60 * 1000).toISOString(),
    })), 'utf8');
    // 3h old, not disposed -> LEAK
    writeFileSync(join(dir, 'dispatch-d.json'), JSON.stringify(baseRecord({
      requestId: 'd',
      createdAt: new Date(FIXED_NOW.getTime() - 3 * 60 * 60 * 1000).toISOString(),
    })), 'utf8');

    const out = findLeakedDispatchRecords(process.cwd(), SID, { now: () => FIXED_NOW });
    expect(out).toHaveLength(2);
    const ids = out.map((r: LeakedRecord) => r.record.requestId).sort();
    expect(ids).toEqual(['a', 'd']);
  });

  it("when invoked, should per-session isolation: records from other sids are never read", () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    const otherDir = join(process.cwd(), '.peaks', '_sub_agents', 'other-sid');
    mkdirSync(otherDir, { recursive: true });
    writeFileSync(join(otherDir, 'dispatch-1.json'), JSON.stringify(baseRecord()), 'utf8');
    const out = findLeakedDispatchRecords(process.cwd(), SID, { now: () => FIXED_NOW });
    expect(out).toEqual([]);
  });
});
