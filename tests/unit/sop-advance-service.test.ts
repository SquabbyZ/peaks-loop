import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { advanceSop, readSopState, SopAdvanceError, SopGateBlockedError, SopPhaseSkipError, type SopState } from '../../src/services/sop/sop-advance-service.js';
import type { SopGate, SopManifest } from '../../src/services/sop/sop-types.js';

// SOP definition is global (PEAKS_HOME/sops); run-state and gate targets are
// per-project. Each test gets a global home plus one or more project dirs.
let peaksHome: string;
let project: string;
let savedPeaksHome: string | undefined;

beforeEach(async () => {
  savedPeaksHome = process.env.PEAKS_HOME;
  peaksHome = await mkdtemp(join(tmpdir(), 'peaks-home-'));
  project = await mkdtemp(join(tmpdir(), 'peaks-proj-'));
  process.env.PEAKS_HOME = peaksHome;
});

afterEach(() => {
  if (savedPeaksHome === undefined) {
    delete process.env.PEAKS_HOME;
  } else {
    process.env.PEAKS_HOME = savedPeaksHome;
  }
});

async function seed(id: string, phases: string[], gates: SopGate[]): Promise<void> {
  const manifest: SopManifest = { id, name: id, description: '', phases, gates };
  const dir = join(peaksHome, 'sops', id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'sop.json'), JSON.stringify(manifest), 'utf8');
}

function stateFile(projectRoot: string, id: string): string {
  return join(projectRoot, '.peaks', 'sop-state', id, 'state.json');
}

describe('advanceSop', () => {
  test('advances into the first phase when it has no gates', async () => {
    await seed('s', ['draft', 'review'], []);
    const result = await advanceSop({ projectRoot: project, id: 's', toPhase: 'draft' });
    expect(result.phase).toBe('draft');
    expect(result.bypassed).toBe(false);
    expect(result.previousPhase).toBeNull();
    const state = await readSopState(project, 's');
    expect(state.currentPhase).toBe('draft');
    expect(state.history).toEqual([{ phase: 'draft', bypassed: false }]);
  });

  test('advances when all guarding gates pass', async () => {
    await writeFile(join(project, 'CHANGELOG.md'), '# changes\n', 'utf8');
    await seed('s', ['ship'], [{ id: 'changelog', phase: 'ship', check: { type: 'file-exists', path: 'CHANGELOG.md' } }]);
    const result = await advanceSop({ projectRoot: project, id: 's', toPhase: 'ship' });
    expect(result.phase).toBe('ship');
  });

  test('blocks (throws SopGateBlockedError) when a guarding gate fails', async () => {
    await seed('s', ['ship'], [{ id: 'changelog', phase: 'ship', check: { type: 'file-exists', path: 'MISSING.md' } }]);
    let caught: SopGateBlockedError | null = null;
    try {
      await advanceSop({ projectRoot: project, id: 's', toPhase: 'ship' });
    } catch (error) {
      if (error instanceof SopGateBlockedError) caught = error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.code).toBe('SOP_GATE_BLOCKED');
    expect(caught!.blockedGates.map((g) => g.gateId)).toEqual(['changelog']);
    // A blocked advance must NOT write state.
    expect(existsSync(stateFile(project, 's'))).toBe(false);
  });

  test('blocks when a command gate cannot be evaluated (commands not allowed)', async () => {
    await seed('s', ['p'], [{ id: 'tests', phase: 'p', check: { type: 'command', run: ['true'] } }]);
    await expect(advanceSop({ projectRoot: project, id: 's', toPhase: 'p' })).rejects.toBeInstanceOf(SopGateBlockedError);
    // With commands allowed and a passing command, it advances.
    await seed('s', ['p'], [{ id: 'tests', phase: 'p', check: { type: 'command', run: [process.execPath, '-e', 'process.exit(0)'] } }]);
    const ok = await advanceSop({ projectRoot: project, id: 's', toPhase: 'p', allowCommands: true });
    expect(ok.phase).toBe('p');
  });

  test('allowIncomplete bypasses gates and records the reason in history', async () => {
    await seed('s', ['ship'], [{ id: 'changelog', phase: 'ship', check: { type: 'file-exists', path: 'MISSING.md' } }]);
    const result = await advanceSop({ projectRoot: project, id: 's', toPhase: 'ship', allowIncomplete: true, reason: 'hotfix' });
    expect(result.bypassed).toBe(true);
    const state = await readSopState(project, 's');
    expect(state.history).toEqual([{ phase: 'ship', bypassed: true, reason: 'hotfix' }]);
  });

  test('accumulates history across adjacent advances and tracks previousPhase', async () => {
    await seed('s', ['draft', 'review', 'ship'], []);
    await advanceSop({ projectRoot: project, id: 's', toPhase: 'draft' });
    const second = await advanceSop({ projectRoot: project, id: 's', toPhase: 'review' });
    expect(second.previousPhase).toBe('draft');
    const state: SopState = await readSopState(project, 's');
    expect(state.history.map((h) => h.phase)).toEqual(['draft', 'review']);
  });

  test('dry-run still blocks on a failing gate (does not persist either way)', async () => {
    await seed('s', ['ship'], [{ id: 'changelog', phase: 'ship', check: { type: 'file-exists', path: 'MISSING.md' } }]);
    await expect(advanceSop({ projectRoot: project, id: 's', toPhase: 'ship', dryRun: true })).rejects.toBeInstanceOf(SopGateBlockedError);
  });

  test('dry-run previews a passing advance without writing state.json', async () => {
    await seed('s', ['draft', 'ship'], []);
    const result = await advanceSop({ projectRoot: project, id: 's', toPhase: 'draft', dryRun: true });
    expect(result.applied).toBe(false);
    expect(result.phase).toBe('draft');
    expect(existsSync(stateFile(project, 's'))).toBe(false);
    // State remains at its prior (empty) value.
    expect((await readSopState(project, 's')).currentPhase).toBeNull();
  });

  test('throws SOP_NOT_FOUND for a missing SOP and INVALID_PHASE for an unknown phase', async () => {
    await expect(advanceSop({ projectRoot: project, id: 'ghost', toPhase: 'x' })).rejects.toMatchObject({ code: 'SOP_NOT_FOUND' });
    await seed('s', ['draft'], []);
    await expect(advanceSop({ projectRoot: project, id: 's', toPhase: 'nope' })).rejects.toMatchObject({ code: 'INVALID_PHASE' });
  });

  test('readSopState returns an empty state when none exists', async () => {
    await seed('s', ['p'], []);
    expect(await readSopState(project, 's')).toEqual({ currentPhase: null, history: [] });
  });

  test('only gates for the target phase block the advance', async () => {
    // A failing gate on a DIFFERENT phase must not block advancing to 'review'
    // (the first phase, reachable from null).
    await seed('s', ['review', 'ship'], [{ id: 'ship-gate', phase: 'ship', check: { type: 'file-exists', path: 'MISSING.md' } }]);
    const result = await advanceSop({ projectRoot: project, id: 's', toPhase: 'review' });
    expect(result.phase).toBe('review');
  });
});

describe('advanceSop — phase order (no skipping ahead)', () => {
  test('throws SOP_PHASE_SKIP when jumping past the next phase', async () => {
    await seed('s', ['draft', 'review', 'publish'], []);
    let caught: SopPhaseSkipError | null = null;
    try {
      await advanceSop({ projectRoot: project, id: 's', toPhase: 'publish' });
    } catch (error) {
      if (error instanceof SopPhaseSkipError) caught = error;
    }
    expect(caught).not.toBeNull();
    expect(caught!.code).toBe('SOP_PHASE_SKIP');
    expect(caught!.expectedNext).toBe('draft');
    // A skip must NOT write state.
    expect(existsSync(stateFile(project, 's'))).toBe(false);
  });

  test('allows stepping through phases one at a time', async () => {
    await seed('s', ['draft', 'review', 'publish'], []);
    await advanceSop({ projectRoot: project, id: 's', toPhase: 'draft' });
    await advanceSop({ projectRoot: project, id: 's', toPhase: 'review' });
    const last = await advanceSop({ projectRoot: project, id: 's', toPhase: 'publish' });
    expect(last.phase).toBe('publish');
    expect(last.previousPhase).toBe('review');
  });

  test('allows re-entering the current phase and stepping back', async () => {
    await seed('s', ['draft', 'review', 'publish'], []);
    await advanceSop({ projectRoot: project, id: 's', toPhase: 'draft' });
    await advanceSop({ projectRoot: project, id: 's', toPhase: 'review' });
    // Step back to draft — not a forward skip, allowed.
    const back = await advanceSop({ projectRoot: project, id: 's', toPhase: 'draft' });
    expect(back.phase).toBe('draft');
  });

  test('allowIncomplete bypasses the phase-order check too', async () => {
    await seed('s', ['draft', 'review', 'publish'], []);
    const result = await advanceSop({ projectRoot: project, id: 's', toPhase: 'publish', allowIncomplete: true, reason: 'emergency skip' });
    expect(result.phase).toBe('publish');
    expect(result.bypassed).toBe(true);
  });
});

describe('advanceSop — per-project run-state isolation (AC2)', () => {
  test('the same global SOP tracks independent progress in two projects', async () => {
    const projectB = await mkdtemp(join(tmpdir(), 'peaks-projB-'));
    await seed('s', ['draft', 'review'], []);

    // Advance in project A only.
    await advanceSop({ projectRoot: project, id: 's', toPhase: 'draft' });

    expect((await readSopState(project, 's')).currentPhase).toBe('draft');
    // Project B has its own state — untouched.
    expect((await readSopState(projectB, 's')).currentPhase).toBeNull();
    expect(existsSync(stateFile(projectB, 's'))).toBe(false);

    // Advancing in B is independent of A's progress.
    await advanceSop({ projectRoot: projectB, id: 's', toPhase: 'draft' });
    expect((await readSopState(projectB, 's')).currentPhase).toBe('draft');
    expect((await readSopState(project, 's')).currentPhase).toBe('draft');
  });
});

describe('SopAdvanceError export sanity', () => {
  test('SopAdvanceError carries its code', () => {
    const error = new SopAdvanceError('INVALID_PHASE', 'x');
    expect(error.code).toBe('INVALID_PHASE');
    expect(error.name).toBe('SopAdvanceError');
  });
});
