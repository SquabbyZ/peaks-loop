/**
 * 2.7.0 slice-dag-dispatcher MVP — peaks contract write CLI guard.
 *
 * Covers the round-5 audit fix that adds a real `peaks contract write`
 * CLI command. The structured MVP prompt (round-2 fix #5) tells the
 * LLM-side runner to call this command after each slice finishes; the
 * round-5 audit caught that the command didn't exist. This test
 * pins the CLI surface so it cannot be silently removed without
 * breaking the handoff protocol.
 *
 * The test exercises the CLI by importing the command's
 * `registerContractCommands` factory and invoking the registered
 * subcommand directly via commander, then asserting on the result
 * envelope + the resulting contract file on disk.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';

import { registerContractCommands } from '../../../src/cli/commands/contract-commands.js';
import type { ProgramIO } from '../../../src/cli/cli-helpers.js';

let projectRoot: string;
let stdout: string[];
let stderr: string[];

const io: ProgramIO = {
  stdout: (s: string) => { stdout.push(s); },
  stderr: (s: string) => { stderr.push(s); }
};

function makeProgram(): Command {
  stdout = [];
  stderr = [];
  const program = new Command();
  program.exitOverride(); // commander throws on process.exit so we can catch
  registerContractCommands(program, io);
  return program;
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-r5-contract-'));
});

afterEach(() => {
  if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
});

describe('peaks contract write — round-5 audit fix (slice 1.2.c handoff command)', () => {
  it('writes the contract file at .peaks/_runtime/<sid>/dispatch/contracts/<slice>.json with the expected shape', async () => {
    const program = makeProgram();
    await program.parseAsync([
      'node', 'peaks', 'contract', 'write',
      '--project', projectRoot,
      '--session-id', 'sid-r5-test',
      '--slice-id', 'slice-A',
      '--exports', 'validateDag,topologicalLevels',
      '--types', 'SliceDag',
      '--signatures', 'validateDag(dag: SliceDag): void',
      '--broadcast-to', 'slice-B,slice-C',
      '--completed-at', '2026-06-18T17:30:00.000Z',
      '--json'
    ]);

    // Envelope was printed to stdout
    expect(stdout.length, 'envelope should be printed to stdout').toBeGreaterThan(0);
    const envelope = JSON.parse(stdout.join('')) as {
      ok: boolean;
      command: string;
      data: {
        path: string;
        contractHash: string;
        sliceId: string;
        sessionId: string;
        completedAt: string;
        exportCount: number;
        typeCount: number;
        signatureCount: number;
        broadcastTo: readonly string[];
      };
    };
    expect(envelope.ok, 'envelope.ok').toBe(true);
    expect(envelope.command).toBe('contract.write');
    expect(envelope.data.sliceId).toBe('slice-A');
    expect(envelope.data.exportCount).toBe(2);
    expect(envelope.data.typeCount).toBe(1);
    expect(envelope.data.signatureCount).toBe(1);
    expect(envelope.data.broadcastTo).toEqual(['slice-B', 'slice-C']);
    expect(envelope.data.contractHash).toMatch(/^[0-9a-f]{64}$/);

    // File on disk
    const expectedPath = join(projectRoot, '.peaks', '_runtime', 'sid-r5-test', 'dispatch', 'contracts', 'slice-A.json');
    expect(existsSync(expectedPath), `contract file at ${expectedPath}`).toBe(true);
    const fileBody = JSON.parse(readFileSync(expectedPath, 'utf8')) as {
      sliceId: string;
      sessionId: string;
      completedAt: string;
      exports: readonly string[];
      types: readonly string[];
      publicSignatures: readonly string[];
      broadcastTo: readonly string[];
      contractHash: string;
    };
    expect(fileBody.sliceId).toBe('slice-A');
    expect(fileBody.sessionId).toBe('sid-r5-test');
    expect(fileBody.completedAt).toBe('2026-06-18T17:30:00.000Z');
    expect(fileBody.exports).toEqual(['validateDag', 'topologicalLevels']);
    expect(fileBody.types).toEqual(['SliceDag']);
    expect(fileBody.publicSignatures).toEqual(['validateDag(dag: SliceDag): void']);
    expect(fileBody.broadcastTo).toEqual(['slice-B', 'slice-C']);
    expect(fileBody.contractHash).toBe(envelope.data.contractHash);
  });

  it('is idempotent: re-running with the same inputs produces the same contractHash', async () => {
    const args = [
      'node', 'peaks', 'contract', 'write',
      '--project', projectRoot,
      '--session-id', 'sid-r5-idem',
      '--slice-id', 'slice-X',
      '--exports', 'foo,bar',
      '--completed-at', '2026-06-18T00:00:00.000Z',
      '--json'
    ];
    const program1 = makeProgram();
    await program1.parseAsync(args);
    const env1 = JSON.parse(stdout.join('')) as { data: { contractHash: string } };

    const program2 = makeProgram();
    await program2.parseAsync(args);
    const env2 = JSON.parse(stdout.join('')) as { data: { contractHash: string } };

    expect(env2.data.contractHash, 'same input → same hash').toBe(env1.data.contractHash);
  });

  it('rejects empty --slice-id with code MISSING_SLICE_ID', async () => {
    const program = makeProgram();
    // commander requiredOption catches missing; the empty string is
    // still accepted. We rely on the action handler's
    // sliceId.length === 0 check.
    await program.parseAsync([
      'node', 'peaks', 'contract', 'write',
      '--project', projectRoot,
      '--session-id', 'sid-r5-bad',
      '--slice-id', '',
      '--json'
    ]);
    const env = JSON.parse(stdout.join('')) as { ok: boolean; code: string };
    expect(env.ok, 'envelope.ok').toBe(false);
    expect(env.code).toBe('MISSING_SLICE_ID');
  });

  it('surfaces writeContract IO errors as code WRITE_ERROR', async () => {
    const program = makeProgram();
    // Point --project at a file (not a dir); writeContract's
    // mkdirSync(recursive: true) will fail on a path whose parent
    // is not a directory.
    const blockingFile = join(projectRoot, 'blocker');
    writeFileSync(blockingFile, 'blocker', 'utf8');
    await program.parseAsync([
      'node', 'peaks', 'contract', 'write',
      '--project', blockingFile, // <-- this is a FILE, not a dir
      '--session-id', 'sid-r5-err',
      '--slice-id', 'slice-Z',
      '--json'
    ]);
    const env = JSON.parse(stdout.join('')) as { ok: boolean; code: string };
    expect(env.ok, 'envelope.ok').toBe(false);
    expect(env.code).toBe('WRITE_ERROR');
  });
});
