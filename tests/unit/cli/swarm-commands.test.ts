import { Command } from 'commander';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import { registerSwarmCommands } from '../../../src/cli/commands/swarm-commands.js';

function makeProgram(): { program: Command; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const program = new Command();
  program
    .name('peaks')
    .exitOverride()
    .configureOutput({ writeOut: (text) => out.push(text), writeErr: (text) => err.push(text) });
  const swarm = program.command('swarm').description('Plan RD swarm dry-run graphs');
  registerSwarmCommands(program, { stdout: (text) => out.push(text), stderr: (text) => err.push(text) });
  return { program, out, err };
}

function parseOutput(out: string[]): { ok: boolean; command?: string; code?: string; data?: { workerTarget: number; waves: unknown[]; outputs: { taskGraph: string } } } {
  const last = out.join('').trim();
  if (!last) return { ok: false };
  try { return JSON.parse(last); } catch { return { ok: false, data: { workerTarget: 0, waves: [], outputs: { taskGraph: last } } }; }
}

describe('registerSwarmCommands', () => {
  test('returns a successful JSON envelope for swarm plan-change-id', async () => {
    const { program, out } = makeProgram();
    await program.parseAsync(['node', 'peaks', 'swarm', 'plan-change-id', '--change-id', 'cli-1', '--goal', 'Implement the approved checkout refactor', '--max-workers', '25', '--dry-run', '--json'], { from: 'node' });
    const parsed = parseOutput(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('swarm.plan');
    expect(parsed.data?.workerTarget).toBe(25);
  });
  test('rejects invalid change-ids with change-id-format', async () => {
    const { program, out } = makeProgram();
    await program.parseAsync(['node', 'peaks', 'swarm', 'plan-change-id', '--change-id', '../escape', '--goal', 'x', '--max-workers', '25', '--dry-run', '--json'], { from: 'node' });
    const parsed = parseOutput(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('change-id-format');
  });
  test('rejects empty goals with INVALID_GOAL', async () => {
    const { program, out } = makeProgram();
    await program.parseAsync(['node', 'peaks', 'swarm', 'plan-change-id', '--change-id', 'cli-2', '--goal', '   ', '--max-workers', '25', '--dry-run', '--json'], { from: 'node' });
    const parsed = parseOutput(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('INVALID_GOAL');
  });
  test('blocks when --no-dry-run is requested with UNSUPPORTED_NON_DRY_RUN', async () => {
    const { program, out } = makeProgram();
    await program.parseAsync(['node', 'peaks', 'swarm', 'plan-change-id', '--change-id', 'cli-3', '--goal', 'x', '--max-workers', '25', '--no-dry-run', '--json'], { from: 'node' });
    const parsed = parseOutput(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('UNSUPPORTED_NON_DRY_RUN');
  });
  test('rejects unsupported code modes with UNSUPPORTED_CODE_MODE', async () => {
    const { program, out } = makeProgram();
    await program.parseAsync(['node', 'peaks', 'swarm', 'plan-change-id', '--change-id', 'cli-4', '--goal', 'x', '--max-workers', '25', '--dry-run', '--code-mode', 'foo', '--json'], { from: 'node' });
    const parsed = parseOutput(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('UNSUPPORTED_CODE_MODE');
  });
  test('returns the planned JSON output shape', async () => {
    const { program, out } = makeProgram();
    await program.parseAsync(['node', 'peaks', 'swarm', 'plan-change-id', '--change-id', 'cli-5', '--goal', 'Refactor the checkout flow', '--max-workers', '30', '--dry-run', '--json'], { from: 'node' });
    const parsed = parseOutput(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.outputs.taskGraph).toBe('cli-5/swarm/task-graph.json');
  });
});
