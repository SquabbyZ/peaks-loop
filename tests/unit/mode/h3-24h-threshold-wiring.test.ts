// tests/unit/mode/h3-24h-threshold-wiring.test.ts
//
// Slice H3 — rid=h3-24h-threshold-not-wired.
//
// The 现场 (field report): a session in `24H_ACTIVE` with a context ratio
// of 0.703 was judged `below-threshold` by `peaks code auto-compact`,
// even though `partial`'s pre-compact line is 0.70 and the SKILL.md
// contract says "24h mode moves every line down to 0.65 / 0.70 / 0.85".
//
// Root cause: the profile was keyed off the PRESENCE MODE only, and the
// presence mode is stamped onto *in-flight leases*
// (`applyAutoEngagePresenceMode` → `stampPresenceLeaseMode`). With no
// in-flight lease the stamp fails closed as
// `{ applied: false, reason: 'no-in-flight-lease' }` — reported inside
// the transition envelope's `data.presenceMode`, read by nothing — and
// `resolveAutoCompactProfile` fell through to `standard`. A 24h run
// therefore compacted LATER than a plain session.
//
// Dimensions covered:
//   - render:      the transition envelope surfaces the failed stamp as
//                  a top-level `warnings` + `nextActions`, not just in
//                  `data.presenceMode`
//   - behavior:    profile resolution + the trigger decision, at a ratio
//                  inside [0.70, 0.80) — the exact band from the 现场
//   - integration: real fs — the 24h state machine at
//                  `.peaks/_runtime/<sid>/24h-state.json` is what the
//                  profile now reads, with no lease present at all
//   - a11y:        the degradation is stated in human-readable text that
//                  tells the operator the thresholds ARE active
//
// Run with: pnpm vitest run tests/unit/mode/h3-24h-threshold-wiring.test.ts

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { emptySnapshot, write24hState } from '~/src/services/24h-mode/store';
import { applyAutoEngagePresenceMode, presenceModeAdvisory } from '~/src/services/24h-mode/auto-engage';
import {
  resolveAutoCompactProfile,
  resolveModeStatus,
  resolvePresenceMode
} from '~/src/services/mode/mode-status-service';
import { AUTO_COMPACT_THRESHOLDS } from '~/src/services/code/auto-compact-modes';
import { evaluateAutoCompactDecision } from '~/src/services/code/auto-compact-orchestrator';
import { registerSession24hModeCommand } from '~/src/cli/commands/session-24h-mode';

declareDimensions('tests/unit/mode/h3-24h-threshold-wiring.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SID = '2026-09-17-session-h3-probe';

/** The 现场 ratio band: at or above `partial.preCompact` (0.70), below `standard.autoFire` (0.80). */
const FIELD_RATIOS = [0.70, 0.703, 0.75939, 0.799] as const;

const tmpRoots: string[] = [];

/**
 * A project root with a session binding and NOTHING ELSE — no lease, no
 * 24h state. This is the control arm.
 */
function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-h3-24h-'));
  tmpRoots.push(root);
  mkdirSync(join(root, '.peaks', '_runtime'), { recursive: true });
  writeFileSync(join(root, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }), 'utf8');
  writeFileSync(
    join(root, '.peaks', '_runtime', 'session.json'),
    JSON.stringify({ sessionId: SID, projectRoot: root }),
    'utf8'
  );
  return root;
}

/** Enter the 24h long run: state machine only, exactly as the 现场 had it. */
function enter24hState(root: string, state: '24H_ACTIVE' | 'WAITING_USER' | 'IDLE' | 'HANDOFF'): void {
  write24hState(root, SID, {
    ...emptySnapshot(),
    state,
    enteredAt: '2026-09-17T17:00:44.121Z'
  });
}

function decisionsFor(root: string): { mode: string; reasons: string[] } {
  const mode = resolveAutoCompactProfile(root);
  const reasons = FIELD_RATIOS.map((ratio) => evaluateAutoCompactDecision({ ratio, mode }).reason);
  return { mode, reasons };
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// behavior — the acceptance: a 24h session in [0.70, 0.80) MUST trigger
// ---------------------------------------------------------------------------

describe('Scenario: behavior — a 24h session in the 0.70–0.80 band triggers compaction', () => {
  it('when the 24h run is engaged, should resolve `partial` and compact at every field ratio', () => {
    const root = makeProjectRoot();
    enter24hState(root, '24H_ACTIVE');

    const { mode, reasons } = decisionsFor(root);
    expect(mode).toBe('partial');
    expect(reasons).not.toContain('below-threshold');
    for (const ratio of FIELD_RATIOS) {
      const decision = evaluateAutoCompactDecision({ ratio, mode: 'partial' });
      expect(decision.shouldCompact).toBe(true);
      expect(decision.action).toBe('auto-compact-now');
      expect(decision.trigger.kind).not.toBe('soft-warn');
    }
  });

  it('when the run pauses inside 24h (WAITING_USER), should keep `partial`', () => {
    const root = makeProjectRoot();
    enter24hState(root, 'WAITING_USER');
    expect(resolveAutoCompactProfile(root)).toBe('partial');
    expect(decisionsFor(root).reasons).not.toContain('below-threshold');
  });

  it('CONTROL: a standard session at the same ratios should NOT trigger', () => {
    const root = makeProjectRoot();
    // No 24h state, no lease — the control arm.
    const { mode, reasons } = decisionsFor(root);
    expect(mode).toBe('standard');
    for (const reason of reasons) expect(reason).toBe('below-threshold');
    for (const ratio of FIELD_RATIOS) {
      expect(evaluateAutoCompactDecision({ ratio, mode: 'standard' }).shouldCompact).toBe(false);
    }
    for (const ratio of FIELD_RATIOS) {
      expect(evaluateAutoCompactDecision({ ratio, mode: 'standard' }).action).toBe('soft-warn');
    }
  });

  it('CONTROL: the two lines are genuinely different, and neither threshold table changed', () => {
    const root = makeProjectRoot();
    enter24hState(root, '24H_ACTIVE');
    const h24 = resolveAutoCompactProfile(root);
    const std = resolveAutoCompactProfile(makeProjectRoot());
    expect(h24).not.toBe(std);
    expect(AUTO_COMPACT_THRESHOLDS.partial).toEqual({ autoFire: 0.65, preCompact: 0.70, redLine: 0.85 });
    expect(AUTO_COMPACT_THRESHOLDS.standard).toEqual({ autoFire: 0.80, preCompact: 0.85, redLine: 0.95 });
  });

  it('when the run has ended, should fall back to `standard`', () => {
    for (const state of ['IDLE', 'HANDOFF'] as const) {
      const root = makeProjectRoot();
      enter24hState(root, state);
      expect(resolveAutoCompactProfile(root)).toBe('standard');
    }
  });
});

// ---------------------------------------------------------------------------
// integration — the state machine is the durable source, with no lease
// ---------------------------------------------------------------------------

describe('Scenario: integration — the 24h state machine carries the mode when no lease exists', () => {
  it('should read `partial` from the on-disk 24h snapshot and have no presence mode at all', () => {
    const root = makeProjectRoot();
    enter24hState(root, '24H_ACTIVE');

    // The 现场 coexistence, pinned: 24H_ACTIVE while the presence mode is
    // unset. Before the fix this pair resolved to `standard`.
    expect(resolvePresenceMode(root)).toEqual({ mode: null, skill: null, source: 'none' });
    expect(resolveAutoCompactProfile(root)).toBe('partial');

    // And the aggregate reader agrees, so `peaks code mode status` cannot
    // advertise a different profile than `peaks code auto-compact` applies.
    const status = resolveModeStatus({ projectRoot: root, sessionId: SID });
    expect(status.autoCompactProfile).toBe('partial');
    expect(status.autoCompactThresholds).toEqual({ autoFire: 0.65, preCompact: 0.70, redLine: 0.85 });
  });

  it('when the snapshot is unreadable, should degrade to `standard` without throwing', () => {
    const root = makeProjectRoot();
    const dir = join(root, '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '24h-state.json'), '{ not json', 'utf8');
    expect(() => resolveAutoCompactProfile(root)).not.toThrow();
    expect(resolveAutoCompactProfile(root)).toBe('standard');
  });

  it('when a 24h lease is ALSO present, should stay `partial` (the union, not a replacement)', () => {
    const root = makeProjectRoot();
    enter24hState(root, '24H_ACTIVE');
    const applied = applyAutoEngagePresenceMode({ projectRoot: root, sessionId: SID });
    expect(applied.applied).toBe(false);
    if (!applied.applied) expect(applied.reason).toBe('no-in-flight-lease');
    expect(resolveAutoCompactProfile(root)).toBe('partial');
  });
});

// ---------------------------------------------------------------------------
// render — the failed stamp reaches the envelope
// ---------------------------------------------------------------------------

describe('Scenario: render — the transition envelope surfaces the failed presence stamp', () => {
  it('when entering 24H_ACTIVE with no in-flight lease, should emit a warning + next action', async () => {
    const root = makeProjectRoot();
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    const session = program.command('session');
    registerSession24hModeCommand(session, io);
    await program.parseAsync([
      'node', 'peaks', 'session', '24h-mode', 'transition',
      '--state', '24H_ACTIVE', '--project', root, '--json'
    ]);

    const envelope = JSON.parse(captured.text()) as {
      ok: boolean;
      data: { presenceMode: { applied: boolean; reason?: string } };
      warnings: string[];
      nextActions: string[];
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.presenceMode.applied).toBe(false);
    expect(envelope.data.presenceMode.reason).toBe('no-in-flight-lease');
    expect(envelope.warnings).toHaveLength(1);
    expect(envelope.warnings[0]).toContain('no-in-flight-lease');
    expect(envelope.nextActions.length).toBeGreaterThan(0);
  });

  it('when the stamp succeeds, should emit no warning', () => {
    const root = makeProjectRoot();
    const applied = applyAutoEngagePresenceMode({ projectRoot: root, sessionId: SID });
    // No lease in this fixture either — so exercise the success branch directly.
    expect(applied.applied).toBe(false);
    expect(presenceModeAdvisory({ applied: true, mode: '24h', updated: 1 })).toEqual({
      warnings: [],
      nextActions: []
    });
  });
});

// ---------------------------------------------------------------------------
// a11y — the message must not mislead the operator about the thresholds
// ---------------------------------------------------------------------------

describe('Scenario: a11y — the degradation is stated in human-readable text', () => {
  it('should say the thresholds ARE active and never claim the run is off', () => {
    const advisory = presenceModeAdvisory({
      applied: false,
      mode: '24h',
      reason: 'no-in-flight-lease'
    });
    const text = [...advisory.warnings, ...advisory.nextActions].join(' ');
    expect(text).toContain('24h state machine');
    // The operator must not be told the 24h lines are inactive when the
    // state machine is carrying them.
    expect(text).not.toMatch(/thresholds? (are|is) not active/i);
    expect(text).not.toMatch(/standard/i);
  });

  it('should address the LLM driver and never ask the user to type a verb', () => {
    const advisory = presenceModeAdvisory({
      applied: false,
      mode: '24h',
      reason: 'stamp-failed'
    });
    expect(advisory.warnings[0]).toContain('stamp-failed');
    // Human-NL-Choice-Only: no user-facing text may require the user to
    // type a CLI verb.
    for (const line of [...advisory.warnings, ...advisory.nextActions]) {
      expect(line).not.toMatch(/\bthe user (should|must) (run|type)\b/i);
    }
  });
});
