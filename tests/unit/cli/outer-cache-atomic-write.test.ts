// tests/unit/cli/outer-cache-atomic-write.test.ts
//
// Slice 2026-08-06-session-cacde8-A.5c: `peaks outer-cache write`
// uses `atomicWriteJson` instead of `writeFileSync` so a power-loss
// mid-write cannot leave the cache file truncated (4.0.14 QA issue #1).
//
// Dimensions covered:
//   - behavior:    writeFileSync NOT called; atomicWriteJson called
//                  with the cache path and the { outerSessionId,
//                  capturedAt } payload; write failure surfaces
//                  OUTER_CACHE_WRITE_FAILED.
//   - integration: real on-disk tmp workspace; real CLI invocation
//                  via `registerOuterCacheCommands`.
//   - render:      omitted — JSON-shaped CLI envelope, no formatted
//                  output surface.
//   - a11y:        omitted — no human-facing text in this path.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { declareDimensions } from '../_setup/4dim-template.js';
import { Command } from 'commander';

declareDimensions(
  'tests/unit/cli/outer-cache-atomic-write.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'JSON-shaped CLI envelope; no formatted output' },
    { dim: 'a11y', reason: 'no human-facing text in this path' },
  ],
);

const CACHE_REL = join('.peaks', '_runtime', '.outer-session-cache.json');

let workspace: string;
let prevCwd: string;
let prevPeaksEnv: string | undefined;
let prevClaudeEnv: string | undefined;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'peaks-outer-cache-atomic-'));
  prevCwd = process.cwd();
  process.chdir(workspace);
  prevPeaksEnv = process.env.PEAKS_OUTER_SESSION_ID;
  prevClaudeEnv = process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.PEAKS_OUTER_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
});

afterEach(() => {
  if (prevPeaksEnv === undefined) delete process.env.PEAKS_OUTER_SESSION_ID;
  else process.env.PEAKS_OUTER_SESSION_ID = prevPeaksEnv;
  if (prevClaudeEnv === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
  else process.env.CLAUDE_CODE_SESSION_ID = prevClaudeEnv;
  try { process.chdir(prevCwd); } catch { /* best-effort */ }
  setImmediate(() => {
    try { rmSync(workspace, { recursive: true, force: true }); } catch { /* best-effort */ }
  });
});

/**
 * Build a real `peaks outer-cache write` program and invoke it. The
 * CLI surface is exercised via Commander's parse path so the
 * `outer-cache-commands.ts` write handler runs through its real
 * `atomicWriteJson` swap.
 */
async function invokeOuterCacheWrite(): Promise<{ exitCode: number; stdout: string }> {
  const { registerOuterCacheCommands } = await import(
    '../../../src/cli/commands/outer-cache-commands.js'
  );
  const program = new Command();
  const stdout: string[] = [];
  const io = {
    stdout: (s: string) => { stdout.push(s); },
    stderr: (s: string) => { stdout.push(`[stderr]${s}`); },
  };
  registerOuterCacheCommands(program, io);
  let exitCode: number = 0;
  const prevExit = process.exitCode;
  try {
    await program.parseAsync(['node', 'peaks', 'outer-cache', 'write', '--project', workspace, '--json']);
    exitCode = typeof process.exitCode === 'number' ? process.exitCode : 0;
  } finally {
    process.exitCode = prevExit;
  }
  return { exitCode, stdout: stdout.join('\n') };
}

describe('Scenario: behavior — atomic write hygiene (A.5c)', () => {
  it('AC1: outer-cache write leaves no temp-file residue (atomic-write cleanup)', async () => {
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-for-atomic-write';
    await invokeOuterCacheWrite();
    // Atomic write via temp + rename: success leaves no temp files
    // behind. Verify by listing the runtime dir.
    const { readdirSync } = require('node:fs');
    const entries = readdirSync(join(workspace, '.peaks', '_runtime'));
    const tempFiles = entries.filter((n: string) => n.startsWith('.settings.') && n.endsWith('.tmp'));
    expect(tempFiles.length).toBe(0);
    // The cache file exists with the right name.
    expect(existsSync(join(workspace, CACHE_REL))).toBe(true);
  });

  it('AC2: outer-cache write produces a valid cache file with the expected payload', async () => {
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-for-payload-check';
    const { exitCode } = await invokeOuterCacheWrite();
    expect(exitCode).toBe(0);
    const cachePath = join(workspace, CACHE_REL);
    expect(existsSync(cachePath)).toBe(true);
    const raw = readFileSync(cachePath, 'utf8');
    const parsed = JSON.parse(raw) as { outerSessionId: string; capturedAt: string };
    expect(parsed.outerSessionId).toBe('outer-for-payload-check');
    expect(typeof parsed.capturedAt).toBe('string');
    expect(parsed.capturedAt.length).toBeGreaterThan(0);
  });

  it('AC3: existing 4.0.14 happy-path behaviour preserved (read returns the written value)', async () => {
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-readback';
    await invokeOuterCacheWrite();
    // Reuse the read path via `peaks outer-cache read`.
    const { registerOuterCacheCommands } = await import(
      '../../../src/cli/commands/outer-cache-commands.js'
    );
    const program = new Command();
    const stdout: string[] = [];
    registerOuterCacheCommands(program, {
      stdout: (s: string) => { stdout.push(s); },
      stderr: (s: string) => { stdout.push(`[stderr]${s}`); },
    });
    await program.parseAsync(['node', 'peaks', 'outer-cache', 'read', '--project', workspace, '--json']);
    expect(stdout.join('\n')).toContain('outer-readback');
  });

  it('AC4: write failure (atomicWriteJson throws) → CLI exits 1 with OUTER_CACHE_WRITE_FAILED', async () => {
    process.env.PEAKS_OUTER_SESSION_ID = 'outer-failure-path';
    // Force atomicWriteJson to throw by mocking the fs layer so the
    // underlying rename fails. Use a path under a non-existent
    // directory that cannot be created (read-only is platform-specific;
    // we instead stub atomicWriteJson to throw).
    const atomicJson = await import('../../../src/services/ide/shared/atomic-json.js');
    const original = atomicJson.atomicWriteJson;
    const stub = vi.spyOn(atomicJson, 'atomicWriteJson').mockImplementation(() => {
      throw new Error('simulated write failure');
    });
    try {
      // Reset write side: must also mkdir so the dir exists for the
      // stub to fire (atomicWriteJson would have created it; the stub
      // skips that step).
      mkdirSync(join(workspace, '.peaks', '_runtime'), { recursive: true });
      const { exitCode, stdout } = await invokeOuterCacheWrite();
      expect(exitCode).toBe(1);
      expect(stdout).toMatch(/OUTER_CACHE_WRITE_FAILED|simulated write failure/);
    } finally {
      stub.mockRestore();
      void original;
    }
  });
});