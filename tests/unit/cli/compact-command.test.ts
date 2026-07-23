/**
 * `peaks compact *` — capability-first compact control plane CLI.
 *
 * Task 1.7 (design §13.1) retired the legacy 5-verb group
 * (suggest / recommend / survival / dry-run / force). This suite now
 * asserts:
 *   - the public surface `auto / status / capabilities` behaves per §11.1
 *   - the 5 retired verbs no longer exist (unknownCommand rejection)
 *   - `peaks compact --help` lists exactly auto / status / capabilities
 *
 * The test boundary is the CLI envelope; the underlying service
 * primitives are unit-tested in tests/unit/services/compact/*.test.ts.
 */
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommanderError } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, parseJsonOutput, runCommand } from '../cli-program-test-utils.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-compact-'));
});

afterEach(() => {
  try {
    process.chdir(tmpdir());
  } catch {
    // best effort
  }
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

function writeSessionBinding(sid: string, projectRoot: string): void {
  const peaksDir = join(projectRoot, '.peaks', '_runtime');
  mkdirSync(peaksDir, { recursive: true });
  writeFileSync(
    join(peaksDir, 'session.json'),
    JSON.stringify({ sessionId: sid, setAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

describe('peaks compact --help discoverability', () => {
  it('lists the three primary subcommands (auto / status / capabilities) in the help text', async () => {
    // Task 1.6 (design §11.1): the public LLM surface is `auto / status /
    // capabilities`. Task 1.7 (design §13.1) deleted the legacy 5-verb
    // group outright, so the help output lists exactly these three plus
    // `help`.
    const harness = createHarness();
    try {
      await harness.program.parseAsync(['node', 'peaks', 'compact', '--help'], { from: 'node' });
    } catch (error: unknown) {
      if (
        !(error instanceof CommanderError) ||
        (error.code !== 'commander.help' && error.code !== 'commander.helpDisplayed')
      ) {
        throw error;
      }
    }
    const out = [...harness.stdout, ...harness.stderr].join('\n');
    expect(out).toMatch(/auto/);
    expect(out).toMatch(/status/);
    expect(out).toMatch(/capabilities/);
  });

  it('does NOT list the retired 5-verb group (suggest / recommend / survival / dry-run / force) in --help', async () => {
    // Task 1.7 (design §13.1): the legacy verbs are no longer registered
    // as Commander subcommands. This asserts none of them appear as a
    // command line in the rendered help.
    const harness = createHarness();
    let helpText = '';
    try {
      await harness.program.parseAsync(['node', 'peaks', 'compact', '--help'], { from: 'node' });
    } catch (error: unknown) {
      if (
        !(error instanceof CommanderError) ||
        (error.code !== 'commander.help' && error.code !== 'commander.helpDisplayed')
      ) {
        throw error;
      }
    }
    helpText = [...harness.stdout, ...harness.stderr].join('\n');

    // The new verbs MUST appear.
    expect(helpText).toMatch(/\bauto\b/);
    expect(helpText).toMatch(/\bstatus\b/);
    expect(helpText).toMatch(/\bcapabilities\b/);

    // The retired five MUST NOT appear as a subcommand line.
    const legacyVerbs = ['suggest', 'recommend', 'survival', 'dry-run', 'force'];
    for (const verb of legacyVerbs) {
      const asSubcommandLine = new RegExp(`^\\s+${verb}\\b`, 'm');
      expect(helpText, `retired verb "${verb}" must be absent from --help`).not.toMatch(asSubcommandLine);
    }
  });
});

describe('peaks compact — retired 5-verb group no longer exists (Task 1.7, design §13.1)', () => {
  // The verbs used a different signal + semantics from the control plane
  // and were deleted outright. Invoking any of them must be rejected by
  // Commander's unknownCommand path — NOT silently accepted, NOT forwarded
  // to a fabricated alias.
  const retiredVerbs = ['suggest', 'recommend', 'survival', 'dry-run', 'force'] as const;
  for (const verb of retiredVerbs) {
    it(`rejects \`peaks compact ${verb}\` as an unknown command`, async () => {
      await expect(runCommand(['compact', verb, '--json'], {})).rejects.toMatchObject({
        code: 'commander.unknownCommand'
      } satisfies Partial<CommanderError>);
    });
  }
});

// =============================================================================
// Task 1.6 — `peaks compact auto|status|capabilities` (design §11.1).
// LLM-facing public surface. The handlers MUST NOT silently accept unknown
// flags. The dry-run path MUST NOT write journal / circuit / mutating-bridge
// state. Status / capabilities are read-only.
// =============================================================================

type AutoData = {
  outcome: 'AUTO_COMPACT_PLAN' | 'AUTO_COMPACT_COMPLETED' | 'unsupported' | 'circuit-open' | 'exhausted';
  path?: 'native' | 'fallback';
  targetRatio: number;
  dryRun: boolean;
};

type StatusData = {
  sessionId: string | null;
  consecutiveVerificationFailures: number;
  circuit: 'closed' | 'open' | 'awaiting-manual-observation';
  lastAttemptId: string | null;
  lastFailureCode: string | null;
  manualPromptShown: boolean;
};

type CapabilitiesData = {
  providerId: string;
  certification: 'certified-strong' | 'native-only' | 'safe-handoff' | 'unsupported';
  profile: {
    contextMeasurement: 'exact' | 'estimated' | 'none';
    nativeCompact: 'invoke-and-observe' | 'invoke-only' | 'none';
    contextReplacement: 'in-place' | 'none';
    progressSurface: 'native' | 'host-rendered' | 'none';
    continuation: 'same-ui' | 'new-ui' | 'none';
    completionSignal: 'event-with-measurement' | 'remeasure' | 'none';
    rollbackSupport: 'transactional' | 'snapshot-restore' | 'none';
    capabilityEpoch: string;
  };
  supported: boolean;
};

describe('peaks compact auto', () => {
  it('returns a compact.auto envelope with side-effect-free dry-run outcome', async () => {
    const sid = '2026-07-23-task-1-6-auto-dry';
    writeSessionBinding(sid, root);
    const result = await runCommand(
      ['compact', 'auto', '--project', root, '--session-id', sid, '--dry-run', '--json'],
      {}
    );
    const env = parseJsonOutput<AutoData>(result.stdout);
    expect(env.command).toBe('compact.auto');
    // Phase 1 has no real bridge factory wired into the CLI; dry-run
    // therefore resolves to one of the honest unsupported / circuit-open
    // / exhausted outcomes. The envelope MUST be parseable and the
    // envelope MUST record that dry-run was used.
    expect(env.data.dryRun).toBe(true);
    expect(env.data.targetRatio).toBeCloseTo(0.6, 5);
    expect(['unsupported', 'circuit-open', 'exhausted'].includes(env.data.outcome)).toBe(true);
  });

  it('writes no journal / circuit files when invoked with --dry-run', async () => {
    const sid = '2026-07-23-task-1-6-auto-dry-nowrites';
    writeSessionBinding(sid, root);
    const compactDir = join(root, '.peaks', '_runtime', sid, 'compact-attempts');
    const circuitFile = join(compactDir, 'session-circuit.json');
    expect(existsSync(circuitFile)).toBe(false);
    await runCommand(
      ['compact', 'auto', '--project', root, '--session-id', sid, '--dry-run', '--json'],
      {}
    );
    // No journal files, no circuit file. The CLI MUST be side-effect-free
    // when --dry-run is set (design §11.1, handoff handoff #3).
    expect(existsSync(circuitFile)).toBe(false);
    const journalFiles = existsSync(compactDir)
      ? readdirSyncIfDir(compactDir).filter((n) => n.endsWith('.journal.json'))
      : [];
    expect(journalFiles).toEqual([]);
  });

  it('honors an explicit --target-ratio value', async () => {
    const sid = '2026-07-23-task-1-6-auto-ratio';
    writeSessionBinding(sid, root);
    const result = await runCommand(
      ['compact', 'auto', '--project', root, '--session-id', sid, '--dry-run', '--target-ratio', '0.55', '--json'],
      {}
    );
    const env = parseJsonOutput<AutoData>(result.stdout);
    expect(env.data.targetRatio).toBeCloseTo(0.55, 5);
  });

  it('rejects --target-ratio values outside [0, 1] with INVALID_TARGET_RATIO', async () => {
    const sid = '2026-07-23-task-1-6-auto-bad-ratio';
    writeSessionBinding(sid, root);
    const result = await runCommand(
      ['compact', 'auto', '--project', root, '--session-id', sid, '--dry-run', '--target-ratio', '1.5', '--json'],
      {}
    );
    expect(result.exitCode).toBe(1);
    const env = parseJsonOutput(result.stdout);
    expect(env.code).toBe('INVALID_TARGET_RATIO');
  });

  it('fails loudly when --execute is passed (unknown flag)', async () => {
    const sid = '2026-07-23-task-1-6-auto-execute';
    writeSessionBinding(sid, root);
    const { stderr, exitCode, thrown } = await runCommandResilient(
      ['compact', 'auto', '--project', root, '--session-id', sid, '--execute', '--json'],
      {}
    );
    const out = stderr.join('\n');
    if (thrown !== null) {
      expect(thrown instanceof CommanderError).toBe(true);
      expect((thrown as CommanderError).code).toBe('commander.unknownOption');
    } else {
      expect(exitCode).toBeGreaterThan(0);
    }
    expect(out).toMatch(/--execute/);
  });

  it('fails loudly when a vendor flag like --binary is passed', async () => {
    const sid = '2026-07-23-task-1-6-auto-vendor';
    writeSessionBinding(sid, root);
    const { stderr, exitCode, thrown } = await runCommandResilient(
      ['compact', 'auto', '--project', root, '--session-id', sid, '--binary', 'claude', '--json'],
      {}
    );
    const out = stderr.join('\n');
    if (thrown !== null) {
      expect(thrown instanceof CommanderError).toBe(true);
    } else {
      expect(exitCode).toBeGreaterThan(0);
    }
    expect(out).toMatch(/--binary/);
  });

  it('uses the explicit --session-id verbatim (NO_ACTIVE_SESSION requires omitting --session-id)', async () => {
    // Why this assertion instead of "NO_ACTIVE_SESSION returned":
    // `resolveSessionId` treats an explicit --session-id as authoritative
    // (design §11.1 honesty: we don't fabricate a missing-session error
    // when the caller told us which session to use). The CLI therefore
    // runs to completion with the explicit sid. The Phase-1 no-provider
    // bridge then returns an honest unsupported / exhausted outcome.
    const sid = '2026-07-23-task-1-6-auto-explicit-sid';
    writeSessionBinding(sid, root);
    const result = await runCommand(
      ['compact', 'auto', '--project', root, '--session-id', sid, '--dry-run', '--json'],
      {}
    );
    const env = parseJsonOutput<AutoData>(result.stdout);
    expect(env.command).toBe('compact.auto');
    expect(env.data.dryRun).toBe(true);
    expect(['unsupported', 'circuit-open', 'exhausted'].includes(env.data.outcome)).toBe(true);
  });
});

describe('peaks compact status', () => {
  it('returns closed-circuit status when no failure journal exists', async () => {
    const sid = '2026-07-23-task-1-6-status-closed';
    writeSessionBinding(sid, root);
    const result = await runCommand(
      ['compact', 'status', '--project', root, '--session-id', sid, '--json'],
      {}
    );
    const env = parseJsonOutput<StatusData>(result.stdout);
    expect(env.command).toBe('compact.status');
    expect(env.ok).toBe(true);
    expect(env.data.sessionId).toBe(sid);
    expect(env.data.circuit).toBe('closed');
    expect(env.data.consecutiveVerificationFailures).toBe(0);
    expect(env.data.lastAttemptId).toBeNull();
    expect(env.data.lastFailureCode).toBeNull();
    expect(env.data.manualPromptShown).toBe(false);
  });

  it('uses the explicit --session-id verbatim (NO_ACTIVE_SESSION requires omitting --session-id)', async () => {
    // Same rationale as the auto test: explicit --session-id is
    // authoritative. With no journal written yet, status returns
    // circuit=closed for the requested session.
    const sid = '2026-07-23-task-1-6-status-explicit-sid';
    writeSessionBinding(sid, root);
    const result = await runCommand(
      ['compact', 'status', '--project', root, '--session-id', sid, '--json'],
      {}
    );
    const env = parseJsonOutput<StatusData>(result.stdout);
    expect(env.command).toBe('compact.status');
    expect(env.data.sessionId).toBe(sid);
    expect(env.data.circuit).toBe('closed');
  });

  it('does not write any journal / circuit file (read-only)', async () => {
    const sid = '2026-07-23-task-1-6-status-readonly';
    writeSessionBinding(sid, root);
    const compactDir = join(root, '.peaks', '_runtime', sid, 'compact-attempts');
    const circuitFile = join(compactDir, 'session-circuit.json');
    await runCommand(
      ['compact', 'status', '--project', root, '--session-id', sid, '--json'],
      {}
    );
    expect(existsSync(circuitFile)).toBe(false);
  });

  it('fails loudly when --target-ratio is passed (status is read-only and does not accept it)', async () => {
    const sid = '2026-07-23-task-1-6-status-badflag';
    writeSessionBinding(sid, root);
    const { exitCode, thrown } = await runCommandResilient(
      ['compact', 'status', '--project', root, '--session-id', sid, '--target-ratio', '0.5', '--json'],
      {}
    );
    if (thrown !== null) {
      expect(thrown instanceof CommanderError).toBe(true);
    } else {
      expect(exitCode).toBeGreaterThan(0);
    }
  });
});

describe('peaks compact capabilities', () => {
  it('returns a non-vendor profile envelope (providerId present, no vendor field)', async () => {
    const result = await runCommand(
      ['compact', 'capabilities', '--project', root, '--json'],
      {}
    );
    const env = parseJsonOutput<CapabilitiesData>(result.stdout);
    expect(env.command).toBe('compact.capabilities');
    expect(env.ok).toBe(true);
    expect(typeof env.data.providerId).toBe('string');
    expect(['certified-strong', 'native-only', 'safe-handoff', 'unsupported'].includes(env.data.certification)).toBe(true);
    expect(env.data.profile).toBeDefined();
    // The envelope must NOT carry a vendor/binary/slash-command field of
    // any kind. The shape check below fails fast if a vendor discriminator
    // is ever added back.
    expect((env.data as Record<string, unknown>).vendor).toBeUndefined();
    expect((env.data as Record<string, unknown>).binary).toBeUndefined();
    expect((env.data as Record<string, unknown>).slashCommand).toBeUndefined();
    expect((env.data as Record<string, unknown>).host).toBeUndefined();
  });

  it('explicitly reports supported=false when no certified provider is registered', async () => {
    const result = await runCommand(
      ['compact', 'capabilities', '--project', root, '--json'],
      {}
    );
    const env = parseJsonOutput<CapabilitiesData>(result.stdout);
    // Phase 1 ships an honest "no provider wired" capabilities surface.
    expect(env.data.supported).toBe(false);
  });

  it('fails loudly when a vendor name is passed as a flag (e.g. --vendor)', async () => {
    const { stderr, exitCode, thrown } = await runCommandResilient(
      ['compact', 'capabilities', '--project', root, '--vendor', 'claude-code', '--json'],
      {}
    );
    const out = stderr.join('\n');
    if (thrown !== null) {
      expect(thrown instanceof CommanderError).toBe(true);
    } else {
      expect(exitCode).toBeGreaterThan(0);
    }
    expect(out).toMatch(/--vendor/);
  });

  it('fails loudly when --execute is passed', async () => {
    const { exitCode, thrown } = await runCommandResilient(
      ['compact', 'capabilities', '--project', root, '--execute', '--json'],
      {}
    );
    if (thrown !== null) {
      expect(thrown instanceof CommanderError).toBe(true);
    } else {
      expect(exitCode).toBeGreaterThan(0);
    }
  });
});

function readdirSyncIfDir(path: string): string[] {
  try {
    return require('node:fs').readdirSync(path) as string[];
  } catch {
    return [];
  }
}

/**
 * Run a CLI command and swallow Commander's unknown-option / unknown-command
 * throws. The base `runCommand` helper only catches `commander.version`, so
 * unknown flags throw and the test's `out` arrays stay empty. This helper
 * returns a synthetic result so the test can assert against the rendered
 * stderr message (which Commander writes BEFORE throwing).
 */
async function runCommandResilient(args: string[], env: Record<string, string> = {}): Promise<{
  stdout: string[];
  stderr: string[];
  exitCode: number | undefined;
  thrown: unknown;
}> {
  let stdout: string[] = [];
  let stderr: string[] = [];
  let exitCode: number | undefined = undefined;
  let thrown: unknown = null;
  try {
    const r = await runCommand(args, env);
    stdout = r.stdout;
    stderr = r.stderr;
    exitCode = r.exitCode;
  } catch (error) {
    thrown = error;
    // The harness's io.stderr collected the error text before the throw.
    // Replay parseAsync to capture it: but throwing has already collected
    // stdout/stderr into the harness. Walk back via the harness's own
    // _outputConfiguration. Simpler: re-run with exitOverride() so we
    // capture the rendered error. The harness doesn't expose exitOverride
    // publicly, so we fall back to checking the CommanderError's message.
    if (error instanceof CommanderError) {
      stderr = [error.message];
      exitCode = 1;
    }
  }
  return { stdout, stderr, exitCode, thrown };
}
