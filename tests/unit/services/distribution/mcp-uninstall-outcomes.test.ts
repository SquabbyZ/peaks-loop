// tests/unit/services/distribution/mcp-uninstall-outcomes.test.ts
//
// PRD rid-044: the REMOVAL sweep must tell "nothing was there" from "never
// answered". The engine's own suite (`mcp-install.test.ts`) covers rid-037; this
// file owns the defect that PRD rid-044 fixes, and it lives apart so neither file
// crosses the test-size cap.
//
// THE ONE DESIGN CONSTRAINT. No harness's stdout/stderr is ever parsed — the
// boundary is not "what did it say" but "did it render a verdict at all":
//   exit 0            → it removed            → `removed`
//   exit != 0         → it answered "no"      → `absent`   (unchanged)
//   timeout / no spawn → it never answered    → `unknown`  (this file's subject)
// The third bucket must not be reported as absence, and it makes `ok` false.
//
// Dimensions covered: behavior, integration. render/a11y are the surface
// `mcp-install.test.ts` already asserts, and this slice changes neither field name
// nor the `--json` envelope shape.

import { describe, expect, it } from 'vitest';

import {
  resolveMcpServerArgv,
  runMcpUninstallPlan,
  spawnMcpInstallRunner,
  type McpInstallCommand,
  type McpInstallOutcome,
  type McpInstallRunner
} from '~/src/services/distribution/mcp-install';
import type { IdeMcpInstallProfile } from '~/src/services/ide/ide-mcp-install-types';

// An INVENTED harness — no real harness is named anywhere in this file.
const HARNESS = 'harness-under-test';

function profile(overrides: Partial<IdeMcpInstallProfile> = {}): IdeMcpInstallProfile {
  return {
    serverName: HARNESS,
    scopes: ['one', 'two'],
    targetScope: 'two',
    addArgv: ['bin', 'register', '<name>', '--scope', '<scope>', '--', '<server-argv>'],
    removeArgv: ['bin', 'unregister', '<name>', '--scope', '<scope>'],
    ...overrides
  };
}

/** A runner that answers every command by the rule given. */
function answeringRunner(
  answer: (command: McpInstallCommand) => McpInstallOutcome
): McpInstallRunner {
  return (command) => answer(command);
}

const ONE_SCOPE = profile({ scopes: ['one'], targetScope: 'one' });
const SERVER_ARGV = resolveMcpServerArgv();

describe('Scenario: behavior - the sweep separates "nothing was there" from "never answered"', () => {
  it('when a removal is killed at the deadline, should report its scope unknown and the sweep not ok', () => {
    // given: a harness whose removal never answers — the runner reports no verdict
    // when:  the uninstall runs
    // then:  the scope is `unknown`, NOT `absent`, and `ok` is false, so a hung
    //        harness is never reported as "nothing was there" (AC-1)
    const runner = answeringRunner(() => ({
      ok: false,
      answered: false,
      detail: 'timed out after 30000 ms and was killed: harness'
    }));
    const report = runMcpUninstallPlan(ONE_SCOPE, SERVER_ARGV, runner);
    expect(report.unknown).toEqual(['one']);
    expect(report.absent).toEqual([]);
    expect(report.removed).toEqual([]);
    expect(report.ok).toBe(false);
    expect(report.detail).not.toContain('registration was present');
    expect(report.detail).toContain('unconfirmed');
  });

  it('when a removal never launches, should report its scope unknown too', () => {
    // given: a removal whose process cannot be spawned at all (ENOENT)
    // when:  the uninstall runs
    // then:  it is `unknown`, not `absent`, and `ok` is false (AC-2): "no verdict"
    //        is the boundary, and a launch failure is on the same side of it
    const runner = answeringRunner(() => ({
      ok: false,
      answered: false,
      detail: 'spawn harness ENOENT'
    }));
    const report = runMcpUninstallPlan(ONE_SCOPE, SERVER_ARGV, runner);
    expect(report.unknown).toEqual(['one']);
    expect(report.absent).toEqual([]);
    expect(report.ok).toBe(false);
  });

  it('when a removal exits zero, should report it removed and ok', () => {
    // given: a harness that performed the removal
    // when:  the uninstall runs
    // then:  the scope is `removed` and `ok` is true — the exit-0 judgement is
    //        untouched by this slice (AC-3)
    const report = runMcpUninstallPlan(
      ONE_SCOPE,
      SERVER_ARGV,
      answeringRunner(() => ({ ok: true, detail: '' }))
    );
    expect(report.removed).toEqual(['one']);
    expect(report.unknown).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('when a removal exits non-zero, should report it absent and still ok', () => {
    // given: a harness that answered "no such registration" — a verdict, not silence
    // when:  the uninstall runs
    // then:  the scope is `absent` and `ok` stays true: "there was nothing" is a
    //        success, and failing it would be the regression the PRD's R1 warns of
    const runner = answeringRunner(() => ({ ok: false, detail: 'no such server' }));
    const report = runMcpUninstallPlan(ONE_SCOPE, SERVER_ARGV, runner);
    expect(report.absent).toEqual(['one']);
    expect(report.unknown).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it('when one scope is removed and another never answers, should keep the removal and refuse ok', () => {
    // given: two scopes — one the harness removed, one it never answered for
    // when:  the uninstall runs
    // then:  the removed scope is kept, the silent one is `unknown`, and `ok` is
    //        false: a sweep whose other half is unknown is not a completed
    //        operation even though something WAS removed (rid-044 R3)
    const runner = answeringRunner((command) =>
      command.args.includes('one')
        ? { ok: true, detail: '' }
        : { ok: false, answered: false, detail: 'timed out' }
    );
    const report = runMcpUninstallPlan(profile(), SERVER_ARGV, runner);
    expect(report.removed).toEqual(['one']);
    expect(report.unknown).toEqual(['two']);
    expect(report.absent).toEqual([]);
    expect(report.ok).toBe(false);
  });
});

describe('Scenario: integration - a REAL harness that never answers is not reported absent', () => {
  // The production runner, a genuine spawned child, and the real deadline: the
  // end-to-end shape of the defect with no injected fake runner. `@slow` because
  // it waits `MCP_INSTALL_TIMEOUT_MS` out; the fast lane skips it.
  it('@slow when the production runner meets a hanging harness, should record the scope unknown', () => {
    // given: the production runner and a removal that will never exit on its own
    // when:  the uninstall runs (it waits out the real deadline)
    // then:  the scope is `unknown`, not `absent`, and `ok` is false — the harness
    //        was killed, so it rendered no verdict and never said "nothing was
    //        there" (AC-10)
    const hanging = profile({
      scopes: ['one'],
      targetScope: 'one',
      removeArgv: [
        process.execPath,
        '-e',
        'setInterval(function () {}, 1000);',
        '<name>',
        '<scope>'
      ]
    });
    const report = runMcpUninstallPlan(hanging, SERVER_ARGV, spawnMcpInstallRunner);
    expect(report.unknown).toEqual(['one']);
    expect(report.absent).toEqual([]);
    expect(report.removed).toEqual([]);
    expect(report.ok).toBe(false);
  }, 60_000);
});
