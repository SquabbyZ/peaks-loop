// tests/unit/mode/mode-consolidation.test.ts
//
// 4-dimension unit test for slice 2026-09-09-mode-consolidation.
//
// The slice consolidates the autonomy model onto four peers
// (`full-auto | assisted | strict | 24h`), removes `swarm` as a mode
// (parallel fan-out is now the default execution strategy in every
// mode), keeps the 6-state machine as an internal phase of the `24h`
// mode, and lets the auto-engage paths set the `24h` mode.
//
// Dimensions covered:
//   - render:      `peaks code mode status` envelope shape (both the
//                  "mode recorded" and the "no presence" branches)
//   - behavior:    enum migration (`swarm` → `full-auto`),
//                  `shouldAutoProceed` / `requiresConfirmation` for all
//                  four modes, `shouldPauseAtGate` for `24h`,
//                  auto-engage stamp + refuse-other-modes guard
//   - integration: real fs under tmpdir — canonical lease written by
//                  `setPresenceLease`, read back through the canonical
//                  resolver + the compat `getSkillPresence` projection
//   - a11y:        dead-command guard — `peaks compact auto` must not
//                  reappear in `skills/` or `src/`
//
// Run with: pnpm vitest run tests/unit/mode/mode-consolidation.test.ts

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Command } from 'commander';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  VALID_SKILL_PRESENCE_MODES,
  getSkillPresence,
  isSkillPresenceMode,
  normalizeSkillPresenceMode
} from '~/src/services/skills/skill-presence-service';
import {
  CODE_MODES,
  shouldAutoProceed,
  shouldPauseAtGate
} from '~/src/services/code/mode-gate';
import { requiresConfirmation } from '~/src/services/mode/mode-enforcement';
import { applyAutoEngagePresenceMode } from '~/src/services/24h-mode/auto-engage';
import { emptySnapshot, write24hState } from '~/src/services/24h-mode/store';
import { listPresenceLeases, setPresenceLease } from '~/src/services/skills/presence-lease-service';
import { resolveActiveSkillForCaller } from '~/src/services/audit/enforcers/active-skill-resolver';
import { resolveModeStatus } from '~/src/services/mode/mode-status-service';
import { registerCodeModeStatusCommand } from '~/src/cli/commands/code-mode-status-command';

declareDimensions(
  'tests/unit/mode/mode-consolidation.test.ts',
  ['render', 'behavior', 'integration', 'a11y']
);

const SID = '2026-09-09-session-mode-consolidation';
const CALLER = 'test-caller-mode';

const tmpRoots: string[] = [];

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-mode-consolidation-'));
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

function writeLease(projectRoot: string, mode: string, workflowId = 'wf-mode-test'): void {
  setPresenceLease({
    projectRoot,
    sessionId: SID,
    callerId: CALLER,
    workflowId,
    graphRef: `graphs/${workflowId}.json`,
    skill: 'peaks-code',
    mode,
    now: '2026-09-09T10:00:00.000Z'
  });
}

function leaseMode(projectRoot: string): string | undefined {
  const lease = listPresenceLeases(projectRoot, SID)[0] as { mode?: string } | undefined;
  return lease?.mode;
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// behavior — the four-mode enum + migration
// ---------------------------------------------------------------------------

describe('Scenario: behavior — mode enum consolidation', () => {
  it('when read, should expose exactly the four peers (no swarm)', () => {
    expect([...VALID_SKILL_PRESENCE_MODES]).toEqual(['full-auto', 'assisted', 'strict', '24h']);
    expect([...CODE_MODES]).toEqual(['full-auto', 'assisted', 'strict', '24h']);
  });

  it('when a legacy mode is read, should normalize swarm to full-auto', () => {
    expect(isSkillPresenceMode('swarm')).toBe(false);
    expect(normalizeSkillPresenceMode('swarm')).toBe('full-auto');
  });

  it('when a current mode is read, should pass it through and return undefined for junk', () => {
    for (const mode of ['full-auto', 'assisted', 'strict', '24h'] as const) {
      expect(normalizeSkillPresenceMode(mode)).toBe(mode);
    }
    expect(normalizeSkillPresenceMode('nonsense')).toBeUndefined();
    expect(normalizeSkillPresenceMode('')).toBeUndefined();
    expect(normalizeSkillPresenceMode(undefined)).toBeUndefined();
    expect(normalizeSkillPresenceMode(null)).toBeUndefined();
  });

  it('when shouldAutoProceed is asked, should auto-proceed for full-auto and 24h only', () => {
    expect(shouldAutoProceed('full-auto')).toBe(true);
    expect(shouldAutoProceed('24h')).toBe(true);
    expect(shouldAutoProceed('assisted')).toBe(false);
    expect(shouldAutoProceed('strict')).toBe(false);
  });

  it('when requiresConfirmation is asked, should auto-proceed for full-auto and 24h only', () => {
    expect(requiresConfirmation('full-auto', 'prd:confirmed-by-user')).toBe(false);
    expect(requiresConfirmation('24h', 'prd:confirmed-by-user')).toBe(false);
    expect(requiresConfirmation('assisted', 'prd:confirmed-by-user')).toBe(true);
    expect(requiresConfirmation('assisted', 'rd:qa-handoff')).toBe(true);
    expect(requiresConfirmation('assisted', 'unlisted:key')).toBe(false);
    expect(requiresConfirmation('strict', 'unlisted:key')).toBe(true);
  });

  it('when shouldPauseAtGate is asked in 24h mode, should auto-proceed on mode-driven gates', () => {
    const modeDriven = shouldPauseAtGate({ mode: '24h', step: 'phase-2-prd-confirm' });
    expect(modeDriven.shouldPause).toBe(false);
    expect(modeDriven.gateKind).toBe('mode-driven');
  });

  it('when shouldPauseAtGate is asked in 24h mode, should still hard-pause mode selection + hard floors', () => {
    const modeSelect = shouldPauseAtGate({ mode: '24h', step: 'step-1-mode-select' });
    expect(modeSelect.shouldPause).toBe(true);
    expect(modeSelect.gateKind).toBe('mode-selection-itself');

    const hardFloor = shouldPauseAtGate({
      mode: '24h',
      step: 'phase-2-prd-confirm',
      hardFloorCategory: 'irreversible-external-side-effect'
    });
    expect(hardFloor.shouldPause).toBe(true);
    expect(hardFloor.gateKind).toBe('hard-floor');

    const commitBoundary = shouldPauseAtGate({
      mode: '24h',
      step: 'phase-2-prd-confirm',
      commitBoundaryAction: true
    });
    expect(commitBoundary.shouldPause).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// integration — on-disk lease migration + auto-engage stamp
// ---------------------------------------------------------------------------

describe('Scenario: integration — on-disk lease mode migration', () => {
  it('when a lease carries mode=swarm, should read it back as full-auto', () => {
    const root = makeProjectRoot();
    writeLease(root, 'swarm');

    const resolved = resolveActiveSkillForCaller(root);
    expect(resolved.skill).toBe('peaks-code');
    expect(resolved.mode).toBe('full-auto');

    expect(getSkillPresence(root)?.mode).toBe('full-auto');
  });

  it('when a lease carries a current mode, should read it back verbatim', () => {
    const root = makeProjectRoot();
    writeLease(root, 'assisted');
    expect(resolveActiveSkillForCaller(root).mode).toBe('assisted');
  });
});

describe('Scenario: integration — auto-engage stamps the 24h mode', () => {
  it('when auto-engage runs, should stamp mode=24h onto the in-flight lease', () => {
    const root = makeProjectRoot();
    writeLease(root, 'assisted');

    const applied = applyAutoEngagePresenceMode({ projectRoot: root, sessionId: SID });
    expect(applied).toEqual({ applied: true, mode: '24h', updated: 1 });
    expect(leaseMode(root)).toBe('24h');
    expect(resolveActiveSkillForCaller(root).mode).toBe('24h');
  });

  it('when auto-engage is asked to set another mode, should refuse and leave the lease alone', () => {
    const root = makeProjectRoot();
    writeLease(root, 'assisted');

    const refused = applyAutoEngagePresenceMode({ projectRoot: root, sessionId: SID, mode: 'full-auto' });
    expect(refused.applied).toBe(false);
    if (!refused.applied) expect(refused.reason).toBe('mode-not-auto-settable');
    expect(leaseMode(root)).toBe('assisted');
  });

  it('when there is no in-flight lease, should report no-in-flight-lease without throwing', () => {
    const root = makeProjectRoot();
    const result = applyAutoEngagePresenceMode({ projectRoot: root, sessionId: SID });
    expect(result.applied).toBe(false);
    if (!result.applied) expect(result.reason).toBe('no-in-flight-lease');
  });
});

// ---------------------------------------------------------------------------
// render — `peaks code mode status`
// ---------------------------------------------------------------------------

describe('Scenario: render — peaks code mode status envelope', () => {
  it('when invoked, should nest mode status under the code command', () => {
    const { io } = makeCapturedIo();
    const program = new Command();
    const code = program.command('code');
    registerCodeModeStatusCommand(code, io);
    const mode = code.commands.find((c) => c.name() === 'mode');
    expect(mode).toBeDefined();
    expect(mode?.commands.map((c) => c.name())).toContain('status');
  });

  it('when a 24h lease is active, should report the stacked picture', async () => {
    const root = makeProjectRoot();
    writeLease(root, '24h');
    write24hState(root, SID, {
      ...emptySnapshot(),
      state: '24H_ACTIVE',
      enteredAt: '2026-09-09T09:00:00.000Z'
    });

    const status = resolveModeStatus({ projectRoot: root, sessionId: SID });
    expect(status.mode).toBe('24h');
    expect(status.is24h).toBe(true);
    expect(status.autoCompactProfile).toBe('partial');
    expect(status.autoCompactThresholds).toEqual({ autoFire: 0.65, preCompact: 0.70, redLine: 0.85 });
    expect(status.h24State?.state).toBe('24H_ACTIVE');
    expect(status.jobMode).toBe(false);

    const { io, captured } = makeCapturedIo();
    const program = new Command();
    const code = program.command('code');
    registerCodeModeStatusCommand(code, io);
    await program.parseAsync(['node', 'peaks', 'code', 'mode', 'status', '--project', root, '--json']);

    const envelope = JSON.parse(captured.text()) as { ok: boolean; data: Record<string, unknown> };
    expect(envelope.ok).toBe(true);
    expect(envelope.data['mode']).toBe('24h');
    expect(envelope.data['is24h']).toBe(true);
    expect(envelope.data['autoCompactProfile']).toBe('partial');
    expect(envelope.data['modeSource']).toBe('canonical');
  });

  it('when no presence is recorded, should degrade to null mode + standard profile', () => {
    const root = makeProjectRoot();
    const status = resolveModeStatus({ projectRoot: root, sessionId: SID });
    expect(status.mode).toBeNull();
    expect(status.is24h).toBe(false);
    expect(status.autoCompactProfile).toBe('standard');
    expect(status.h24State).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// a11y — dead command guard
// ---------------------------------------------------------------------------

function collectFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(path, out);
    } else {
      out.push(path);
    }
  }
}

describe('Scenario: a11y — dead command guard', () => {
  it('when scanned, should not reference the removed `peaks compact auto` command', () => {
    // The guard is scoped to the COMMAND form. Bare `compact auto`
    // substrings are legitimate in prose ("pre-compact auto",
    // "post-compact auto-resume"), so match the verb sequence instead.
    const deadCommand = /\bpeaks\s+compact\s+auto\b/;
    const repoRoot = resolve(__dirname, '..', '..', '..');
    const offenders: string[] = [];
    for (const dir of ['skills', 'src']) {
      const files: string[] = [];
      collectFiles(join(repoRoot, dir), files);
      for (const file of files) {
        if (deadCommand.test(readFileSync(file, 'utf8'))) {
          offenders.push(file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
