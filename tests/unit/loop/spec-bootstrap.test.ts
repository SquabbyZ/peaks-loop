/**
 * peaks-loop v3.0.0 — Slice F (P1) tests
 *
 * `peaks loop spec bootstrap` --force二次保护:
 *  1. First bootstrap on a rid → ok, file written
 *  2. Second bootstrap without --force → SPEC_EXISTS_NEEDS_FORCE
 *  3. Second bootstrap with --force → ok and overwrites
 *
 * These exercise the `peaks loop spec bootstrap` CLI subcommand via
 * the program-level commander wiring.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { registerWorkflowEvalCommands } from '../../../src/cli/commands/loop-eval-commands.js';

const TMP_SESSION = '2026-07-01-spec-bootstrap-test';

const IO = {
  stdout: (text: string): void => {
    // Capture JSON envelopes; the test asserts on these.
    captured.push(text);
  },
  stderr: (text: string): void => {
    captured.push(text);
  }
};

let captured: string[];

function makeProgram(): Command {
  const program = new Command();
  program.exitOverride(); // prevent commander from process.exit
  registerWorkflowEvalCommands(program, IO);
  return program;
}

describe('peaks loop spec bootstrap — --force flag (P1)', () => {
  let tmpRoot: string;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-bootstrap-'));
    captured = [];
  });
  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('1. first bootstrap writes a spec.yaml and reports ok', async () => {
    const program = makeProgram();
    await program.parseAsync([
      'node', 'peaks', 'loop', 'spec', 'bootstrap', 'demo-1',
      '--session', TMP_SESSION,
      '--project', tmpRoot,
      '--json'
    ]);
    const specPath = join(tmpRoot, '.peaks', '_runtime', TMP_SESSION, 'loop', 'demo-1', 'spec.yaml');
    expect(existsSync(specPath)).toBe(true);
    const raw = readFileSync(specPath, 'utf8');
    expect(raw).toMatch(/rid: demo-1/);
    // The last JSON envelope is the `ok` one.
    const okEnvelope = captured.map((s) => {
      try { return JSON.parse(s) as { ok: boolean; code?: string }; } catch { return null; }
    }).filter((p) => p !== null).pop();
    expect(okEnvelope?.ok).toBe(true);
  });

  it('2. second bootstrap without --force → SPEC_EXISTS_NEEDS_FORCE', async () => {
    const program = makeProgram();
    // First call: write the file.
    await program.parseAsync([
      'node', 'peaks', 'loop', 'spec', 'bootstrap', 'demo-2',
      '--session', TMP_SESSION,
      '--project', tmpRoot,
      '--json'
    ]);
    // Reset capture; second call should fail.
    captured = [];
    await program.parseAsync([
      'node', 'peaks', 'loop', 'spec', 'bootstrap', 'demo-2',
      '--session', TMP_SESSION,
      '--project', tmpRoot,
      '--json'
    ]);
    const env = captured.map((s) => {
      try { return JSON.parse(s) as { ok: boolean; code?: string; message?: string }; } catch { return null; }
    }).filter((p) => p !== null).pop();
    expect(env?.ok).toBe(false);
    expect(env?.code).toBe('SPEC_EXISTS_NEEDS_FORCE');
    expect(env?.message).toMatch(/--force/);
  });

  it('3. second bootstrap with --force → ok and overwrites', async () => {
    const program = makeProgram();
    await program.parseAsync([
      'node', 'peaks', 'loop', 'spec', 'bootstrap', 'demo-3',
      '--session', TMP_SESSION,
      '--project', tmpRoot,
      '--json'
    ]);
    const specPath = join(tmpRoot, '.peaks', '_runtime', TMP_SESSION, 'loop', 'demo-3', 'spec.yaml');
    const firstMtime = (require('node:fs') as typeof import('node:fs')).statSync(specPath).mtimeMs;
    // Wait a hair so mtime changes deterministically.
    await new Promise((r) => setTimeout(r, 20));
    captured = [];
    await program.parseAsync([
      'node', 'peaks', 'loop', 'spec', 'bootstrap', 'demo-3',
      '--session', TMP_SESSION,
      '--project', tmpRoot,
      '--force',
      '--json'
    ]);
    const env = captured.map((s) => {
      try { return JSON.parse(s) as { ok: boolean; code?: string; data?: { overwritten?: boolean } }; } catch { return null; }
    }).filter((p) => p !== null).pop();
    expect(env?.ok).toBe(true);
    expect(env?.data?.overwritten).toBe(true);
    const secondMtime = (require('node:fs') as typeof import('node:fs')).statSync(specPath).mtimeMs;
    expect(secondMtime).toBeGreaterThanOrEqual(firstMtime);
  });
});
