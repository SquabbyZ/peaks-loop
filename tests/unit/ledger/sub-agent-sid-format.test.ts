/**
 * Sub-agent SID format regression guard (rid-034).
 *
 * Locks in the lesson that sub-agent session ids under `.peaks/_sub_agents/`
 * must match `isValidSessionId` from `src/services/workspace/sid-naming-guard.ts`.
 *
 * The historical orphan dir `.peaks/_sub_agents/2026-06-23-session-heartbeat-test/`
 * was the cause of the lone audit-red-lines enforcer fail (RD item #12).
 * The suffix `heartbeat-test` is structurally invalid because it contains a
 * hyphen, but `isValidSessionId` requires `[0-9a-z]{3,6}` (no hyphens).
 *
 * Cases:
 *   (a) `isValidSessionId('2026-06-23-session-heartbeat-test') === false`
 *   (b) every entry in `.peaks/_sub_agents/` matches `isValidSessionId`
 *
 * (b) is run on the live filesystem at test time so future regressions are
 * caught immediately. The regression was caused by ad-hoc dir creation
 * during sub-agent spike tests that bypassed the naming guard.
 */
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { isValidSessionId } from '../../../src/services/workspace/sid-naming-guard.js';

const SUB_AGENTS_DIR = join(process.cwd(), '.peaks', '_sub_agents');

describe('isValidSessionId (canonical regex from sid-naming-guard)', () => {
  test('rejects the historical orphan sid 2026-06-23-session-heartbeat-test', () => {
    // The suffix `heartbeat-test` contains a hyphen, but the regex requires
    // `[0-9a-z]{3,6}` (no hyphens). This was the exact sid that lived under
    // .peaks/_sub_agents/2026-06-23-session-heartbeat-test/ and caused the
    // lone audit enforcer fail in the rid-034 pre-implementation baseline.
    expect(isValidSessionId('2026-06-23-session-heartbeat-test')).toBe(false);
  });

  test('accepts a canonical-format sid (lockstep with the regex)', () => {
    expect(isValidSessionId('2026-07-28-session-71a3cf')).toBe(true);
  });

  test('rejects bare sids (sid-3, unknown-sid) so a regression does not reintroduce them', () => {
    expect(isValidSessionId('sid-3')).toBe(false);
    expect(isValidSessionId('unknown-sid')).toBe(false);
  });
});

describe('.peaks/_sub_agents/ live-tree check', () => {
  // Skipped when the dir does not exist (fresh repo / CI on a non-peaks-loop
  // checkout) so the suite does not false-positive.
  test.skipIf(!existsSync(SUB_AGENTS_DIR))('every sub-agent sid under .peaks/_sub_agents/ matches isValidSessionId', () => {
    const entries = readdirSync(SUB_AGENTS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    // The dir itself exists but is empty (post-rid-034 cleanup of the orphan)
    // is fine — readdirSync returns [] and the loop vacuously passes.
    const invalid = entries.filter((sid) => !isValidSessionId(sid));
    expect(invalid, `invalid sub-agent sids: ${JSON.stringify(invalid)}`).toEqual([]);
  });
});