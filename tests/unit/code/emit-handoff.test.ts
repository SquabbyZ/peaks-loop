// tests/unit/code/emit-handoff.test.ts
//
// The Step 11 refusal point. `peaks code emit-handoff` refused a completed
// Job's *remaining* slices and said nothing about a Job that completed while
// the session sedimented no memory, so Step 11's BLOCKING rule had no refusal
// point beyond prose in a SKILL.md.
//
// The sediment question is put to the memory index (`.peaks/memory/index.json`),
// which both `peaks memory extract --apply` paths rebuild and whose entries
// record the `sourceArtifact` each memory came from. No mtime is read. When the
// index cannot be read, or is not the shape this reader knows, the handoff is
// REFUSED — cannot tell is not a pass.
//
// Dimensions covered: render (envelope shape), behavior (verdict per state,
// including the fail-closed ones), integration (a real temp tree read by the
// registered command, and its exit code), a11y (the block's stderr, message and
// nextActions).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';

import { declareDimensions } from '../_setup/4dim-template.js';
import { registerCodeEmitHandoffCommand } from '~/src/cli/commands/code-emit-handoff-command';
import type { ProgramIO } from '~/src/cli/cli-helpers';
import {
  evaluateEmitHandoff,
  JOB_COMPLETED_NO_SEDIMENT,
  JOB_NOT_INITIALIZED,
  JOB_REMAINING_BLOCKED
} from '~/src/services/code/emit-handoff';
import { writeJobShapeDecision } from '~/src/services/code/job-shape-decision';

declareDimensions('tests/unit/code/emit-handoff.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const SESSION_ID = '2026-10-10-session-emithandoff';
const JOB_ID = 'emit-handoff-test-job';
const FIXED_NOW = new Date('2026-10-10T12:00:00.000Z');
const OVERRIDE_REASON = 'user approved shipping without memory';

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
  const root = mkdtempSync(join(tmpdir(), 'peaks-emit-handoff-'));
  roots.push(root);
  return root;
}

function sessionDir(projectRoot: string): string {
  return join(projectRoot, '.peaks', '_runtime', SESSION_ID);
}

/** `peaks code detect-job` — the real writer, so the record is the real shape. */
function writeDecision(projectRoot: string, isJob: boolean): void {
  writeJobShapeDecision(
    projectRoot,
    SESSION_ID,
    {
      isJob,
      rationale: 'emit-handoff unit-test rationale',
      suggestedJobId: JOB_ID,
      suggestedStrategy: 'single',
      confidence: 'high',
      prompt: 'emit-handoff unit-test prompt'
    },
    { now: () => FIXED_NOW, force: true }
  );
}

/** `peaks job init` — the ledger the remaining-count is read from. */
function writeLedger(projectRoot: string, statuses: readonly string[]): void {
  const dir = join(sessionDir(projectRoot), 'job', JOB_ID);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'state.json'),
    JSON.stringify({ jobId: JOB_ID, slices: statuses.map((status) => ({ status })) }, null, 2),
    'utf8'
  );
}

/**
 * The memory index in the full shape `emptyIndex()` writes. `sourceArtifacts`
 * is the session's sediment as the index records it; `null` stands for the
 * hand-written memories that carry no source artifact.
 */
function writeMemoryIndex(projectRoot: string, sourceArtifacts: readonly (string | null)[]): void {
  const dir = join(projectRoot, '.peaks', 'memory');
  mkdirSync(dir, { recursive: true });
  const seed = sourceArtifacts.map((sourceArtifact, index) => ({
    name: `memory-${index}`,
    kind: 'lesson',
    description: 'a sedimented memory',
    sourcePath: join(dir, `memory-${index}.md`),
    sourceArtifact,
    updatedAt: '2026-10-10'
  }));
  writeFileSync(
    join(dir, 'index.json'),
    JSON.stringify(
      {
        version: 1,
        updatedAt: FIXED_NOW.toISOString(),
        hot: { rule: [], lesson: seed },
        warm: { decision: [], convention: [] }
      },
      null,
      2
    ),
    'utf8'
  );
}

/** A body the reader must treat as "cannot tell", whatever its reason. */
function writeRawMemoryIndex(projectRoot: string, body: string): void {
  const dir = join(projectRoot, '.peaks', 'memory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.json'), body, 'utf8');
}

function thisSessionArtifact(): string {
  return `.peaks/_runtime/${SESSION_ID}/txt/handoff.md`;
}

interface Envelope {
  readonly ok: boolean;
  readonly code?: string;
  readonly message?: string;
  readonly data: Record<string, unknown>;
  readonly nextActions: readonly string[];
}

interface CliRun {
  readonly envelope: Envelope;
  readonly stderr: string;
  /** Exactly what `process.exitCode` holds — unset means the process exits 0. */
  readonly exitCode: typeof process.exitCode;
}

async function runEmitHandoffCli(
  projectRoot: string,
  extra: readonly string[] = []
): Promise<CliRun> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const io: ProgramIO = {
    stdout: (s: string) => stdout.push(s),
    stderr: (s: string) => stderr.push(s)
  };
  const program = new Command();
  registerCodeEmitHandoffCommand(program, io);
  await program.parseAsync(
    ['emit-handoff', '--project', projectRoot, '--session-id', SESSION_ID, ...extra, '--json'],
    { from: 'user' }
  );
  return {
    envelope: JSON.parse(stdout.join('')) as Envelope,
    stderr: stderr.join(''),
    exitCode: process.exitCode
  };
}

/** A completed Job with an empty memory index: the shape this refusal is for. */
function completedJobWithNoSediment(): string {
  const projectRoot = makeProjectRoot();
  writeDecision(projectRoot, true);
  writeLedger(projectRoot, ['done']);
  writeMemoryIndex(projectRoot, []);
  return projectRoot;
}

describe('(behavior) a completed Job must have sedimented, or be allowed not to', () => {
  it('refuses a completed Job whose session sedimented nothing', () => {
    // given: the Job is done and the memory index names no memory for it
    const projectRoot = completedJobWithNoSediment();

    // when: the handoff is evaluated
    const verdict = evaluateEmitHandoff({ projectRoot, sessionId: SESSION_ID });

    // then: refused, and the refusal says which state it read
    expect(verdict.kind).toBe('block-no-sediment');
    if (verdict.kind !== 'block-no-sediment') throw new Error('unreachable');
    expect(verdict.code).toBe(JOB_COMPLETED_NO_SEDIMENT);
    expect(verdict.jobId).toBe(JOB_ID);
    expect(verdict.sedimentState).toBe('none');
  });

  it('allows a completed Job whose session DID sediment — the inverse direction', () => {
    // given: the same completed Job, but the index carries a memory extracted
    //        from this session's own runtime directory
    const projectRoot = makeProjectRoot();
    writeDecision(projectRoot, true);
    writeLedger(projectRoot, ['done', 'done']);
    writeMemoryIndex(projectRoot, [thisSessionArtifact()]);

    // when: the handoff is evaluated
    const verdict = evaluateEmitHandoff({ projectRoot, sessionId: SESSION_ID });

    // then: allowed. Without this arm the block could be unconditional and the
    //       suite would not notice.
    expect(verdict).toEqual({ kind: 'allow-done', remaining: 0 });
  });

  it('ignores a memory extracted from a DIFFERENT session', () => {
    // The link is the session's own runtime directory, so a neighbour's
    // sediment must not be read as this session's.
    const projectRoot = completedJobWithNoSediment();
    writeMemoryIndex(projectRoot, ['.peaks/_runtime/2026-10-09-session-other/txt/handoff.md']);

    expect(evaluateEmitHandoff({ projectRoot, sessionId: SESSION_ID }).kind).toBe(
      'block-no-sediment'
    );
  });

  it('refuses when the memory index is absent — cannot tell is not a pass', () => {
    // given: a completed Job and no `.peaks/memory/` at all
    const projectRoot = makeProjectRoot();
    writeDecision(projectRoot, true);
    writeLedger(projectRoot, ['done']);

    // when: the handoff is evaluated
    const verdict = evaluateEmitHandoff({ projectRoot, sessionId: SESSION_ID });

    // then: refused, and the state says WHY it could not be answered
    expect(verdict.kind).toBe('block-no-sediment');
    if (verdict.kind !== 'block-no-sediment') throw new Error('unreachable');
    expect(verdict.sedimentState).toBe('unknown');
  });

  it('refuses when the memory index is malformed JSON', () => {
    const projectRoot = completedJobWithNoSediment();
    writeRawMemoryIndex(projectRoot, '{ this is not JSON :: ');

    const verdict = evaluateEmitHandoff({ projectRoot, sessionId: SESSION_ID });

    expect(verdict.kind).toBe('block-no-sediment');
    if (verdict.kind !== 'block-no-sediment') throw new Error('unreachable');
    expect(verdict.sedimentState).toBe('unknown');
  });

  it('refuses when the index is JSON but not the shape this reader knows', () => {
    // given: a list where the two buckets are expected — a shape deviation has
    //        to read as "cannot tell", never as "no entries"
    const projectRoot = completedJobWithNoSediment();
    writeRawMemoryIndex(projectRoot, '[]');

    const verdict = evaluateEmitHandoff({ projectRoot, sessionId: SESSION_ID });

    expect(verdict.kind).toBe('block-no-sediment');
    if (verdict.kind !== 'block-no-sediment') throw new Error('unreachable');
    expect(verdict.sedimentState).toBe('unknown');
  });

  it('refuses an override that carries no reason', () => {
    // given: `--force-no-sediment ""` — the flag was typed, the justification
    //        was not, so the block stands
    const projectRoot = completedJobWithNoSediment();

    const verdict = evaluateEmitHandoff({
      projectRoot,
      sessionId: SESSION_ID,
      forceNoSedimentReason: '   '
    });

    expect(verdict.kind).toBe('block-no-sediment');
  });

  it('allows on a reasoned override and carries the reason it was given', () => {
    const projectRoot = completedJobWithNoSediment();

    const verdict = evaluateEmitHandoff({
      projectRoot,
      sessionId: SESSION_ID,
      forceNoSedimentReason: `  ${OVERRIDE_REASON}  `
    });

    expect(verdict.kind).toBe('allow-forced-no-sediment');
    if (verdict.kind !== 'allow-forced-no-sediment') throw new Error('unreachable');
    // Trimmed, but not invented: the reason the user gave is what is recorded.
    expect(verdict.reason).toBe(OVERRIDE_REASON);
    expect(verdict.sedimentState).toBe('none');
  });

  it('still refuses a remaining Job, and the sediment arms cannot mask it', () => {
    const projectRoot = makeProjectRoot();
    writeDecision(projectRoot, true);
    writeLedger(projectRoot, ['done', 'pending', 'pending']);
    writeMemoryIndex(projectRoot, [thisSessionArtifact()]);

    const verdict = evaluateEmitHandoff({ projectRoot, sessionId: SESSION_ID });

    expect(verdict.kind).toBe('block-remaining');
    if (verdict.kind !== 'block-remaining') throw new Error('unreachable');
    expect(verdict.code).toBe(JOB_REMAINING_BLOCKED);
    expect(verdict.remaining).toBe(2);
  });
});

describe('(behavior) the verdicts that existed before this refusal are unchanged', () => {
  it('allows a non-Job session with no sediment, as it always did', () => {
    // The refusal is scoped to a completed JOB. A non-Job session is not
    // obliged to sediment by this gate, so it passes through untouched.
    const projectRoot = makeProjectRoot();
    writeDecision(projectRoot, false);

    expect(evaluateEmitHandoff({ projectRoot, sessionId: SESSION_ID })).toEqual({
      kind: 'allow-not-job'
    });
  });

  it('allows when no job-shape decision was ever recorded', () => {
    const projectRoot = makeProjectRoot();
    mkdirSync(sessionDir(projectRoot), { recursive: true });

    expect(evaluateEmitHandoff({ projectRoot, sessionId: SESSION_ID })).toEqual({
      kind: 'allow-not-job'
    });
  });

  it('blocks a Job whose ledger was never initialized', () => {
    const projectRoot = makeProjectRoot();
    writeDecision(projectRoot, true);

    const verdict = evaluateEmitHandoff({ projectRoot, sessionId: SESSION_ID });

    expect(verdict.kind).toBe('block-not-initialized');
    if (verdict.kind !== 'block-not-initialized') throw new Error('unreachable');
    expect(verdict.code).toBe(JOB_NOT_INITIALIZED);
  });

  it('still lets --force-under-job override a remaining Job', () => {
    const projectRoot = makeProjectRoot();
    writeDecision(projectRoot, true);
    writeLedger(projectRoot, ['pending']);

    const verdict = evaluateEmitHandoff({
      projectRoot,
      sessionId: SESSION_ID,
      forceUnderJob: true
    });

    expect(verdict).toEqual({ kind: 'allow-force-override', remaining: 1 });
  });

  it('does not let --force-under-job double as a no-sediment override', () => {
    // The two overrides answer different questions. `--force-under-job` is
    // about remaining work, so it must not open the sediment gate too.
    const projectRoot = completedJobWithNoSediment();

    const verdict = evaluateEmitHandoff({
      projectRoot,
      sessionId: SESSION_ID,
      forceUnderJob: true
    });

    expect(verdict.kind).toBe('block-no-sediment');
  });
});

describe('(integration) the CLI turns the block into a non-zero exit and the override into a pass', () => {
  it('exits 1 with a BLOCKED stderr line on a completed Job with no sediment', async () => {
    const run = await runEmitHandoffCli(completedJobWithNoSediment());

    expect(run.exitCode).toBe(1);
    expect(run.envelope.ok).toBe(false);
    expect(run.envelope.code).toBe(JOB_COMPLETED_NO_SEDIMENT);
    expect(run.stderr).toMatch(/^BLOCKED:/);
  });

  it('exits 0 when the session sedimented', async () => {
    const projectRoot = makeProjectRoot();
    writeDecision(projectRoot, true);
    writeLedger(projectRoot, ['done']);
    writeMemoryIndex(projectRoot, [thisSessionArtifact()]);

    const run = await runEmitHandoffCli(projectRoot);

    expect(run.exitCode).toBeUndefined();
    expect(run.envelope.ok).toBe(true);
    expect(run.envelope.data.mode).toBe('job-done');
  });

  it('exits 0 on a reasoned override and records the reason in the envelope', async () => {
    const run = await runEmitHandoffCli(completedJobWithNoSediment(), [
      '--force-no-sediment',
      OVERRIDE_REASON
    ]);

    expect(run.exitCode).toBeUndefined();
    expect(run.envelope.ok).toBe(true);
    expect(run.envelope.data.mode).toBe('job-forced-no-sediment');
    expect(run.envelope.data.approvedNoSedimentReason).toBe(OVERRIDE_REASON);
  });

  it('still exits 1 for a remaining Job, and 0 when --force-under-job overrides it', async () => {
    const projectRoot = makeProjectRoot();
    writeDecision(projectRoot, true);
    writeLedger(projectRoot, ['pending']);
    writeMemoryIndex(projectRoot, [thisSessionArtifact()]);

    const blocked = await runEmitHandoffCli(projectRoot);
    expect(blocked.exitCode).toBe(1);
    expect(blocked.envelope.code).toBe(JOB_REMAINING_BLOCKED);
    process.exitCode = undefined;

    const forced = await runEmitHandoffCli(projectRoot, ['--force-under-job']);
    expect(forced.exitCode).toBeUndefined();
    expect(forced.envelope.data.mode).toBe('job-force-override');
  });
});

describe('(render) the block envelope names the state it read', () => {
  it('carries mode=job-done and the remaining count on the pass path', async () => {
    const projectRoot = makeProjectRoot();
    writeDecision(projectRoot, true);
    writeLedger(projectRoot, ['done', 'done']);
    writeMemoryIndex(projectRoot, [thisSessionArtifact()]);

    const run = await runEmitHandoffCli(projectRoot);

    expect(run.envelope.data).toMatchObject({ allow: true, mode: 'job-done', remaining: 0 });
  });

  it('distinguishes "sedimented nothing" from "could not tell" in the envelope data', async () => {
    const noIndex = makeProjectRoot();
    writeDecision(noIndex, true);
    writeLedger(noIndex, ['done']);

    const first = await runEmitHandoffCli(completedJobWithNoSediment());
    expect(first.envelope.data.sedimentState).toBe('none');
    process.exitCode = undefined;

    const second = await runEmitHandoffCli(noIndex);
    expect(second.envelope.data.sedimentState).toBe('unknown');
  });
});

describe('(a11y) the block tells the reader which step is missing and how to remedy it', () => {
  it('names the step and the state, and never claims a sediment it did not read', async () => {
    const run = await runEmitHandoffCli(completedJobWithNoSediment());

    const message = run.envelope.message ?? '';
    expect(message).toContain('Step 11');
    expect(message).toContain('sedimented no memory');
    expect(message).not.toContain('could not be read');
  });

  it('offers the sediment remedy and the reasoned override, in that order', async () => {
    const run = await runEmitHandoffCli(completedJobWithNoSediment());

    const actions = run.envelope.nextActions.join('\n');
    expect(actions).toContain('peaks memory extract');
    expect(actions).toContain('--force-no-sediment');
    expect(actions).toContain('Ask the user');
  });

  it('says the index could not be read when the answer was unanswerable', async () => {
    const projectRoot = completedJobWithNoSediment();
    writeRawMemoryIndex(projectRoot, 'not json at all');

    const run = await runEmitHandoffCli(projectRoot);

    expect(run.envelope.message ?? '').toContain('could not be read');
  });

  it('names the user-approved outcome in the override envelope, not just the mode', async () => {
    const run = await runEmitHandoffCli(completedJobWithNoSediment(), [
      '--force-no-sediment',
      OVERRIDE_REASON
    ]);

    expect(run.envelope.nextActions.join('\n')).toContain('no-sediment outcome');
  });
});
