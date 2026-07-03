// tests/unit/cli/commands/job-commands-2.test.ts
import { describe, it, expect } from 'vitest';
import { registerJobCommands } from '../../../../src/cli/commands/job-commands.js';
import { Command } from 'commander';

function freshProgram(): Command { const p = new Command(); registerJobCommands(p); return p; }

describe('peaks job — round-trip commands', () => {
  it('checkpoint --help documents --commit-sha and --reason', () => {
    const p = freshProgram();
    const cmd = p.commands.find(c => c.name() === 'job')!.commands.find(c => c.name() === 'checkpoint')!;
    const h = cmd.helpInformation();
    expect(h).toContain('--commit-sha');
    expect(h).toContain('--reason');
    expect(h).toContain('<done|failed|skipped>');
  });

  it('block --reason is required (Commander marks it)', () => {
    const p = freshProgram();
    const cmd = p.commands.find(c => c.name() === 'job')!.commands.find(c => c.name() === 'block')!;
    const required = (cmd as any).options.filter((o: any) => o.required).map((o: any) => o.long);
    expect(required).toContain('--reason');
  });

  it('handoff mentions --job-id', () => {
    const p = freshProgram();
    const cmd = p.commands.find(c => c.name() === 'job')!.commands.find(c => c.name() === 'handoff')!;
    expect(cmd.helpInformation()).toContain('--job-id');
  });
});