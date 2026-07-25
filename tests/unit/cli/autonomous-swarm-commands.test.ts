import { Command } from 'commander';
import { describe, expect, test } from 'vitest';
import { registerAutonomousSwarmCommands } from '../../../src/cli/commands/autonomous-swarm-commands.js';

function makeProgram(): { program: Command; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const program = new Command();
  program
    .name('peaks')
    .exitOverride()
    .configureOutput({ writeOut: (text) => out.push(text), writeErr: (text) => err.push(text) });
  return { program, out, err };
}

function parseOutput(out: string[]): { ok: boolean; command?: string; code?: string; data?: { goalPackage?: { goalCommand?: { marker: string; nonDurable: boolean } }; autonomyMode?: string; available?: boolean } } {
  const last = out.join('').trim();
  if (!last) return { ok: false };
  try {
    return JSON.parse(last);
  } catch {
    return { ok: false };
  }
}

describe('registerAutonomousSwarmCommands', () => {
  test('returns a successful JSON envelope for workflow autonomous-swarm', async () => {
    const { program, out } = makeProgram();
    const workflow = program.command('workflow').description('Plan workflow routing dry-run graphs');
    registerAutonomousSwarmCommands(program, { stdout: (text) => out.push(text), stderr: (text) => err.push(text) });
    await program.parseAsync(['node', 'peaks', 'workflow', 'autonomous-swarm', '--mode', 'code', '--change-id', 'cli-as-1', '--goal', 'Plan a resumable autonomous RD swarm', '--max-workers', '40', '--dry-run', '--json'], { from: 'node' });
    const parsed = parseOutput(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('workflow.autonomous');
    expect(parsed.data?.autonomyMode).toBe('dry-run');
    expect(parsed.data?.available).toBe(true);
  });

  test('rejects invalid change-ids with change-id-format', async () => {
    const { program, out } = makeProgram();
    const workflow = program.command('workflow').description('Plan workflow routing dry-run graphs');
    registerAutonomousSwarmCommands(program, { stdout: (text) => out.push(text), stderr: (text) => err.push(text) });
    await program.parseAsync(['node', 'peaks', 'workflow', 'autonomous-swarm', '--mode', 'code', '--change-id', '../escape', '--goal', 'x', '--max-workers', '40', '--dry-run', '--json'], { from: 'node' });
    const parsed = parseOutput(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('change-id-format');
  });

  test('rejects empty goals with INVALID_GOAL', async () => {
    const { program, out } = makeProgram();
    const workflow = program.command('workflow').description('Plan workflow routing dry-run graphs');
    registerAutonomousSwarmCommands(program, { stdout: (text) => out.push(text), stderr: (text) => err.push(text) });
    await program.parseAsync(['node', 'peaks', 'workflow', 'autonomous-swarm', '--mode', 'code', '--change-id', 'cli-as-2', '--goal', '   ', '--max-workers', '40', '--dry-run', '--json'], { from: 'node' });
    const parsed = parseOutput(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('INVALID_GOAL');
  });

  test('blocks when --no-dry-run is requested with NON_DRY_RUN_UNSUPPORTED', async () => {
    const { program, out } = makeProgram();
    const workflow = program.command('workflow').description('Plan workflow routing dry-run graphs');
    registerAutonomousSwarmCommands(program, { stdout: (text) => out.push(text), stderr: (text) => err.push(text) });
    await program.parseAsync(['node', 'peaks', 'workflow', 'autonomous-swarm', '--mode', 'code', '--change-id', 'cli-as-3', '--goal', 'x', '--max-workers', '40', '--no-dry-run', '--json'], { from: 'node' });
    const parsed = parseOutput(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('NON_DRY_RUN_UNSUPPORTED');
  });

  test('rejects unsupported modes with UNSUPPORTED_AUTONOMOUS_MODE', async () => {
    const { program, out } = makeProgram();
    const workflow = program.command('workflow').description('Plan workflow routing dry-run graphs');
    registerAutonomousSwarmCommands(program, { stdout: (text) => out.push(text), stderr: (text) => err.push(text) });
    await program.parseAsync(['node', 'peaks', 'workflow', 'autonomous-swarm', '--mode', 'foo', '--change-id', 'cli-as-4', '--goal', 'x', '--max-workers', '40', '--dry-run', '--json'], { from: 'node' });
    const parsed = parseOutput(out);
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('UNSUPPORTED_AUTONOMOUS_MODE');
  });

  test('includes the /goal marker with nonDurable=true', async () => {
    const { program, out } = makeProgram();
    const workflow = program.command('workflow').description('Plan workflow routing dry-run graphs');
    registerAutonomousSwarmCommands(program, { stdout: (text) => out.push(text), stderr: (text) => err.push(text) });
    await program.parseAsync(['node', 'peaks', 'workflow', 'autonomous-swarm', '--mode', 'code', '--change-id', 'cli-as-5', '--goal', 'Plan a resumable autonomous RD swarm', '--max-workers', '40', '--dry-run', '--json'], { from: 'node' });
    const parsed = parseOutput(out);
    expect(parsed.ok).toBe(true);
    expect(parsed.data?.goalPackage?.goalCommand?.marker).toBe('/goal');
    expect(parsed.data?.goalPackage?.goalCommand?.nonDurable).toBe(true);
  });
});
