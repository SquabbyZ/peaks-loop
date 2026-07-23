/**
 * Task 1.6 — end-to-end integration test for `peaks compact auto|status|capabilities`.
 *
 * Runs the full CLI in-process via `runCli`, not just the unit-test
 * boundary. Asserts the contract published in design §11.1: the public
 * CLI surface is the three commands `auto / status / capabilities`,
 * dry-run is side-effect-free, unknown flags fail loudly, and the
 * envelope shape matches the unit-test version.
 *
 * The unit test in tests/unit/cli/compact-command.test.ts covers the
 * envelope shape; this integration test exercises the real Command
 * tree (Commander arg-parsing path) and the file-system side-effect
 * guarantee for `--dry-run`.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCli } from './_cli-helper.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-compact-auto-int-'));
});

afterEach(() => {
  try {
    process.chdir(tmpdir());
  } catch {
    // best effort
  }
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

function writeSessionBinding(sid: string, projectRoot: string): void {
  const peaksDir = join(projectRoot, '.peaks', '_runtime');
  mkdirSync(peaksDir, { recursive: true });
  writeFileSync(
    join(peaksDir, 'session.json'),
    JSON.stringify({ sessionId: sid, setAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

function readEnvelope(stdout: string): {
  ok: boolean;
  command: string;
  code?: string;
  data?: unknown;
  nextActions?: string[];
  message?: string;
} {
  // The CLI prints one JSON envelope on stdout for --json invocations.
  return JSON.parse(stdout) as ReturnType<typeof readEnvelope>;
}

describe('peaks compact auto (integration, design §11.1)', () => {
  it('dry-run resolves through the full CLI and writes no journal / circuit files', async () => {
    const sid = '2026-07-23-task-1-6-int-auto-dry';
    writeSessionBinding(sid, root);
    const compactDir = join(root, '.peaks', '_runtime', sid, 'compact-attempts');
    const circuitFile = join(compactDir, 'session-circuit.json');

    const result = await runCli(
      ['compact', 'auto', '--project', root, '--session-id', sid, '--dry-run', '--json'],
      root
    );
    expect(result.code).toBeGreaterThan(0); // Phase 1 has no real bridge; reports unsupported.
    const env = readEnvelope(result.stdout);
    expect(env.command).toBe('compact.auto');
    expect(env.ok).toBe(false);
    expect(['AUTO_COMPACT_UNSUPPORTED_STRONG_GUARANTEE', 'AUTO_COMPACT_VERIFICATION_CIRCUIT_OPEN', 'AUTO_COMPACT_EXHAUSTED'].includes(env.code ?? '')).toBe(true);
    expect(Array.isArray(env.nextActions)).toBe(true);
    // Side-effect-free: no journal / circuit files written.
    expect(existsSync(circuitFile)).toBe(false);
    if (existsSync(compactDir)) {
      const journals = readdirSync(compactDir).filter((n) => n.endsWith('.journal.json'));
      expect(journals).toEqual([]);
    }
  });

  it('rejects --execute (unknown option) loudly without running the action', async () => {
    const sid = '2026-07-23-task-1-6-int-auto-execute';
    writeSessionBinding(sid, root);
    const result = await runCli(
      ['compact', 'auto', '--project', root, '--session-id', sid, '--execute', '--json'],
      root
    );
    // The integration helper uses exitOverride() so Commander's unknown-
    // option rejection is thrown and silently swallowed; the render still
    // routes the error to stderr via configureOutput. We assert both the
    // exit code (when the helper propagates it) AND the stderr message.
    const out = `${result.stdout}\n${result.stderr}`;
    expect(out).toMatch(/--execute/);
    if (result.code === 0) {
      // Helper swallowed the Commander throw; the rendered error MUST
      // still be visible on stderr so the LLM / user sees the rejection.
      expect(result.stderr).toMatch(/--execute/);
    } else {
      expect(result.code).toBeGreaterThan(0);
    }
  });

  it('rejects --target-ratio=1.5 with INVALID_TARGET_RATIO', async () => {
    const sid = '2026-07-23-task-1-6-int-auto-bad-ratio';
    writeSessionBinding(sid, root);
    const result = await runCli(
      ['compact', 'auto', '--project', root, '--session-id', sid, '--dry-run', '--target-ratio', '1.5', '--json'],
      root
    );
    expect(result.code).toBeGreaterThan(0);
    const env = readEnvelope(result.stdout);
    expect(env.code).toBe('INVALID_TARGET_RATIO');
  });

  it('lists auto / status / capabilities in the help text', async () => {
    const result = await runCli(['compact', '--help'], root);
    const out = `${result.stdout}\n${result.stderr}`;
    expect(out).toMatch(/auto/);
    expect(out).toMatch(/status/);
    expect(out).toMatch(/capabilities/);
  });
});

describe('peaks compact status (integration, read-only)', () => {
  it('returns closed-circuit status when no failure journal exists', async () => {
    const sid = '2026-07-23-task-1-6-int-status-closed';
    writeSessionBinding(sid, root);
    const result = await runCli(
      ['compact', 'status', '--project', root, '--session-id', sid, '--json'],
      root
    );
    expect(result.code).toBe(0);
    const env = readEnvelope(result.stdout);
    expect(env.command).toBe('compact.status');
    expect(env.ok).toBe(true);
    type StatusData = {
      sessionId: string;
      circuit: 'closed' | 'open' | 'awaiting-manual-observation';
      consecutiveVerificationFailures: number;
    };
    const data = env.data as StatusData;
    expect(data.sessionId).toBe(sid);
    expect(data.circuit).toBe('closed');
    expect(data.consecutiveVerificationFailures).toBe(0);
  });

  it('does not write a circuit file (read-only)', async () => {
    const sid = '2026-07-23-task-1-6-int-status-readonly';
    writeSessionBinding(sid, root);
    const compactDir = join(root, '.peaks', '_runtime', sid, 'compact-attempts');
    const circuitFile = join(compactDir, 'session-circuit.json');
    const result = await runCli(
      ['compact', 'status', '--project', root, '--session-id', sid, '--json'],
      root
    );
    expect(result.code).toBe(0);
    expect(existsSync(circuitFile)).toBe(false);
  });
});

describe('peaks compact capabilities (integration, no vendor parameter)', () => {
  it('returns a non-vendor profile envelope with supported=false in Phase 1', async () => {
    const result = await runCli(
      ['compact', 'capabilities', '--project', root, '--json'],
      root
    );
    expect(result.code).toBe(0);
    const env = readEnvelope(result.stdout);
    expect(env.command).toBe('compact.capabilities');
    expect(env.ok).toBe(true);
    type CapsData = {
      providerId: string;
      certification: string;
      supported: boolean;
      profile: Record<string, unknown>;
    };
    const data = env.data as CapsData;
    expect(typeof data.providerId).toBe('string');
    expect(data.supported).toBe(false);
    // No vendor / binary / host / slashCommand discriminator leaks.
    expect((data as Record<string, unknown>).vendor).toBeUndefined();
    expect((data as Record<string, unknown>).binary).toBeUndefined();
    expect((data as Record<string, unknown>).host).toBeUndefined();
    expect((data as Record<string, unknown>).slashCommand).toBeUndefined();
  });

  it('rejects --vendor (unknown option) loudly', async () => {
    const result = await runCli(
      ['compact', 'capabilities', '--project', root, '--vendor', 'claude-code', '--json'],
      root
    );
    const out = `${result.stdout}\n${result.stderr}`;
    expect(out).toMatch(/--vendor/);
    if (result.code === 0) {
      // Helper swallowed the Commander throw; the rendered error MUST
      // still be visible on stderr so the LLM / user sees the rejection.
      expect(result.stderr).toMatch(/--vendor/);
    } else {
      expect(result.code).toBeGreaterThan(0);
    }
  });
});
