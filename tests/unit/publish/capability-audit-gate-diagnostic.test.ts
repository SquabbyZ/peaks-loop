// tests/unit/publish/capability-audit-gate-diagnostic.test.ts
//
// Drift guard for the `gate-capability-baseline` failure message in
// `.github/workflows/publish.yml` (session 2026-10-10-session-062f74, request 036).
//
// WHY THIS FILE EXISTS
//   The 4.1.4 publish failed at `gate-capability-baseline` and CI gave exactly
//   one line: `verdict=drifted degraded=false failing=[J03]`. J03 has SIX
//   probes (`capability-guard-runner/contracts/J03.ts`) and all six collapse
//   into that one word; locating the probe that failed took a long
//   investigation that ended without a conclusion (attempt 2 passed on the same
//   commit). The detail was never missing — `capability-audit-service/runner.ts`
//   puts the failing contract's diff into `evidence[].summary` — the message
//   assembly threw it away. So this file runs the REAL inline script, EXTRACTED
//   from the workflow yaml and EXECUTED the way the runner executes it, against
//   a real `capability-audit.json`, and asserts the summary reaches the log.
//
// THE CONTROL ARMS (measured 2026-10-10, each reverted after the run):
//   1. message expression put back to the pre-slice `journeyId`-only form — 8
//      of the 10 cases below go red (the survivors are this slice's own
//      non-goals: the passing-dimension case and the consistent-verdict happy
//      path);
//   2. evidence read made naive (`oneLine(dim.evidence[0].summary)`) — the
//      missing-evidence case goes red with a TypeError inside the annotation;
//   3. blank-summary guard deleted — the same case goes red with `J03()`
//      instead of `J03(no evidence)`.
//   Every new branch is therefore watched failing, not asserted only while green.
//
// Dimensions covered:
//   - render:      the annotation's fields and its single-line shape
//   - behavior:    which dimensions are reported; the no-evidence degradation
//   - integration: the script read out of publish.yml, run as a child process
//                  against a file on disk (real exit code, real stderr)
//   - a11y:        the bound, its markers, and the prefix CI already greps for

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const WORKFLOW_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '.github',
  'workflows',
  'publish.yml'
);

/** The J03 probe that reddens `no silent-catch rule count grew past its ceiling`. */
const J03_FAILING_PROBE =
  'no silent-catch rule count grew past its ceiling (catch-return-null: 42 > 41)';

/**
 * A J03 failure summary in the shape `runner.ts` builds it:
 * `${contract} → ${status} | ${diff.reason}: ${diff.after}`, where `after` is
 * the FAILING probes joined by '; ' (`contracts/_shared.ts` `combineProbes`).
 */
const J03_SUMMARY = `workflow-trace → fail | J03 invariant broken: a silent-catch or fake-green pattern was reintroduced under src/**; ${J03_FAILING_PROBE}`;

let scriptCache: string | null = null;

function gateStepText(): string {
  const yaml = readFileSync(WORKFLOW_PATH, 'utf8');
  const start = yaml.indexOf('- name: gate-capability-baseline');
  expect(start, 'publish.yml must still have a gate-capability-baseline step').toBeGreaterThan(-1);
  const end = yaml.indexOf('\n      - name:', start);
  return yaml.slice(start, end === -1 ? yaml.length : end);
}

/**
 * The script CI actually runs, taken from the yaml rather than copied here, so
 * this test cannot pass against a stale copy of it. The capture is anchored on
 * the step, because publish.yml holds other `node -e` calls.
 */
function gateScript(): string {
  if (scriptCache !== null) return scriptCache;
  const captured = /node -e '\n([\s\S]*?)\n\s*'/.exec(gateStepText())?.[1] ?? '';
  // The extractor's own control: a wrong capture must fail HERE rather than
  // pass by running something else.
  expect(captured, 'the gate step must still run its check through node -e').not.toBe('');
  expect(captured).toContain('capability-audit.json');
  expect(captured).toContain('::error title=capability-audit-not-consistent::');
  scriptCache = captured;
  return captured;
}

type GateRun = { readonly status: number | null; readonly stderr: string; readonly stdout: string };

/** Run the step's own script against `payload`, in a scratch directory. */
function runGate(payload: unknown, preamble = ''): GateRun {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-audit-gate-'));
  try {
    const file = join(dir, 'capability-audit.json');
    writeFileSync(file, `${preamble}${JSON.stringify(payload)}\n`, 'utf8');
    const run = spawnSync(process.execPath, ['-e', gateScript()], {
      cwd: dir,
      encoding: 'utf8',
      windowsHide: true
    });
    expect(run.error, `spawning node failed: ${String(run.error?.message)}`).toBeUndefined();
    return { status: run.status, stderr: run.stderr, stdout: run.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The single annotation line the step printed. Exactly one line IS the "the
 * diagnostic did not throw" assertion: an uncaught error prints a stack.
 */
function annotation(run: GateRun): string {
  const lines = run.stderr.trimEnd().split('\n');
  expect(lines, 'the failure must be one annotation, not a dump').toHaveLength(1);
  const line = lines[0] ?? '';
  expect(line.startsWith('::error ')).toBe(true);
  return line;
}

const guardEvidence = (summary: unknown): ReadonlyArray<unknown> => [
  { kind: 'guard-run', ref: 'capability-guard-runner:J03', summary }
];

const failedDimension = (journeyId: string, evidence?: unknown): Record<string, unknown> => ({
  journeyId,
  consistencyScore: 0,
  ...(evidence === undefined ? {} : { evidence })
});

const passingDimension = (journeyId: string): Record<string, unknown> => ({
  journeyId,
  consistencyScore: 1,
  evidence: [{ kind: 'guard-run', ref: `capability-guard-runner:${journeyId}`, summary: `${journeyId} → pass` }]
});

/** The failure envelope `baseline audit --json` writes (`baseline-command-shared.ts` `fail`). */
const driftedEnvelope = (dimensions: ReadonlyArray<unknown>, data: Record<string, unknown> = {}) => ({
  ok: false,
  command: 'baseline',
  code: 'AUDIT_NOT_CONSISTENT',
  message: 'capability audit verdict is not consistent',
  data: { verdict: 'drifted', degraded: false, dimensions, ...data },
  warnings: [],
  nextActions: []
});

const j03 = (summary: unknown) => driftedEnvelope([failedDimension('J03', guardEvidence(summary))]);

describe('render — the annotation the gate prints on a failed audit', () => {
  it('keeps the fields CI already greps for and adds the failing dimension summary', () => {
    const run = runGate(
      driftedEnvelope([failedDimension('J03', guardEvidence(J03_SUMMARY)), passingDimension('J01')])
    );

    expect(run.status).toBe(1);
    const line = annotation(run);
    // The pre-slice prefix stays byte-identical: `verdict=` / `degraded=` /
    // `failing=[...]` are searchable and must not be replaced by the detail.
    expect(line).toContain(
      '::error title=capability-audit-not-consistent::verdict=drifted degraded=false failing=[J03]'
    );
    expect(line).toContain(`detail=[J03(${J03_SUMMARY})]`);
    // The assertion this whole slice exists for: WHICH probe failed is in the log.
    expect(line).toContain(J03_FAILING_PROBE);
  });

  it('does not carry a passing dimension evidence into the message', () => {
    const line = annotation(
      runGate(driftedEnvelope([failedDimension('J03', guardEvidence(J03_SUMMARY)), passingDimension('J01')]))
    );

    expect(line).not.toContain('J01 → pass');
    expect(line).toContain('failing=[J03]');
  });
});

describe('behavior — which dimensions the message reports', () => {
  it('reports every failed dimension, in the order the audit produced them', () => {
    const line = annotation(
      runGate(
        driftedEnvelope([
          failedDimension('J01', guardEvidence('cli-envelope → fail | J01 row missing (src/x.ts)')),
          passingDimension('J02'),
          failedDimension('J03', guardEvidence(J03_SUMMARY))
        ])
      )
    );

    expect(line).toContain('failing=[J01,J03]');
    expect(line).toContain('detail=[J01(cli-envelope → fail | J01 row missing (src/x.ts)) | J03(');
    expect(line).toContain(J03_FAILING_PROBE);
  });

  // The degradation path: a dimension with no usable evidence must still be
  // reported by journeyId. A diagnostic that can itself fail is worse than the
  // silent one it replaces.
  it('degrades to the journeyId for every shape of missing evidence, and never throws', () => {
    const shapes: ReadonlyArray<readonly [string, unknown]> = [
      ['no evidence key', undefined],
      ['an empty evidence array', []],
      ['a summary that is not a string', [{ kind: 'guard-run', ref: 'x' }, { summary: 42 }]],
      ['a blank summary', guardEvidence('   ')]
    ];

    for (const [label, evidence] of shapes) {
      const run = runGate(driftedEnvelope([failedDimension('J03', evidence)]));
      expect(run.status, label).toBe(1);
      const line = annotation(run);
      expect(line, label).toContain('failing=[J03]');
      expect(line, label).toContain('detail=[J03(no evidence)]');
    }
  });

  it('reports failing=[] without throwing when no dimension scored 0', () => {
    // A degraded run scores every dimension 0.5, so `failing` has always been
    // empty there; the new detail field must not turn that into a crash.
    const run = runGate(
      driftedEnvelope(
        [{ journeyId: 'J01', consistencyScore: 0.5, evidence: guardEvidence('J01 → skipped') }],
        { verdict: 'inconclusive', degraded: true }
      )
    );

    expect(run.status).toBe(1);
    expect(annotation(run)).toContain('verdict=inconclusive degraded=true failing=[] detail=[]');
  });
});

describe('a11y — bounded, marked, and readable at a glance', () => {
  it('bounds the annotation when many dimensions each carry a 4000-char summary', () => {
    // runner.ts caps ONE summary at 4000 chars; nine of those concatenated is a
    // 36 000-char log dump. The step must bound the whole message instead.
    const ids = ['J01', 'J02', 'J03', 'J04', 'J05', 'J06', 'J07', 'J08', 'J09'];
    const line = annotation(
      runGate(driftedEnvelope(ids.map((id) => failedDimension(id, guardEvidence('x'.repeat(4000))))))
    );

    // `failing=[...]` stays COMPLETE; only the detail is bounded.
    expect(line).toContain(`failing=[${ids.join(',')}]`);
    expect(line.length).toBeGreaterThan(2400); // 2 400 chars of detail reach the log
    expect(line.length).toBeLessThan(2700); // plus the ~150-char prefix and fields
    expect(line).toContain('…(+'); // the cut is MARKED, so a bounded message never reads as complete
  });

  it('marks a per-dimension cut instead of silently shortening the summary', () => {
    const summary = `workflow-trace → fail | ${'probe-check '.repeat(60)}`;
    const collapsed = summary.replace(/\s+/g, ' ').trim();
    const line = annotation(runGate(j03(summary)));

    expect(line).toContain(`detail=[J03(${collapsed.slice(0, 400)}…)]`); // 400 chars, then a mark
  });

  it('collapses a multi-line summary so the annotation stays one line', () => {
    // A raw newline would END the ::error command and start a second log line.
    const line = annotation(runGate(j03('probe one\nprobe two\r\nprobe three')));

    expect(line).toContain('J03(probe one probe two probe three)');
    expect(line).not.toMatch(/[\r\n]/);
  });
});

describe('integration — the script read out of publish.yml, run as the runner runs it', () => {
  it('reads the LAST JSON line of capability-audit.json', () => {
    const run = runGate(j03(J03_SUMMARY), 'progress: auditing 9 contracts\n');

    expect(annotation(run)).toContain(J03_FAILING_PROBE);
  });

  it('exits 0 and prints the dimension count when the verdict is consistent', () => {
    const run = runGate({
      ok: true,
      command: 'baseline',
      data: {
        verdict: 'consistent',
        degraded: false,
        dimensions: [passingDimension('J01'), passingDimension('J03')]
      },
      warnings: [],
      nextActions: []
    });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain('capability audit consistent: 2 dimensions');
    expect(run.stderr).toBe('');
  });
});
