import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { enforceBashCommand, recordGateBypass, GateBypassError } from '../../src/services/sop/gate-enforce-service.js';
import { registerSop } from '../../src/services/sop/sop-registry-service.js';
import type { SopManifest } from '../../src/services/sop/sop-types.js';

// SOP definitions + registry are global (PEAKS_HOME); gate targets + bypass
// tokens are per-project. Each test gets a fresh global home and project dir.
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

async function seedRegisteredSop(manifest: SopManifest): Promise<void> {
  const dir = join(peaksHome, 'sops', manifest.id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'sop.json'), JSON.stringify(manifest), 'utf8');
  await registerSop({ id: manifest.id });
}

/** Seed a SOP + registry entry WITHOUT linting (for fail-open / corrupt cases). */
async function seedUnvalidated(id: string, manifestJson: string): Promise<void> {
  const dir = join(peaksHome, 'sops', id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'sop.json'), manifestJson, 'utf8');
  await writeFile(join(peaksHome, 'sops', 'registry.json'), JSON.stringify({ version: 1, sops: [{ id, path: `sops/${id}/sop.json`, gates: [] }] }), 'utf8');
}

// A publish-guarded SOP: running `git push` enters publish, whose no-todo gate
// requires posts/current.md to be free of TODO.
function wechatManifest(): SopManifest {
  return {
    id: 'wechat', name: 'wechat', phases: ['draft', 'publish'],
    gates: [{ id: 'no-todo', phase: 'publish', check: { type: 'grep', file: 'posts/current.md', pattern: 'TODO', absent: true } }],
    guards: [{ phase: 'publish', bash: 'git\\s+push' }]
  };
}

describe('enforceBashCommand', () => {
  test('allows a command no guard matches', async () => {
    await seedRegisteredSop(wechatManifest());
    const decision = await enforceBashCommand(project, 'ls -la');
    expect(decision.decision).toBe('allow');
  });

  test('denies a guarded command when the phase gate fails', async () => {
    await seedRegisteredSop(wechatManifest());
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), '正文\n\nTODO: 补结尾\n', 'utf8');
    const decision = await enforceBashCommand(project, 'git push origin main');
    expect(decision.decision).toBe('deny');
    if (decision.decision === 'deny') {
      expect(decision.matched).toHaveLength(1);
      expect(decision.matched[0]!.sopId).toBe('wechat');
      expect(decision.matched[0]!.phase).toBe('publish');
      expect(decision.matched[0]!.failing.map((f) => f.gateId)).toEqual(['no-todo']);
      expect(decision.reason).toMatch(/no-todo/);
      expect(decision.reason).toMatch(/peaks gate bypass/);
    }
  });

  test('allows a guarded command once the gate passes', async () => {
    await seedRegisteredSop(wechatManifest());
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), '正文\n\n结尾写好了\n', 'utf8');
    const decision = await enforceBashCommand(project, 'git push');
    expect(decision.decision).toBe('allow');
  });

  test('a SOP without guards never blocks', async () => {
    await seedRegisteredSop({
      id: 'noguard', name: 'noguard', phases: ['p'],
      gates: [{ id: 'g', phase: 'p', check: { type: 'file-exists', path: 'MISSING.md' } }]
    });
    const decision = await enforceBashCommand(project, 'git push');
    expect(decision.decision).toBe('allow');
  });

  test('fail-open: an invalid guard regex allows and warns (never blocks)', async () => {
    // A '(' regex would be rejected by lint, so hand-seed past registration.
    await seedUnvalidated('badre', JSON.stringify({
      id: 'badre', name: 'badre', phases: ['publish'],
      gates: [{ id: 'no-todo', phase: 'publish', check: { type: 'file-exists', path: 'MISSING.md' } }],
      guards: [{ phase: 'publish', bash: '(' }]
    }));
    const decision = await enforceBashCommand(project, 'git push');
    expect(decision.decision).toBe('allow');
    if (decision.decision === 'allow') {
      expect(decision.warnings?.some((w) => /invalid regex/.test(w))).toBe(true);
    }
  });

  test('fail-open: a malformed manifest is skipped, not blocked', async () => {
    await seedUnvalidated('broken', '{ not json');
    const decision = await enforceBashCommand(project, 'git push');
    expect(decision.decision).toBe('allow');
  });

  test('fail-open: a corrupt registry allows and warns (never blocks)', async () => {
    await mkdir(join(peaksHome, 'sops'), { recursive: true });
    await writeFile(join(peaksHome, 'sops', 'registry.json'), '{ not json', 'utf8');
    const decision = await enforceBashCommand(project, 'git push');
    expect(decision.decision).toBe('allow');
    if (decision.decision === 'allow') {
      expect(decision.warnings?.some((w) => /could not read registry/.test(w))).toBe(true);
    }
  });
});

describe('one-shot bypass token', () => {
  test('a recorded bypass allows once, then the next guarded command denies again', async () => {
    await seedRegisteredSop(wechatManifest());
    await mkdir(join(project, 'posts'), { recursive: true });
    await writeFile(join(project, 'posts', 'current.md'), 'TODO: x\n', 'utf8');

    recordGateBypass(project, 'wechat', 'publish', 'hotfix');
    const first = await enforceBashCommand(project, 'git push');
    expect(first.decision).toBe('allow');
    if (first.decision === 'allow') expect(first.bypassed).toBe(true);

    const second = await enforceBashCommand(project, 'git push');
    expect(second.decision).toBe('deny');
  });

  test('bypass tokens are capped per project per SOP', async () => {
    await seedRegisteredSop(wechatManifest());
    recordGateBypass(project, 'wechat', 'publish', 'a');
    recordGateBypass(project, 'wechat', 'publish', 'b');
    recordGateBypass(project, 'wechat', 'publish', 'c');
    expect(() => recordGateBypass(project, 'wechat', 'publish', 'd')).toThrow(GateBypassError);
  });

  test('a bypass in one project does not affect another', async () => {
    await seedRegisteredSop(wechatManifest());
    const projectB = await mkdtemp(join(tmpdir(), 'peaks-projB-'));
    for (const p of [project, projectB]) {
      await mkdir(join(p, 'posts'), { recursive: true });
      await writeFile(join(p, 'posts', 'current.md'), 'TODO: x\n', 'utf8');
    }
    recordGateBypass(project, 'wechat', 'publish', 'only-A');
    // Project B has no token → still denied.
    expect((await enforceBashCommand(projectB, 'git push')).decision).toBe('deny');
    // Project A consumes its token → allowed once.
    expect((await enforceBashCommand(project, 'git push')).decision).toBe('allow');
  });
});
