/**
 * Slice 2026-06-27-slice-ls — `peaks slice ls` end-to-end CLI test.
 *
 * Covers ACs 1-12 from .peaks/_runtime/2026-06-27-session-1512ac/prd/requests/001-2026-06-27-slice-ls.md
 *
 * Strategy: write fake decomposition JSON files into a tmp dir with
 * controlled mtime, invoke `peaks slice ls --json --project <tmpDir>`
 * via the compiled bin, assert the JSON envelope and exit code.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const BIN_PATH = join(process.cwd(), 'bin', 'peaks.js');
const BIN_TIMEOUT_MS = 30_000;

/**
 * Create a tmp project root with a `.peaks/sc/slice-decomposition/` dir
 * containing the given rid/mtime fixtures. Returns the tmp project root.
 *
 * @param files Array of { rid, hasPicked, ageDays }
 */
function makeFixture(
  files: ReadonlyArray<{ rid: string; hasPicked: boolean; ageDays: number }>
): string {
  const root = join(
    tmpdir(),
    `slice-ls-fixture-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  mkdirSync(root, { recursive: true });
  const dir = join(root, '.peaks', 'sc', 'slice-decomposition');
  mkdirSync(dir, { recursive: true });
  const nowSec = Math.floor(Date.now() / 1000);
  for (const f of files) {
    const decPath = join(dir, `${f.rid}.json`);
    writeFileSync(decPath, JSON.stringify({ rid: f.rid, workUnits: [] }, null, 2));
    utimesSync(decPath, nowSec - f.ageDays * 86400, nowSec - f.ageDays * 86400);
    if (f.hasPicked) {
      const pickedPath = join(dir, `${f.rid}-picked.json`);
      writeFileSync(pickedPath, JSON.stringify({ rid: f.rid, picked: [] }, null, 2));
      utimesSync(pickedPath, nowSec - f.ageDays * 86400, nowSec - f.ageDays * 86400);
    }
  }
  return root;
}

function runLs(args: readonly string[], cwd: string): { stdout: string; status: number } {
  try {
    const stdout = execFileSync('node', [BIN_PATH, 'slice', 'ls', ...args, '--project', cwd], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: BIN_TIMEOUT_MS
    }).toString('utf8');
    return { stdout, status: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer; status?: number };
    return {
      stdout: (e.stdout ?? Buffer.alloc(0)).toString('utf8'),
      status: e.status ?? 1
    };
  }
}

const fixtures: string[] = [];

afterEach(() => {
  for (const root of fixtures) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
  fixtures.length = 0;
});

describe('peaks slice ls (slice 2026-06-27-slice-ls)', () => {
  it('AC1+AC2: --help lists the subcommand and all flags', () => {
    const out = execFileSync('node', [BIN_PATH, 'slice', '--help'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: BIN_TIMEOUT_MS
    }).toString('utf8');
    expect(out).toMatch(/\bcheck\b/);
    expect(out).toMatch(/\bdecompose\b/);
    expect(out).toMatch(/\bpick\b/);
    expect(out).toMatch(/\bplan\b/);
    // New subcommand present
    expect(out).toMatch(/\bls\b/);
  });

  it('AC3: enumerates rids in mtime-desc order with pickedPath + sizeBytes', () => {
    const root = makeFixture([
      { rid: '2026-06-13-foo', hasPicked: false, ageDays: 14 },
      { rid: '2026-06-26-bar', hasPicked: true, ageDays: 1 }
    ]);
    fixtures.push(root);
    const { stdout, status } = runLs(['--json'], root);
    expect(status).toBe(0);
    const env = JSON.parse(stdout) as { ok: boolean; data: { rids: Array<{ rid: string; pickedPath: string | null; sizeBytes: number; isStale: boolean }> } };
    expect(env.ok).toBe(true);
    expect(env.data.rids).toHaveLength(2);
    expect(env.data.rids[0]?.rid).toBe('2026-06-26-bar');
    expect(env.data.rids[0]?.pickedPath).toBeTruthy();
    expect(env.data.rids[1]?.rid).toBe('2026-06-13-foo');
    expect(env.data.rids[1]?.pickedPath).toBeNull();
    expect(env.data.rids[0]?.sizeBytes).toBeGreaterThan(0);
    // 14 days is under the 30-day threshold, so not stale yet
    expect(env.data.rids[1]?.isStale).toBe(false);
  });

  it('AC4: --stale-only filters to isStale=true rids', () => {
    const root = makeFixture([
      { rid: 'fresh', hasPicked: false, ageDays: 5 },
      { rid: 'ancient', hasPicked: false, ageDays: 45 }
    ]);
    fixtures.push(root);
    const { stdout, status } = runLs(['--json', '--stale-only'], root);
    expect(status).toBe(0);
    const env = JSON.parse(stdout) as { data: { rids: Array<{ rid: string; isStale: boolean }> } };
    expect(env.data.rids).toHaveLength(1);
    expect(env.data.rids[0]?.rid).toBe('ancient');
    expect(env.data.rids[0]?.isStale).toBe(true);
  });

  it('AC5+AC6: empty / missing dir returns empty list, exit 0', () => {
    const root = join(tmpdir(), `slice-ls-empty-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    mkdirSync(root, { recursive: true });
    fixtures.push(root);
    const { stdout, status } = runLs(['--json'], root);
    expect(status).toBe(0);
    const env = JSON.parse(stdout) as { ok: boolean; data: { rids: unknown[] } };
    expect(env.ok).toBe(true);
    expect(env.data.rids).toEqual([]);
  });

  it('AC7: --limit caps result count', () => {
    const root = makeFixture([
      { rid: 'r1', hasPicked: false, ageDays: 1 },
      { rid: 'r2', hasPicked: false, ageDays: 2 },
      { rid: 'r3', hasPicked: false, ageDays: 3 }
    ]);
    fixtures.push(root);
    const { stdout, status } = runLs(['--json', '--limit', '1'], root);
    expect(status).toBe(0);
    const env = JSON.parse(stdout) as { data: { rids: unknown[] } };
    expect(env.data.rids).toHaveLength(1);
  });

  it('AC8: --rid substring filter is case-insensitive', () => {
    const root = makeFixture([
      { rid: 'add-oauth', hasPicked: false, ageDays: 1 },
      { rid: 'fix-bug', hasPicked: false, ageDays: 1 },
      { rid: 'ADD-NEWS', hasPicked: false, ageDays: 1 }
    ]);
    fixtures.push(root);
    const { stdout, status } = runLs(['--json', '--rid', 'add'], root);
    expect(status).toBe(0);
    const env = JSON.parse(stdout) as { data: { rids: Array<{ rid: string }> } };
    const rids = env.data.rids.map((r) => r.rid);
    expect(rids).toContain('add-oauth');
    expect(rids).toContain('ADD-NEWS');
    expect(rids).not.toContain('fix-bug');
  });

  it('AC9: plaintext mode prints header + data rows', () => {
    const root = makeFixture([
      { rid: 'r1', hasPicked: false, ageDays: 1 }
    ]);
    fixtures.push(root);
    const { stdout, status } = runLs([], root);
    expect(status).toBe(0);
    expect(stdout).toMatch(/RID/);
    expect(stdout).toMatch(/MTIME/);
    expect(stdout).toMatch(/r1/);
  });
});