// tests/integration/workspace-session-start-primer.test.ts
//
// Slice rid-statusline-stale-ux AC-2 — verify the new
// `peaks session primer` subcommand behaviour end-to-end.
//
// Tests:
//   1. Empty / whitespace-only --project triggers fail-closed
//      (PRIMER_EMPTY_PROJECT, exit 1).
//   2. NUL byte in --project triggers InvalidProjectRootError.
//   3. Commander registration: 'session primer' is a CHILD of the
//      'session' group (verified pattern at core/session-command.ts:32;
//      NOT a single literal `session primer` command).
//
// Run with:
//   pnpm vitest run --config vitest.config.integration.ts tests/integration/workspace-session-start-primer.test.ts

import { describe, expect, it } from 'vitest';
import { Command } from 'commander';

import {
  registerPrimerCommand,
  runPrimerAction
} from '~/src/cli/commands/primer-command';

function makeStdio(): { stdout: (s: string) => void; stderr: (s: string) => void } {
  return { stdout: (): void => {}, stderr: (): void => {} };
}

describe("workspace-session-start-primer — `peaks session primer` subcommand", () => {
  it("rejects empty --project (fail-closed, PRIMER_EMPTY_PROJECT)", async () => {
    const result = await runPrimerAction({ project: '' }, makeStdio());
    expect(result.exitCode).toBe(1);
  });

  it("rejects whitespace-only --project (fail-closed)", async () => {
    const result = await runPrimerAction({ project: '   ' }, makeStdio());
    expect(result.exitCode).toBe(1);
  });

  it("NUL byte in --project triggers InvalidProjectRootError (PRIMER_INVALID_PROJECT_ROOT_NUL_BYTE)", async () => {
    const result = await runPrimerAction({ project: 'foo\0bar' }, makeStdio());
    expect(result.exitCode).toBe(1);
  });

  it("commander registration: 'session primer' is a CHILD of the 'session' group (M-4 fix)", () => {
    const program = new Command();
    const io = makeStdio();
    registerPrimerCommand(program, io);
    // The 'session' command itself must exist as a top-level group.
    const sessionCmd = program.commands.find((c) => c.name() === 'session');
    expect(sessionCmd).toBeDefined();
    // 'primer' must be a CHILD of that group, NOT a literal
    // `session primer` top-level command.
    const primerCmd = sessionCmd?.commands.find((c) => c.name() === 'primer');
    expect(primerCmd).toBeDefined();
    expect(primerCmd?.name()).toBe('primer');
    // There must NOT be a top-level command literally named 'session primer'.
    const literalTop = program.commands.find((c) => c.name() === 'session primer');
    expect(literalTop).toBeUndefined();
  });
});
