// tests/unit/skills/presence-lease-selection.test.ts
//
// Slice 2026-10-24 — rid-t3-presence-cross-session-test-split.
//
// This file holds the LEASE SELECTION RULES, and those rules are pure:
// `selectActivePresenceLease`, `staleThresholdMs` and
// `explainInactivePresence` take a candidate list and a timestamp and return
// a decision. Nothing here touches the disk, the clock, the environment or
// the process exit code.
//
// So this file deliberately carries NO fixture: no scratch directory is
// created, no file is written, no environment variable is read or changed.
// The 8 tests below used to share one scratch workspace per test with 11
// disk-backed tests that they have nothing to do with.
//
// WHAT IT GUARDS. Presence must survive the cases that used to hide it:
// the bound tree keeps its precedence over a fresher foreign lease; a lease
// that reached a terminal state is not "active"; a lease whose heartbeat
// went cold is not "active"; a 24h lease keeps its own wider window; and
// when nothing is eligible the read says WHY — by counting the terminal and
// the stale leases.
//
// SIBLINGS. The pure gate contract lives in
// `tests/unit/skills/presence-gate.test.ts`; the disk-backed integration /
// render / a11y scenarios live in
// `tests/unit/skills/presence-cross-session.test.ts`.
//
// Dimensions: behavior only — render, integration and a11y are omitted with
// a one-line reason each in the `declareDimensions` call below.
//
// Run with: pnpm vitest run tests/unit/skills/presence-lease-selection.test.ts

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  explainInactivePresence,
  selectActivePresenceLease,
  staleThresholdMs,
  type PresenceLeaseCandidate
} from '../../../src/services/skills/presence-lease-selection.js';
import {
  STALE_HEARTBEAT_MS,
  STALE_STARTED_AFTER_MS
} from '../../../src/services/skills/presence-lease-types.js';

declareDimensions(
  'tests/unit/skills/presence-lease-selection.test.ts',
  ['behavior'],
  [
    {
      dim: 'render',
      reason:
        'the selection rules return a decision, not output text; the `--json` envelope is covered by the cross-session file.'
    },
    {
      dim: 'integration',
      reason:
        'no filesystem, process or clock boundary is exercised here; the disk-backed scenarios live in the cross-session file.'
    },
    {
      dim: 'a11y',
      reason:
        'the rules return a reason code, not human-facing text; the plain-language refusal lives in the cross-session file.'
    }
  ]
);

const BOUND_SID = '2026-10-24-session-0000aa';
const OTHER_SID = '2026-10-23-session-0000bb';

const NOW = new Date().toISOString();
const ONE_HOUR_MS = 60 * 60 * 1000;
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}

/** A candidate set for the pure selection functions. */
function candidate(
  lease: Partial<PresenceLeaseCandidate['lease']> & { lastHeartbeat?: string },
  scope: 'bound' | 'other',
  sessionId = scope === 'bound' ? BOUND_SID : OTHER_SID
): PresenceLeaseCandidate {
  return {
    lease: {
      callerId: 'caller-a',
      workflowId: 'wf-a',
      graphRef: 'graphs/wf-a.json',
      skill: 'peaks-code',
      depth: 0,
      startedAt: NOW,
      lastHeartbeat: NOW,
      status: 'running',
      schemaVersion: 1,
      ...lease
    },
    sessionId,
    scope
  };
}

/* ---------- behavior: the selection rules ---------- */
describe('Scenario: behavior — presence lease selection rules', () => {
  it('when the bound tree holds no lease but another tree does, should report the other tree’s lease', () => {
    // given: a candidate set holding one live lease in another session tree
    // when: the active lease is selected
    // then: the other tree lease is selected and marked as out of the bound tree
    const selection = selectActivePresenceLease(
      [candidate({ lastHeartbeat: NOW }, 'other')],
      Date.now()
    );
    expect(selection?.sessionId).toBe(OTHER_SID);
    expect(selection?.scope).toBe('other');
  });

  it('when the bound tree holds a lease, should keep the bound tree’s precedence over a fresher foreign lease', () => {
    // given: a candidate set holding a bound lease and a fresher foreign lease
    // when: the active lease is selected
    // then: the bound tree keeps precedence
    const selection = selectActivePresenceLease(
      [
        candidate({ lastHeartbeat: isoAgo(10 * 60 * 1000) }, 'bound'),
        candidate({ lastHeartbeat: NOW }, 'other')
      ],
      Date.now()
    );
    expect(selection?.scope).toBe('bound');
    expect(selection?.sessionId).toBe(BOUND_SID);
  });

  it('when every lease reached a terminal state, should select nothing', () => {
    // given: a candidate set holding only terminalized and lost leases
    // when: the active lease is selected
    // then: nothing is selected
    const selection = selectActivePresenceLease(
      [
        candidate({ status: 'terminalized', terminalAt: NOW }, 'bound'),
        candidate({ status: 'lost', terminalAt: NOW }, 'other')
      ],
      Date.now()
    );
    expect(selection).toBeNull();
  });

  it('when the heartbeat is older than the stale window, should not report the lease as active', () => {
    // given: a candidate set holding a lease whose heartbeat is older than the stale window
    // when: the active lease is selected
    // then: nothing is selected
    const selection = selectActivePresenceLease(
      [candidate({ lastHeartbeat: isoAgo(STALE_HEARTBEAT_MS + ONE_HOUR_MS) }, 'other')],
      Date.now()
    );
    expect(selection).toBeNull();
  });

  // The 24h run must not lose its presence after one hour just because
  // nothing refreshes the lease heartbeat while the run is in flight.
  it('when a 24h lease is past the 1h window but inside its own window, should keep it active', () => {
    // given: a 24h lease whose heartbeat is older than the 1h window
    // when: the active lease is selected
    // then: the 24h lease keeps its presence
    const age = STALE_HEARTBEAT_MS + ONE_HOUR_MS;
    expect(age).toBeLessThan(STALE_STARTED_AFTER_MS);
    const selection = selectActivePresenceLease(
      [candidate({ mode: '24h', lastHeartbeat: isoAgo(age) }, 'other')],
      Date.now()
    );
    expect(selection?.lease.mode).toBe('24h');
  });

  it('when the window is asked for, should give 24h30m to a 24h lease and 1h to every other', () => {
    // given: a 24h lease and a lease with no mode
    // when: the stale threshold is asked for
    // then: the 24h lease gets the 24h30m window and every other lease the 1h window
    expect(staleThresholdMs(candidate({ mode: '24h' }, 'other').lease)).toBe(
      STALE_STARTED_AFTER_MS
    );
    expect(staleThresholdMs(candidate({}, 'other').lease)).toBe(STALE_HEARTBEAT_MS);
    expect(STALE_HEARTBEAT_MS).toBe(60 * 60 * 1000);
    expect(STALE_STARTED_AFTER_MS).toBe(24 * 60 * 60 * 1000 + 30 * 60 * 1000);
  });

  it('when nothing is eligible, should explain why the read found nothing', () => {
    // given: a candidate set holding one terminalized lease and one stale lease
    // when: the inactive presence is explained
    // then: the reason names terminal and stale leases and counts each of them
    const diagnostic = explainInactivePresence(
      [
        candidate({ status: 'terminalized', terminalAt: NOW }, 'bound'),
        candidate({ lastHeartbeat: isoAgo(TWO_HOURS_MS) }, 'other')
      ],
      Date.now()
    );
    expect(diagnostic.reason).toBe('terminal-and-stale');
    expect(diagnostic.leaseCount).toBe(2);
    expect(diagnostic.terminalCount).toBe(1);
    expect(diagnostic.staleCount).toBe(1);
    expect(diagnostic.eligibleCount).toBe(0);
  });

  it('when there is no lease at all, should report the empty reason', () => {
    // given: an empty candidate set
    // when: the inactive presence is explained
    // then: the reason is that there were no leases at all
    expect(explainInactivePresence([], Date.now()).reason).toBe('no-leases');
  });
});
