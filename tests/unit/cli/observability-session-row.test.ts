// tests/unit/cli/observability-session-row.test.ts
//
// WHY THIS FILE EXISTS. The per-session metric row and the compliance judge
// were built and tested, but nothing in production called them: the row was
// unreachable and the compliance rate had no reader. This file drives the
// COMMAND PATH — `peaks observability session-row` — against a real temp
// tree, and asserts the two things the slice exists to make reachable:
//   - the tracked row is written to `.peaks/observability/sessions/<sid>.json`;
//   - the compliance rate appears in the command's output.
//
// It also pins the coverage rule: a session with no judged slice has NO
// compliance rate — it reads null with a reason, never 0.
//
// Dimensions:
//   behavior:    the row is written and the rate is computed from real artifacts
//   integration: the real command, a real metrics file, real artifacts on disk
//   render:      the envelope carries the rate, or null with its reason
//   a11y:        the reason says WHY there is no rate, not a bare null

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProgram } from '~/src/cli/program';
import {
  readSessionMetricRow,
  sessionMetricRowPath
} from '~/src/services/observability/session-metric-rows.js';
import {
  SESSION_ID,
  SLICE_RID,
  seedCompliantArtifacts,
  seedEvents,
  transition
} from '../services/observability/session-metric-rows-fixture.js';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../_setup/io.js';

declareDimensions('tests/unit/cli/observability-session-row.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

let root = '';

/** Run `peaks observability session-row` and hand back its JSON envelope. */
async function runSessionRow(): Promise<Record<string, unknown>> {
  const { io, captured } = makeCapturedIo();
  const program = createProgram(io);
  program.exitOverride();
  await program.parseAsync([
    'node',
    'peaks',
    'observability',
    'session-row',
    '--project',
    root,
    '--session',
    SESSION_ID,
    '--json'
  ]);
  return JSON.parse(captured.text()) as Record<string, unknown>;
}

/** The envelope's `data`, as the reader sees it. */
function dataOf(envelope: Record<string, unknown>): Record<string, unknown> {
  return (envelope['data'] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-observability-session-row-'));
  // The command reads the canonical binding unless told otherwise; a leftover
  // caller id or session from the developer's shell must not decide the scope.
  withEnv('PEAKS_CALLER_ID', undefined);
  withEnv('CLAUDE_CODE_SESSION_ID', undefined);
  withEnv('HOME', root);
  withEnv('USERPROFILE', root);
  mkdirSync(join(root, '.peaks', '_runtime'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Scenario: behavior — the command writes the row and reads the compliance rate', () => {
  it('when a judged slice has its artifacts on disk, should write the row and report a compliance rate', async () => {
    // given: a session whose slice passed verdict-issued, with the artifacts a compliant RD slice leaves
    // when:  the observability command is run for that session
    // then:  the tracked row exists and reads back with the slice's reading, and the envelope carries the rate
    seedEvents(root, [
      transition(SLICE_RID, 'implemented', { prereqOk: true, missingCount: 0 }),
      transition(SLICE_RID, 'verdict-issued', { prereqOk: true, missingCount: 0 })
    ]);
    seedCompliantArtifacts(root);
    const envelope = await runSessionRow();

    const row = readSessionMetricRow(root, SESSION_ID);
    expect(row).not.toBeNull();
    expect(readFileSync(sessionMetricRowPath(root, SESSION_ID), 'utf8')).toContain(SLICE_RID);
    expect(row?.compliance).toEqual([
      expect.objectContaining({ specId: 'peaks-rd', sliceRid: SLICE_RID, complianceRate: 1 })
    ]);
    expect(dataOf(envelope)['complianceRate']).toBe(1);
    expect(dataOf(envelope)['judgedSliceCount']).toBe(1);
  });
});

describe('Scenario: behavior — no judged slice means no rate, not a zero', () => {
  it('when the session recorded no slice, should report the compliance rate as null with a reason', async () => {
    // given: a session whose stream holds no slice-scoped event at all
    // when:  the observability command is run for that session
    // then:  the row is written, the rate is null with a reason, and the near-miss rate is unobserved too
    seedEvents(root, []);
    const envelope = await runSessionRow();

    const row = readSessionMetricRow(root, SESSION_ID);
    expect(row).not.toBeNull();
    expect(row?.compliance).toEqual([]);
    expect(dataOf(envelope)['complianceRate']).toBeNull();
    expect(typeof dataOf(envelope)['complianceReason']).toBe('string');
    expect(dataOf(envelope)['nearMissRate']).toBeNull();
    expect(String(dataOf(envelope)['complianceReason'])).toMatch(/no slice/i);
  });
});

/**
 * The artifacts one slice leaves behind when EVERY writer stamped the request's
 * number into the filename — the shape this repository actually produces:
 * `rd/requests/001-<rid>.md` and `prd/handoff-001-<rid>.md` alike.
 */
function seedNumberedArtifacts(root: string, numberedRid: string): void {
  for (const relativePath of [
    `rd/requests/${numberedRid}.md`,
    `prd/handoff-${numberedRid}.md`,
    `rd/code-review-${numberedRid}.md`,
    `rd/karpathy-review-${numberedRid}.md`,
    `audit/security-${numberedRid}.md`,
    `audit/perf-${numberedRid}.md`
  ]) {
    const path = join(root, '.peaks', '_runtime', SESSION_ID, relativePath);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, '# artifact\n', 'utf8');
  }
}

describe('Scenario: behavior — one slice is judged once, however many spellings name it', () => {
  it('when the events name one slice under both its numbered and its bare rid, should judge that slice once', async () => {
    // given: a session whose events name ONE slice under BOTH spellings — the
    //        numbered form the request writer stamps on the artifact filenames,
    //        and the bare form the transition CLI is handed
    // when:  the observability command is run for that session
    // then:  the slice is judged ONCE — not once per spelling — and it is judged
    //        under the spelling whose artifacts the resolver can actually find,
    //        so the reading is the whole rate rather than half of it
    const bareRid = '2026-10-27-observability-rows';
    const numberedRid = `001-${bareRid}`;
    seedEvents(root, [
      transition(numberedRid, 'implemented', { prereqOk: true, missingCount: 0 }),
      transition(bareRid, 'implemented', { prereqOk: true, missingCount: 0 })
    ]);
    seedNumberedArtifacts(root, numberedRid);
    const envelope = await runSessionRow();

    const row = readSessionMetricRow(root, SESSION_ID);
    expect(row?.compliance).toHaveLength(1);
    expect(String(row?.compliance[0]?.sliceRid)).toContain(bareRid);
    expect(dataOf(envelope)['judgedSliceCount']).toBe(1);
    expect(dataOf(envelope)['complianceRate']).toBe(1);
  });
});

describe('Scenario: security — a slice id cannot escape the session directory', () => {
  it('when an event names a slice id carrying a parent reference, should refuse to judge it', async () => {
    // given: an event whose slice id walks OUT of the session directory, and an artifact planted where that walk lands
    // when:  the observability command is run for that session
    // then:  the escaping slice is NOT judged, so the planted file outside the session cannot be credited
    const escapingRid = 'a/../../../outside/code-review-evil';
    const outside = join(root, '.peaks', '_runtime', 'outside', 'code-review-evil.md');
    mkdirSync(dirname(outside), { recursive: true });
    writeFileSync(outside, '# not a real artifact\n', 'utf8');
    seedEvents(root, [transition(escapingRid, 'implemented', { prereqOk: true, missingCount: 0 })]);
    const envelope = await runSessionRow();

    expect(dataOf(envelope)['judgedSliceCount']).toBe(0);
    expect(dataOf(envelope)['rejectedSliceCount']).toBe(1);
    const row = readSessionMetricRow(root, SESSION_ID);
    expect(row?.compliance).toEqual([]);
    expect(dataOf(envelope)['complianceRate']).toBeNull();
    expect(String(dataOf(envelope)['complianceReason'])).toMatch(/not a single safe path segment/i);
  });
});
