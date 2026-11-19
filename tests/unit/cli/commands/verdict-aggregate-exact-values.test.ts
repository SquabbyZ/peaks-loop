// tests/unit/cli/commands/verdict-aggregate-exact-values.test.ts
//
// rid-mut-baseline-80 — the EXACT-VALUE arms for `verdict-aggregate-command.ts`.
//
// WHY THIS IS A SECOND FILE. Its sibling
// (`verdict-aggregate-missing-evidence.test.ts`) is at its 500-line cap, and the
// repo's file-size ratchet refuses GROWTH past a cap. These arms extend the same
// subject, so the split is by CLAIM rather than by subject: the sibling proves
// the reader resolves the right file and fails closed; this file proves the
// envelope it emits carries exact values rather than merely well-shaped ones.
//
// WHY EXACT VALUES AT ALL. The mutation report (measured 2026-11-19) showed the
// largest surviving family in this module was the empty-value substitution:
// `""` → a sentinel string, `[]` → `["Stryker was here"]`, `{}` → a sentinel
// object. Shape assertions cannot see those — a sources map with an injected key,
// or a message with junk text, still satisfies "there is a reason" and "the
// verdict is block". These arms compare the whole value, one field per
// assertion, so a red run names the field that moved.
//
// The harness is duplicated rather than shared on purpose: a shared helper module
// would need to be a mutation target's dependency, and these arms are about what
// the command EMITS, not about how the tests are organised.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { registerVerdictAggregateCommands } from '~/src/cli/commands/verdict-aggregate-command';
import type { ProgramIO } from '~/src/cli/cli-helpers';

declareDimensions(
  'tests/unit/cli/commands/verdict-aggregate-exact-values.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'these arms compare emitted JSON values; no human-facing text is asserted'
    }
  ]
);

const SESSION_ID = '2026-09-14-session-repair01';
const RID = '2026-09-14-audit-artifact-rid-scoping';

const PASS_AUDIT_JSON = '{"verdict":"pass","violations":[],"summary":"clean"}';
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
  const root = mkdtempSync(join(tmpdir(), 'peaks-verdict-exact-'));
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
    [
      'verdict',
      'aggregate',
      '--from-rid',
      RID,
      '--sid',
      SESSION_ID,
      '--project',
      projectRoot,
      '--json'
    ],
    { from: 'user' }
  );
  const envelope = JSON.parse(stdout.join('')) as { ok: boolean; data: AggregateData };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

function writeAllRidScopedEvidence(projectRoot: string): void {
  writeSessionFile(projectRoot, `audit/security-${RID}.md`, PASS_AUDIT_JSON);
  writeSessionFile(projectRoot, `audit/perf-${RID}.md`, PASS_AUDIT_JSON);
  writeSessionFile(projectRoot, `rd/karpathy-review-${RID}.md`, PASS_KARPATHY);
}

/**
 * rid-mut-baseline-80 — the empty-value arms.
 *
 * The mutation report (measured 2026-11-19) left 55 mutants alive in
 * `verdict-aggregate-command.ts`, and the largest family by far was the
 * empty-value substitution: `[]` → `["Stryker was here"]`, `""` → a sentinel,
 * `{}` → a sentinel object. Those mutants survive because the assertions above
 * check the SHAPE of the answer ("there is a reason", "the verdict is block")
 * rather than the exact contents, so a reason carrying junk text or a sources
 * map with an injected key still satisfies them.
 *
 * These arms pin the exact values. They are deliberately narrow: one assertion
 * per field, so a red run names the field that moved.
 */
describe('(render) the envelope carries exact values, not just shapes', () => {
  it('when every source is missing, should report all five flags as the literal string "missing"', async () => {
    // given: an empty session — every reader misses
    // when: the aggregate runs
    // then: each flag is EXACTLY 'missing' — an injected key or a sentinel value would still pass a "toContain" style check, so compare all five
    const projectRoot = makeProjectRoot();

    const data = await runAggregate(projectRoot);

    expect(data.sources).toEqual({
      security: 'missing',
      perf: 'missing',
      karpathy: 'missing',
      mut: 'missing',
      qa: 'missing'
    });
  });

  it('when the mut report is not valid JSON, should treat it as missing rather than crash', async () => {
    // given: the three required sources present and a CORRUPT mut report
    // when:  the aggregate runs
    // then: the unparseable report reads as missing and the run still answers A half-written file or a truncated download is the shape this covers; an unreadable OPTIONAL source must not take the whole aggregation down.
    const projectRoot = makeProjectRoot();
    writeAllRidScopedEvidence(projectRoot);
    writeSessionFile(projectRoot, 'mut/mut-report.json', '{ not json at all');

    const data = await runAggregate(projectRoot);

    expect(data.sources.mut).toBe('missing');
    expect(data.sources.security).toBe('present');
    expect(data.verdict).toBe('pass');
  });

  it('when only some sources are present, should flag each one independently', async () => {
    // given: a MIXED tree — security and qa present, everything else absent
    // when:  the aggregate runs
    // then: exactly the two written sources are 'present' The all-missing and all-present arms above cannot distinguish the per-source ternaries from each other: a mutation making every branch answer 'present' fails all-missing, one making every branch answer 'missing' fails all-present, but a mutation swapping TWO branches leaves both extremes unchanged. This tree is the one that separates them.
    const projectRoot = makeProjectRoot();
    writeSessionFile(projectRoot, `audit/security-${RID}.md`, PASS_AUDIT_JSON);
    writeSessionFile(projectRoot, `qa/test-reports/${RID}.md`, 'verdict: pass\n');

    const data = await runAggregate(projectRoot);

    expect(data.sources).toEqual({
      security: 'present',
      perf: 'missing',
      karpathy: 'missing',
      mut: 'missing',
      qa: 'present'
    });
    // And only the two required misses produce reasons — qa is present, so it
    // adds none, and mut is not required at all.
    expect(data.reasons.filter((r) => r.kind === 'missing-evidence')).toHaveLength(2);
    expect(data.verdict).toBe('block');
  });

  it('when every source is present, should report all five flags as the literal string "present"', async () => {
    // given: every source written at its rid-scoped location, plus mut and qa in the shapes `parseMutEnvelope` / `parseQaEnvelope` actually accept (read from `services/verdict/envelopes.ts`, not guessed)
    // when: the aggregate runs
    // then: each flag is EXACTLY 'present'
    const projectRoot = makeProjectRoot();
    writeAllRidScopedEvidence(projectRoot);
    writeSessionFile(
      projectRoot,
      'mut/mut-report.json',
      JSON.stringify({ passed: true, killRate: 0.9, weakRate: 0, violations: [] })
    );
    writeSessionFile(projectRoot, `qa/test-reports/${RID}.md`, 'verdict: pass\n');

    const data = await runAggregate(projectRoot);

    expect(data.sources).toEqual({
      security: 'present',
      perf: 'present',
      karpathy: 'present',
      mut: 'present',
      qa: 'present'
    });
  });

  it('when no source is missing, should carry no missing-evidence reason at all', async () => {
    // given: a fully-evidenced session
    // when:  the aggregate runs
    // then: the reason array is EMPTY of missing-evidence entries An injected sentinel reason would survive `toHaveLength(0)` on the filtered list only if the filter itself is intact, so assert both.
    const projectRoot = makeProjectRoot();
    writeAllRidScopedEvidence(projectRoot);

    const data = await runAggregate(projectRoot);

    expect(data.reasons.filter((r) => r.kind === 'missing-evidence')).toEqual([]);
  });

  it('when a required source is missing, should name both declared tiers in the hint', async () => {
    // given: nothing written, so every required source misses
    // when:  the aggregate runs
    // then: each hint joins the tiers with ' | ' and names the session dir A reader uses the hint to know where to write.
    const projectRoot = makeProjectRoot();

    const data = await runAggregate(projectRoot);

    const missing = data.reasons.filter((r) => r.kind === 'missing-evidence');
    expect(missing.length).toBeGreaterThan(0);
    for (const reason of missing) {
      expect(reason.hint).toContain(' | ');
      expect(reason.hint).toContain(`.peaks/_runtime/${SESSION_ID}/`);
    }
  });

  it('when the rid is absent from the flag, should refuse with the exact RID_REQUIRED code', async () => {
    // given: `--from-rid` passed as an empty string (an unset shell variable)
    // when:  the aggregate runs
    // then: the refusal is the exact RID_REQUIRED envelope, not a generic failure
    const projectRoot = makeProjectRoot();
    const stdout: string[] = [];
    const io: ProgramIO = { stdout: (s: string) => stdout.push(s), stderr: () => undefined };
    const program = new Command();
    registerVerdictAggregateCommands(program, io);

    await program.parseAsync(
      [
        'verdict',
        'aggregate',
        '--from-rid',
        '',
        '--sid',
        SESSION_ID,
        '--project',
        projectRoot,
        '--json'
      ],
      { from: 'user' }
    );

    // then: the refusal is the exact code, not a generic failure
    const envelope = JSON.parse(stdout.join('')) as {
      ok: boolean;
      code: string;
      message: string;
      nextActions: string[];
    };
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('RID_REQUIRED');
    expect(envelope.message).toBe('--from-rid is required');
    expect(envelope.nextActions).toEqual(['Re-run with --from-rid <rid>']);
    process.exitCode = undefined;
  });
});

describe('Scenario: (render) — the success envelope carries empty meta arrays, not sentinels', () => {
  it('when the aggregate succeeds, should report empty warnings and nextActions', async () => {
    // given: a fully-evidenced session
    // when: the aggregate runs
    // then: both meta arrays are EMPTY. The command passes `[]` and `[]` positionally, and the mutation report showed the array-literal substitutions surviving because nothing compared them.
    const projectRoot = makeProjectRoot();
    writeAllRidScopedEvidence(projectRoot);
    const stdout: string[] = [];
    const io: ProgramIO = { stdout: (s: string) => stdout.push(s), stderr: () => undefined };
    const program = new Command();
    registerVerdictAggregateCommands(program, io);

    await program.parseAsync(
      [
        'verdict',
        'aggregate',
        '--from-rid',
        RID,
        '--sid',
        SESSION_ID,
        '--project',
        projectRoot,
        '--json'
      ],
      { from: 'user' }
    );

    const envelope = JSON.parse(stdout.join('')) as {
      warnings: string[];
      nextActions: string[];
    };
    expect(envelope.warnings).toEqual([]);
    expect(envelope.nextActions).toEqual([]);
  });
});

describe('Scenario: (render) — the command advertises its own flags', () => {
  it('when the program is registered, should declare --from-rid as required and describe the two optional flags', () => {
    // given: a freshly built program
    // when: the leaf command is located through the registered tree
    // then: each flag's description is the exact string the help text prints. Nothing asserted these before, and the mutation report showed both description strings surviving as empty substitutions.
    const program = new Command();
    registerVerdictAggregateCommands(program, {
      stdout: () => undefined,
      stderr: () => undefined
    });

    const verdict = program.commands.find((c) => c.name() === 'verdict');
    expect(verdict).toBeDefined();
    const leaf = verdict?.commands.find((c) => c.name() === 'aggregate');
    expect(leaf).toBeDefined();

    const byLong = (long: string) => leaf?.options.find((o) => o.long === long);
    expect(byLong('--from-rid')?.description).toBe('request id, e.g. 2026-06-27-...');
    expect(byLong('--from-rid')?.mandatory).toBe(true);
    expect(byLong('--sid')?.description).toBe(
      'session id, e.g. 2026-06-27-session-...; default: project default'
    );
    expect(byLong('--project')?.description).toBe('project root (default: cwd)');
    expect(byLong('--json')?.description).toBe('print machine-readable JSON envelope');
    // The parent 'verdict' command's description is pinned too, and the leaf's
    // in full: both survived as empty-string substitutions before this arm.
    expect(verdict?.description()).toBe(
      'Aggregate the 5 envelope sources feeding peaks-code verdict logic'
    );
    expect(leaf?.description()).toBe(
      'Aggregate 5 envelope sources (security / perf / karpathy / mut / qa) and print the verdict + reasons JSON envelope. Used by peaks-code and peaks-final-review.'
    );
  });
});

describe('Scenario: (render) — each missing-evidence reason carries the full severity shape', () => {
  it('when a required source is absent, should emit signal=block, its own source twice, and the exact kind', async () => {
    // given: nothing written, so every required source misses
    // when: the aggregate runs
    // then: EVERY field of each reason is pinned. The mutation report showed `signal: 'block'` and `sources: [entry.source]` surviving as `""` and `[]` — shape assertions on `kind` alone cannot see them.
    const projectRoot = makeProjectRoot();

    const data = await runAggregate(projectRoot);

    const missing = data.reasons.filter((r) => r.kind === 'missing-evidence') as Array<{
      kind: string;
      source: string;
      signal: string;
      sources: string[];
      hint: string;
    }>;
    // THREE required sources: security, perf and karpathy (REQUIRED_SOURCES).
    expect(missing).toHaveLength(3);
    for (const reason of missing) {
      expect(reason.signal).toBe('block');
      expect(reason.sources).toEqual([reason.source]);
      expect(reason.kind).toBe('missing-evidence');
    }
    expect(missing.map((r) => r.source).sort()).toEqual([
      'karpathy-reviewer',
      'perf-audit',
      'security-audit'
    ]);
  });
});

describe('Scenario: (behavior) — the qa reader accepts both filename forms the writers emit', () => {
  it('when only the numbered-slug form exists, should still read the qa verdict', async () => {
    // given: a qa report written under the SECOND candidate the reader probes — `001-<slug>.md`, the numbered form `buildNumberedFilename` emits. Both candidate names are probed in order; the mutation report showed the loop and its second literal surviving, because every existing fixture writes only the bare `<rid>.md` form.
    // when: the aggregate runs
    // then: the numbered form is found, so qa is present rather than missing
    const projectRoot = makeProjectRoot();
    writeAllRidScopedEvidence(projectRoot);
    writeSessionFile(
      projectRoot,
      'qa/test-reports/001-2026-09-14-audit-artifact-rid-scoping.md',
      'verdict: pass\n'
    );

    const data = await runAggregate(projectRoot);

    expect(data.sources.qa).toBe('present');
  });

  it('when neither form exists, should report qa missing', async () => {
    // given: the required three, and no qa report at all
    // when: the aggregate runs
    // then: qa is missing, and it is not a required source so the verdict stands
    const projectRoot = makeProjectRoot();
    writeAllRidScopedEvidence(projectRoot);

    const data = await runAggregate(projectRoot);

    expect(data.sources.qa).toBe('missing');
    expect(data.verdict).toBe('pass');
  });
});

describe('Scenario: (render) — the success envelope names the command that produced it', () => {
  it('when the aggregate succeeds, should stamp the exact command identifier', async () => {
    // given: a fully-evidenced session
    // when: the aggregate runs
    // then: `command` is the literal 'verdict.aggregate'. The field is what downstream readers key on, and the mutation report showed the literal surviving as "" because only `verdict` and `sources` were ever asserted.
    const projectRoot = makeProjectRoot();
    writeAllRidScopedEvidence(projectRoot);
    const stdout: string[] = [];
    const io: ProgramIO = { stdout: (s: string) => stdout.push(s), stderr: () => undefined };
    const program = new Command();
    registerVerdictAggregateCommands(program, io);

    await program.parseAsync(
      [
        'verdict',
        'aggregate',
        '--from-rid',
        RID,
        '--sid',
        SESSION_ID,
        '--project',
        projectRoot,
        '--json'
      ],
      { from: 'user' }
    );

    const envelope = JSON.parse(stdout.join('')) as { command: string; ok: boolean };
    expect(envelope.command).toBe('verdict.aggregate');
    expect(envelope.ok).toBe(true);
  });
});

describe('Scenario: (a11y) — the refusals also work in TEXT mode', () => {
  it('when the rid is absent and --json is NOT passed, should print the text refusal to stderr', async () => {
    // given: an empty --from-rid with no --json flag
    // when: the aggregate runs
    // then: the refusal goes to STDERR as `code: message` + action lines. Every other guard arm passes --json, so `printResult`'s text branch was never exercised on this path — the mutation report showed the `asJson` argument surviving as `false`.
    const projectRoot = makeProjectRoot();
    const out: string[] = [];
    const err: string[] = [];
    const io: ProgramIO = { stdout: (s) => out.push(s), stderr: (s) => err.push(s) };
    const program = new Command();
    registerVerdictAggregateCommands(program, io);

    await program.parseAsync(
      ['verdict', 'aggregate', '--from-rid', '', '--sid', SESSION_ID, '--project', projectRoot],
      { from: 'user' }
    );

    expect(out).toEqual([]);
    expect(err).toEqual(['RID_REQUIRED: --from-rid is required', '- Re-run with --from-rid <rid>']);
    process.exitCode = undefined;
  });
});

describe('Scenario: (integration) — the karpathy envelope actually reaches the aggregator', () => {
  it('when the karpathy review blocks, should carry its verdict into the aggregate result', async () => {
    // given: the three required sources present, with karpathy saying BLOCK
    // when:  the aggregate runs
    // then:  the aggregate verdict is block BECAUSE of karpathy. The `sources.karpathy === 'present'` flag alone proves the file was READ, not that its envelope reached `aggregateVerdict`; the mutation report had the `sources.karpathy !== null ? … : null` ternary surviving as `false`, which drops the envelope while leaving the flag 'present'.
    const projectRoot = makeProjectRoot();
    writeSessionFile(projectRoot, `audit/security-${RID}.md`, PASS_AUDIT_JSON);
    writeSessionFile(projectRoot, `audit/perf-${RID}.md`, PASS_AUDIT_JSON);
    writeSessionFile(
      projectRoot,
      `rd/karpathy-review-${RID}.md`,
      'gateAction: block\npassed: false\n'
    );

    const data = await runAggregate(projectRoot);

    expect(data.sources.karpathy).toBe('present');
    // A `block` verdict with all three required sources PRESENT can only come
    // from the karpathy envelope reaching the aggregator: drop that ternary and
    // it falls back to the envelopes' own leaf verdicts, which are all pass.
    expect(data.verdict).toBe('block');
  });
});
