import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const BIN = join(__dirname, '..', '..', 'bin', 'peaks.js');
let projectRoot = '';
afterEach(() => { if (projectRoot) rmSync(projectRoot, { recursive: true, force: true }); projectRoot = ''; });

function run(args: ReadonlyArray<string>): { stdout: string; code: number } {
  try {
    return { stdout: execFileSync('node', [BIN, ...args], { cwd: projectRoot, env: { ...process.env, PEAKS_CALLER_ID: 'baseline-cli-test' } }).toString('utf8'), code: 0 };
  } catch (e) {
    const err = e as { stdout?: Buffer | string; status?: number };
    return { stdout: (err.stdout?.toString('utf8') ?? ''), code: err.status ?? 1 };
  }
}

function writeSampleInput(projectRoot: string): string {
  const input = {
    schemaVersion: '2026-08-03',
    version: '4.0.8',
    signedBy: 'SquabbyZ',
    signedAt: '2026-08-03T00:00:00.000Z',
    rows: Array.from({ length: 15 }, (_, i) => ({
      journeyId: `J${String(i + 1).padStart(2, '0')}`,
      intent: 'sample',
      observable: { inputs: [], outputs: [], errors: [] },
      invariants: [`inv-${i + 1}`],
      forbiddenChanges: ['forbid'],
      sourceFiles: ['src/sample.ts']
    }))
  };
  const f = join(projectRoot, 'baseline-input.json');
  writeFileSync(f, JSON.stringify(input));
  return f;
}

describe('peaks baseline freeze + list + show', () => {
  it('creates a baseline file with a signed lock after freeze', () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'cbl-cli-'));
    const fromFile = writeSampleInput(projectRoot);
    const r = run(['baseline', 'freeze', '--from', fromFile, '--project', projectRoot, '--json']);
    expect(r.code).toBe(0);
    expect(existsSync(join(projectRoot, 'openspec', 'baselines', 'current', 'capability-baseline.json'))).toBe(true);
    expect(existsSync(join(projectRoot, 'openspec', 'baselines', 'current', 'capability-baseline.lock'))).toBe(true);
  });
  it('list prints 15 rows', () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'cbl-cli-'));
    const fromFile = writeSampleInput(projectRoot);
    const freeze = run(['baseline', 'freeze', '--from', fromFile, '--project', projectRoot, '--json']);
    expect(freeze.code).toBe(0);
    const list = run(['baseline', 'list', '--project', projectRoot, '--json']);
    expect(list.code).toBe(0);
    const env = JSON.parse(list.stdout) as { ok: boolean; data: { rows: unknown[] } };
    expect(env.ok).toBe(true);
    expect(env.data.rows).toHaveLength(15);
  });
  it('show prints a single row', () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'cbl-cli-'));
    const fromFile = writeSampleInput(projectRoot);
    run(['baseline', 'freeze', '--from', fromFile, '--project', projectRoot, '--json']);
    const show = run(['baseline', 'show', 'J07', '--project', projectRoot, '--json']);
    expect(show.code).toBe(0);
    const env = JSON.parse(show.stdout) as { ok: boolean; data: { journeyId: string } };
    expect(env.ok).toBe(true);
    expect(env.data.journeyId).toBe('J07');
  });
});
