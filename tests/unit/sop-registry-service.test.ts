import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { initSop } from '../../src/services/sop/sop-service.js';
import { registerSop, readRegistry, SopRegisterError } from '../../src/services/sop/sop-registry-service.js';
import type { SopManifest } from '../../src/services/sop/sop-types.js';

// SOP definitions and the registry are global (~/.peaks/sops); PEAKS_HOME
// redirects that root to a per-test temp dir.
let peaksHome: string;
let savedPeaksHome: string | undefined;

beforeEach(async () => {
  savedPeaksHome = process.env.PEAKS_HOME;
  peaksHome = await mkdtemp(join(tmpdir(), 'peaks-home-'));
  process.env.PEAKS_HOME = peaksHome;
});

afterEach(() => {
  if (savedPeaksHome === undefined) {
    delete process.env.PEAKS_HOME;
  } else {
    process.env.PEAKS_HOME = savedPeaksHome;
  }
});

async function seedSop(id: string, manifest: SopManifest): Promise<void> {
  const dir = join(peaksHome, 'sops', id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'sop.json'), JSON.stringify(manifest), 'utf8');
}

async function seedRegistry(value: unknown): Promise<void> {
  const regDir = join(peaksHome, 'sops');
  await mkdir(regDir, { recursive: true });
  await writeFile(join(regDir, 'registry.json'), JSON.stringify(value), 'utf8');
}

describe('readRegistry', () => {
  test('returns an empty registry when none exists', async () => {
    const registry = await readRegistry();
    expect(registry).toEqual({ version: 1, sops: [], gateCount: 0 });
  });
});

describe('registerSop', () => {
  test('registers a scaffolded SOP and enumerates its gates with unique refs (AC4)', async () => {
    await initSop({ id: 'team-release', apply: true });
    const result = await registerSop({ id: 'team-release' });

    expect(result.gateCount).toBe(1);
    expect(result.registered.gates[0]).toEqual({
      ref: 'team-release/example-gate',
      gateId: 'example-gate',
      sopId: 'team-release',
      phase: 'review',
      transition: 'team-release:review'
    });
    // Manifest path is recorded relative to the global Peaks home.
    expect(result.registered.path).toBe('sops/team-release/sop.json');

    const registry = await readRegistry();
    expect(registry.sops.map((s) => s.id)).toEqual(['team-release']);
    expect(registry.gateCount).toBe(1);
  });

  test('built-in peaks-* gates never appear in the registry (AC4)', async () => {
    await initSop({ id: 'team-release', apply: true });
    await registerSop({ id: 'team-release' });
    const registry = await readRegistry();
    const refs = registry.sops.flatMap((s) => s.gates.map((g) => g.ref));
    expect(refs.every((ref) => !ref.startsWith('peaks-'))).toBe(true);
    expect(registry.sops.some((s) => s.id.startsWith('peaks-'))).toBe(false);
  });

  test('upserts idempotently and pools gateCount across SOPs', async () => {
    await seedSop('a', { id: 'a', name: 'A', phases: ['p'], gates: [{ id: 'g1', phase: 'p', check: { type: 'file-exists', path: 'x' } }] });
    await seedSop('b', { id: 'b', name: 'B', phases: ['p'], gates: [
      { id: 'g1', phase: 'p', check: { type: 'file-exists', path: 'y' } },
      { id: 'g2', phase: 'p', check: { type: 'file-exists', path: 'z' } }
    ] });
    await registerSop({ id: 'a' });
    await registerSop({ id: 'b' });
    // Re-register a (idempotent — no duplicate entry).
    const result = await registerSop({ id: 'a' });

    const registry = await readRegistry();
    expect(registry.sops.map((s) => s.id)).toEqual(['a', 'b']);
    expect(registry.gateCount).toBe(3);
    expect(result.gateCount).toBe(3);
    // Two SOPs may share local gate id "g1"; refs disambiguate them.
    const refs = registry.sops.flatMap((s) => s.gates.map((g) => g.ref));
    expect(refs).toContain('a/g1');
    expect(refs).toContain('b/g1');
  });

  test('dry-run previews the registration without writing registry.json', async () => {
    await initSop({ id: 'team-release', apply: true });
    const result = await registerSop({ id: 'team-release', dryRun: true });
    expect(result.applied).toBe(false);
    expect(result.gateCount).toBe(1);
    // Nothing persisted: the registry is still empty.
    const registry = await readRegistry();
    expect(registry.sops).toEqual([]);
  });

  test('refuses to register a missing SOP', async () => {
    await expect(registerSop({ id: 'ghost' })).rejects.toMatchObject({ code: 'SOP_NOT_FOUND' });
  });

  test('refuses to register a SOP that does not lint clean', async () => {
    await seedSop('bad', { id: 'bad', name: 'Bad', phases: ['p'], gates: [{ id: 'g', phase: 'nope', check: { type: 'file-exists', path: 'x' } }] } as SopManifest);
    await expect(registerSop({ id: 'bad' })).rejects.toBeInstanceOf(SopRegisterError);
  });

  test('command-gate SOP needs allowCommands to register', async () => {
    await seedSop('cmd', { id: 'cmd', name: 'Cmd', phases: ['p'], gates: [{ id: 'g', phase: 'p', check: { type: 'command', run: ['true'] } }] });
    await expect(registerSop({ id: 'cmd' })).rejects.toMatchObject({ code: 'SOP_INVALID' });
    const result = await registerSop({ id: 'cmd', allowCommands: true });
    expect(result.gateCount).toBe(1);
  });

  test('readRegistry tolerates a malformed entry without crashing (gates not an array)', async () => {
    await seedRegistry({ version: 1, sops: [{ id: 'broken', path: 'p' }, { id: 'ok', path: 'q', gates: [{ ref: 'ok/g', gateId: 'g', sopId: 'ok', phase: 'p', transition: 'ok:p' }] }] });
    const registry = await readRegistry();
    expect(registry.gateCount).toBe(1);
    expect(registry.sops).toHaveLength(2);
  });

  test('persisted registry recomputes gateCount from stored sops (tolerates absent count field)', async () => {
    await seedRegistry({ version: 1, sops: [{ id: 'x', path: 'p', gates: [{ ref: 'x/g', gateId: 'g', sopId: 'x', phase: 'p', transition: 'x:p' }] }] });
    const registry = await readRegistry();
    expect(registry.gateCount).toBe(1);
  });
});

describe('AC10 — no tier/billing logic in Slice 2 sources', () => {
  // Strip comments so the guard tests executable code, not the prose that
  // documents the absence of tier logic.
  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  }

  test('registry and check services contain no free/pro/max/ultra threshold logic', async () => {
    const reg = stripComments(await readFile(join(process.cwd(), 'src/services/sop/sop-registry-service.ts'), 'utf8'));
    const check = stripComments(await readFile(join(process.cwd(), 'src/services/sop/sop-check-service.ts'), 'utf8'));
    for (const source of [reg, check]) {
      expect(/\b(free|pro|max|ultra)\b\s*[:=]/i.test(source)).toBe(false);
      expect(source).not.toMatch(/tier|entitlement|quota|paywall/i);
    }
  });
});
