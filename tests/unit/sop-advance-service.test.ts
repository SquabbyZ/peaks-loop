import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { advanceSop, readSopState, SopAdvanceError, SopGateBlockedError, type SopState } from '../../src/services/sop/sop-advance-service.js';
import type { SopGate, SopManifest } from '../../src/services/sop/sop-types.js';

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-sopadv-'));
}

async function seed(project: string, id: string, phases: string[], gates: SopGate[]): Promise<void> {
  const manifest: SopManifest = { id, name: id, description: '', phases, gates };
  const dir = join(project, '.peaks', 'sops', id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'sop.json'), JSON.stringify(manifest), 'utf8');
}

describe('advanceSop', () => {
  test('advances when the phase has no gates', async () => {
    const project = await makeProject();
    await seed(project, 's', ['draft', 'review'], []);
    const result = await advanceSop({ projectRoot: project, id: 's', toPhase: 'review' });
    expect(result.phase).toBe('review');
    expect(result.bypassed).toBe(false);
    expect(result.previousPhase).toBeNull();
    const state = await readSopState(project, 's');
    expect(state.currentPhase).toBe('review');
    expect(state.history).toEqual([{ phase: 'review', bypassed: false }]);
  });

  test('advances when all guarding gates pass', async () => {
    const project = await makeProject();
    await writeFile(join(project, 'CHANGELOG.md'), '# changes\n', 'utf8');
    await seed(project, 's', ['draft', 'ship'], [{ id: 'changelog', phase: 'ship', check: { type: 'file-exists', path: 'CHANGELOG.md' } }]);
    const result = await advanceSop({ projectRoot: project, id: 's', toPhase: 'ship' });
    expect(result.phase).toBe('ship');
  });

  test('blocks (throws SopGateBlockedError) when a guarding gate fails', async () => {
    const project = await makeProject();
    await seed(project, 's', ['draft', 'ship'], [{ id: 'changelog', phase: 'ship', check: { type: 'file-exists', path: 'MISSING.md' } }]);
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
    expect(existsSync(join(project, '.peaks', 'sops', 's', 'state.json'))).toBe(false);
  });

  test('blocks when a command gate cannot be evaluated (commands not allowed)', async () => {
    const project = await makeProject();
    await seed(project, 's', ['p'], [{ id: 'tests', phase: 'p', check: { type: 'command', run: ['true'] } }]);
    await expect(advanceSop({ projectRoot: project, id: 's', toPhase: 'p' })).rejects.toBeInstanceOf(SopGateBlockedError);
    // With commands allowed and a passing command, it advances.
    await seed(project, 's', ['p'], [{ id: 'tests', phase: 'p', check: { type: 'command', run: [process.execPath, '-e', 'process.exit(0)'] } }]);
    const ok = await advanceSop({ projectRoot: project, id: 's', toPhase: 'p', allowCommands: true });
    expect(ok.phase).toBe('p');
  });

  test('allowIncomplete bypasses gates and records the reason in history', async () => {
    const project = await makeProject();
    await seed(project, 's', ['draft', 'ship'], [{ id: 'changelog', phase: 'ship', check: { type: 'file-exists', path: 'MISSING.md' } }]);
    const result = await advanceSop({ projectRoot: project, id: 's', toPhase: 'ship', allowIncomplete: true, reason: 'hotfix' });
    expect(result.bypassed).toBe(true);
    const state = await readSopState(project, 's');
    expect(state.history).toEqual([{ phase: 'ship', bypassed: true, reason: 'hotfix' }]);
  });

  test('accumulates history across advances and tracks previousPhase', async () => {
    const project = await makeProject();
    await seed(project, 's', ['draft', 'review', 'ship'], []);
    await advanceSop({ projectRoot: project, id: 's', toPhase: 'draft' });
    const second = await advanceSop({ projectRoot: project, id: 's', toPhase: 'review' });
    expect(second.previousPhase).toBe('draft');
    const state: SopState = await readSopState(project, 's');
    expect(state.history.map((h) => h.phase)).toEqual(['draft', 'review']);
  });

  test('throws SOP_NOT_FOUND for a missing SOP and INVALID_PHASE for an unknown phase', async () => {
    const project = await makeProject();
    await expect(advanceSop({ projectRoot: project, id: 'ghost', toPhase: 'x' })).rejects.toMatchObject({ code: 'SOP_NOT_FOUND' });
    await seed(project, 's', ['draft'], []);
    await expect(advanceSop({ projectRoot: project, id: 's', toPhase: 'nope' })).rejects.toMatchObject({ code: 'INVALID_PHASE' });
  });

  test('readSopState returns an empty state when none exists', async () => {
    const project = await makeProject();
    await seed(project, 's', ['p'], []);
    expect(await readSopState(project, 's')).toEqual({ currentPhase: null, history: [] });
  });

  test('only gates for the target phase block the advance', async () => {
    const project = await makeProject();
    // A failing gate on a DIFFERENT phase must not block advancing to 'review'.
    await seed(project, 's', ['review', 'ship'], [{ id: 'ship-gate', phase: 'ship', check: { type: 'file-exists', path: 'MISSING.md' } }]);
    const result = await advanceSop({ projectRoot: project, id: 's', toPhase: 'review' });
    expect(result.phase).toBe('review');
  });
});

describe('SopAdvanceError export sanity', () => {
  test('SopAdvanceError carries its code', () => {
    const error = new SopAdvanceError('INVALID_PHASE', 'x');
    expect(error.code).toBe('INVALID_PHASE');
    expect(error.name).toBe('SopAdvanceError');
  });
});
