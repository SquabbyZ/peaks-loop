// tests/unit/cli/commands/job-commands.test.ts
import { describe, it, expect } from 'vitest';
import { registerJobCommands } from '../../../../src/cli/commands/job-commands.js';
import { Command } from 'commander';

function freshProgram(): Command {
  const prog = new Command();
  prog.option('--project <p>');
  registerJobCommands(prog as any);
  return prog;
}

describe('peaks job CLI', () => {
  it('registers 9 subcommands', () => {
    const prog = freshProgram();
    const jobCmd = prog.commands.find(c => c.name() === 'job');
    expect(jobCmd).toBeTruthy();
    const names = jobCmd!.commands.map(c => c.name()).sort();
    expect(names).toEqual([
      'block', 'checkpoint', 'continue', 'handoff', 'init',
      'resume', 'rotate-now', 'status', 'subagent-cleanup',
    ]);
  });

  it('init requires --job-id and --slice-list', () => {
    const prog = freshProgram();
    const initCmd = prog.commands.find(c => c.name() === 'job')!.commands.find(c => c.name() === 'init')!;
    const required = (initCmd as any).options.filter((o: any) => o.required).map((o: any) => o.long);
    expect(required).toContain('--job-id');
    expect(required).toContain('--slice-list');
  });

  it('status --help mentions --watch and --show-cost', () => {
    const prog = freshProgram();
    const statusCmd = prog.commands.find(c => c.name() === 'job')!.commands.find(c => c.name() === 'status')!;
    const help = statusCmd.helpInformation();
    expect(help).toContain('--watch');
    expect(help).toContain('--show-cost');
  });
});