/**
 * CLI-level tests for `peaks race pilot-status`. The surface is exercised through
 * the real registered command, not by calling the service: the CLI face IS the
 * deliverable (PRD §5.1), and a test that bypassed it would not measure it.
 *
 * The read-only claim is proven here too, and behaviourally: the evidence file's
 * bytes and mtime are captured before and after a verdict is asked for. "The
 * service exports no writer" would not be a proof of anything.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  registerRaceCommands,
  type PilotStatusReport
} from '../../../../src/cli/commands/race-commands.js';
import type { ProgramIO } from '../../../../src/cli/cli-helpers.js';

type StatusEnvelope = {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly data: PilotStatusReport;
};

const roots: string[] = [];

type RowFixture = {
  rid: string;
  sessionId: string;
  outcome: string;
  filesChanged: string[];
  riskSurfacesHit: number[];
  riskSurfaceHandling: string;
  rolledBack: boolean;
};

function rowFixture(overrides: Partial<RowFixture> & { rid: string }): RowFixture {
  return {
    sessionId: '2026-10-01-session-aaaaaa',
    outcome: 'landed',
    filesChanged: ['skills/x/SKILL.md'],
    riskSurfacesHit: [],
    riskSurfaceHandling: 'none',
    rolledBack: false,
    ...overrides
  };
}

function makeRoot(rows: readonly RowFixture[] | null): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-race-cli-'));
  roots.push(root);
  if (rows === null) return root;
  const dir = join(root, '.peaks', 'race');
  mkdirSync(dir, { recursive: true });
  const tasks = rows.map((entry) => ({
    ...entry,
    date: entry.sessionId.slice(0, 10),
    laneChosenBy: 'user-named',
    ciRed: false,
    missedRiskSurface: false
  }));
  writeFileSync(
    join(dir, 'pilot-gate.json'),
    `${JSON.stringify({ policyVersion: 'race-gate2-policy-v1', tasks }, null, 2)}\n`,
    'utf8'
  );
  return root;
}

/** Ten landed rows over two sessions with coverage met and one safety-arm row. */
function passingRows(): RowFixture[] {
  const rows: RowFixture[] = [];
  for (let i = 1; i <= 6; i += 1) rows.push(rowFixture({ rid: `rid-a${i}` }));
  for (let i = 1; i <= 4; i += 1) {
    rows.push(
      rowFixture({
        rid: `rid-b${i}`,
        sessionId: '2026-10-02-session-bbbbbb',
        filesChanged: ['src/services/a.ts']
      })
    );
  }
  rows.push(
    rowFixture({
      rid: 'rid-arm',
      sessionId: '2026-10-02-session-bbbbbb',
      riskSurfacesHit: [1],
      riskSurfaceHandling: 'refused'
    })
  );
  return rows;
}

async function runPilotStatus(root: string | undefined): Promise<StatusEnvelope> {
  const stdout: string[] = [];
  const io: ProgramIO = { stdout: (text: string) => stdout.push(text), stderr: () => undefined };
  const program = new Command();
  registerRaceCommands(program, io);
  const argv = ['race', 'pilot-status', '--json'];
  if (root !== undefined) argv.push('--project', root);
  await program.parseAsync(argv, { from: 'user' });
  return JSON.parse(stdout.join('')) as StatusEnvelope;
}

beforeEach(() => {
  process.exitCode = undefined;
});

afterEach(() => {
  process.exitCode = undefined;
  while (roots.length > 0) {
    rmSync(roots.pop() as string, { recursive: true, force: true });
  }
});

describe('Scenario: race pilot-status — the policy it judges under', () => {
  it('when the status is asked for as JSON, should return the whole policy with its version and rationale', async () => {
    // given: a project whose evidence meets every floor
    const root = makeRoot(passingRows());
    // when:  the verdict is asked for
    const envelope = await runPilotStatus(root);
    // then:  the policy is reported in full — all seven numbers, the version, and the basis
    expect(envelope.ok).toBe(true);
    expect(envelope.data.policyVersion).toBe('race-gate2-policy-v1');
    expect(envelope.data.policy.taskCountMin).toBe(10);
    expect(envelope.data.policy.coreCapabilityTaskCountMin).toBe(3);
    expect(envelope.data.policy.sessionCountMin).toBe(2);
    expect(envelope.data.policy.safetyArmExercisedMin).toBe(1);
    expect(envelope.data.policy.rollbackCountMax).toBe(0);
    expect(envelope.data.policy.ciRedCountMax).toBe(0);
    expect(envelope.data.policy.missedRiskSurfaceCountMax).toBe(0);
    expect(envelope.data.policy.rationale.length).toBeGreaterThan(0);
    expect(envelope.data.recordedPolicyVersion).toBe('race-gate2-policy-v1');
  });
});

describe('Scenario: race pilot-status — verdicts and exit codes', () => {
  it('when every floor is met and no hard zero is raised, should report pass and exit 0', async () => {
    // given: the passing fixture
    const root = makeRoot(passingRows());
    // when:  the verdict is asked for
    const envelope = await runPilotStatus(root);
    // then:  pass, exit 0, and no reason to read
    expect(envelope.data.verdict).toBe('pass');
    expect(envelope.data.reasons).toEqual([]);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('when a hard zero is raised, should report fail and exit 1', async () => {
    // given: the passing fixture plus one rolled-back row
    const root = makeRoot([...passingRows(), rowFixture({ rid: 'rid-rolled', rolledBack: true })]);
    // when:  the verdict is asked for
    const envelope = await runPilotStatus(root);
    // then:  fail is the only non-zero verdict, and the reason carries its numbers
    expect(envelope.data.verdict).toBe('fail');
    expect(envelope.data.reasons[0]?.observed).toBe(1);
    expect(envelope.data.reasons[0]?.threshold).toBe(0);
    expect(process.exitCode).toBe(1);
  });

  it('when a floor is unmet, should report insufficient-evidence and exit 0', async () => {
    // given: four landed rows in one session, none of them core capability
    const root = makeRoot(
      [1, 2, 3, 4].map((n) =>
        rowFixture({ rid: `rid-q${n}`, sessionId: '2026-10-03-session-cccccc' })
      )
    );
    // when:  the verdict is asked for
    const envelope = await runPilotStatus(root);
    // then:  "keep running the pilot" is not a failure, and the gaps are named
    expect(envelope.data.verdict).toBe('insufficient-evidence');
    expect(envelope.data.reasons.map((reason) => [reason.observed, reason.threshold])).toEqual([
      [4, 10],
      [0, 3],
      [1, 2],
      [0, 1]
    ]);
    expect(process.exitCode ?? 0).toBe(0);
  });

  it('when the evidence file is absent, should refuse a verdict and exit 1', async () => {
    // given: a project root with no evidence file
    const root = makeRoot(null);
    // when:  the verdict is asked for
    const envelope = await runPilotStatus(root);
    // then:  exit 0 here would report "nothing was judged" as a pass
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('PILOT_GATE_EVIDENCE_MISSING');
    expect(process.exitCode).toBe(1);
  });
});

describe('Scenario: race pilot-status — the reader owns no file', () => {
  it('when a verdict is asked for, should leave the evidence file byte-identical', async () => {
    // given: an evidence file whose bytes and mtime are captured first
    const root = makeRoot(passingRows());
    const path = join(root, '.peaks', 'race', 'pilot-gate.json');
    const before = readFileSync(path);
    const mtimeBefore = statSync(path).mtimeMs;
    // when:  the verdict is asked for
    await runPilotStatus(root);
    // then:  nothing was written — the evaluation is a reading, not a refresh
    expect(readFileSync(path).equals(before)).toBe(true);
    expect(statSync(path).mtimeMs).toBe(mtimeBefore);
  });
});
