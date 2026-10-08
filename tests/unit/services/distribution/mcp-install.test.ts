// tests/unit/services/distribution/mcp-install.test.ts
//
// The vendor-neutral MCP registration engine (PRD rid-037 AC-4, AC-5, AC-6, AC-7,
// AC-10), plus the CLI surface that exposes it.
//
//   AC-4  an adapter with no `mcpInstall` profile is SKIPPED — not an error, not
//         a partial install. Asserted on the real registry, so the claim is
//         about the shipped adapters and not about a fixture.
//   AC-5  the install is SEMANTICALLY idempotent: two runs build the same argv in
//         the same order, and the removals precede the addition, because the
//         harness's own register verb is not idempotent and there is no `--force`
//         to fall back on. Asserted by running the plan twice and comparing what
//         the runner was handed — the registration CONTENT, not a step count.
//   AC-6  `uninstall` is an explicit command on the CLI, and it sweeps.
//   AC-7  the only key any argv names is the adapter's own server name.
//   AC-10 no branch on a harness or a platform name: proven by AC-10's own guard
//         (`mcp-vendor-neutrality.test.ts`, which this module was ADDED to) and
//         by the fixtures here, which use a harness that does not exist.
//
// THE CONCRETE REGISTRATION COMMAND IS NOT IN THIS FILE, on purpose (PRD R1):
// every fixture below declares its own invented harness, so no assertion is
// coupled to a real harness's spelling and none of them can be satisfied by
// copying one.
//
// Dimensions covered: render, behavior, integration, a11y.

import { describe, expect, it } from 'vitest';

import {
  MCP_INSTALL_TIMEOUT_MS,
  buildMcpInstallPlan,
  installMcpForAdapter,
  resolveMcpServerArgv,
  runMcpInstallPlan,
  runMcpUninstallPlan,
  spawnMcpInstallCommand,
  spawnMcpInstallRunner,
  uninstallMcpForAdapter,
  type McpInstallCommand,
  type McpInstallOutcome,
  type McpInstallRunner
} from '~/src/services/distribution/mcp-install';
import {
  assertMcpInstallProfile,
  type IdeMcpInstallProfile
} from '~/src/services/ide/ide-mcp-install-types';
import { listAdapters } from '~/src/services/ide/ide-registry';
import type { IdeAdapter } from '~/src/services/ide/ide-types';

// ---------------------------------------------------------------------------
// Fixtures. An INVENTED harness — no real harness is named anywhere in this file.
// ---------------------------------------------------------------------------

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

function adapterWith(install: IdeMcpInstallProfile | undefined): IdeAdapter {
  const adapter = listAdapters()[0];
  if (adapter === undefined) throw new Error('no adapter is registered');
  // `undefined` means "this adapter declares NO registration profile", so the
  // field is REMOVED from a real adapter rather than borrowed as-is. Slice ③
  // (rid-037) gave claude-code — the first registered adapter — a profile, and
  // the version of this fixture that returned the registry's first entry
  // untouched silently stopped exercising the skip arm while its own cases still
  // read as if it had.
  const { mcpInstall: ignored, ...withoutProfile } = adapter;
  void ignored;
  return install === undefined ? withoutProfile : { ...adapter, mcpInstall: install };
}

/** A runner that records every command and answers by the rule given. */
function recordingRunner(
  answer: (command: McpInstallCommand) => McpInstallOutcome = () => ({ ok: true, detail: '' })
): { runner: McpInstallRunner; calls: McpInstallCommand[] } {
  const calls: McpInstallCommand[] = [];
  return {
    calls,
    runner: (command) => {
      calls.push(command);
      return answer(command);
    }
  };
}

function commandsOf(calls: readonly McpInstallCommand[]): string[][] {
  return calls.map((call) => [call.command, ...call.args]);
}

const SERVER_ARGV = resolveMcpServerArgv();

describe('Scenario: render - the plan is one removal per scope, then the addition', () => {
  it('when the plan is built, should remove from every declared scope before adding', () => {
    // given: a profile declaring two scopes
    // when:  the plan is built
    // then:  the removals come first, in declaration order, and the add is last —
    //        the order IS the contract, because the harness fails on duplicates
    const plan = buildMcpInstallPlan(profile(), SERVER_ARGV);
    expect(plan.map((step) => `${step.operation}:${step.scope}`)).toEqual([
      'remove:one',
      'remove:two',
      'add:two'
    ]);
  });

  it('when the argv is expanded, should substitute values and never join them', () => {
    // given: a template whose server placeholder stands for a MULTI-token argv
    // when:  it is expanded
    // then:  the command is a bare executable and the rest is an array, with the
    //        server argv spliced in whole
    const added = buildMcpInstallPlan(profile(), SERVER_ARGV).at(-1);
    expect(added?.command).toEqual({
      command: 'bin',
      args: ['register', HARNESS, '--scope', 'two', '--', ...SERVER_ARGV]
    });
  });
});

describe('Scenario: behavior - semantic idempotency and the failure directions', () => {
  it('when the install runs twice, should hand the runner identical commands', () => {
    // given: a runner that succeeds, and the same profile
    // when:  the install runs twice
    // then:  both runs issue the same content in the same order, so the
    //        registration left behind is the same one — "semantically idempotent"
    //        is a claim about content, not about the second run doing nothing
    const first = recordingRunner();
    const second = recordingRunner();
    const a = runMcpInstallPlan(profile(), SERVER_ARGV, first.runner);
    const b = runMcpInstallPlan(profile(), SERVER_ARGV, second.runner);
    expect(commandsOf(first.calls)).toEqual(commandsOf(second.calls));
    expect(a.ok && b.ok).toBe(true);
    expect(first.calls).toHaveLength(3);
  });

  it('when a removal finds nothing, should tolerate it and still add', () => {
    // given: a runner whose removals fail (nothing was registered) and whose add succeeds
    // when:  the install runs
    // then:  the removals are recorded as absent, not as a failure, and the
    //        registration is still written
    const { runner } = recordingRunner((command) =>
      command.args.includes('unregister')
        ? { ok: false, detail: 'no such server' }
        : { ok: true, detail: '' }
    );
    const report = runMcpInstallPlan(profile(), SERVER_ARGV, runner);
    expect(report.absent).toEqual(['one', 'two']);
    expect(report.removed).toEqual([]);
    expect(report.added).toBe(true);
    expect(report.ok).toBe(true);
  });

  it('when only one scope held the entry, should report which scope it was', () => {
    // given: a removal that succeeds in one scope and fails in the other
    // when:  the install runs
    // then:  the report names the scope that actually held it
    const { runner } = recordingRunner((command) =>
      command.args.includes('one') ? { ok: true, detail: '' } : { ok: false, detail: 'absent' }
    );
    const report = runMcpInstallPlan(profile(), SERVER_ARGV, runner);
    expect(report.removed).toEqual(['one']);
    expect(report.absent).toEqual(['two']);
  });

  it('when the addition fails, should report failure rather than a partial success', () => {
    // given: removals that succeed and an add the harness rejects
    // when:  the install runs
    // then:  `ok` is false and the runner's own words are carried, so a caller
    //        cannot mistake a half-write for a registration
    const { runner } = recordingRunner((command) =>
      command.args.includes('register') ? { ok: false, detail: 'boom' } : { ok: true, detail: '' }
    );
    const report = runMcpInstallPlan(profile(), SERVER_ARGV, runner);
    expect(report.ok).toBe(false);
    expect(report.added).toBe(false);
    expect(report.detail).toContain('boom');
  });

  it('when uninstall runs, should sweep and never add', () => {
    // given: a runner that succeeds
    // when:  the uninstall runs
    // then:  only removals were issued, one per declared scope
    const { runner, calls } = recordingRunner();
    const report = runMcpUninstallPlan(profile(), SERVER_ARGV, runner);
    expect(calls.every((call) => call.args.includes('unregister'))).toBe(true);
    expect(calls).toHaveLength(2);
    expect(report.added).toBe(false);
    expect(report.ok).toBe(true);
  });

  it('when uninstall finds nothing, should say so instead of failing', () => {
    // given: an empty registry
    // when:  the uninstall runs
    // then:  it reports the absence in words a human can act on
    const { runner } = recordingRunner(() => ({ ok: false, detail: 'absent' }));
    expect(runMcpUninstallPlan(profile(), SERVER_ARGV, runner).detail).toContain(
      `'${HARNESS}' registration`
    );
  });

  it('when a profile cannot drive an install, should refuse it by name', () => {
    // given: four declarations, each broken in one way
    // when:  each is validated
    // then:  each is refused with the reason, so a bad adapter fails loudly
    //        instead of writing a registration that launches nothing
    expect(() => assertMcpInstallProfile(profile({ serverName: '' }))).toThrow(/serverName/);
    expect(() => assertMcpInstallProfile(profile({ scopes: [] }))).toThrow(/scopes is empty/);
    expect(() => assertMcpInstallProfile(profile({ targetScope: 'three' }))).toThrow(/targetScope/);
    expect(() =>
      assertMcpInstallProfile(
        profile({ addArgv: ['bin', 'register', '<name>', '--scope', '<scope>'] })
      )
    ).toThrow(/server-argv/);
  });
});

describe('Scenario: integration - the shipped adapters with no profile are skipped, and AC-7 is by construction', () => {
  it('when every registered adapter is installed for, should skip the ones with no profile', () => {
    // given: the real registry
    // when:  each adapter that declares no profile is installed for, with a
    //        runner that would fail loudly
    // then:  each reports `skipped` with the reason, the runner is never called,
    //        and nothing throws — the contract with an adapter that declares no
    //        registration entry is silence (AC-4)
    //
    // The population is split on the DECLARATION, not assumed. Slice ③
    // (rid-037) gave claude-code a profile, and the version of this arm that
    // installed for every adapter and asserted `skipped` for all of them could
    // only ever have been true while the registry had no declarer at all.
    const { runner, calls } = recordingRunner(() => {
      throw new Error('the runner must not be reached for an adapter with no profile');
    });
    const silent = listAdapters().filter((adapter) => adapter.mcpInstall === undefined);
    expect(silent.length, 'anti-vacuity: some adapter must declare no profile').toBeGreaterThan(0);
    for (const adapter of silent) {
      const result = installMcpForAdapter(adapter, SERVER_ARGV, runner);
      expect(result.skipped).toBe(true);
      if (result.skipped) expect(result.reason).toContain('mcpInstall');
    }
    expect(calls).toEqual([]);
  });

  it('when an adapter declares a profile, should register that adapter and nothing else', () => {
    // given: one adapter carrying a profile
    // when:  it is installed for
    // then:  it reports its own id and the runner saw exactly the plan
    const { runner, calls } = recordingRunner();
    const adapter = adapterWith(profile());
    const result = installMcpForAdapter(adapter, SERVER_ARGV, runner);
    expect(result.ideId).toBe(adapter.id);
    expect(result.skipped).toBe(false);
    expect(calls).toHaveLength(3);
  });

  it('when a registration is written, should name no key but the adapter server name', () => {
    // given: a profile whose server name is invented
    // when:  its argv is expanded
    // then:  every token is one of: a template literal the adapter declared, the
    //        server name, a declared scope, or the launched server argv — the
    //        engine has no OTHER identity in hand, which is what makes "only our
    //        own entry is touched" true by construction (AC-7) and not by care
    const declared = profile();
    const literals = new Set([...declared.addArgv, ...declared.removeArgv]);
    const allowed = new Set([...literals, declared.serverName, ...declared.scopes, ...SERVER_ARGV]);
    const plan = buildMcpInstallPlan(declared, SERVER_ARGV);
    expect(plan.length).toBeGreaterThan(0);
    for (const step of plan) {
      const tokens = [step.command.command, ...step.command.args];
      expect(tokens.filter((token) => !allowed.has(token))).toEqual([]);
      expect(tokens.filter((token) => token === declared.serverName)).toHaveLength(1);
    }
  });

  it('when the server argv is resolved, should name an interpreter and an entry, not a CLI shim', () => {
    // given: a resolution that must work on every platform
    // when:  the argv is read
    // then:  it is an array whose first token is an executable path and whose
    //        last two are the CLI's own subcommand — no shell, no joined string
    const argv = resolveMcpServerArgv();
    expect(argv.slice(-2)).toEqual(['mcp', 'serve']);
    expect(argv[0]).toBe(process.execPath);
  });

  it('when uninstall is asked for an adapter with no profile, should skip it too', () => {
    // given: an adapter with no profile
    // when:  the uninstall runs
    // then:  it is skipped for the same reason as the install, not failed
    const { runner } = recordingRunner();
    const result = uninstallMcpForAdapter(adapterWith(undefined), SERVER_ARGV, runner);
    expect(result.skipped).toBe(true);
  });
});

describe('Scenario: integration - a harness that does not return is cut off, not waited on', () => {
  // The stand-in is a REAL spawned child, the same shape `cli-executor.test.ts`
  // hangs on: a unit-level stub would prove the timer fired, not that a hung
  // child is actually killed.
  const HANGING: McpInstallCommand = {
    command: process.execPath,
    args: ['-e', 'setInterval(function () {}, 1000);']
  };
  const DEADLINE_MS = 600;

  it('when the harness never returns, should kill it and fail by naming the deadline', () => {
    // given: a command that will not exit on its own, and a short deadline
    const started = Date.now();
    // when:  the production spawner runs it
    const outcome = spawnMcpInstallCommand(HANGING, DEADLINE_MS);
    // then:  it came back, it failed, and the reason names the deadline AND the
    //        command — never a silent empty result and never a fake success.
    //        Drop the deadline and this arm does not fail, it HANGS; that is the
    //        defect the ceiling exists for, and why it is not optional.
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('timed out');
    expect(outcome.detail).toContain(`${DEADLINE_MS} ms`);
    expect(outcome.detail).toContain(HANGING.command);
    expect(Date.now() - started).toBeLessThan(10_000);
  }, 20_000);

  it('when a command outlives the deadline, should kill it rather than report its exit', () => {
    // given: a command that outlives the deadline but DOES exit on its own — and
    //        successfully — so this arm terminates even when no deadline is applied
    // when:  the production spawner runs it
    const outcome = spawnMcpInstallCommand(
      {
        command: process.execPath,
        args: ['-e', 'setTimeout(function () { process.exit(0); }, 3000);']
      },
      DEADLINE_MS
    );
    // then:  past the deadline the child is killed, so its success is never
    //        reported. This is the arm that goes red IF THE CEILING IS MISSING,
    //        and it goes red in bounded time — which is what makes it usable as
    //        the injected control for the arm above.
    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain('timed out');
  }, 20_000);

  it('when a command finishes inside the deadline, should report its outcome unchanged', () => {
    // given: two commands that exit at once, on the PRODUCTION runner (default
    //        deadline) — one clean, one with its own status and stderr
    // when:  each is run
    // then:  the clean one succeeds and the failing one carries the harness's own
    //        words, so neither arm above can be satisfied by a spawner that
    //        simply reports every command as a timeout
    const ran = spawnMcpInstallRunner({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("ok");']
    });
    const failed = spawnMcpInstallRunner({
      command: process.execPath,
      args: ['-e', 'process.stderr.write("no such server"); process.exit(3);']
    });
    expect(ran).toEqual({ ok: true, detail: '' });
    expect(failed.ok).toBe(false);
    expect(failed.detail).toContain('no such server');
  }, 20_000);

  it('when the deadline is read, should be bounded and above the one the arms watch', () => {
    // given: the production ceiling, which no caller passes in
    // when:  it is compared with the deadline the arms above use
    // then:  it is a finite number, generous enough for a real harness binary and
    //        far short of "forever" — the arms watch the real mechanism at a
    //        scale a suite can afford, not some other code path
    expect(Number.isFinite(MCP_INSTALL_TIMEOUT_MS)).toBe(true);
    expect(MCP_INSTALL_TIMEOUT_MS).toBeGreaterThan(DEADLINE_MS);
    expect(MCP_INSTALL_TIMEOUT_MS).toBeLessThanOrEqual(120_000);
  });
});

describe('Scenario: a11y - the report is a sentence a human can act on', () => {
  it('when the addition is refused by the harness, should carry the harness words', () => {
    // given: a harness whose own error is the only useful diagnosis
    // when:  the install runs
    // then:  the report repeats it, prefixed so the reader knows what failed
    const { runner } = recordingRunner((command) =>
      command.args.includes('register')
        ? { ok: false, detail: 'server already exists' }
        : { ok: true, detail: '' }
    );
    const report = runMcpInstallPlan(profile(), SERVER_ARGV, runner);
    expect(report.detail).toContain('not written');
    expect(report.detail).toContain('server already exists');
  });

  it('when a registration succeeds, should name the scope it landed in', () => {
    // given: a successful install into the second scope
    // when:  the report is read
    // then:  the scope is named, so "it worked" is not the whole message
    const { runner } = recordingRunner();
    expect(runMcpInstallPlan(profile(), SERVER_ARGV, runner).detail).toContain("'two'");
  });

  it('when an adapter is skipped, should name the adapter and the reason', () => {
    // given: the first registered adapter, which declares no profile
    // when:  it is installed for
    // then:  the skip names both, so a user can tell "nothing to do" from "broken"
    const adapter = adapterWith(undefined);
    const { runner } = recordingRunner();
    const result = installMcpForAdapter(adapter, SERVER_ARGV, runner);
    expect(result.skipped).toBe(true);
    if (result.skipped) {
      expect(result.ideId).toBe(adapter.id);
      expect(result.reason.length).toBeGreaterThan(0);
    }
  });
});
