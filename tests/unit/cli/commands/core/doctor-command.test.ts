import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProgramIO } from '../../../../../src/cli/cli-helpers.js';

// v2.18.2 cycle 2: these tests guard the two QA blockers returned by
// peaks-qa for the v2.18.2 doctor release:
//
//   Blocker 1 — `peaks doctor --rebuild-binding --project .` must
//     accept `--project <path>` and resolve the projectRoot from it
//     (verified end-to-end via the action handler's `options.project`
//     branch). Previously the option was missing on the doctor command.
//
//   Blocker 2 — `peaks doctor --rebuild-binding --cleanup-stale` must
//     hard-reject with CONFLICTING_FLAGS (Q2 arbitration). Previously
//     it silently short-circuited through the rebuild branch and
//     dropped `--cleanup-stale` without a warning.
//
// The handlers are exercised via the same `runRegisteredCommand`
// harness used by tests/unit/cli-command-branches.test.ts so we don't
// need to spawn a child Node process. `findProjectRoot` and
// `rebuildBindingFromLegacy` are mocked so the test does not depend
// on the real .peaks/_runtime/session.json on disk.

const branchState = vi.hoisted(() => ({
  findProjectRoot: vi.fn(),
  rebuildBindingFromLegacy: vi.fn(),
  readBinding: vi.fn()
}));

vi.mock('../../../../../src/services/config/config-safety.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/services/config/config-safety.js')>();
  return {
    ...actual,
    findProjectRoot: branchState.findProjectRoot
  };
});

vi.mock('../../../../../src/services/session/binding-store.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../../src/services/session/binding-store.js')>();
  return {
    ...actual,
    rebuildBindingFromLegacy: branchState.rebuildBindingFromLegacy,
    // readBinding is also exported from binding-store; the doctor
    // command's listStaleInstances path uses it indirectly. We mock it
    // to a safe empty-payload shape so non-rebuild-bound tests don't
    // touch the real binding file.
    readBinding: branchState.readBinding
  };
});

function createHarness(register: (program: Command, io: ProgramIO) => void) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const program = new Command();
  program.exitOverride();
  register(program, { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) });
  return { program, stdout, stderr };
}

async function runRegisteredCommand(register: (program: Command, io: ProgramIO) => void, args: string[]) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  const harness = createHarness(register);
  await harness.program.parseAsync(['node', 'peaks', ...args], { from: 'node' });
  const exitCode = process.exitCode;
  process.exitCode = previousExitCode;
  return { ...harness, exitCode };
}

function parseJsonOutput(stdout: string[]): {
  ok: boolean;
  command: string;
  code?: string;
  message?: string;
  data?: { projectRoot?: string; rebuildBinding?: boolean; cleanupStale?: boolean };
} {
  return JSON.parse(stdout.join('\n')) as ReturnType<typeof parseJsonOutput>;
}

describe('registerDoctorCommand — v2.18.2 cycle 2 blockers', () => {
  beforeEach(() => {
    branchState.findProjectRoot.mockReset();
    branchState.rebuildBindingFromLegacy.mockReset();
    branchState.readBinding.mockReset();
    // Default: no live binding on disk; non-rebuild path can scan an
    // empty listStaleInstances scope without crashing.
    branchState.readBinding.mockReturnValue(null);
    // Default: rebuildBindingFromLegacy returns a noop result so
    // the rebuild branch is safe to invoke with no real binding file.
    branchState.rebuildBindingFromLegacy.mockReturnValue({
      rewritten: 0,
      preserved: 0,
      errors: [],
      noop: true
    });
  });

  afterEach(() => {
    // ensure nothing leaks into subsequent tests
    process.exitCode = undefined;
  });

  // ---------------------------------------------------------------------
  // Blocker 1: --project flag is accepted and overrides findProjectRoot
  // ---------------------------------------------------------------------

  test('accepts --project and passes it through to rebuildBindingFromLegacy (--rebuild-binding --project . --json)', async () => {
    const { registerDoctorCommand } = await import('../../../../../src/cli/commands/core/doctor-command.js');

    const harness = await runRegisteredCommand(registerDoctorCommand, [
      'doctor',
      '--rebuild-binding',
      '--project',
      '.',
      '--json'
    ]);

    // The mocked rebuildBindingFromLegacy should have been called
    // with the value of --project verbatim, NOT with the findProjectRoot(cwd) fallback.
    expect(branchState.findProjectRoot).not.toHaveBeenCalled();
    expect(branchState.rebuildBindingFromLegacy).toHaveBeenCalledTimes(1);
    expect(branchState.rebuildBindingFromLegacy).toHaveBeenCalledWith('.');

    // The envelope echoes projectRoot in its data payload (verified at
    // doctor-command.ts:118).
    const output = parseJsonOutput(harness.stdout);
    expect(output.command).toBe('doctor.rebuild-binding');
    expect(output.ok).toBe(true);
    expect(output.data?.projectRoot).toBe('.');
  });

  test('accepts --project for an arbitrary non-current path and does NOT call findProjectRoot (--rebuild-binding --project /tmp/other --json)', async () => {
    const { registerDoctorCommand } = await import('../../../../../src/cli/commands/core/doctor-command.js');

    const harness = await runRegisteredCommand(registerDoctorCommand, [
      'doctor',
      '--rebuild-binding',
      '--project',
      '/tmp/other-project',
      '--json'
    ]);

    expect(branchState.findProjectRoot).not.toHaveBeenCalled();
    expect(branchState.rebuildBindingFromLegacy).toHaveBeenCalledWith('/tmp/other-project');

    const output = parseJsonOutput(harness.stdout);
    expect(output.data?.projectRoot).toBe('/tmp/other-project');
  });

  // ---------------------------------------------------------------------
  // Blocker 2: --rebuild-binding + --cleanup-stale mutual exclusion
  // ---------------------------------------------------------------------

  test('rejects --rebuild-binding + --cleanup-stale with CONFLICTING_FLAGS and exit 1', async () => {
    const { registerDoctorCommand } = await import('../../../../../src/cli/commands/core/doctor-command.js');

    const harness = await runRegisteredCommand(registerDoctorCommand, [
      'doctor',
      '--rebuild-binding',
      '--cleanup-stale',
      '--json'
    ]);

    // Neither downstream mutator should have been invoked — the
    // handler rejects the combination BEFORE running either.
    expect(branchState.rebuildBindingFromLegacy).not.toHaveBeenCalled();
    expect(branchState.readBinding).not.toHaveBeenCalled();

    expect(harness.exitCode).toBe(1);

    const output = parseJsonOutput(harness.stdout);
    expect(output.ok).toBe(false);
    expect(output.command).toBe('doctor.rebuild-binding');
    expect(output.code).toBe('CONFLICTING_FLAGS');
    expect(output.message).toContain('mutually exclusive');
    expect(output.data?.rebuildBinding).toBe(true);
    expect(output.data?.cleanupStale).toBe(true);
  });

  test('allows --rebuild-binding alone (no conflict) and runs the rebuild branch', async () => {
    const { registerDoctorCommand } = await import('../../../../../src/cli/commands/core/doctor-command.js');

    const harness = await runRegisteredCommand(registerDoctorCommand, [
      'doctor',
      '--rebuild-binding',
      '--json'
    ]);

    expect(branchState.rebuildBindingFromLegacy).toHaveBeenCalledTimes(1);
    // No conflict, no exit 1 from the guard.
    expect(harness.exitCode).not.toBe(1);

    const output = parseJsonOutput(harness.stdout);
    expect(output.command).toBe('doctor.rebuild-binding');
  });

  test('allows --cleanup-stale alone (no conflict) — drops stale entries without invoking rebuild', async () => {
    const { registerDoctorCommand } = await import('../../../../../src/cli/commands/core/doctor-command.js');

    // --cleanup-stale alone runs the doctor surface AND the
    // dropStale path. We only need to verify the rebuild branch
    // is not invoked and the conflict guard did NOT reject the call.
    const harness = await runRegisteredCommand(registerDoctorCommand, [
      'doctor',
      '--cleanup-stale',
      '--json'
    ]);

    expect(branchState.rebuildBindingFromLegacy).not.toHaveBeenCalled();

    // Should NOT carry the CONFLICTING_FLAGS code.
    const output = parseJsonOutput(harness.stdout);
    expect(output.code).not.toBe('CONFLICTING_FLAGS');
  });
});
