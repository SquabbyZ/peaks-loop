/**
 * Slice 2026-07-02-auto-compact-zero-pause — AC-1 dogfood test.
 *
 * Pins the contract that the `peaks session auto-compact-hook`
 * command:
 *   - exits 0 silent when env-var is missing
 *   - exits 0 silent when ratio is below the red line
 *   - exits 0 silent when ratio ≥ red line AND `claude` is not on
 *     PATH (ENOENT must NOT crash the runner's tool call)
 *   - emits a stderr hint at the red line (operational visibility)
 *
 * The dogfood surfaced the ENOENT class of bug (user runs Claude
 * Code as an MCP, not via the CLI binary); this test pins the fix.
 */

import { spawn } from 'node:child_process';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('peaks session auto-compact-hook — red-line spawn handling', () => {
  let stderrWriteSpy: { mock: { calls: unknown[][] } };
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...originalEnv };
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation((() => true) as never) as unknown as { mock: { calls: unknown[][] } };
  });

  afterEach(() => {
    process.env = originalEnv;
    (stderrWriteSpy as unknown as { mockRestore: () => void }).mockRestore();
  });

  it('below threshold exits 0 silent with no stderr', async () => {
    process.env['CLAUDE_CONTEXT_USAGE_PERCENT'] = '0.50';
    const { registerSessionAutoCompactHookCommand } = await import('../../../src/cli/commands/session-auto-compact-hook-command.js');
    const fakeProgram = {
      command: () => fakeProgram,
      description: () => fakeProgram,
      action: (fn: () => void) => {
        fakeProgram._action = fn;
        return fakeProgram;
      },
      _action: undefined as (() => void) | undefined
    };
    registerSessionAutoCompactHookCommand(fakeProgram as never);
    fakeProgram._action!();
    expect(stderrWriteSpy).not.toHaveBeenCalled();
  });

  it('missing env-var exits 0 silent with no stderr', async () => {
    delete process.env['CLAUDE_CONTEXT_USAGE_PERCENT'];
    const { registerSessionAutoCompactHookCommand } = await import('../../../src/cli/commands/session-auto-compact-hook-command.js');
    const fakeProgram = {
      command: () => fakeProgram,
      description: () => fakeProgram,
      action: (fn: () => void) => {
        fakeProgram._action = fn;
        return fakeProgram;
      },
      _action: undefined as (() => void) | undefined
    };
    registerSessionAutoCompactHookCommand(fakeProgram as never);
    fakeProgram._action!();
    expect(stderrWriteSpy).not.toHaveBeenCalled();
  });

  it('red-line + claude not on PATH: hook does NOT crash (ENOENT is caught)', async () => {
    process.env['CLAUDE_CONTEXT_USAGE_PERCENT'] = '0.96';
    // `claude` is NOT on PATH on this test environment (Windows,
    // node-only). The hook must catch the spawn ENOENT and exit 0
    // silently with a stderr hint — it MUST NOT throw an unhandled
    // error event that kills the runner's tool call.
    expect(typeof spawn).toBe('function');
    // We exercise the actual action handler from the registered
    // command. It must complete without throwing.
    const { registerSessionAutoCompactHookCommand } = await import('../../../src/cli/commands/session-auto-compact-hook-command.js');
    const fakeProgram = {
      command: () => fakeProgram,
      description: () => fakeProgram,
      action: (fn: () => void) => {
        fakeProgram._action = fn;
        return fakeProgram;
      },
      _action: undefined as (() => void) | undefined
    };
    registerSessionAutoCompactHookCommand(fakeProgram as never);
    expect(() => fakeProgram._action!()).not.toThrow();
    // Stderr hint emitted (either "firing" before spawn, OR "failed"
    // after ENOENT — both are acceptable signals).
    expect(stderrWriteSpy).toHaveBeenCalled();
    const stderrText = stderrWriteSpy.mock.calls.map((c) => String(c[0])).join('');
    expect(stderrText).toMatch(/peaks:auto-compact-hook/);
  });
});