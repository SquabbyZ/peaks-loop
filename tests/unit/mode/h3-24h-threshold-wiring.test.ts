// tests/unit/mode/h3-24h-threshold-wiring.test.ts
//
// Slice H3 — rid=h3-24h-threshold-not-wired — RE-PINNED against the
// PUBLIC auto-compact profile.
//
// THE PROPOSITION CHANGED. H3 was written to prove that the 24h long-run
// thresholds were WIRED: a session in `24H_ACTIVE` had to resolve the
// `partial` profile, because the contract said "24h mode moves every line
// down to 0.65 / 0.70 / 0.85". The owner decided (2026-10-24) that the
// auto-compact capability is PUBLIC and must not belong to a mode, so the
// 24h state machine no longer derives a profile at all.
//
// THE PROPOSITION NOW: the compaction profile is a PUBLIC, explicitly
// settable project choice, and the 24h mode does not make it. A 24h
// session resolves the PROJECT's profile — `standard` unless the project
// asks for `eager` — and the earlier thresholds are reached ONLY by
// asking for them (`peaks preferences set --key autoCompactProfile
// --value eager`, or an explicit `--mode eager`).
//
// The file keeps its original shape (the same fixtures, the same four
// dimensions) and pins the NEW contract:
//
//   - a 24h run (`24H_ACTIVE` / `WAITING_USER`) resolves `standard`, and
//     its decisions do NOT fire across the 0.70-0.80 band;
//   - a project that pins `eager` resolves `eager` and DOES compact across
//     that band — with or without a 24h run;
//   - the two threshold tables are unchanged, and the earlier one is
//     reachable only by asking for it.
//
// Dimensions covered:
//   - render:      the transition envelope surfaces the failed presence
//                  stamp as a top-level `warnings` + `nextActions`, not
//                  just in `data.presenceMode`
//   - behavior:    profile resolution + the trigger decision, at a ratio
//                  inside [0.70, 0.80) — the exact band from the 现场
//   - integration: real fs — the project setting carries the profile, and
//                  the 24h state machine carries none
//   - a11y:        the failed stamp is stated in human-readable text that
//                  does not claim the 24h mode decides the profile
//
// Run with: pnpm vitest run tests/unit/mode/h3-24h-threshold-wiring.test.ts

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { emptySnapshot, read24hState, write24hState } from '~/src/services/24h-mode/store';
import {
  applyAutoEngagePresenceMode,
  presenceModeAdvisory
} from '~/src/services/24h-mode/auto-engage';
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

/** The 现场 ratio band: at/above `eager.preCompact` (0.70), below `standard.autoFire` (0.80). */
const FIELD_RATIOS = [0.7, 0.703, 0.75939, 0.799] as const;

const tmpRoots: string[] = [];

/**
 * A project root with a session binding and NOTHING ELSE — no lease, no
 * 24h state, no project setting. This is the control arm.
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
function enter24hState(
  root: string,
  state: '24H_ACTIVE' | 'WAITING_USER' | 'IDLE' | 'HANDOFF'
): void {
  write24hState(root, SID, {
    ...emptySnapshot(),
    state,
    enteredAt: '2026-09-17T17:00:44.121Z'
  });
}

/**
 * Pin the EARLIER profile the public way: the project setting
 * `autoCompactProfile`. This is the only route to the earlier thresholds
 * now — the 24h state machine is not one.
 */
function pinEagerProfile(root: string): void {
  writeFileSync(
    join(root, '.peaks', 'preferences.json'),
    JSON.stringify({ schema_version: '2.0.0', autoCompactProfile: 'eager' }, null, 2) + '\n',
    'utf8'
  );
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
// behavior — the acceptance: the 24h mode does NOT pick a profile, and the
// earlier profile is reached only by asking for it
// ---------------------------------------------------------------------------

describe('Scenario: behavior — the profile is the project’s choice, not the 24h mode’s', () => {
  it('when the 24h run is engaged, should resolve `standard` and NOT compact in the field band', () => {
    const root = makeProjectRoot();
    enter24hState(root, '24H_ACTIVE');

    const { mode, reasons } = decisionsFor(root);
    expect(mode).toBe('standard');
    // The 0.70-0.80 band is below `standard`'s auto-fire line, so a 24h
    // session no longer compacts there.
    for (const reason of reasons) expect(reason).toBe('below-threshold');
  });

  it('when the run pauses inside 24h (WAITING_USER), should also resolve `standard`', () => {
    // given: a 24h run paused at WAITING_USER
    // when: the profile is resolved for that project
    // then: it is `standard`, and the field band does not pre-compact
    const root = makeProjectRoot();
    enter24hState(root, 'WAITING_USER');
    expect(resolveAutoCompactProfile(root)).toBe('standard');
    expect(decisionsFor(root).reasons).not.toContain('pre-compact');
  });

  it('when the project pins the eager profile, should resolve `eager` and compact at every field ratio', () => {
    const root = makeProjectRoot();
    pinEagerProfile(root);

    const { mode, reasons } = decisionsFor(root);
    expect(mode).toBe('eager');
    expect(reasons).not.toContain('below-threshold');
    for (const ratio of FIELD_RATIOS) {
      const decision = evaluateAutoCompactDecision({ ratio, mode: 'eager' });
      expect(decision.shouldCompact).toBe(true);
      expect(decision.action).toBe('auto-compact-now');
      expect(decision.trigger.kind).not.toBe('soft-warn');
    }
  });

  it('CONTROL: a standard session at the same ratios should NOT trigger', () => {
    const root = makeProjectRoot();
    // No 24h state, no project setting — the control arm.
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

  it('CONTROL: the two tables are different, and the earlier one is reachable only by asking', () => {
    const plain = makeProjectRoot();
    const eager = makeProjectRoot();
    pinEagerProfile(eager);

    // The same project WITHOUT the setting resolves the default; WITH it,
    // the earlier profile.
    expect(resolveAutoCompactProfile(plain)).toBe('standard');
    expect(resolveAutoCompactProfile(eager)).toBe('eager');
    expect(resolveAutoCompactProfile(plain)).not.toBe(resolveAutoCompactProfile(eager));

    expect(AUTO_COMPACT_THRESHOLDS.eager).toEqual({
      autoFire: 0.65,
      preCompact: 0.7,
      redLine: 0.85
    });
    expect(AUTO_COMPACT_THRESHOLDS.standard).toEqual({
      autoFire: 0.8,
      preCompact: 0.85,
      redLine: 0.95
    });
  });

  it('when the run has ended, should still be `standard`', () => {
    for (const state of ['IDLE', 'HANDOFF'] as const) {
      const root = makeProjectRoot();
      enter24hState(root, state);
      expect(resolveAutoCompactProfile(root)).toBe('standard');
    }
  });
});

// ---------------------------------------------------------------------------
// integration — the project setting carries the profile; the 24h snapshot
// carries none
// ---------------------------------------------------------------------------

describe('Scenario: integration — the profile comes from the project, not from the 24h snapshot', () => {
  it('should read the `eager` profile from the PROJECT SETTING, with no 24h state at all', () => {
    const root = makeProjectRoot();
    pinEagerProfile(root);

    // No 24h snapshot and no presence lease at all: the profile is the
    // project's, and the project asked for the earlier one.
    expect(resolvePresenceMode(root)).toEqual({ mode: null, skill: null, source: 'none' });
    expect(resolveAutoCompactProfile(root)).toBe('eager');

    // And the aggregate reader agrees, so `peaks code mode status` cannot
    // advertise a different profile than `peaks code auto-compact` applies.
    const status = resolveModeStatus({ projectRoot: root, sessionId: SID });
    expect(status.autoCompactProfile).toBe('eager');
    expect(status.autoCompactProfileSource).toBe('preference');
    expect(status.autoCompactThresholds).toEqual({
      autoFire: 0.65,
      preCompact: 0.7,
      redLine: 0.85
    });
  });

  it('when the 24h snapshot is engaged, should NOT change the profile', () => {
    // given: a project whose 24h snapshot is engaged at 24H_ACTIVE
    // when: the profile and the mode status are resolved
    // then: neither of them moves off the default profile
    //   The 现场 coexistence, pinned under the NEW contract: 24H_ACTIVE
    //   while the presence mode is unset. Before this change the profile
    //   followed the state machine; now it does not.
    const root = makeProjectRoot();
    enter24hState(root, '24H_ACTIVE');

    expect(resolvePresenceMode(root)).toEqual({ mode: null, skill: null, source: 'none' });
    expect(resolveAutoCompactProfile(root)).toBe('standard');

    const status = resolveModeStatus({ projectRoot: root, sessionId: SID });
    expect(status.autoCompactProfile).toBe('standard');
    expect(status.autoCompactProfileSource).toBe('default');
    expect(status.autoCompactThresholds).toEqual({
      autoFire: 0.8,
      preCompact: 0.85,
      redLine: 0.95
    });
    // The 24h run really is engaged on disk — the state machine is what
    // the profile does NOT read.
    expect(read24hState(root, SID).state).toBe('24H_ACTIVE');
  });

  it('when the 24h snapshot is unreadable, should not affect the profile and must not throw', () => {
    const root = makeProjectRoot();
    const dir = join(root, '.peaks', '_runtime', SID);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '24h-state.json'), '{ not json', 'utf8');
    expect(() => resolveAutoCompactProfile(root)).not.toThrow();
    expect(resolveAutoCompactProfile(root)).toBe('standard');
  });

  it('when a 24h lease is ALSO present, the profile is still the project’s', () => {
    const root = makeProjectRoot();
    enter24hState(root, '24H_ACTIVE');
    const applied = applyAutoEngagePresenceMode({ projectRoot: root, sessionId: SID });
    expect(applied.applied).toBe(false);
    if (!applied.applied) expect(applied.reason).toBe('no-in-flight-lease');
    expect(resolveAutoCompactProfile(root)).toBe('standard');
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
      'node',
      'peaks',
      'session',
      '24h-mode',
      'transition',
      '--state',
      '24H_ACTIVE',
      '--project',
      root,
      '--json'
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
// a11y — the message must not mislead the operator about the profile
// ---------------------------------------------------------------------------

describe('Scenario: a11y — the advisory must not claim the 24h mode decides the profile', () => {
  it('should say the profile is the project setting, and never that the 24h state machine derives it', () => {
    const advisory = presenceModeAdvisory({
      applied: false,
      mode: '24h',
      reason: 'no-in-flight-lease'
    });
    const text = [...advisory.warnings, ...advisory.nextActions].join(' ');
    // The operator must be told the truth: the profile is the project's.
    expect(text).toContain('autoCompactProfile');
    expect(text).toMatch(/NOT derived from the 24h state machine/i);
    // And never the false claim the old wording made.
    expect(text).not.toMatch(/thresholds? (are|is) still derived from the 24h state machine/i);
    expect(text).not.toMatch(/24h thresholds are/i);
  });

  it('should address the LLM driver and never ask the user to type a verb', () => {
    const advisory = presenceModeAdvisory({
      applied: false,
      mode: '24h',
      reason: 'stamp-failed'
    });
    // Human-NL-Choice-Only: no user-facing text may require the user to
    // type a CLI verb.
    for (const line of [...advisory.warnings, ...advisory.nextActions]) {
      expect(line).not.toMatch(/\bthe user (should|must) (run|type)\b/i);
    }
  });
});
