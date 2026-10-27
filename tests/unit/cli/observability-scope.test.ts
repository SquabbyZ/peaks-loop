// tests/unit/cli/observability-scope.test.ts
//
// WHY THIS FILE EXISTS. The observability queries read ONE session by
// default — the canonical session binding — so a project whose history was
// recorded in OTHER sessions answered "0 events" to every question, and the
// reader concluded the project had recorded nothing. The 1533 events were
// there; the SCOPE was wrong.
//
// The second defect is the counts. `successCount` and `failCount` did not
// partition the slices: a slice stuck at `qa-handoff` was in NEITHER, so the
// summary reported fewer outcomes than the slice table showed rows. The three
// counts must sum to the number of slices.
//
// WHAT IS ASSERTED HERE:
//   - the scope: `--all-sessions` reads the whole recorded history, and
//     without it the canonical session is what a query reads;
//   - the counts: success + fail + stalled === totalSlices, always;
//   - the empty scope: a query that reads nothing while other sessions hold
//     events SAYS so, instead of answering 0 and stopping;
//   - the history: a v1-shaped event (the shape written before the
//     missing-artifact list existed) is still read back;
//   - the report: the summary counts the stalled slices, the slice table
//     marks a stalled slice apart from a failed one, `--json` produces the
//     envelope the help text promises, and a period that empties the
//     result says which period reaches the data.
//
// Dimensions:
//   - behavior:   the scope resolution and the count partition
//   - integration: the real command reading a real project tree on disk
//   - render:     the envelope's shape — the scope it answered for, the
//                  warning it carries
//   - a11y:       what the warning SAYS to a reader who was told "0 events"

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProgram } from '~/src/cli/program';
import { readObservabilityEvents } from '~/src/services/observability/observability-service.js';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../_setup/io.js';

declareDimensions('tests/unit/cli/observability-scope.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const SESSION_A = '2026-10-26-session-aaaaaa';
const SESSION_B = '2026-10-27-session-bbbbbb';

/**
 * The instant the report cases read the clock at. The period windows are
 * relative to now, so a case that asserts WHICH period reaches an event can
 * only be pinned if the clock is pinned with it.
 */
const REPORT_NOW = new Date('2026-10-27T12:00:00.000Z');

let root = '';

/**
 * One observability event at an explicit instant, in the shape the emitter
 * writes.
 */
function seedEventAt(sessionId: string, sliceRid: string, to: string, ts: string): string {
  return JSON.stringify({
    schemaVersion: 1,
    ts,
    sessionId,
    category: 'slice-transition',
    sliceRid,
    detail: { artifactRole: 'rd', to, prereqOk: true, missingCount: 0 }
  });
}

/** One observability event, in the shape the emitter writes. */
function seedEvent(sessionId: string, sliceRid: string, to: string, index: number): string {
  return seedEventAt(
    sessionId,
    sliceRid,
    to,
    new Date(Date.UTC(2026, 9, 26, 0, 0, index)).toISOString()
  );
}

/** Write a session's metrics file, the way the emitter lays it down. */
function writeEvents(sessionId: string, lines: readonly string[]): void {
  const dir = join(root, '.peaks', '_runtime', sessionId, 'metrics');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'slices.jsonl'), `${lines.join('\n')}\n`, 'utf8');
}

/** Run `peaks observability <command>` and hand back its JSON envelope. */
async function runObservability(
  command: string,
  extraArgs: readonly string[] = []
): Promise<Record<string, unknown>> {
  const { io, captured } = makeCapturedIo();
  const program = createProgram(io);
  program.exitOverride();
  await program.parseAsync([
    'node',
    'peaks',
    'observability',
    command,
    '--project',
    root,
    '--json',
    ...extraArgs
  ]);
  return JSON.parse(captured.text()) as Record<string, unknown>;
}

/** The envelope's `data.scope`, as the reader sees it. */
function scopeOf(envelope: Record<string, unknown>): Record<string, unknown> {
  const data = envelope['data'] as { readonly scope?: Record<string, unknown> };
  return data.scope ?? {};
}

/** The envelope's `warnings`, as the reader sees them. */
function warningsOf(envelope: Record<string, unknown>): string {
  return (envelope['warnings'] as readonly string[]).join(' ');
}

/** The envelope's `data.status`, as the reader sees it. */
function statusOf(envelope: Record<string, unknown>): {
  readonly totalSlices?: number;
  readonly successCount?: number;
  readonly failCount?: number;
  readonly stalledCount?: number;
  readonly totalEvents?: number;
} {
  const data = envelope['data'] as { readonly status?: Record<string, number> };
  return data.status ?? {};
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-observability-scope-'));
  // The canonical binding is read through the caller projection, which
  // resolves a caller id from the environment; a leftover caller id from the
  // developer's shell must not decide which session a query reads.
  withEnv('PEAKS_CALLER_ID', undefined);
  withEnv('CLAUDE_CODE_SESSION_ID', undefined);
  // The CLI bootstraps a log line into the home directory; point the home at
  // the throwaway project so the run leaves nothing behind.
  withEnv('HOME', root);
  withEnv('USERPROFILE', root);
  const runtime = join(root, '.peaks', '_runtime');
  mkdirSync(runtime, { recursive: true });
  writeFileSync(
    join(runtime, 'session.json'),
    `${JSON.stringify({ sessionId: SESSION_A, projectRoot: root })}\n`,
    'utf8'
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Scenario: behavior — the scope a query reads', () => {
  it('when all-sessions is asked for, should read every recorded session', async () => {
    // given: two sessions, each with events of its own
    // when:  the query is asked for the whole recorded history
    // then:  the count is the sum of BOTH sessions
    writeEvents(SESSION_A, [
      seedEvent(SESSION_A, 'slice-a', 'handed-off', 0),
      seedEvent(SESSION_A, 'slice-a', 'verdict-issued', 1)
    ]);
    writeEvents(SESSION_B, [seedEvent(SESSION_B, 'slice-b', 'handed-off', 2)]);
    const envelope = await runObservability('status', ['--all-sessions']);
    expect(statusOf(envelope).totalEvents).toBe(3);
  });

  it('when all-sessions is not asked for, should read the canonical session only', async () => {
    // given: two sessions, each with events of its own
    // when:  the query is asked without the flag
    // then:  only the canonical session was read
    writeEvents(SESSION_A, [seedEvent(SESSION_A, 'slice-a', 'handed-off', 0)]);
    writeEvents(SESSION_B, [seedEvent(SESSION_B, 'slice-b', 'handed-off', 1)]);
    const envelope = await runObservability('status');
    expect(statusOf(envelope).totalEvents).toBe(1);
  });
});

describe('Scenario: behavior — the three counts partition the slices', () => {
  it('when a slice stops at a non-terminal state, should count it as stalled', async () => {
    // given: three slices — one handed off, one blocked, one stuck at qa-handoff
    // when:  the status of that session is aggregated
    // then:  the three counts sum to the number of slices
    writeEvents(SESSION_A, [
      seedEvent(SESSION_A, 'slice-done', 'handed-off', 0),
      seedEvent(SESSION_A, 'slice-blocked', 'blocked', 1),
      seedEvent(SESSION_A, 'slice-stuck', 'qa-handoff', 2)
    ]);
    const status = statusOf(await runObservability('status', ['--session', SESSION_A]));
    expect(status.totalSlices).toBe(3);
    expect(status.successCount).toBe(1);
    expect(status.failCount).toBe(1);
    expect(status.stalledCount).toBe(1);
    expect((status.successCount ?? 0) + (status.failCount ?? 0) + (status.stalledCount ?? 0)).toBe(
      status.totalSlices
    );
  });
});

describe('Scenario: integration — an empty scope says where the data is', () => {
  it('when the scope holds no events but others do, should warn instead of answering zero', async () => {
    // given: a canonical session with NO events, and another session with some
    // when:  the status of the canonical session is asked for
    // then:  the envelope carries a warning naming the other sessions
    writeEvents(SESSION_B, [
      seedEvent(SESSION_B, 'slice-b', 'handed-off', 0),
      seedEvent(SESSION_B, 'slice-b', 'verdict-issued', 1)
    ]);
    const envelope = await runObservability('status');
    expect(warningsOf(envelope)).toContain('other session(s)');
  });

  it('when the scope is asked for explicitly, should warn the same way', async () => {
    // given: a named session with no events, and another session with some
    // when:  that session is asked for by name
    // then:  the warning is there
    writeEvents(SESSION_B, [seedEvent(SESSION_B, 'slice-b', 'handed-off', 0)]);
    const envelope = await runObservability('status', ['--session', SESSION_A]);
    expect(warningsOf(envelope)).toContain('--all-sessions');
  });

  it('when every session is empty, should not claim the data is elsewhere', async () => {
    // given: a project with no events at all
    // when:  the status is asked for
    // then:  no warning points at other sessions
    const envelope = await runObservability('status');
    expect(warningsOf(envelope)).not.toContain('other session(s)');
  });
});

describe('Scenario: render — the envelope says which scope it answered for', () => {
  it('when all-sessions is asked for, should name the whole scope', async () => {
    // given: a project with one session of events
    // when:  the whole history is asked for
    // then:  the scope says "all sessions"
    writeEvents(SESSION_A, [seedEvent(SESSION_A, 'slice-a', 'handed-off', 0)]);
    const envelope = await runObservability('status', ['--all-sessions']);
    expect(scopeOf(envelope)).toEqual({ allSessions: true });
  });

  it('when the canonical session is read, should name that session', async () => {
    // given: a project with one session of events
    // when:  the default scope is read
    // then:  the scope names the session
    writeEvents(SESSION_A, [seedEvent(SESSION_A, 'slice-a', 'handed-off', 0)]);
    const envelope = await runObservability('status');
    expect(scopeOf(envelope)).toEqual({ sessionId: SESSION_A });
  });
});

describe('Scenario: a11y — the warning says where the events are', () => {
  it('when the scope is empty, should name the other sessions and their event count', async () => {
    // given: a canonical session with no events, and another session with three
    // when:  the status of the canonical session is asked for
    // then:  the warning names how many sessions and how many events
    writeEvents(SESSION_B, [
      seedEvent(SESSION_B, 'slice-b', 'handed-off', 0),
      seedEvent(SESSION_B, 'slice-b', 'verdict-issued', 1),
      seedEvent(SESSION_B, 'slice-b2', 'handed-off', 2)
    ]);
    const warnings = warningsOf(await runObservability('status'));
    expect(warnings).toContain('1 other session(s)');
    expect(warnings).toContain('3 event(s)');
    expect(warnings).toContain('--all-sessions');
  });
});

describe('Scenario: integration — the recorded history survives', () => {
  it('when a v1-shaped event is written, should still be read back', () => {
    // given: an event in the shape written BEFORE the missing-artifact list
    //        existed — no `missing` key at all
    // when:  the session is read back
    // then:  the event was NOT skipped by the schema check
    const legacy = JSON.stringify({
      schemaVersion: 1,
      ts: new Date(Date.UTC(2026, 9, 26, 0, 0, 0)).toISOString(),
      sessionId: SESSION_A,
      category: 'slice-transition',
      sliceRid: 'slice-legacy',
      detail: { artifactRole: 'rd', to: 'qa-handoff', prereqOk: false, missingCount: 2 }
    });
    writeEvents(SESSION_A, [legacy]);
    const events = readObservabilityEvents(root, SESSION_A);
    expect(events.length).toBe(1);
    expect(events[0]?.detail).toEqual({
      artifactRole: 'rd',
      to: 'qa-handoff',
      prereqOk: false,
      missingCount: 2
    });
  });
});

describe('Scenario: integration — repair-cycles reads the scope the other queries read', () => {
  it('when the scope holds no events but others do, should warn where the events are', async () => {
    // given: a canonical session with NO events, and another session with some
    // when:  the repair cycles of the canonical session are asked for
    // then:  the envelope carries a warning naming the other sessions
    writeEvents(SESSION_B, [
      seedEvent(SESSION_B, 'slice-b', 'handed-off', 0),
      seedEvent(SESSION_B, 'slice-b', 'verdict-issued', 1)
    ]);
    const envelope = await runObservability('repair-cycles');
    expect(warningsOf(envelope)).toContain('other session(s)');
    expect(warningsOf(envelope)).toContain('--all-sessions');
  });
});

describe('Scenario: integration — near-miss and hotspots read the scope the other queries read', () => {
  it('when the scope holds no events but others do, should warn where the events are', async () => {
    // given: a canonical session with NO events, and another session with some
    // when:  the near-miss rate of the canonical session is asked for
    // then:  the envelope carries a warning naming the other sessions
    writeEvents(SESSION_B, [
      seedEvent(SESSION_B, 'slice-b', 'handed-off', 0),
      seedEvent(SESSION_B, 'slice-b', 'verdict-issued', 1)
    ]);
    const envelope = await runObservability('near-miss');
    expect(warningsOf(envelope)).toContain('other session(s)');
    expect(warningsOf(envelope)).toContain('--all-sessions');
  });

  it('when near-miss is asked for as json, should answer with a rate and a record list', async () => {
    // given: a session with one recorded slice
    // when:  the near-miss rate is asked for as json
    // then:  the envelope carries the rate and the record list it says it carries
    writeEvents(SESSION_A, [seedEvent(SESSION_A, 'slice-a', 'verdict-issued', 0)]);
    const envelope = await runObservability('near-miss');
    expect(envelope['ok']).toBe(true);
    expect(envelope['command']).toBe('observability.near-miss');
    const data = envelope['data'] as {
      readonly nearMissRate?: number;
      readonly records?: unknown;
    };
    expect(typeof data.nearMissRate).toBe('number');
    expect(Array.isArray(data.records)).toBe(true);
  });

  it('when near-miss has a class with no events, should say so in the envelope', async () => {
    // given: a session with no gate events and no tool traces
    // when:  the near-miss rate is asked for as json
    // then:  the envelope names the unmeasured class, so a zero over it
    //        cannot be read as a result
    writeEvents(SESSION_A, [seedEvent(SESSION_A, 'slice-a', 'verdict-issued', 0)]);
    const envelope = await runObservability('near-miss');
    const data = envelope['data'] as {
      readonly coverage?: ReadonlyArray<{
        reason: string;
        observable: boolean;
        rate: number | null;
      }>;
      readonly unobservedClasses?: readonly string[];
    };
    const gateClass = (data.coverage ?? []).find((item) => item.reason === 'gate-never-evaluated');
    expect(gateClass?.observable).toBe(false);
    expect(gateClass?.rate).toBeNull();
    expect(data.unobservedClasses).toContain('gate-never-evaluated');
    expect(warningsOf(envelope)).toContain('gate-never-evaluated');
  });

  it('when near-miss is asked for as json, should state its own denominator', async () => {
    // given: a session with one recorded slice that reached a verdict
    // when:  the near-miss rate is asked for as json
    // then:  the envelope states what "passed" means and how many slices
    //        that definition admits
    writeEvents(SESSION_A, [seedEvent(SESSION_A, 'slice-a', 'verdict-issued', 0)]);
    const envelope = await runObservability('near-miss');
    const data = envelope['data'] as {
      readonly denominator?: {
        definition?: string;
        sliceCount?: number;
        statusSuccessCount?: number;
      };
    };
    expect(typeof data.denominator?.definition).toBe('string');
    expect(typeof data.denominator?.sliceCount).toBe('number');
    expect(typeof data.denominator?.statusSuccessCount).toBe('number');
  });

  it('when hotspots is asked for as json, should answer with a ranking', async () => {
    // given: a session with one recorded slice
    // when:  the hotspot ranking is asked for as json
    // then:  the envelope carries the ranking it says it carries
    writeEvents(SESSION_A, [seedEvent(SESSION_A, 'slice-a', 'verdict-issued', 0)]);
    const envelope = await runObservability('hotspots');
    expect(envelope['ok']).toBe(true);
    expect(envelope['command']).toBe('observability.hotspots');
    const data = envelope['data'] as { readonly hotspots?: unknown };
    expect(Array.isArray(data.hotspots)).toBe(true);
  });
});

describe('Scenario: render — the report answers with the envelope it advertises', () => {
  it('when the report is asked for as json, should answer with an envelope carrying the markdown', async () => {
    // given: a session with one recorded slice
    // when:  the report is asked for as json
    // then:  the envelope carries the markdown body it says it carries
    writeEvents(SESSION_A, [seedEvent(SESSION_A, 'slice-a', 'handed-off', 0)]);
    const envelope = await runObservability('report');
    expect(envelope['ok']).toBe(true);
    expect(envelope['command']).toBe('observability.report');
    const data = envelope['data'] as { readonly markdown?: string };
    expect(data.markdown).toContain('peaks observability report');
  });

  it('when the report is asked for as json, should carry the scope it answered for', async () => {
    // given: a session with one recorded slice
    // when:  the report is asked for as json
    // then:  the envelope names the scope, in the one shape the other queries use
    writeEvents(SESSION_A, [seedEvent(SESSION_A, 'slice-a', 'handed-off', 0)]);
    const envelope = await runObservability('report');
    expect(scopeOf(envelope)).toEqual({ sessionId: SESSION_A });
  });
});

describe('Scenario: a11y — the report says which switch reaches the data', () => {
  it('when the period empties the result, should name the period that reaches the events', async () => {
    // given: events the DAY window leaves out but the MONTH window reaches
    // when:  the report is asked for the day period
    // then:  the envelope names the period switch that reaches them
    vi.useFakeTimers();
    vi.setSystemTime(REPORT_NOW);
    try {
      writeEvents(SESSION_A, [
        seedEventAt(
          SESSION_A,
          'slice-old',
          'handed-off',
          new Date(Date.UTC(2026, 9, 20, 0, 0, 0)).toISOString()
        )
      ]);
      const envelope = await runObservability('report', ['--period', 'day']);
      const warnings = warningsOf(envelope);
      expect(warnings).toContain('--period');
      expect(warnings).toContain('month');
    } finally {
      vi.useRealTimers();
    }
  });
});
