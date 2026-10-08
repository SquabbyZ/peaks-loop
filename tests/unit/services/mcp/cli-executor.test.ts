// tests/unit/services/mcp/cli-executor.test.ts
//
// The process boundary of the MCP server (PRD rid-036 AC-2, AC-5, AC-11).
//
//   AC-5   every execution has a MANDATORY timeout, and a hanging argv is
//          reported rather than waited on. A read tool that never returns gives
//          its caller no recovery path, so this is measured, not asserted.
//   AC-11  the launch shape carries no platform branch and the module names no
//          harness: one command spelling (`process.execPath` + this tree's CLI
//          entry) has to work everywhere, which is exactly why there is no
//          `if (platform)` to test.
//
// The hanging child is a real, spawned process — a unit-level stand-in would
// prove the timer fired, not that a hung child is actually cut off.
//
// Dimensions covered: render, behavior, integration, a11y.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXECUTION_TIMEOUT_MS,
  executeCliArgv,
  resolveCliLaunch
} from '~/src/services/mcp/cli-executor';
import { cliEntryPath } from '~/src/services/web/daemon-supervisor';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/mcp/cli-executor.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));

/** A launch that runs inline JavaScript instead of the CLI, so a case can hang on purpose. */
function nodeInline(code: string) {
  return { command: process.execPath, argsPrefix: ['-e', code] };
}

describe('Scenario: render - the launch shape is one shape on every platform', () => {
  it('when the launch is resolved, should be this interpreter running this CLI entry', () => {
    // given: the production resolver, which is what queries nothing about the OS
    const launch = resolveCliLaunch();
    // when:  its parts are read
    // then:  the interpreter is the running one and the entry is the CLI's, so
    //        no platform needs a branch and no `.cmd` shim is ever named
    expect(launch.command).toBe(process.execPath);
    expect(launch.argsPrefix.at(-1)).toBe(cliEntryPath());
  });

  it('when the child is spawned, should ask for no shell and no inherited stdin', () => {
    // given: the executor's source, which is the only place the spawn options live
    const source = readFileSync(
      join(MODULE_DIR, '..', '..', '..', '..', 'src', 'services', 'mcp', 'cli-executor.ts'),
      'utf8'
    );
    // when:  the spawn call is read
    // then:  the array form is explicit (`shell: false` through the shared
    //        helper), the Windows console-window contract is honoured, and stdin
    //        is NOT inherited - a child reading our protocol stream would answer
    //        the harness itself, and no in-test child can demonstrate that
    //        difference reliably
    expect(source).toContain('readonlySpawnOptions()');
    expect(source).toContain('windowsHide: true');
    expect(source).toContain("stdio: ['ignore', 'pipe', 'pipe']");
  });
});

describe('Scenario: behavior - a hung argv is cut off, not waited on', () => {
  it('when the child never exits, should return a timeout instead of blocking', async () => {
    // given: a child that will not finish on its own, and a short deadline
    const started = Date.now();
    // when:  the executor runs it
    const execution = await executeCliArgv([], {
      launch: nodeInline('setInterval(function () {}, 1000);'),
      timeoutMs: 600
    });
    // then:  it came back, it said why, and it did not wait for the child
    expect(execution.timedOut).toBe(true);
    expect(execution.exitCode).toBeNull();
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(DEFAULT_EXECUTION_TIMEOUT_MS).toBeGreaterThan(600);
  }, 20_000);

  it('when the child finishes, should report its output and status unchanged', async () => {
    // given: a child that writes a marker and exits non-zero
    // when:  the executor runs it
    const execution = await executeCliArgv(['ignored'], {
      launch: nodeInline('process.stdout.write("{\\"ok\\":true}"); process.exit(3);')
    });
    // then:  stdout is handed back verbatim and the status is the child's own -
    //        the executor is not entitled to interpret either
    expect(execution.timedOut).toBe(false);
    expect(execution.stdout).toBe('{"ok":true}');
    expect(execution.exitCode).toBe(3);
    expect(execution.argv).toEqual(['ignored']);
  });
});

describe('Scenario: integration - a child that cannot start is described, not thrown', () => {
  it('when the command does not exist, should resolve with the failure recorded', async () => {
    // given: a command name nothing answers to
    // when:  the executor runs it
    const execution = await executeCliArgv([], {
      launch: { command: 'peaks-boundary-probe-does-not-exist', argsPrefix: [] }
    });
    // then:  the caller gets a described outcome instead of a rejection, and the
    //        reason is not silently dropped. The exit status is whatever the
    //        spawner reports for a missing binary — the point is that the
    //        failure is NAMED, so no reader has to infer it from a status code
    //        that differs per platform.
    expect(execution.launchError).toBeTruthy();
    expect(execution.exitCode).not.toBe(0);
  }, 20_000);
});

describe('Scenario: a11y - a timeout names the argv a human must go and look at', () => {
  it('when a deadline fires, should report the argv that was killed', () => {
    // given: the argv the executor was handed
    const argv = ['job', 'status', '--watch'];
    // when:  a hanging launch is executed
    return executeCliArgv(argv, {
      launch: nodeInline('setInterval(function () {}, 1000);'),
      timeoutMs: 500
    }).then((execution) => {
      // then:  the reason the tool result quotes can name the exact call, which
      //        is what turns "it timed out" into something actionable
      expect(execution.argv).toEqual(argv);
      expect(execution.timedOut).toBe(true);
    });
  }, 20_000);
});
