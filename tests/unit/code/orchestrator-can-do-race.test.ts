// tests/unit/code/orchestrator-can-do-race.test.ts
//
// Unit tests for the race-lane handoff probe behind
//   - src/services/code/orchestrator-can-do-race.ts (pure thresholds + verdict)
//   - src/cli/commands/code-orchestrator-can-do.ts (the --lane race branch and
//     the untouched no-lane envelope)
//
// Dimensions covered:
//   - render:     verdict shape, named threshold constants, thresholds echo
//   - behavior:   the three thresholds (below vs at/above) and risk-surface hits
//   - integration: the CLI shim driven through Commander's parseAsync
//   - a11y:       exit codes, named errors, and the --from-dag next action

import { describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  evaluateRaceLane,
  RaceLaneError,
  RACE_MAX_FILES,
  RACE_MAX_SUBTASKS,
  RACE_RISK_SURFACES,
  RACE_THRESHOLDS,
  resolveRaceLaneInput
} from '~/src/services/code/orchestrator-can-do-race';
import { registerCodeOrchestratorCanDoCommand } from '~/src/cli/commands/code-orchestrator-can-do';

declareDimensions('tests/unit/code/orchestrator-can-do-race.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

interface CliRun {
  readonly stdout: string;
  readonly exitCode: number | undefined;
}

async function runCli(args: readonly string[]): Promise<CliRun> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  const code = program.command('code');
  registerCodeOrchestratorCanDoCommand(code, io);
  const prevExit = process.exitCode;
  process.exitCode = 0;
  try {
    await program.parseAsync(['node', 'peaks', 'code', 'orchestrator-can-do', ...args]);
    return {
      stdout: captured.text(),
      exitCode: process.exitCode
    };
  } finally {
    process.exitCode = prevExit;
  }
}

/** Both probes run `execFile(bin, …)`, so node-as-bin fails them deterministically. */
const DEAD_BIN = process.execPath;

describe('Scenario: render — the named thresholds and the verdict shape', () => {
  it('when invoked, should pin the three named thresholds', () => {
    // given: the race-lane module's exported threshold constants
    // when: they are read directly
    // then: they are pinned at 3 subtasks, 8 files and the five named risk surfaces
    expect(RACE_MAX_SUBTASKS).toBe(3);
    expect(RACE_MAX_FILES).toBe(8);
    expect(RACE_RISK_SURFACES).toEqual([
      'auth',
      'filesystem',
      'external-call',
      'schema-migration',
      'release'
    ]);
    expect(RACE_THRESHOLDS).toEqual({
      maxSubtasks: 3,
      maxFiles: 8,
      riskSurfaces: RACE_RISK_SURFACES
    });
  });

  it('when invoked, should echo lane, mustHandoff, exceeded and thresholds', () => {
    // given: a payload with one subtask, two files and an auth risk
    // when: evaluateRaceLane is called
    // then: the verdict echoes lane race, mustHandoff=true, risk:auth and the thresholds
    const verdict = evaluateRaceLane({
      subtasks: 1,
      files: 2,
      risks: ['auth']
    });
    expect(verdict.lane).toBe('race');
    expect(verdict.mustHandoff).toBe(true);
    expect(verdict.exceeded).toEqual(['risk:auth']);
    expect(verdict.thresholds).toEqual(RACE_THRESHOLDS);
  });
});

describe('Scenario: behavior — subtasks threshold (at or above 3 hands off)', () => {
  it('when subtasks are below the threshold, should not hand off', () => {
    // given: payloads with zero and two subtasks
    // when: evaluateRaceLane runs with no files and no risks
    // then: neither payload hands off
    expect(evaluateRaceLane({ subtasks: 0, files: 0, risks: [] }).mustHandoff).toBe(false);
    expect(evaluateRaceLane({ subtasks: 2, files: 0, risks: [] }).mustHandoff).toBe(false);
  });

  it('when subtasks equal or exceed the threshold, should hand off', () => {
    // given: payloads at three and nine subtasks
    // when: evaluateRaceLane runs with no files and no risks
    // then: both hand off and report subtasks as the exceeded threshold
    const atThreshold = evaluateRaceLane({ subtasks: 3, files: 0, risks: [] });
    expect(atThreshold.mustHandoff).toBe(true);
    expect(atThreshold.exceeded).toEqual(['subtasks']);
    expect(evaluateRaceLane({ subtasks: 9, files: 0, risks: [] }).exceeded).toEqual(['subtasks']);
  });
});

describe('Scenario: behavior — files threshold (at or above 8 hands off)', () => {
  it('when expected files are below the threshold, should not hand off', () => {
    // given: a payload with seven expected files
    // when: evaluateRaceLane runs with no subtasks and no risks
    // then: it does not hand off
    expect(evaluateRaceLane({ subtasks: 0, files: 7, risks: [] }).mustHandoff).toBe(false);
  });

  it('when expected files equal or exceed the threshold, should hand off', () => {
    // given: a payload with eight expected files and no other signal
    // when: evaluateRaceLane runs
    // then: it hands off and reports files as the exceeded threshold
    const atThreshold = evaluateRaceLane({ subtasks: 0, files: 8, risks: [] });
    expect(atThreshold.mustHandoff).toBe(true);
    expect(atThreshold.exceeded).toEqual(['files']);
  });
});

describe('Scenario: behavior — any risk surface hands off', () => {
  it('when any single risk surface is present, should hand off and name it', () => {
    // given: each named risk surface, presented one at a time
    // when: evaluateRaceLane runs with no size signal
    // then: every surface hands off and is named risk:<surface>
    for (const surface of RACE_RISK_SURFACES) {
      const verdict = evaluateRaceLane({ subtasks: 0, files: 0, risks: [surface] });
      expect(verdict.mustHandoff, surface).toBe(true);
      expect(verdict.exceeded).toEqual([`risk:${surface}`]);
    }
  });

  it('when no risk surface is present, should not hand off', () => {
    // given: an empty risk list
    // when: evaluateRaceLane runs with zero subtasks and zero files
    // then: it does not hand off
    expect(evaluateRaceLane({ subtasks: 0, files: 0, risks: [] }).mustHandoff).toBe(false);
  });

  it('when every threshold fires, should list them in a stable order', () => {
    // given: a payload crossing all three thresholds, with risks given out of order
    // when: evaluateRaceLane runs
    // then: exceeded lists subtasks, files, then the risks ordered auth before release
    expect(
      evaluateRaceLane({ subtasks: 3, files: 8, risks: ['release', 'auth'] }).exceeded
    ).toEqual(['subtasks', 'files', 'risk:auth', 'risk:release']);
  });

  it('when flags are resolved, should trim and accept an empty risk list', () => {
    // given: CLI flag strings with surrounding whitespace and a comma-separated risk list
    // when: resolveRaceLaneInput parses them
    // then: numbers are coerced, risks trimmed, and an empty risk string yields an empty list
    expect(resolveRaceLaneInput({ subtasks: '2', files: '7', risk: ' auth, filesystem ' })).toEqual(
      { subtasks: 2, files: 7, risks: ['auth', 'filesystem'] }
    );
    expect(resolveRaceLaneInput({ subtasks: '0', files: '0', risk: '' }).risks).toEqual([]);
  });
});

describe('Scenario: integration — the CLI --lane race branch', () => {
  it('when a threshold is crossed, should stay ok with mustHandoff and a --from-dag next action', async () => {
    // given: the CLI is invoked with --lane race and every threshold crossed
    // when: it dispatches the race verdict as JSON
    // then: the envelope is ok, names the --from-dag action, and the exit code stays 0
    const run = await runCli([
      '--lane',
      'race',
      '--race-subtasks',
      '3',
      '--race-files',
      '8',
      '--race-risk',
      'auth',
      '--json'
    ]);
    const envelope = JSON.parse(run.stdout) as {
      ok: boolean;
      data: { raceVerdict: { mustHandoff: boolean; exceeded: string[] } };
      nextActions: string[];
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.raceVerdict.mustHandoff).toBe(true);
    expect(envelope.data.raceVerdict.exceeded).toEqual(['subtasks', 'files', 'risk:auth']);
    expect(envelope.nextActions[0]).toContain('peaks sub-agent dispatch --from-dag');
    // a routing decision is not a failure
    expect(run.exitCode).toBe(0);
  });

  it('when nothing is crossed, should stay ok with mustHandoff=false', async () => {
    // given: the CLI is invoked with --lane race and every input below threshold
    // when: it dispatches the race verdict as JSON
    // then: the envelope is ok with mustHandoff=false, no exceeded entries, and exit code 0
    const run = await runCli([
      '--lane',
      'race',
      '--race-subtasks',
      '2',
      '--race-files',
      '7',
      '--race-risk',
      '',
      '--json'
    ]);
    const envelope = JSON.parse(run.stdout) as {
      ok: boolean;
      data: { raceVerdict: { mustHandoff: boolean; exceeded: string[] } };
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.data.raceVerdict.mustHandoff).toBe(false);
    expect(envelope.data.raceVerdict.exceeded).toEqual([]);
    expect(run.exitCode).toBe(0);
  });
});

describe('Scenario: integration — the no-lane envelope is unchanged', () => {
  // Captured from the CLI BEFORE this slice's edits, with both probes pinned
  // to fail deterministically (--peaks-bin pointing at node: the Q2/Q4 spawns
  // then cannot resolve their script, so they answer false/0 every time).
  const EXPECTED_NO_LANE_ENVELOPE = {
    ok: true,
    command: 'code.orchestrator-can-do',
    data: {
      canDoInSession: false,
      blockers: ['sub-agent dispatch unavailable (peaks sub-agent dispatch --help failed)'],
      warnings: [],
      suggestions: ['verify peaks CLI is on PATH; check `peaks --version`'],
      contextRatio: 0,
      subAgentAvailable: false,
      q1SourceCodeTouched: false,
      q1HardBlockedPath: false,
      q2SubAgentAvailable: false,
      q3RequiresUserDecision: false,
      q4ContextRatio: 0
    },
    warnings: [],
    nextActions: [
      'verify peaks CLI is on PATH; check `peaks --version`',
      'verdict: canDoInSession=false (blockers present); q1=src[N] q1=hard-block[N] ' +
        'q2=subagent[N] q3=user-decision[N] q4=ratio=0.00 (red-line 0.95 / pre-compact 0.85)'
    ]
  };

  it('when --lane is absent, should emit the same bytes and exit code as before', async () => {
    // given: a no-lane invocation with both probes pinned to a dead bin
    // when: the CLI runs without --lane
    // then: stdout matches the captured pre-slice envelope byte for byte and exits 1
    const run = await runCli([
      '--slice-spec',
      'update docs/spec.md',
      '--peaks-bin',
      DEAD_BIN,
      '--json'
    ]);
    expect(run.stdout).toBe(JSON.stringify(EXPECTED_NO_LANE_ENVELOPE, null, 2));
    expect(run.exitCode).toBe(1);
  });
});

describe('Scenario: a11y — named errors and exit codes', () => {
  it('when --lane race is missing a flag, should refuse by name instead of passing', async () => {
    // given: a race-lane invocation that omits --race-risk
    // when: the CLI parses the flags
    // then: it refuses with code MISSING_RACE_INPUTS and exits 1
    const run = await runCli([
      '--lane',
      'race',
      '--race-subtasks',
      '1',
      '--race-files',
      '1',
      '--json'
    ]);
    const envelope = JSON.parse(run.stdout) as { ok: boolean; code: string };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('MISSING_RACE_INPUTS');
    expect(run.exitCode).toBe(1);
  });

  it('when a numeric flag is not an integer, should refuse by name', async () => {
    // given: a race-lane invocation whose --race-subtasks is not a number
    // when: the CLI parses the flags
    // then: it refuses with code INVALID_RACE_INPUT and exits 1
    const run = await runCli([
      '--lane',
      'race',
      '--race-subtasks',
      'abc',
      '--race-files',
      '1',
      '--race-risk',
      '',
      '--json'
    ]);
    const envelope = JSON.parse(run.stdout) as { ok: boolean; code: string };
    expect(envelope.code).toBe('INVALID_RACE_INPUT');
    expect(run.exitCode).toBe(1);
  });

  it('when a risk surface is misspelled, should refuse by name instead of under-counting', async () => {
    // given: a race-lane invocation whose risk surface is misspelled as aut
    // when: the CLI parses the flags
    // then: it refuses with code INVALID_RACE_INPUT and exits 1 instead of counting nothing
    const run = await runCli([
      '--lane',
      'race',
      '--race-subtasks',
      '0',
      '--race-files',
      '0',
      '--race-risk',
      'aut',
      '--json'
    ]);
    const envelope = JSON.parse(run.stdout) as { ok: boolean; code: string };
    expect(envelope.code).toBe('INVALID_RACE_INPUT');
    expect(run.exitCode).toBe(1);
  });

  it('when an unknown lane is requested, should refuse by name', async () => {
    // given: a CLI invocation with --lane fast
    // when: the lane is resolved
    // then: it refuses with code UNSUPPORTED_LANE and exits 1
    const run = await runCli(['--lane', 'fast', '--json']);
    const envelope = JSON.parse(run.stdout) as { ok: boolean; code: string };
    expect(envelope.code).toBe('UNSUPPORTED_LANE');
    expect(run.exitCode).toBe(1);
  });

  it('when the resolver runs, should throw a RaceLaneError carrying the code', () => {
    // given: flag input whose subtasks value is undefined
    // when: resolveRaceLaneInput parses it
    // then: it throws a RaceLaneError rather than returning a partial input
    expect(() => resolveRaceLaneInput({ subtasks: undefined, files: '0', risk: '' })).toThrow(
      RaceLaneError
    );
  });
});
