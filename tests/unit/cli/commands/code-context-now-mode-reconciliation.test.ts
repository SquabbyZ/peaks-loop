// tests/unit/cli/commands/code-context-now-mode-reconciliation.test.ts
//
// Slice H4 — rid=h4-context-now-mode-blind.
//
// The 现场: one measurement, two verdicts.
//
//   ratio 0.769469
//   peaks code auto-compact  -> dispatched pre-compact (checkpoint + plan)
//   peaks code context-now   -> verdict "soft-warn" / action "soft-warn" /
//                               next: null
//
// and `skills/peaks-code/SKILL.md` designates `context-now` the "single source
// of truth", so an LLM obeying it read `next: null` and did nothing while the
// action component compressed.
//
// Root cause: `context-now` classified the ratio with a hard-coded ladder that
// read no mode at all (>=0.95 red-line / >=0.85 auto-compact-now / >=0.5
// soft-warn). On a 24h run the profile is `partial` (0.65/0.70/0.85), so the
// whole [0.70, 0.85) band — mandatory compaction — was reported as soft-warn.
// The fix routes the classification through `evaluateCompactTrigger(ratio,
// mode)` with `mode = resolveAutoCompactProfile(root)`, i.e. the same table and
// the same mode resolver `peaks code auto-compact` decides with.
//
// The `action` vocabulary is a published contract (SKILL.md +
// references/step-0-8-gate.md + build-dispatch-system-prompt.ts), so the
// trigger->action mapping is pinned here rather than left to drift.
//
// Run with: pnpm vitest run tests/unit/cli/commands/code-context-now-mode-reconciliation.test.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';

import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import {
  contextNowActionFor,
  registerCodeRuntimeCommands
} from '../../../../src/cli/commands/code-runtime-commands.js';
import { emptySnapshot, write24hState } from '../../../../src/services/24h-mode/store.js';
import {
  evaluateAutoCompactDecision,
  evaluateCompactTrigger
} from '../../../../src/services/code/auto-compact-orchestrator.js';
import { resolveAutoCompactProfile } from '../../../../src/services/mode/mode-status-service.js';
import type { AutoCompactMode } from '../../../../src/services/code/auto-compact-modes.js';

/** The ratio is forced through the canonical Claude Code env seam. */
const RATIO_ENV = 'CLAUDE_CONTEXT_USAGE_PERCENT';

const SID = '2026-09-18-session-h4';

/** The 现场 band: at/above `partial.preCompact` (0.70), below `standard.autoFire` (0.80). */
const FIELD_RATIOS = [0.7, 0.75, 0.769469, 0.799] as const;

const tmpRoots: string[] = [];

/**
 * A project root with a session binding and NOTHING ELSE. Without a 24h
 * snapshot this is the control arm (`standard`).
 */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-h4-ctx-now-'));
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

/** Enter the 24h long run through the durable state machine only. */
function enter24h(root: string): string {
  write24hState(root, SID, {
    ...emptySnapshot(),
    state: '24H_ACTIVE',
    enteredAt: '2026-09-18T14:00:00.000Z'
  });
  return root;
}

interface ContextNowEnvelope {
  readonly ok: boolean;
  readonly data: {
    readonly ratio: number;
    readonly action: 'ok' | 'soft-warn' | 'auto-compact-now' | 'red-line';
    readonly verdict: 'ok' | 'soft-warn' | 'pre-compact' | 'red-line';
    readonly next: string | null;
  };
  readonly nextActions: readonly string[];
}

/** Run the REAL registered command with a forced ratio; no child process. */
async function runContextNow(root: string, ratio: number): Promise<ContextNowEnvelope> {
  withEnv(RATIO_ENV, String(ratio));
  withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  const code = program.command('code');
  registerCodeRuntimeCommands(code, io);
  await program.parseAsync(
    ['code', 'context-now', '--json', '--project', root, '--session-id', SID],
    { from: 'user' }
  );
  return JSON.parse(captured.text()) as ContextNowEnvelope;
}

afterEach(() => {
  process.exitCode = undefined;
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// behavior — the acceptance: the 24h field band must NOT read `soft-warn`
// ---------------------------------------------------------------------------

describe('Slice H4 — context-now classifies with the active mode', () => {
  it('when a 24h run is engaged, should report the `partial` action across [0.70, 0.80), NOT soft-warn', async () => {
    // given: the 现场 coexistence — 24H_ACTIVE, and the profile it resolves to
    const root = enter24h(makeProject());
    expect(resolveAutoCompactProfile(root)).toBe('partial');

    // when/then: every ratio in the field band is mandatory compaction
    for (const ratio of FIELD_RATIOS) {
      const env = await runContextNow(root, ratio);
      expect(env.data.ratio).toBeCloseTo(ratio, 5);
      expect(env.data.action).not.toBe('soft-warn');
      expect(env.data.action).toBe('auto-compact-now');
      expect(env.data.verdict).toBe('pre-compact');
      expect(env.data.next).toBe('peaks code auto-compact');
    }
  });

  it('CONTROL: a standard session at the SAME ratios is unchanged (soft-warn, next null, same prose)', async () => {
    // given: no 24h snapshot at all — the control arm
    const root = makeProject();
    expect(resolveAutoCompactProfile(root)).toBe('standard');

    for (const ratio of FIELD_RATIOS) {
      const env = await runContextNow(root, ratio);
      // then: byte-identical to the pre-H4 output
      expect(env.data.action).toBe('soft-warn');
      expect(env.data.verdict).toBe('soft-warn');
      expect(env.data.next).toBeNull();
      expect(env.nextActions[0]).toBe(
        'Soft warn (50–85%). Continue working; the next `peaks code auto-compact` will re-check.'
      );
      expect(env.nextActions[1]).toBe(
        'Single-rid mode: the same ≥0.85 / ≥0.95 thresholds apply — ≥0.85 is MANDATORY auto-compact, not advisory.'
      );
    }
  });

  it('when the 24h run pauses at WAITING_USER, should still be `partial`', async () => {
    const root = makeProject();
    write24hState(root, SID, {
      ...emptySnapshot(),
      state: 'WAITING_USER',
      enteredAt: '2026-09-18T14:00:00.000Z'
    });
    const env = await runContextNow(root, 0.75);
    expect(env.data.action).toBe('auto-compact-now');
  });
});

// ---------------------------------------------------------------------------
// integration — the two components must reconcile on the same ratio + mode
// ---------------------------------------------------------------------------

describe('Slice H4 — context-now reconciles with the action component', () => {
  /** A ratio sweep that lands inside every band of both tables. */
  const SWEEP = [0.4, 0.55, 0.66, 0.7, 0.75, 0.8, 0.86, 0.96] as const;

  const ARMS: readonly (readonly [AutoCompactMode, () => string])[] = [
    ['standard', (): string => makeProject()],
    ['partial', (): string => enter24h(makeProject())]
  ];

  it('should agree with `evaluateAutoCompactDecision` on every tier except the one it does not own', async () => {
    for (const [mode, build] of ARMS) {
      const root = build();
      expect(resolveAutoCompactProfile(root)).toBe(mode);
      for (const ratio of SWEEP) {
        const env = await runContextNow(root, ratio);
        // The action component's OWN decision — the pure function
        // `runAutoCompact` calls (auto-compact-orchestrator.ts:555).
        const decision = evaluateAutoCompactDecision({ ratio, mode });
        const kind = evaluateCompactTrigger(ratio, mode).kind;
        if (kind === 'auto-fire') {
          // The ONE documented carve-out, asserted rather than skipped:
          // the auto-fire tier belongs to `peaks skill presence` (the
          // every-turn probe, already mode-correct), so `context-now`
          // reports it as soft-warn in BOTH modes. Realising it as
          // `auto-compact-now` here would change every non-24h session's
          // output, which slice H4 forbids.
          expect(env.data.action).toBe('soft-warn');
          continue;
        }
        expect(env.data.action).toBe(decision.action);
        expect(env.data.next === null).toBe(
          decision.action === 'ok' || decision.action === 'soft-warn'
        );
      }
    }
  });

  it('should diverge ONLY inside the auto-fire band, in both modes (nothing wider)', () => {
    for (const mode of ['standard', 'partial'] as const) {
      const divergentPct: number[] = [];
      for (let pct = 1; pct <= 100; pct += 1) {
        const ratio = pct / 100;
        const decision = evaluateAutoCompactDecision({ ratio, mode });
        const ours = contextNowActionFor(ratio, mode).action;
        const expected =
          evaluateCompactTrigger(ratio, mode).kind === 'auto-fire' ? 'soft-warn' : decision.action;
        if (ours !== expected) divergentPct.push(pct);
      }
      expect(divergentPct).toEqual([]);
    }
  });
});

// ---------------------------------------------------------------------------
// behavior — the mapping itself is pinned (two vocabularies, one table)
// ---------------------------------------------------------------------------

describe('Slice H4 — the trigger -> action mapping cannot drift', () => {
  it('should map every CompactTrigger kind to exactly ONE action, identically in both modes', () => {
    const actionsByKind = new Map<string, Set<string>>();
    for (const mode of ['standard', 'partial'] as const) {
      for (let pct = 1; pct <= 100; pct += 1) {
        const ratio = pct / 100;
        const kind = evaluateCompactTrigger(ratio, mode).kind;
        const set = actionsByKind.get(kind) ?? new Set<string>();
        set.add(contextNowActionFor(ratio, mode).action);
        actionsByKind.set(kind, set);
      }
    }
    // The published vocabulary, one value per kind — SKILL.md documents
    // `action: 'ok' | 'soft-warn' | 'auto-compact-now' | 'red-line'`.
    expect([...actionsByKind.get('none')!]).toEqual(['ok']);
    expect([...actionsByKind.get('soft-warn')!]).toEqual(['soft-warn']);
    expect([...actionsByKind.get('auto-fire')!]).toEqual(['soft-warn']);
    expect([...actionsByKind.get('pre-compact')!]).toEqual(['auto-compact-now']);
    expect([...actionsByKind.get('red-line')!]).toEqual(['red-line']);
    // every kind the table can emit is covered above
    expect(actionsByKind.size).toBe(5);
  });

  it('should keep `next` to the one dispatch verb, and null wherever nothing must be run', () => {
    expect(contextNowActionFor(0.3, 'standard')).toEqual({ action: 'ok', next: null });
    expect(contextNowActionFor(0.6, 'standard')).toEqual({ action: 'soft-warn', next: null });
    expect(contextNowActionFor(0.82, 'standard')).toEqual({ action: 'soft-warn', next: null });
    expect(contextNowActionFor(0.9, 'standard')).toEqual({
      action: 'auto-compact-now',
      next: 'peaks code auto-compact'
    });
    expect(contextNowActionFor(0.97, 'standard')).toEqual({
      action: 'red-line',
      next: 'peaks code auto-compact'
    });
    // `partial` moves the SAME tiers down — 0.75 is pre-compact there
    expect(contextNowActionFor(0.75, 'partial')).toEqual({
      action: 'auto-compact-now',
      next: 'peaks code auto-compact'
    });
    expect(contextNowActionFor(0.86, 'partial')).toEqual({
      action: 'red-line',
      next: 'peaks code auto-compact'
    });
  });
});
