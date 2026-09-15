// tests/unit/services/dispatch/sub-agent-dispatcher-timeouts.test.ts
//
// Slice 2026-09-15-s9-platform-vendor-coverage, D7 — the second half of the
// dispatcher coverage. `sub-agent-dispatchers.test.ts` drives the real join
// loop and asserts what a caller sees; this file asserts the per-IDE values
// the loop is CONFIGURED with, which the real loop cannot expose without
// waiting out a 30–45 s budget.
//
// The four non-Claude dispatchers differ from claude-code in exactly two
// numbers and one string, and all three are per-IDE claims:
//
//   - `defaultTimeoutMs` — trae / trae-cn / cursor 30 s, codex 45 s (Codex's
//     documented heartbeat is slower), claude-code 60 s.
//   - `notePrefix` — the per-IDE label that makes a timeout attributable.
//   - `hardCapMs` — deliberately NOT set. Asserted as absent: a per-IDE cap
//     would silently truncate a caller's explicit `--timeout`.
//
// The seam is a `vi.mock` of the unified `awaitBatch` module. Mocking it is
// the only way to observe the wiring without burning the real budget, and it
// is the same technique the repo already uses for a service it needs to
// observe rather than run.
//
// Dimensions covered:
//   - behavior:    the options each dispatcher hands the unified loop, and
//                  the caller's `timeoutMs` pass-through
//   - integration: omitted — the loop this file stubs is exercised against a
//                  real filesystem by `sub-agent-dispatchers.test.ts`, which
//                  is the file that owns that boundary
//   - render:      omitted — nothing renders; the options are asserted as data
//   - a11y:        omitted — no human-facing surface in this path

import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

interface CapturedCall {
  readonly dispatchCount: number;
  readonly recordPaths: readonly string[];
  readonly timeoutMs: number | undefined;
  readonly options: { readonly defaultTimeoutMs: number; readonly notePrefix?: string; readonly hardCapMs?: number };
}

const captured = vi.hoisted(() => ({ calls: [] as CapturedCall[] }));

vi.mock('~/src/services/dispatch/await-batch.js', () => ({
  awaitBatch: async (
    dispatchCount: number,
    recordPaths: readonly string[],
    timeoutMs: number | undefined,
    options: CapturedCall['options'],
  ) => {
    captured.calls.push({ dispatchCount, recordPaths, timeoutMs, options });
    return {
      results: [],
      outcome: 'completed' as const,
      requestedTimeoutMs: timeoutMs ?? options.defaultTimeoutMs,
      effectiveTimeoutMs: 0,
      hardCapMs: options.hardCapMs ?? 120_000,
    };
  },
}));

// Imported AFTER the mock declaration, so the module graph picks the stub up.
const {
  claudeCodeSubAgentDispatcher,
  traeSubAgentDispatcher,
  traeCnSubAgentDispatcher,
  codexSubAgentDispatcher,
  cursorSubAgentDispatcher,
} = await import('../../../../src/services/dispatch/sub-agent-dispatcher.js');

declareDimensions(
  'tests/unit/services/dispatch/sub-agent-dispatcher-timeouts.test.ts',
  ['behavior'],
  [
    { dim: 'integration', reason: 'the stubbed loop is exercised against a real fs by sub-agent-dispatchers.test.ts' },
    { dim: 'render', reason: 'nothing renders; the options are asserted as data' },
    { dim: 'a11y', reason: 'no human-facing surface on this path' },
  ],
);

const CASES = [
  {
    ide: 'claude-code',
    dispatcher: claudeCodeSubAgentDispatcher,
    defaultTimeoutMs: 60_000,
    notePrefix: undefined,
  },
  {
    ide: 'trae',
    dispatcher: traeSubAgentDispatcher,
    defaultTimeoutMs: 30_000,
    notePrefix: 'trae 1.3 real awaitBatch',
  },
  {
    ide: 'trae-cn',
    dispatcher: traeCnSubAgentDispatcher,
    defaultTimeoutMs: 30_000,
    notePrefix: 'trae-cn 1.3 real awaitBatch',
  },
  {
    ide: 'codex',
    dispatcher: codexSubAgentDispatcher,
    defaultTimeoutMs: 45_000,
    notePrefix: 'codex 1.3 real awaitBatch',
  },
  {
    ide: 'cursor',
    dispatcher: cursorSubAgentDispatcher,
    defaultTimeoutMs: 30_000,
    notePrefix: 'cursor 1.3 real awaitBatch',
  },
] as const;

describe('Scenario: behavior — each dispatcher hands the join loop its own per-IDE configuration', () => {
  for (const testCase of CASES) {
    it(`when the ${testCase.ide} dispatcher joins a batch, should pass its own default budget and note prefix`, async () => {
      // given: a batch whose caller named no budget of their own
      captured.calls.length = 0;

      // when
      await testCase.dispatcher.awaitBatch?.({
        batchId: 'batch-1',
        dispatchCount: 2,
        recordPaths: ['record-a.json', 'record-b.json'],
      });

      // then: exactly one call reached the loop, carrying this IDE's numbers
      expect(captured.calls).toHaveLength(1);
      const call = captured.calls[0] as CapturedCall;
      expect(call.dispatchCount).toBe(2);
      expect(call.recordPaths).toEqual(['record-a.json', 'record-b.json']);
      expect(call.options.defaultTimeoutMs).toBe(testCase.defaultTimeoutMs);
      expect(call.options.notePrefix).toBe(testCase.notePrefix);
      // and: no caller budget was supplied, so the per-IDE default applies
      expect(call.timeoutMs).toBeUndefined();
    });
  }

  it('when the caller supplies a budget, should pass it through unchanged for every dispatcher', async () => {
    // A caller's explicit `--timeout` must not be replaced by the per-IDE
    // default. Asserted with a value that matches NONE of the defaults, so a
    // dispatcher that ignored the argument would fail here.
    for (const testCase of CASES) {
      captured.calls.length = 0;
      await testCase.dispatcher.awaitBatch?.({
        batchId: 'batch-2',
        dispatchCount: 1,
        recordPaths: ['record.json'],
        timeoutMs: 7_777,
      });
      expect((captured.calls[0] as CapturedCall).timeoutMs, testCase.ide).toBe(7_777);
    }
  });

  it('when the per-IDE budgets are collected, should hold codex apart from the other four', () => {
    // Codex is the only adapter whose default is 45 s, on the documented
    // grounds that its heartbeat is slower. Pinned as a triple: the three 30 s
    // IDEs, codex at 45 s, claude-code at 60 s. If a slice sets codex back to
    // 30 s by copying a neighbour's row, this fails.
    const budgets = Object.fromEntries(CASES.map((c) => [c.ide, c.defaultTimeoutMs]));
    expect(budgets).toEqual({
      'claude-code': 60_000,
      trae: 30_000,
      'trae-cn': 30_000,
      codex: 45_000,
      cursor: 30_000,
    });
  });

  it('when the note prefixes are collected, should be distinct for the four prefixed IDEs', () => {
    // The prefix is the ONLY per-IDE value on the wire. Two IDEs sharing one
    // makes a cross-IDE timeout misattributable — which is the failure the
    // 1.4 dogfood contract added the prefix to prevent.
    const prefixes = CASES.filter((c) => c.notePrefix !== undefined).map((c) => c.notePrefix);
    expect(new Set(prefixes).size).toBe(4);
    for (const prefix of prefixes) {
      expect(prefix).toMatch(/^[a-z-]+ 1\.3 real awaitBatch$/);
    }
  });

  it('when any dispatcher joins a batch, should leave the hard cap to the shared default', async () => {
    // `hardCapMs` must stay unset here: setting it per-IDE would cap a
    // caller's explicit budget below the documented 120 s shared limit, and
    // the cap is a property of the loop, not of an IDE.
    for (const testCase of CASES) {
      captured.calls.length = 0;
      await testCase.dispatcher.awaitBatch?.({
        batchId: 'batch-3',
        dispatchCount: 1,
        recordPaths: ['record.json'],
      });
      expect((captured.calls[0] as CapturedCall).options.hardCapMs, testCase.ide).toBeUndefined();
    }
  });
});
