import { existsSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import type { ProgramIO } from '../../../src/cli/cli-helpers.js';
import { registerSpillDemoCommand } from '../../../src/cli/commands/spill-demo-command.js';
import { listSpills, spillPath } from '../../../src/services/context/spillover-store.js';

function harness() {
  const output: string[] = [];
  const io: ProgramIO = {
    stdout: (text) => output.push(text),
    stderr: () => {}
  };
  const program = new Command();
  const session = program.command('session');
  registerSpillDemoCommand(session, io);
  return { program, output };
}

describe('session spill-demo command', () => {
  const roots: string[] = [];

  afterEach(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true });
    roots.length = 0;
  });

  async function run(batchId?: string) {
    const projectRoot = join(tmpdir(), `spill-demo-${randomUUID()}`);
    const sessionId = `session-${randomUUID()}`;
    roots.push(projectRoot);
    const { program, output } = harness();
    const args = [
      'node', 'peaks', 'session', 'spill-demo',
      '--session-id', sessionId,
      '--project', projectRoot,
      '--json'
    ];
    if (batchId !== undefined) args.push('--batch-id', batchId);
    await program.parseAsync(args, { from: 'node' });
    return {
      projectRoot,
      sessionId,
      envelope: JSON.parse(output.join('')) as {
        data: {
          spilled: string;
          totalSpills: number;
          hydrated: {
            state: string;
            batchId?: string;
            payload: unknown;
          };
        };
      }
    };
  }

  it('writes, lists, and hydrates a spill record', async () => {
    const result = await run();
    expect(existsSync(spillPath(result.projectRoot, result.sessionId, result.envelope.data.spilled))).toBe(true);
    expect(result.envelope.data.hydrated.state).toBe('hydrated');
  });

  it('round-trips the sample payload', async () => {
    const { envelope } = await run();
    expect(envelope.data.hydrated.payload).toEqual({ llm: { turn: 1, context: ['sample'] } });
  });

  it('preserves the batch id', async () => {
    const { envelope } = await run('batch-32');
    expect(envelope.data.hydrated.batchId).toBe('batch-32');
  });

  it('reports one record for an initially empty session', async () => {
    const result = await run();
    expect(result.envelope.data.totalSpills).toBe(1);
    expect(listSpills(result.projectRoot, result.sessionId)).toHaveLength(1);
  });
});
