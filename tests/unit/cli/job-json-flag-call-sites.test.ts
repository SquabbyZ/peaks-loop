// tests/unit/cli/job-json-flag-call-sites.test.ts
//
// Integration half of the E1 `peaks job --json` split (rid
// 2026-09-17-cli-output-and-stale-refs; file split by the b1 filesplit
// campaign). The render / behavior / a11y scenarios live in the sibling
// job-json-flag.test.ts; the fixtures and the mocked `codegraph-autorefresh`
// boundary are shared from job-json-flag-support.ts and installed identically
// here.
//
// WHAT THIS FILE MEASURES. The defect was one expression (`asJson = opts`)
// repeated at 15 call sites, so this sweep pins EVERY fixed call site: the
// envelope reaches stdout under `--json` and never without it. The job-state
// fs and `registerJobCommands` are real; only the codegraph refresh (a
// process-spawning boundary) is mocked.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { withEnv } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';
import {
  asEnvelope,
  bareWorkspace,
  COMMIT_SHA,
  JOB_ID,
  runJob,
  seedJob,
  stdoutIsEnvelope,
  writeProgressMirror
} from './job-json-flag-support.js';

declareDimensions(
  'tests/unit/cli/job-json-flag-call-sites.test.ts',
  ['integration'],
  [
    {
      dim: 'render',
      reason: 'stdout-shape scenarios live in job-json-flag.test.ts'
    },
    {
      dim: 'behavior',
      reason: 'flag-decides-the-branch scenarios live in job-json-flag.test.ts'
    },
    { dim: 'a11y', reason: 'human-text scenarios live in job-json-flag.test.ts' }
  ]
);

const __autorefresh = vi.hoisted(() => ({ refreshCodegraphAfterSlice: vi.fn() }));

// Only the process-spawning boundary is replaced; the real `codegraphRefreshNotice`
// decides which refresh outcomes become a warning, so the warning under test is
// the shipped rule rather than a stub.
vi.mock('../../../src/services/codegraph/codegraph-autorefresh.js', async () => {
  const actual = await vi.importActual('../../../src/services/codegraph/codegraph-autorefresh.js');
  return { ...actual, refreshCodegraphAfterSlice: __autorefresh.refreshCodegraphAfterSlice };
});

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

describe('Scenario: integration — every fixed call site routes through the flag', () => {
  // ONE CASE PER CALL SITE, because the defect was one expression repeated at
  // 15 sites: a test that covers `status` says nothing about `handoff`. The
  // list was produced by mutating each site back to the object form and
  // keeping every invocation whose case went red; a site with no case here is
  // a site a re-paste can regress unnoticed.
  //
  // The assertion is the same for all of them — envelope on stdout under
  // `--json`, never without it — because that is the whole of what the
  // parameter controls. It holds for a success and for a failure alike: the
  // point is the channel, not the verdict.
  const callSites: ReadonlyArray<{
    site: string;
    label: string;
    args: readonly string[];
    /** Use a workspace with no session binding, so the command refuses. */
    bare?: true;
    /** Seed the progress mirror so `job progress` reaches its ok call site. */
    needsProgress?: true;
  }> = [
    // init: NO_ACTIVE_SESSION, INVALID_INIT, ok
    {
      site: 'init/NO_ACTIVE_SESSION',
      label: 'init — no session',
      args: ['init', '--job-id', 'j-bare', '--slice-list', 's1'],
      bare: true
    },
    {
      site: 'init/INVALID_INIT',
      label: 'init — empty slice list',
      args: ['init', '--job-id', 'j-bad', '--slice-list', ',']
    },
    {
      site: 'init/ok',
      label: 'init — ok',
      args: ['init', '--job-id', 'j-fresh', '--slice-list', 's1']
    },
    { site: 'status/ok', label: 'status', args: ['status', '--job-id', JOB_ID] },
    { site: 'rotate-now/ok', label: 'rotate-now', args: ['rotate-now', '--job-id', JOB_ID] },
    {
      site: 'subagent-cleanup/ok',
      label: 'subagent-cleanup',
      args: ['subagent-cleanup', '--job-id', JOB_ID, '--batch-id', 'b1', '--force']
    },
    // checkpoint: INVALID_CHECKPOINT, SLICE_NOT_FOUND, ok
    {
      site: 'checkpoint/INVALID_CHECKPOINT',
      label: 'checkpoint — done without a commit sha',
      args: ['checkpoint', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--state', 'done']
    },
    {
      site: 'checkpoint/SLICE_NOT_FOUND',
      label: 'checkpoint — unknown slice',
      args: [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'no-such-slice',
        '--state',
        'failed',
        '--reason',
        'why'
      ]
    },
    {
      site: 'checkpoint/ok',
      label: 'checkpoint — done',
      args: [
        'checkpoint',
        '--job-id',
        JOB_ID,
        '--slice-id',
        'slice-001',
        '--state',
        'done',
        '--commit-sha',
        COMMIT_SHA
      ]
    },
    // block: INVALID_BLOCK, SLICE_NOT_FOUND, ok
    {
      site: 'block/INVALID_BLOCK',
      label: 'block — reason too short',
      args: ['block', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--reason', 'ab']
    },
    {
      site: 'block/SLICE_NOT_FOUND',
      label: 'block — unknown slice',
      args: ['block', '--job-id', JOB_ID, '--slice-id', 'no-such-slice', '--reason', 'why']
    },
    {
      site: 'block/ok',
      label: 'block — ok',
      args: ['block', '--job-id', JOB_ID, '--slice-id', 'slice-001', '--reason', 'because']
    },
    { site: 'continue/ok', label: 'continue', args: ['continue', '--job-id', JOB_ID] },
    { site: 'resume/ok', label: 'resume', args: ['resume', '--job-id', JOB_ID] },
    // progress: NO_PROGRESS, ok, PROGRESS_READ_FAILED
    {
      site: 'progress/NO_PROGRESS',
      label: 'progress — allow-missing with no mirror',
      args: ['progress', '--job-id', JOB_ID, '--allow-missing']
    },
    {
      site: 'progress/ok',
      label: 'progress — seeded mirror',
      args: ['progress', '--job-id', JOB_ID],
      needsProgress: true
    },
    {
      site: 'progress/PROGRESS_READ_FAILED',
      label: 'progress — no mirror, no allow-missing',
      args: ['progress', '--job-id', JOB_ID]
    },
    { site: 'handoff/ok', label: 'handoff', args: ['handoff', '--job-id', JOB_ID] },
    // karpathy-cost-check: NO_ACTIVE_SESSION, ok
    {
      site: 'karpathy-cost-check/NO_ACTIVE_SESSION',
      label: 'karpathy-cost-check — no session',
      args: ['karpathy-cost-check', '--review-file', 'rd/karpathy-review.md'],
      bare: true
    },
    {
      site: 'karpathy-cost-check/ok',
      label: 'karpathy-cost-check — missing review file',
      args: ['karpathy-cost-check', '--review-file', 'rd/karpathy-review.md']
    }
  ];

  for (const { site, label, args, bare, needsProgress } of callSites) {
    it(`when \`${label}\` runs without --json, should not leave an envelope on stdout (${site})`, async () => {
      // given: a seeded job — or, for the no-session controls, a workspace
      //        without a session binding; plus the progress mirror when the
      //        case needs one to reach its call site
      await seedJob(ws);
      const projectDir = bare === true ? bareWorkspace(ws.path) : ws.path;
      if (needsProgress === true) {
        writeProgressMirror(projectDir);
      }
      // when: the call site's invocation runs both ways, flag the only difference
      const withoutFlag = await runJob(args, projectDir, false);
      const withFlag = await runJob(args, projectDir, true);
      // then: the envelope is the --json rendering, and only that one
      expect(stdoutIsEnvelope(withFlag)).toBe(true);
      expect(stdoutIsEnvelope(withoutFlag)).toBe(false);
    });
  }

  it('when a no-session command is refused, should name the refusal on stderr without --json', async () => {
    // given: a workspace with NO session binding
    const bare = bareWorkspace(ws.path);
    // when: init runs both ways
    const withoutFlag = await runJob(
      ['init', '--job-id', JOB_ID, '--slice-list', 's1'],
      bare,
      false
    );
    const withFlag = await runJob(['init', '--job-id', JOB_ID, '--slice-list', 's1'], bare, true);
    // then: --json keeps the envelope and its command name …
    expect(asEnvelope(withFlag).ok).toBe(false);
    expect(asEnvelope(withFlag).command).toBe('init');
    // … while without it the refusal is human text on stderr
    expect(withoutFlag.stderrText()).toContain(
      'NO_ACTIVE_SESSION: peaks job init requires --session-id'
    );
  });
});
