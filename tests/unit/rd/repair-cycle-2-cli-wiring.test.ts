/**
 * RD#4 Repair cycle 2 — CLI wiring regression test.
 * Slice 2026-06-16-peaks-rd-no-gates.
 *
 * Asserts that `peaks swarm plan --strict-standards` (the CLI entry point)
 * threads `projectRoot` from `getWorkflowWorkspaceContext()` into
 * `createRdSwarmPlan`, so that `--strict-standards` has an observable
 * effect end-to-end:
 *   - JSON envelope contains `standardsErrorCode: 'EPEAKS_NO_STANDARDS'`
 *   - process.exitCode === 1
 *
 * Pre-fix bug: `getWorkflowWorkspaceContext()` returned only `workspace`
 * + `artifactWorkspacePath` — never `projectRoot`. So even though the
 * service-layer (`buildStandardsOverlay`) handled strict+missing correctly,
 * the CLI invocation dropped `projectRoot` and `buildStandardsOverlay`
 * early-returned `{}`. `process.exitCode` stayed 0; the JSON envelope had
 * no `standardsErrorCode` / `standardsDiagnostic`. This made
 * `--strict-standards` observable-zero.
 *
 * Test approach: invoke the real `registerWorkflowCommands` against a fresh
 * `Command` program with the standard JSON-IO contract, then drive the
 * program via `program.parse([...])` exactly as the CLI entry does. This
 * exercises the full CLI surface (option parsing → workspace context → RD
 * service → exit code) without monkey-patching.
 *
 * Hard contract: temp project uses `os.tmpdir()` + `mkdtempSync`.
 * NEVER touches /Users/yuanyuan/Desktop/test/platform-rag-web.
 */
import { Command } from 'commander';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { registerWorkflowCommands } from '../../../src/cli/commands/workflow-commands.js';
import { EPEAKS_NO_STANDARDS } from '../../../src/services/rd/standards-diagnostic.js';
import type { ProgramIO } from '../../../src/cli/cli-helpers.js';

function captureIO(): { io: ProgramIO; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: ProgramIO = {
    stdout: (chunk: string) => { stdout.push(chunk); },
    stderr: (chunk: string) => { stderr.push(chunk); },
  };
  return { io, stdout, stderr };
}

function buildSwarmProgram(io: ProgramIO): Command {
  const program = new Command();
  program
    .name('peaks')
    .exitOverride() // throw instead of process.exit during parse errors
    .configureOutput({ writeOut: (s) => io.stdout(s), writeErr: (s) => io.stderr(s) });
  registerWorkflowCommands(program, io);
  return program;
}

describe('RD#4 repair cycle 2 — CLI workspace context threads projectRoot', () => {
  let projectRoot: string;
  const originalCwd = process.cwd();
  const originalExitCode = process.exitCode;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'rd4-repair-r2-'));
    // cd into the empty project so getWorkflowWorkspaceContext() sees
    // it as the project root via findProjectRoot.
    process.chdir(projectRoot);
    process.exitCode = 0;
  });

  afterEach(() => {
    process.chdir(originalCwd);
    process.exitCode = originalExitCode;
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('strict-standards CLI flag surfaces EPEAKS_NO_STANDARDS in JSON envelope + exits non-zero', async () => {
    const { io, stdout } = captureIO();
    const program = buildSwarmProgram(io);
    // The swarm plan handler is async (it pre-builds peaks-context via
    // ensureContextForRd). `program.parse()` returns synchronously and
    // does NOT await the action's returned promise, so stdout is empty
    // when read immediately after `parse()` returns. Use `parseAsync`
    // so the test actually waits for the JSON envelope to land.
    await program.parseAsync([
      'node', 'peaks', 'swarm', 'plan',
      '--skill', 'rd',
      '--change-id', '2026-06-16-peaks-rd-no-gates',
      '--goal', 'rd-repair-cycle-2-cli-wiring',
      '--strict-standards',
      '--json',
    ]);

    const envelope = JSON.parse(stdout.join(''));
    expect(envelope.data.gateStatus.standardsErrorCode).toBe('EPEAKS_NO_STANDARDS');
    expect(envelope.data.gateStatus.standardsDiagnostic).toBeTypeOf('string');
    expect(process.exitCode).toBe(1);

    // Sanity: the diagnostic surfaces the actual project root (proves projectRoot
    // was threaded through, not stubbed or hardcoded).
    expect(envelope.data.gateStatus.standardsDiagnostic).toContain(projectRoot);
  });

  test('omitted --strict-standards: warn-and-continue (no error code, exit 0)', async () => {
    const { io, stdout } = captureIO();
    const program = buildSwarmProgram(io);
    // See note above — must await async action via `parseAsync`.
    await program.parseAsync([
      'node', 'peaks', 'swarm', 'plan',
      '--skill', 'rd',
      '--change-id', '2026-06-16-peaks-rd-no-gates',
      '--goal', 'rd-repair-cycle-2-cli-wiring-warn-continue',
      '--json',
    ]);

    const envelope = JSON.parse(stdout.join(''));
    // Diagnostic present (warn-and-continue) but error code absent.
    expect(envelope.data.gateStatus.standardsDiagnostic).toBeTypeOf('string');
    expect(envelope.data.gateStatus.standardsErrorCode).toBeUndefined();
    expect(process.exitCode).toBe(0);
  });

  test('CRITICAL guard: temp dir is NOT the dogfood project', () => {
    expect(projectRoot).not.toContain('platform-rag-web');
    expect(projectRoot.startsWith(tmpdir())).toBe(true);
  });

  test('EPEAKS_NO_STANDARDS contract value is stable', () => {
    expect(EPEAKS_NO_STANDARDS).toBe('EPEAKS_NO_STANDARDS');
  });
});
