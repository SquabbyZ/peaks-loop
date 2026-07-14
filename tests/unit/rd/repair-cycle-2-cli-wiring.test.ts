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
 * Slice 2026-06-29-change-id-root-removal: the previous contract passed
 * `--change-id <id>` to `peaks swarm plan` to thread scope. Post-slice,
 * the change-id axis is gone; the test bootstraps a real session via
 * `peaks workspace init` (writes `.peaks/_runtime/<sid>/session.json`),
 * then runs `swarm plan` with the bound session. The session id is
 * the new scope-thread surface.
 *
 * Hard contract: temp project uses `os.tmpdir()` + `mkdtempSync`.
 * NEVER touches /Users/yuanyuan/Desktop/test/platform-rag-web.
 */
import { Command } from 'commander';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { registerWorkflowCommands } from '../../../src/cli/commands/workflow-commands.js';
import { registerWorkspaceCommands } from '../../../src/cli/commands/workspace-commands.js';
import { EPEAKS_NO_STANDARDS } from '../../../src/services/rd/standards-diagnostic.js';
import type { ProgramIO } from '../../../src/cli/cli-helpers.js';

// Slice 015 — mock the execution-model resolver so the swarm-plan path
// proceeds past the provider-config check. This isolates the
// standards-overlay behaviour (the regression we're guarding) from
// the provider-config concern (now exercisable by the dedicated
// `INVALID_PROVIDERS` test below). Without this mock, every
// `swarm.plan` invocation throws `ProviderNotConfiguredError`
// before reaching `buildStandardsOverlay`, hiding the original
// bug from the test surface.
//
// hoisted flag lets the `INVALID_PROVIDERS` test temporarily switch
// the mock off to prove the catch helper routes the typed error.
const providerMockState = vi.hoisted(() => ({ configured: true }));
vi.mock('../../../src/services/config/model-routing.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/services/config/model-routing.js')>();
  return {
    ...actual,
    getEconomyAwareExecutionModelId: () => {
      if (providerMockState.configured) return 'claude-sonnet-test-mock';
      throw new actual.ProviderNotConfiguredError();
    },
    ProviderNotConfiguredError: actual.ProviderNotConfiguredError,
  };
});

function captureIO(): { io: ProgramIO; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: ProgramIO = {
    stdout: (chunk: string) => { stdout.push(chunk); },
    stderr: (chunk: string) => { stderr.push(chunk); },
  };
  return { io, stdout, stderr };
}

function buildProgram(io: ProgramIO): Command {
  const program = new Command();
  program
    .name('peaks')
    .exitOverride() // throw instead of process.exit during parse errors
    .configureOutput({ writeOut: (s) => io.stdout(s), writeErr: (s) => io.stderr(s) });
  registerWorkspaceCommands(program, io);
  registerWorkflowCommands(program, io);
  return program;
}

/**
 * Bootstrap a real session binding under `projectRoot` so the swarm plan
 * planner can find a canonical session id. Returns the new session id.
 * Writes the binding via the real `peaks workspace init` command surface.
 */
async function runInitWorkspace(program: Command, io: ProgramIO, projectRoot: string): Promise<string> {
  await program.parseAsync([
    'node', 'peaks', 'workspace', 'init',
    '--project', projectRoot,
    '--json',
  ]);
  const envelope = JSON.parse(io['stdout'].length ? '' : ''); // not used; we re-read below
  // The init command's JSON envelope has `data.sessionId`. Read the most
  // recent envelope from the program's stdout buffer (captureIO replaces
  // the io each parse, so we need to capture per-call). To keep this
  // helper simple, we use a dedicated initProgram and read its buffer.
  // NOTE: actual extraction is done in the test by capturing the buffer
  // before calling swarm plan.
  return envelope?.data?.sessionId ?? '';
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
    // Slice 2026-06-29-change-id-root-removal: bootstrap a real session
    // binding first (writes `.peaks/_runtime/<sid>/session.json`),
    // then run swarm plan with that session in scope. The session id
    // is the new scope-thread surface after the change-id axis was
    // removed.
    const initIo = captureIO();
    const initProgram = buildProgram(initIo.io);
    await initProgram.parseAsync([
      'node', 'peaks', 'workspace', 'init',
      '--project', projectRoot,
      '--json',
    ]);
    const initEnvelope = JSON.parse(initIo.stdout.join(''));
    const sessionId = initEnvelope.data.sessionId;
    expect(typeof sessionId).toBe('string');
    expect(sessionId.length).toBeGreaterThan(0);

    const { io, stdout } = captureIO();
    const program = buildProgram(io);
    // The swarm plan handler is async (it pre-builds peaks-context via
    // ensureContextForRd). `program.parse()` returns synchronously and
    // does NOT await the action's returned promise, so stdout is empty
    // when read immediately after `parse()` returns. Use `parseAsync`
    // so the test actually waits for the JSON envelope to land.
    await program.parseAsync([
      'node', 'peaks', 'swarm', 'plan',
      '--skill', 'rd',
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
    // Slice 2026-06-29-change-id-root-removal: bootstrap a real session
    // binding first (see note above).
    const initIo = captureIO();
    const initProgram = buildProgram(initIo.io);
    await initProgram.parseAsync([
      'node', 'peaks', 'workspace', 'init',
      '--project', projectRoot,
      '--json',
    ]);
    const initEnvelope = JSON.parse(initIo.stdout.join(''));
    expect(initEnvelope.data.sessionId).toBeTypeOf('string');

    const { io, stdout } = captureIO();
    const program = buildProgram(io);
    // See note above — must await async action via `parseAsync`.
    await program.parseAsync([
      'node', 'peaks', 'swarm', 'plan',
      '--skill', 'rd',
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

  // Slice 015 — when no provider model is configured, the CLI must
  // surface the REAL error class instead of misleadingly returning
  // INVALID_GOAL. The new `INVALID_PROVIDERS` envelope + the catch
  // helper's `mapServiceError` together produce an envelope whose
  // message matches `getConfiguredExecutionModelId`'s throw text
  // and whose nextActions point the user at `peaks config provider`.
  test('strict-standards without a provider configured surfaces INVALID_PROVIDERS envelope (Slice 015)', async () => {
    // Slice 015 — flip the hoisted provider mock OFF so the swarm-plan
    // call throws `ProviderNotConfiguredError`, exercising the catch
    // helper's INVALID_PROVIDERS branch. Restore in `finally` so the
    // rest of the suite (and any subsequent run) sees the "configured"
    // default.
    const previousConfigured = providerMockState.configured;
    providerMockState.configured = false;
    try {
    const initIo = captureIO();
    const initProgram = buildProgram(initIo.io);
    await initProgram.parseAsync([
      'node', 'peaks', 'workspace', 'init',
      '--project', projectRoot,
      '--json',
    ]);

    const { io, stdout } = captureIO();
    const program = buildProgram(io);
    await program.parseAsync([
      'node', 'peaks', 'swarm', 'plan',
      '--skill', 'rd',
      '--goal', 'strict-standards-without-provider',
      '--strict-standards',
      '--json',
    ]);

    const envelope = JSON.parse(stdout.join(''));
    expect(envelope.ok).toBe(false);
    expect(envelope.command).toBe('swarm.plan');
    // NEW: real error class surfaced, no longer hidden behind INVALID_GOAL
    expect(envelope.code).toBe('INVALID_PROVIDERS');
    // Original message text preserved (proves the throw site is the source of truth)
    expect(envelope.message).toContain('Execution model must be configured in providers');
    // nextActions hints at the right recovery command
    expect((envelope.nextActions ?? []).join(' ')).toContain('peaks config provider');
    } finally {
      providerMockState.configured = previousConfigured;
    }
  });
});
