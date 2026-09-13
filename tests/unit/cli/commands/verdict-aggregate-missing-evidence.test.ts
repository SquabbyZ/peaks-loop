// tests/unit/cli/commands/verdict-aggregate-missing-evidence.test.ts
//
// rid=2026-09-14-audit-artifact-rid-scoping, repair cycle 1.
//
// QA measured two defects in `peaks verdict aggregate`, and the second one is
// the serious one:
//
//   1. It read the PRE-RID paths only (`audit/security.md`,
//      `audit/perf.md`, `rd/karpathy-review.md`). Slice
//      `2026-09-14-audit-artifact-rid-scoping` made the writers emit
//      `audit/security-<rid>.md` and friends, so on any slice written after
//      that change the reader found nothing.
//   2. It FAILED OPEN. `readAudit()` returns `null` on a miss, a `null` is
//      simply not fed to `aggregateVerdict()`, and `aggregateVerdict()`
//      starts its top-level verdict at `'pass'`. So a guard that could not
//      read its input reported `verdict: 'pass'` — and
//      `src/services/loop/evaluator-dispatcher.ts` consumes exactly that
//      field as the loop's evaluation result.
//
// A fix for (1) alone would leave the failure mode intact for any future path
// move, so the cases below pin BOTH: the rid-scoped read, and the refusal to
// report `pass` when required evidence is unreadable.
//
// Dimensions covered:
//   - render:      the emitted envelope's shape (verdict / reasons / sources)
//   - behavior:    read resolution per on-disk layout, and the fail-closed rule
//   - integration: a real temp `.peaks/_runtime/<sid>/` tree read by the real
//                  registered CLI command
//   - a11y:        omitted — the command prints a JSON envelope, no
//                  human-facing text or exit code is asserted here

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { registerVerdictAggregateCommands } from '~/src/cli/commands/verdict-aggregate-command';
import type { ProgramIO } from '~/src/cli/cli-helpers';

declareDimensions(
  'tests/unit/cli/commands/verdict-aggregate-missing-evidence.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'the command emits a JSON envelope; no human-facing text is asserted' }],
);

const SESSION_ID = '2026-09-14-session-repair01';
const RID = '2026-09-14-audit-artifact-rid-scoping';

/** A minimal body each audit parser accepts (JSON path of `envelopes.ts`). */
const PASS_AUDIT_JSON = '{"verdict":"pass","violations":[],"summary":"clean"}';

/** A minimal body `parseKarpathyEnvelope` accepts: `gateAction` + `passed`. */
const PASS_KARPATHY = 'gateAction: pass\npassed: true\n';

type AggregateData = {
  verdict: string;
  reasons: ReadonlyArray<{ kind?: string; source?: string; hint?: string }>;
  sources: Record<string, string>;
};

const roots: string[] = [];

beforeEach(() => {
  process.exitCode = undefined;
});

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
  process.exitCode = undefined;
});

function makeProjectRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-verdict-agg-'));
  roots.push(root);
  mkdirSync(join(root, '.peaks', '_runtime', SESSION_ID), { recursive: true });
  return root;
}

function writeSessionFile(projectRoot: string, relativePath: string, body: string): void {
  const absolute = join(projectRoot, '.peaks', '_runtime', SESSION_ID, relativePath);
  mkdirSync(join(absolute, '..'), { recursive: true });
  writeFileSync(absolute, body, 'utf8');
}

async function runAggregate(projectRoot: string): Promise<AggregateData> {
  const stdout: string[] = [];
  const io: ProgramIO = { stdout: (s: string) => stdout.push(s), stderr: () => undefined };
  const program = new Command();
  registerVerdictAggregateCommands(program, io);
  await program.parseAsync(
    ['verdict', 'aggregate', '--from-rid', RID, '--sid', SESSION_ID, '--project', projectRoot, '--json'],
    { from: 'user' }
  );
  const envelope = JSON.parse(stdout.join('')) as { ok: boolean; data: AggregateData };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

/** Every required source at its pre-rid location. */
function writeAllLegacyEvidence(projectRoot: string): void {
  writeSessionFile(projectRoot, 'audit/security.md', PASS_AUDIT_JSON);
  writeSessionFile(projectRoot, 'audit/perf.md', PASS_AUDIT_JSON);
  writeSessionFile(projectRoot, 'rd/karpathy-review.md', PASS_KARPATHY);
}

/** Every required source at its rid-scoped location — what the writers emit now. */
function writeAllRidScopedEvidence(projectRoot: string): void {
  writeSessionFile(projectRoot, `audit/security-${RID}.md`, PASS_AUDIT_JSON);
  writeSessionFile(projectRoot, `audit/perf-${RID}.md`, PASS_AUDIT_JSON);
  writeSessionFile(projectRoot, `rd/karpathy-review-${RID}.md`, PASS_KARPATHY);
}

describe('(behavior) the fail-closed rule — a guard that cannot read its input must not report pass', () => {
  it('reports block, not pass, when every required source is absent', async () => {
    // given: an empty session (the loop evaluator's worst case — nothing ran)
    const projectRoot = makeProjectRoot();

    // when: the aggregate runs
    const data = await runAggregate(projectRoot);

    // then: `pass` is NOT reported. Before this repair `aggregateVerdict()`
    // received an empty input and returned `pass` for the same tree.
    expect(data.verdict).toBe('block');
    expect(data.sources.security).toBe('missing');
  });

  it('names which required sources were unreadable, and where it looked', async () => {
    // given: security present, perf + karpathy absent
    const projectRoot = makeProjectRoot();
    writeSessionFile(projectRoot, `audit/security-${RID}.md`, PASS_AUDIT_JSON);

    // when: the aggregate runs
    const data = await runAggregate(projectRoot);

    // then: one reason per unreadable required source, carrying the expected
    //       rid-scoped path so a reader can see where to write it
    const missing = data.reasons.filter((r) => r.kind === 'missing-evidence');
    expect(data.verdict).toBe('block');
    expect(missing).toHaveLength(2);
    expect(missing.map((r) => r.source).sort()).toEqual(['karpathy-reviewer', 'perf-audit']);
    expect(missing.some((r) => r.hint?.includes(`audit/perf-${RID}.md`))).toBe(true);
  });

  it('still reports the aggregate verdict when every required source is readable', async () => {
    // given: the clean control group for the rule above — proving the block is
    //        conditional, not hard-coded
    const projectRoot = makeProjectRoot();
    writeAllRidScopedEvidence(projectRoot);

    // when: the aggregate runs
    const data = await runAggregate(projectRoot);

    // then: no missing-evidence reason, and the verdict comes from the envelopes
    expect(data.reasons.filter((r) => r.kind === 'missing-evidence')).toHaveLength(0);
    expect(data.verdict).toBe('pass');
  });

  it('does NOT require the mut report, which the contract itself treats as a warning', async () => {
    // given: the three required sources present, mut absent — the normal case,
    //        because `MUT_REPORT` carries `backCompat: true`
    const projectRoot = makeProjectRoot();
    writeAllRidScopedEvidence(projectRoot);

    // when: the aggregate runs
    const data = await runAggregate(projectRoot);

    // then: mut is reported missing but does not by itself block
    expect(data.sources.mut).toBe('missing');
    expect(data.verdict).toBe('pass');
  });
});

describe('(integration) the reader follows the writers to the rid-scoped paths', () => {
  it('reads the rid-scoped audit and review files the current writers emit', async () => {
    // given: ONLY the rid-scoped layout — every file the pre-repair reader
    //        probed is absent
    const projectRoot = makeProjectRoot();
    writeAllRidScopedEvidence(projectRoot);

    // when: the aggregate runs
    const data = await runAggregate(projectRoot);

    // then: all three are read. Pre-repair this tree reported three `missing`
    //       sources and `verdict: 'pass'`.
    expect(data.sources.security).toBe('present');
    expect(data.sources.perf).toBe('present');
    expect(data.sources.karpathy).toBe('present');
  });

  it('still reads the pre-rid locations, so existing sessions keep resolving', async () => {
    // given: ONLY the legacy layout (a session written before the rename)
    const projectRoot = makeProjectRoot();
    writeAllLegacyEvidence(projectRoot);

    // when: the aggregate runs
    const data = await runAggregate(projectRoot);

    // then: back-compat holds — no false block on an old session
    expect(data.sources.security).toBe('present');
    expect(data.sources.perf).toBe('present');
    expect(data.sources.karpathy).toBe('present');
    expect(data.verdict).toBe('pass');
  });

  it('reads the OLDEST declared tier, so it agrees with `request transition` on those trees', async () => {
    // Repair round (H-1). The candidate lists used to be hand-written with two
    // of the contract's THREE tiers for security and perf, so the layout below
    // reported `verdict: 'block'` while `peaks request transition` accepted the
    // same tree — two components disagreeing about one tree, which is the
    // defect class this job exists to delete. `artifact-prerequisites.ts:76-79`
    // names three real sessions in exactly this layout:
    // `2026-09-06-session-a87ca4`, `2026-09-10-session-528a63`,
    // `2026-09-12-session-e37ef0`.
    const projectRoot = makeProjectRoot();
    writeSessionFile(projectRoot, 'rd/security-review.md', PASS_AUDIT_JSON);
    writeSessionFile(projectRoot, 'rd/perf-baseline.md', PASS_AUDIT_JSON);
    writeSessionFile(projectRoot, 'rd/karpathy-review.md', PASS_KARPATHY);

    // when: the aggregate runs
    const data = await runAggregate(projectRoot);

    // then: every source resolves. Pre-repair the two oldest-tier files were
    //       never probed and both sources read `missing`.
    expect(data.sources.security).toBe('present');
    expect(data.sources.perf).toBe('present');
    expect(data.sources.karpathy).toBe('present');
    expect(data.verdict).toBe('pass');
  });

  it('refuses a traversal `--from-rid` instead of reading out of tree (F1a)', async () => {
    // The rid selects the file, so a rid that is not one path segment must be
    // refused BEFORE any join. Measured before the guard existed: a rid of
    // `../../../../../../ONLY-HERE` resolved `<project>/ONLY-HERE.md` — a file
    // outside `.peaks/` — and it was read as this slice's security AND perf
    // evidence.
    const projectRoot = makeProjectRoot();
    writeSessionFile(projectRoot, 'audit/security.md', PASS_AUDIT_JSON);

    // when: the aggregate runs with a rid that climbs out of the session dir
    const stdout: string[] = [];
    const io: ProgramIO = { stdout: (s: string) => stdout.push(s), stderr: () => undefined };
    const program = new Command();
    registerVerdictAggregateCommands(program, io);
    await program.parseAsync(
      ['verdict', 'aggregate', '--from-rid', '../../../../../../ONLY-HERE', '--sid', SESSION_ID, '--project', projectRoot, '--json'],
      { from: 'user' }
    );

    // then: refused, with the code that says why — and nothing was read
    const envelope = JSON.parse(stdout.join('')) as { ok: boolean; code: string };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('RID_INVALID');
    process.exitCode = undefined;
  });

  it('refuses a traversal `--sid` — the same axis, one path segment up (F1a)', async () => {
    const projectRoot = makeProjectRoot();

    const stdout: string[] = [];
    const io: ProgramIO = { stdout: (s: string) => stdout.push(s), stderr: () => undefined };
    const program = new Command();
    registerVerdictAggregateCommands(program, io);
    await program.parseAsync(
      ['verdict', 'aggregate', '--from-rid', RID, '--sid', '../../../../OUTSIDE', '--project', projectRoot, '--json'],
      { from: 'user' }
    );

    const envelope = JSON.parse(stdout.join('')) as { ok: boolean; code: string };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SID_INVALID');
    process.exitCode = undefined;
  });

  it('prefers the rid-scoped file over a stale bare one from a sibling slice', async () => {
    // given: this rid's security audit is a real violation, and a bare
    //        `audit/security.md` from another slice says everything is clean
    const projectRoot = makeProjectRoot();
    writeSessionFile(projectRoot, `audit/security-${RID}.md`, JSON.stringify({
      verdict: 'block',
      violations: [
        { dimension: 'injection', severity: 'CRITICAL', file: 'src/x.ts', line: 3, hint: 'unsanitised input' }
      ],
      summary: 'sibling-decoy control'
    }));
    writeSessionFile(projectRoot, 'audit/security.md', PASS_AUDIT_JSON);

    // when: the aggregate runs
    const data = await runAggregate(projectRoot);

    // then: the rid-scoped envelope is the one that counted. If the reader
    //       took the bare file, the CRITICAL violation would vanish.
    const critical = data.reasons.filter((r) => r.kind !== 'missing-evidence');
    expect(critical.length).toBeGreaterThan(0);
  });
});
