// tests/unit/cli/job-json-flag.test.ts
//
// E1 (rid 2026-09-17-cli-output-and-stale-refs) — `peaks job <sub>` honours
// `--json`.
//
// THE DEFECT THIS PINS. `printResult(io, envelope, asJson)` takes a BOOLEAN
// third parameter (`src/cli/cli-helpers.ts`). `job-commands.ts` passed the
// whole Commander options object there at 15 call sites — `asJson = opts` —
// and Commander types an action's `opts` as `any`, so it type-checked. An
// object is always truthy, so the envelope branch was always taken and the
// `warning: ` / `next: ` / `CODE: message` rendering below it was unreachable
// from those commands. `job progress` was the one sibling that passed
// `opts.json`; measured with the real CLI, `peaks job block` (no --json) and
// `peaks job block --json` printed byte-identical envelopes, while
// `peaks job progress` (no --json) put its failure on stderr. One file
// rendered two ways for the same invocation shape.
//
// WHAT THESE CASES MEASURE. The flag is the only input that differs, so the
// two channels are asserted against each other: with `--json` the envelope
// (and only the envelope) reaches stdout; without it stdout carries `data`
// alone and the human text reaches stderr. A re-paste of the object form at
// any of the fixed sites turns the without-`--json` cases red.
//
// Dimension split:
//   - render:      stdout's SHAPE — envelope keys present vs absent
//   - behavior:    the flag decides which branch runs; the same command on the
//                  same state must render two ways
//   - integration: real `registerJobCommands` + real job-state fs; only the
//                  codegraph refresh (a process-spawning boundary) is mocked
//   - a11y:        the human text — `warning: `, `next: `, `CODE: message` —
//                  and the channel it lands on
//
// This file carries the render / behavior / a11y scenarios; the integration
// dimension's per-call-site sweep lives in the sibling
// job-json-flag-call-sites.test.ts (b1 filesplit campaign). Both halves build
// their invocations from job-json-flag-support.ts and mock the same boundary.
//
// Run with: pnpm vitest run tests/unit/cli/job-json-flag.test.ts

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { withEnv } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';
import {
  asData,
  asEnvelope,
  COMMIT_SHA,
  JOB_ID,
  REFRESH_NOTE,
  runJob,
  seedJob,
  stdoutIsEnvelope
} from './job-json-flag-support.js';

declareDimensions(
  'tests/unit/cli/job-json-flag.test.ts',
  ['render', 'behavior', 'a11y'],
  [
    {
      dim: 'integration',
      reason: 'the per-call-site integration sweep lives in job-json-flag-call-sites.test.ts'
    }
  ]
);

const __autorefresh = vi.hoisted(() => ({ refreshCodegraphAfterSlice: vi.fn() }));

// Only the process-spawning boundary is replaced; the real `codegraphRefreshNotice`
// decides which refresh outcomes become a warning, so the warning under test is
// the shipped rule rather than a stub.
vi.mock('../../../src/services/codegraph/codegraph-autorefresh.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../src/services/codegraph/codegraph-autorefresh.js')
  >()),
  refreshCodegraphAfterSlice: __autorefresh.refreshCodegraphAfterSlice
}));

let ws: TmpWorkspace;

beforeEach(() => {
  ws = useTmpWorkspace('peaks-job-json-flag-');
  withEnv('PEAKS_SESSION_ID', undefined);
  // A green refresh by default: the real boundary never returns `undefined`,
  // so a case that is not about the refresh must not hand the command one.
  __autorefresh.refreshCodegraphAfterSlice.mockReset();
  __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
});

afterEach(() => {
  cleanupTmpWorkspace();
});

describe('Scenario: render — stdout carries the envelope only when --json is passed', () => {
  it('when --json is passed, should print the full envelope with ok/command/warnings', async () => {
    // given: a seeded job
    await seedJob(ws);
    // when: job status runs with --json
    const captured = await runJob(['status', '--job-id', JOB_ID], ws.path, true);
    // then: stdout is the envelope, keys and all
    const envelope = asEnvelope(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('status');
    expect(envelope.warnings).toEqual([]);
    expect(envelope).toHaveProperty('nextActions');
  });

  it('when --json is NOT passed, should print data alone with no envelope keys', async () => {
    // given: a seeded job
    await seedJob(ws);
    // when: job status runs without --json
    const captured = await runJob(['status', '--job-id', JOB_ID], ws.path, false);
    // then: stdout is the payload, and the envelope wrapper is gone
    const data = asData(captured);
    expect(data.done).toBe(0);
    expect(data.total).toBe(2);
    expect(data).not.toHaveProperty('ok');
    expect(data).not.toHaveProperty('command');
    expect(data).not.toHaveProperty('warnings');
  });
});

describe('Scenario: behavior — the two channels are decided by the flag, not by the command', () => {
  it('when the same successful command is run both ways, should render two different shapes', async () => {
    // given: one seeded job and one invocation, varied only by the flag
    await seedJob(ws);
    const args = ['resume', '--job-id', JOB_ID];
    // when: the same command runs both ways
    const withFlag = await runJob(args, ws.path, true);
    const withoutFlag = await runJob(args, ws.path, false);
    // then: the flag — and nothing else — picks the branch
    expect(stdoutIsEnvelope(withFlag)).toBe(true);
    expect(stdoutIsEnvelope(withoutFlag)).toBe(false);
  });

  it('when a FAILED command is run both ways, should keep the envelope only under --json', async () => {
    // given: a seeded job and a slice id that matches no slice
    await seedJob(ws);
    const args = ['block', '--job-id', JOB_ID, '--slice-id', 'no-such-slice', '--reason', 'why'];
    // when: the failing command runs both ways
    const withFlag = await runJob(args, ws.path, true);
    const withoutFlag = await runJob(args, ws.path, false);
    // then: --json reports the failure as an envelope …
    expect(asEnvelope(withFlag).ok).toBe(false);
    // … and the human invocation reports it as text on stderr, with NO
    //     machine-readable envelope left behind on stdout
    expect(withoutFlag.stdout.join('\n').trim()).toBe('');
    expect(withoutFlag.stderrText()).toContain('SLICE_NOT_FOUND: no slice "no-such-slice"');
  });
});

describe('Scenario: a11y — the human channel a truthy asJson made unreachable', () => {
  it('when a checkpoint refresh fails against a live store, should print `warning: ` on stderr and not in the envelope', async () => {
    // given: a seeded job and a refresh that failed while a store IS in use
    await seedJob(ws);
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({
      refreshed: false,
      reason: 'index-failed',
      note: REFRESH_NOTE
    });
    const args = [
      'checkpoint',
      '--job-id',
      JOB_ID,
      '--slice-id',
      'slice-001',
      '--state',
      'done',
      '--commit-sha',
      COMMIT_SHA
    ];
    // when: the slice-complete checkpoint runs both ways
    const withoutFlag = await runJob(args, ws.path, false);
    const withFlag = await runJob(args, ws.path, true);
    // then: without --json the operator gets the documented `warning: ` line …
    expect(withoutFlag.stderrText()).toContain(`warning: ${REFRESH_NOTE}`);
    // … with the reason and the remedy readable there …
    expect(withoutFlag.stderrText()).toContain('schema lock conflict');
    expect(withoutFlag.stderrText()).toContain('peaks codegraph index');
    // … while stdout is the checkpoint payload alone, with no envelope
    expect(asData(withoutFlag).status).toBe('done');
    expect(stdoutIsEnvelope(withoutFlag)).toBe(false);
    // and under --json the warning is an envelope field, with no stderr line
    expect(asEnvelope(withFlag).warnings).toEqual([REFRESH_NOTE]);
    expect(withFlag.stderrText()).not.toContain('warning: ');
  });

  it('when the refresh succeeds, should print no warning on either channel', async () => {
    // given: the ordinary green case (clean control for the case above)
    await seedJob(ws);
    __autorefresh.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
    // when: the slice-complete checkpoint runs without --json
    const captured = await runJob(
      [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'slice-001',
        '--state',
        'done',
        '--commit-sha',
        COMMIT_SHA
      ],
      ws.path,
      false
    );
    // then: nothing is reported — a warning on every healthy boundary would
    //       train the reader to skip the line that matters
    expect(captured.stderrText()).not.toContain('warning: ');
    expect(captured.stdout.join('\n')).not.toContain('auto codegraph refresh');
  });

  it('when a failure carries nextActions, should render them as human lines without --json', async () => {
    // given: a seeded job and a block that matches no slice
    await seedJob(ws);
    // when: the failing command runs without --json
    const captured = await runJob(
      ['block', '--job-id', JOB_ID, '--slice-id', 'no-such-slice', '--reason', 'why'],
      ws.path,
      false
    );
    // then: the code and the remedy are on stderr, and stdout stays empty
    expect(captured.stderrText()).toContain('SLICE_NOT_FOUND: ');
    expect(captured.stderrText()).toContain('- Re-run with one of the valid slice ids');
    expect(captured.stdout.join('\n').trim()).toBe('');
  });
});
