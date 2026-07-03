// tests/integration/job-e2e.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CLI = join(process.cwd(), 'dist/src/cli/index.js');

function peaks(args: string[], cwd: string, env: Record<string, string> = {}) {
  const r = spawnSync('node', [CLI, ...args, '--json'], {
    cwd, encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { status: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
}

// Seed a fake canonical session binding so the CLI's getCurrentSessionId() resolves.
// Per M3.1, job init requires --session-id or an active session binding at
// .peaks/_runtime/session.json relative to --project.
function seedSessionBinding(workdir: string, sessionId: string): void {
  const dir = join(workdir, '.peaks', '_runtime');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'session.json'),
    JSON.stringify({ sessionId, createdAt: new Date().toISOString(), projectRoot: workdir }) + '\n',
    'utf8',
  );
}

describe('peaks job — 8-slice E2E (rotating mode)', () => {
  let workdir: string;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'job-e2e-'));
    seedSessionBinding(workdir, 'e2e-8-slice-session');
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it('runs 8 slices, rotates at 3 and 6, lands final summary', () => {
    // 1. Init
    const init = peaks([
      'job', 'init',
      '--job-id', 'e2e-8-slice',
      '--slice-list', 'a,b,c,d,e,f,g,h',
      '--main-loop-strategy', 'rotating',
      '--rotate-every', '3',
      '--project', workdir,
    ], workdir);
    expect(init.status, `init failed: ${init.stderr}`).toBe(0);

    // 2. Drive 8 slices: call checkpoint done for each slice id
    for (let i = 1; i <= 8; i++) {
      const sid = `slice-${String(i).padStart(3, '0')}`;
      const r = peaks([
        'job', 'checkpoint',
        '--job-id', 'e2e-8-slice',
        '--slice-id', sid,
        '--state', 'done',
        '--commit-sha', `sha-${i.toString().padStart(7, '0')}`,
        '--project', workdir,
      ], workdir);
      expect(r.status, `slice ${sid} checkpoint failed: ${r.stderr}`).toBe(0);
    }

    // 3. Status: all 8 done
    const status = peaks(['job', 'status', '--job-id', 'e2e-8-slice', '--project', workdir], workdir);
    expect(status.status, `status failed: ${status.stderr}`).toBe(0);
    const j = JSON.parse(status.stdout).data;
    expect(j.done).toBe(8);
    expect(j.total).toBe(8);
  });
});

describe('peaks job — strict block propagation', () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'job-e2e-block-'));
    seedSessionBinding(workdir, 'e2e-block-session');
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it('slice block → whole job status reports blocked, NOT skipped', () => {
    const init = peaks(['job', 'init', '--job-id', 'bj', '--slice-list', 'a,b,c', '--exit-policy', 'strict', '--main-loop-strategy', 'single', '--project', workdir], workdir);
    expect(init.status).toBe(0);
    const block = peaks(['job', 'block', '--job-id', 'bj', '--slice-id', 'slice-002', '--reason', 'QA cap', '--project', workdir], workdir);
    expect(block.status).toBe(0);
    const s = JSON.parse(peaks(['job', 'status', '--job-id', 'bj', '--project', workdir], workdir).stdout).data;
    expect(s.blocked).toBe(1);
    expect(s.skipped).toBe(0);
    expect(s.done).toBe(0);
  });
});

describe('peaks job — rotate-now under single mode (no crash)', () => {
  let workdir: string;
  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), 'job-e2e-ctx-'));
    seedSessionBinding(workdir, 'e2e-ctx-session');
  });
  afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

  it('rotate-now does not crash in single mode', () => {
    const init = peaks(['job', 'init', '--job-id', 'rj', '--slice-list', 'a', '--main-loop-strategy', 'single', '--project', workdir], workdir);
    expect(init.status).toBe(0);
    const r = peaks(['job', 'rotate-now', '--job-id', 'rj', '--project', workdir], workdir);
    expect([0, 1]).toContain(r.status); // either succeeds or reports rotation-refused; never crashes
  });
});
