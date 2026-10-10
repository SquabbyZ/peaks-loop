// tests/unit/code/step-08-gate.test.ts
//
// 4-dimension unit test for src/services/code/step-08-gate.ts.
//
// Slice 2026-07-31-rid-step-08-gate-silent-catch-sweep narrows the silent
// catch inside the file-local `readProgressIfAny` helper:
//
//   catch #1  readFileSync(path, 'utf8') + JSON.parse(raw)  — was `catch { return null }`
//
// Pre-rid the catch swallowed ALL errors — including `ReferenceError`
// (ESM module-load bugs) and `SyntaxError` (parse bugs from a corrupt
// `.peaks/_runtime/<sid>/job/<jid>/progress.json`). This is the exact
// anti-fake-green pattern the rid-001 family has been closing since
// 2026-07-31: rid-001-r2 (readClaudeTranscriptFallback), rid-001-r3
// (readClaudeStatuslinePercent), rid-presence-marker-silent-catch-sweep
// (readPresenceFile), rid-post-compact-detector-silent-catch-sweep
// (safeReadCheckpoint + readActiveSkillName).
//
// Because step-08-gate is the load-bearing PreToolUse gate that prints
// the `Next: slice #<N+1> of <M> (<currentSlice>)` line to the LLM BEFORE
// every Bash call lands in a Job session, a corrupt progress.json would
// have silently masked the corruption — the gate would have reported
// `nextSliceLine: null` instead of surfacing the corruption.
//
// Post-rid the catch re-throws `ReferenceError` / `SyntaxError` to the
// caller while still swallowing IO errors (`ENOENT`, `EACCES`, …) — the
// original "progress file unreadable" semantic.
//
// We drive the public `evaluateStep08` export rather than break the
// file-local `readProgressIfAny` symbol loose, because that helper is not
// part of the package surface and exposing it just for testing would
// create fake-green backwards-compat pressure.
//
// A later change added the three-state arms for a MISSING `job-shape.json`
// (service verdicts plus the registered CLI command), which is where the
// render and a11y dimensions come from.
//
// Dimensions covered: render (the envelope's `mode` / `data` shape across the
// three states), behavior (broken progress.json surfaces; the verdict per state
// of a missing `job-shape.json`), integration (a real fs tree under a tmp
// project root, plus the registered command's exit code and streams), a11y (the
// BLOCKED stderr line and the reason text a reader acts on).
//
// Run with: pnpm vitest run tests/unit/code/step-08-gate.test.ts

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { declareDimensions } from '../_setup/4dim-template.js';

// Slice 2026-07-31-rid-step-08-gate-silent-catch-sweep needs to verify
// that an IO error raised inside the readProgressIfAny readFileSync block
// is STILL silently swallowed (the original "progress file unreadable"
// semantic must be preserved), while a SyntaxError from JSON.parse
// SURFACES. ESM module namespaces are frozen, so
// `vi.spyOn(fsModule, 'readFileSync')` fails at runtime with "Cannot
// redefine property: readFileSync" — the same constraint already
// documented in rid-001-r2 and rid-presence-marker-silent-catch-sweep.
//
// The accepted workaround is a per-file `vi.mock('node:fs', …)` with a
// hoisted, controllable replacement. `vi.hoisted` is required because
// `vi.mock` is hoisted to the top of the file BEFORE all imports, and the
// factory must reference a value that exists at hoist time.
const __fsMocks = vi.hoisted(() => ({
  // Default: pass-through to real implementation. Each test can override
  // before triggering the call.
  readFileSync: null as unknown as ((...args: unknown[]) => unknown) | null,
  // Narrow the mock to only intercept progress.json reads — let the
  // readFileSync inside `readJobShapeDecision` (job-shape.json) pass
  // through to the real implementation so the gate actually reaches
  // `readProgressIfAny` instead of falling into the JOB_SHAPE_NOT_DECIDED
  // fail-closed branch first.
  pathMatch: null as RegExp | null
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    readFileSync: (...args: unknown[]) => {
      const p = args[0];
      if (typeof p === 'string' && __fsMocks.pathMatch && __fsMocks.pathMatch.test(p)) {
        if (__fsMocks.readFileSync) {
          return __fsMocks.readFileSync(...args);
        }
      }
      return (actual.readFileSync as (...a: unknown[]) => unknown)(...args);
    }
  };
});

// Import AFTER the `vi.mock` above so the mocked `node:fs` is bound to the
// module under test.
const { evaluateStep08 } = await import('../../../src/services/code/step-08-gate.js');
const { registerCodeGateStep08Command } =
  await import('../../../src/cli/commands/code-gate-step-08-command.js');
const { writeJobShapeDecision } = await import('../../../src/services/code/job-shape-decision.js');

declareDimensions(
  'tests/unit/code/step-08-gate.test.ts',
  ['behavior', 'integration', 'render', 'a11y'],
  []
);

// -- helpers ----------------------------------------------------------------
//
// Build the canonical `.peaks/_runtime/<sid>/job-shape.json` shape
// required by `readJobShapeDecision`'s zod schema (JobShapeRecordSchema).
// Strict-typed so a typo in one field fails at the writer rather than at
// `readJobShapeDecision`'s validator (which would mask the test setup as
// "file not decided").
function writeValidJobShapeDecision(tmpDir: string, sessionId: string): void {
  const runtimeDir = join(tmpDir, '.peaks', '_runtime', sessionId);
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'job-shape.json'),
    JSON.stringify({
      sessionId,
      promptHash: 'da39a3ee5e6b4b0d', // sha1("") prefix16 — deterministic, schema-compliant
      decision: {
        isJob: true,
        rationale: 'slice 2026-07-31-rid-step-08-gate-silent-catch-sweep test fixture',
        suggestedJobId: 'rid-step-08-gate-test',
        suggestedStrategy: 'single',
        confidence: 'high',
        decidedAt: new Date().toISOString()
      },
      schemaVersion: 1
    }),
    'utf8'
  );
}

// Slice 2026-07-31-rid-step-08-gate-silent-catch-sweep narrows the silent
// catch in `readProgressIfAny`. Pre-rid it swallowed ALL errors
// (including ReferenceError, SyntaxError) which would have hidden any
// rid-001-r1-class ESM regression if the same shape ever applied to a
// progress-file read.
//
// The tests below pin both halves of the contract from the public surface:
//
//   Case A: SyntaxError from JSON.parse on a broken progress.json bubbles
//           up through evaluateStep08 (NOT swallowed → caller sees the
//           corruption).
//   Case B: IO error (EACCES-style) raised by readFileSync against an
//           existing progress.json is STILL swallowed (backward-compat:
//           progress-unreadable semantic preserved, gate still returns
//           allow-job with progress: null).
describe('Scenario: behavior — readProgressIfAny catch narrows to IO errors only', () => {
  it('when invoked, should Case A: SyntaxError from broken progress.json surfaces to caller (NOT swallowed)', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // Build a tmp project with the canonical progress.json path containing
    // INVALID JSON. existsSync returns true → readFileSync runs →
    // JSON.parse throws SyntaxError. Post-rid the catch MUST re-throw
    // instead of returning null — this is the same anti-fake-green
    // contract pinned by rid-001-r2 / rid-001-r3 / presence-marker sweep /
    // post-compact-detector sweep.
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-step08-syntax-'));
    const sessionId = '2026-07-31-test-session-step08';
    writeValidJobShapeDecision(tmpDir, sessionId);
    // Now seed the progress.json under the job/<jid>/ dir that
    // readProgressIfAny reads. suggestedJobId is 'rid-step-08-gate-test'
    // (3-40 chars, lowercase, matches SUGGESTED_JID_RE /^[a-z0-9][a-z0-9-]{2,40}$/).
    const jobDir = join(tmpDir, '.peaks', '_runtime', sessionId, 'job', 'rid-step-08-gate-test');
    mkdirSync(jobDir, { recursive: true });
    writeFileSync(join(jobDir, 'progress.json'), '{ this is not valid JSON :: ', 'utf8');
    // Discriminate: only intercept progress.json reads so the
    // readFileSync inside `readJobShapeDecision` (job-shape.json) still
    // passes through to the real fs and the gate actually reaches
    // `readProgressIfAny`.
    __fsMocks.pathMatch = /progress\.json$/;
    try {
      // We expect evaluateStep08 to re-throw the SyntaxError.
      expect(() =>
        evaluateStep08({
          sessionId,
          projectRoot: tmpDir
        })
      ).toThrow(SyntaxError);
    } finally {
      __fsMocks.pathMatch = null;
    }
  });

  it('when invoked, should Case B: IO error from readFileSync against existing progress.json returns allow-job with progress: null (still swallowed)', () => {
    // given: the test setup
    // when:  the function under test is invoked
    // then:  the result matches the expectation
    // Backward-compat: the original "progress file unreadable" semantic
    // MUST be preserved for genuine IO failures (EACCES on a read-protected
    // progress.json). We simulate one by throwing what Node ACTUALLY throws —
    // an Error carrying `code: 'EACCES'` — so the catch's predicate
    // (`isExpectedFsMiss`) sees the shape production sees.
    //
    // S6 (2026-09-15): this fixture used to throw a plain Error whose MESSAGE
    // said "EACCES", and passed because the old catch rethrew only
    // ReferenceError / SyntaxError. The assertion below is unchanged; only the
    // fixture now matches the situation it claims to simulate. See the new
    // Case C for the half the old rule got backwards.
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-step08-io-'));
    const sessionId = '2026-07-31-test-session-step08-io';
    writeValidJobShapeDecision(tmpDir, sessionId);
    // Seed a valid progress.json so existsSync returns true and the
    // readFileSync inside the try block is reached.
    const jobDir = join(tmpDir, '.peaks', '_runtime', sessionId, 'job', 'rid-step-08-gate-test');
    mkdirSync(jobDir, { recursive: true });
    writeFileSync(
      join(jobDir, 'progress.json'),
      JSON.stringify({
        jobId: 'rid-step-08-gate-test',
        done: 1,
        total: 3,
        currentSlice: 'rid-step-08-gate-test-slice-2',
        lastCommitSha: null,
        updatedAt: new Date().toISOString()
      }),
      'utf8'
    );
    __fsMocks.pathMatch = /progress\.json$/;
    __fsMocks.readFileSync = () => {
      throw Object.assign(new Error('EACCES: permission denied, open progress.json'), {
        code: 'EACCES',
        errno: -13,
        syscall: 'open'
      });
    };
    try {
      const out = evaluateStep08({
        sessionId,
        projectRoot: tmpDir
      });
      // IO error path → progress unreadable → falls through to
      // progress: null, nextSliceLine: null (allow with no resume context).
      expect(out.allow).toBe(true);
      expect(out.verdict.kind).toBe('allow-job');
      if (out.verdict.kind === 'allow-job') {
        expect(out.verdict.progress).toBeNull();
      }
      expect(out.nextSliceLine).toBeNull();
    } finally {
      __fsMocks.readFileSync = null;
      __fsMocks.pathMatch = null;
    }
  });

  it('when invoked, should Case C: a NON-IO error from readFileSync surfaces to caller (NOT swallowed)', () => {
    // S6 (2026-09-15) — the half the old rule got backwards.
    //
    // The pre-S6 catch rethrew `ReferenceError` and `SyntaxError` by name and
    // swallowed everything else, so the more unexpected the failure the more
    // certainly it was hidden: this gate would read "no progress yet" and
    // ALLOW the call. Step 0.8 is a fail-closed gate, so a swallowed failure
    // here is a gate that reports allow. The rule is now the other way round:
    // swallow the fs-miss codes, propagate the rest. This case fails against
    // the old code by design.
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-step08-nonio-'));
    const sessionId = '2026-07-31-test-session-step08-nonio';
    writeValidJobShapeDecision(tmpDir, sessionId);
    const jobDir = join(tmpDir, '.peaks', '_runtime', sessionId, 'job', 'rid-step-08-gate-test');
    mkdirSync(jobDir, { recursive: true });
    writeFileSync(join(jobDir, 'progress.json'), '{"done":1}', 'utf8');
    __fsMocks.pathMatch = /progress\.json$/;
    __fsMocks.readFileSync = () => {
      throw new TypeError('progress record is not an object');
    };
    try {
      expect(() =>
        evaluateStep08({
          sessionId,
          projectRoot: tmpDir
        })
      ).toThrow(TypeError);
    } finally {
      __fsMocks.readFileSync = null;
      __fsMocks.pathMatch = null;
    }
  });
});

// The three states of a MISSING `job-shape.json`. The gate runs on EVERY Bash
// call in EVERY session, so the rule is not "block more" — a normal non-Job
// session must keep passing through. What changes is the CLAIM (it reported
// "most prompts are not Job-shaped", a judgement it had no basis for) plus one
// state that really is broken: a Job ledger with no decision means
// `peaks job init` ran and `peaks code detect-job` did not.

const STEP08_STATE_SESSION = '2026-10-10-session-step08-states';

/** `.peaks/_runtime/<sid>/job/<jid>/state.json` — `peaks job init`'s output. */
function writeJobLedger(tmpDir: string, sessionId: string, jid: string): void {
  const jobDir = join(tmpDir, '.peaks', '_runtime', sessionId, 'job', jid);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(
    join(jobDir, 'state.json'),
    JSON.stringify({ jobId: jid, slices: [{ status: 'pending' }] }),
    'utf8'
  );
}

interface Step08Envelope {
  readonly ok: boolean;
  readonly code?: string;
  readonly data: Record<string, unknown>;
  readonly nextActions: readonly string[];
}

async function runGateStep08Cli(
  tmpDir: string,
  prompt: string
): Promise<{
  readonly envelope: Step08Envelope;
  readonly stderr: string;
  /** Exactly what `process.exitCode` holds — unset means the process exits 0. */
  readonly exitCode: typeof process.exitCode;
}> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const program = new Command();
  registerCodeGateStep08Command(program, {
    stdout: (s: string) => stdout.push(s),
    stderr: (s: string) => stderr.push(s)
  });
  const before = process.exitCode;
  await program.parseAsync(
    [
      'gate-step-08',
      '--project',
      tmpDir,
      '--session-id',
      STEP08_STATE_SESSION,
      '--prompt',
      prompt,
      '--json'
    ],
    { from: 'user' }
  );
  const exitCode = process.exitCode;
  process.exitCode = before;
  return {
    envelope: JSON.parse(stdout.join('')) as Step08Envelope,
    stderr: stderr.join(''),
    exitCode
  };
}

describe('(behavior) a missing job-shape.json is reported for what it is', () => {
  it('row 1 — a decision on disk still reports the Job and its next slice', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-step08-row1-'));
    writeJobShapeDecision(
      tmpDir,
      STEP08_STATE_SESSION,
      {
        isJob: true,
        rationale: 'row 1 fixture',
        suggestedJobId: 'step08-states-job',
        suggestedStrategy: 'single',
        confidence: 'high',
        prompt: 'row 1 prompt'
      },
      { force: true }
    );

    const out = evaluateStep08({ sessionId: STEP08_STATE_SESSION, projectRoot: tmpDir });

    expect(out.allow).toBe(true);
    expect(out.verdict.kind).toBe('allow-job');
  });

  it('row 2 — no decision and no ledger allows, and says the decision is missing', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-step08-row2-'));

    const out = evaluateStep08({
      sessionId: STEP08_STATE_SESSION,
      projectRoot: tmpDir,
      prompt: 'fix the auth bug'
    });

    expect(out.allow).toBe(true);
    expect(out.verdict.kind).toBe('allow-no-decision-recorded');
    if (out.verdict.kind !== 'allow-no-decision-recorded') throw new Error('unreachable');
    // The arm asserts the REASON, not just the allow: asserting `allow` alone
    // is what let the old sentence — a judgement the gate never made — survive.
    expect(out.verdict.reason).toMatch(/no job-shape decision was recorded/i);
    expect(out.verdict.reason).not.toMatch(/most prompts are not Job-shaped/i);
  });

  it('row 3 — no decision but a Job ledger is refused, and names the missing step', () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-step08-row3-'));
    writeJobLedger(tmpDir, STEP08_STATE_SESSION, 'step08-states-aware-job');

    const out = evaluateStep08({
      sessionId: STEP08_STATE_SESSION,
      projectRoot: tmpDir,
      prompt: 'fix the auth bug'
    });

    expect(out.allow).toBe(false);
    expect(out.verdict.kind).toBe('block-no-decision-with-ledger');
    if (out.verdict.kind !== 'block-no-decision-with-ledger') throw new Error('unreachable');
    expect(out.verdict.ledgerJobIds).toEqual(['step08-states-aware-job']);
    expect(out.verdict.reason).toContain('peaks job init');
    expect(out.verdict.reason).toContain('peaks code detect-job');
  });

  it('row 3 does not fire on a ledger belonging to a DIFFERENT session', () => {
    // A neighbour session's Job must not block this session's Bash calls.
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-step08-row3-other-'));
    writeJobLedger(tmpDir, '2026-10-09-session-neighbour', 'neighbour-job');

    const out = evaluateStep08({
      sessionId: STEP08_STATE_SESSION,
      projectRoot: tmpDir,
      prompt: 'fix the auth bug'
    });

    expect(out.allow).toBe(true);
    expect(out.verdict.kind).toBe('allow-no-decision-recorded');
  });
});

describe('(integration) the gate exit codes — a normal session passes, the broken one is refused', () => {
  it('AC3: a normal non-Job session still gets allow, and exit 0', async () => {
    // The blast radius: the row-2 path must keep passing through untouched.
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-step08-cli-ok-'));

    const run = await runGateStep08Cli(tmpDir, 'fix the auth bug');

    // An allowing run never assigns `process.exitCode`, so the process exits 0
    // — the value the PreToolUse hook reads. Anything non-zero would block a
    // Bash call in a session that has nothing wrong with it.
    expect(run.exitCode ?? 0).toBe(0);
    expect(run.envelope.ok).toBe(true);
    expect(run.envelope.data.allow).toBe(true);
    expect(run.envelope.data.mode).toBe('undecided-no-regex-hit');
  });

  it('AC2: the allowed-but-undecided envelope states the absence, not a judgement', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-step08-cli-reason-'));

    const run = await runGateStep08Cli(tmpDir, 'fix the auth bug');

    const reason = run.envelope.nextActions[0] ?? '';
    expect(reason).toMatch(/no job-shape decision was recorded/i);
    expect(reason).not.toMatch(/most prompts are not Job-shaped/i);
  });

  it('refuses exit 2 with a BLOCKED stderr line when a ledger has no decision', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-step08-cli-ledger-'));
    writeJobLedger(tmpDir, STEP08_STATE_SESSION, 'step08-states-aware-job');

    const run = await runGateStep08Cli(tmpDir, 'fix the auth bug');

    expect(run.exitCode).toBe(2);
    expect(run.envelope.ok).toBe(false);
    expect(run.envelope.code).toBe('STEP_08_BLOCKED_WITH_LEDGER');
    expect(run.stderr).toMatch(/^BLOCKED:/);
    expect(run.envelope.data.ledgerJobIds).toEqual(['step08-states-aware-job']);
  });

  it('keeps the prompt-shape block byte-for-byte on its own path', async () => {
    // The regex is a separate reason to block and must not have moved.
    const tmpDir = mkdtempSync(join(tmpdir(), 'peaks-step08-cli-regex-'));

    const run = await runGateStep08Cli(tmpDir, '继续执行下个 slice,直到全部添加完');

    expect(run.exitCode).toBe(2);
    expect(run.envelope.code).toBe('STEP_08_BLOCKED');
    expect(run.envelope.data.promptSource).toBe('flag');
  });
});

describe('(render) the emitted envelope shape per state', () => {
  it('keeps the mode + null-decision shape on the allow path, and the ledger ids on the block path', async () => {
    const allowed = await runGateStep08Cli(
      mkdtempSync(join(tmpdir(), 'peaks-step08-render-ok-')),
      'fix the auth bug'
    );
    expect(allowed.envelope.data).toMatchObject({
      allow: true,
      mode: 'undecided-no-regex-hit',
      decision: null,
      nextSlice: null,
      promptSource: 'flag'
    });

    const ledgerDir = mkdtempSync(join(tmpdir(), 'peaks-step08-render-ledger-'));
    writeJobLedger(ledgerDir, STEP08_STATE_SESSION, 'step08-states-aware-job');

    const blocked = await runGateStep08Cli(ledgerDir, 'fix the auth bug');

    expect(blocked.envelope.data.ledgerJobIds).toEqual(['step08-states-aware-job']);
    expect(blocked.envelope.data.backupRegex).toMatch(/until all done/);
  });
});
