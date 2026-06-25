/**
 * W5 Fix M2 — CLI integration tests for `peaks prepare-final-review <rid>`.
 *
 * Seven cases under test:
 *   a. `--llm-provider stub` (default) returns a "scaffold ready" envelope
 *      with `status: 'scaffold-only'`, `serviceWired: true`,
 *      `providerBinding: 'pending-follow-up-slice'`, and the computed
 *      `auditGoalPath` (`.peaks/_runtime/<sid>/audit-goal/<rid>.json`).
 *      The audit-goal file must pre-exist for the stub path to fire
 *      (pre-flight is mandatory; see case g).
 *   b. Stub path + `--json` emits the canonical `ResultEnvelope<FinalReviewData>`
 *      shape so downstream consumers can parse it.
 *   c. Non-stub provider (`--llm-provider openai`) fails with
 *      `LLM_PROVIDER_NOT_IMPLEMENTED` and exit code 1. The pre-flight
 *      does NOT block this case because the file pre-exists.
 *   d. Missing `--project` is rejected by commander at parse time
 *      (commander.exitOverride throws).
 *   e. Missing `--session-id` is rejected by commander at parse time.
 *   f. Path-traversal in `--session-id` (e.g. `../../etc`) is rejected
 *      with `INVALID_SESSION_ID` BEFORE the audit-goal pre-flight fires.
 *   g. Pre-flight: a missing audit-goal file is detected BEFORE the
 *      stub/provider check, returning `AUDIT_GOAL_NOT_FOUND` with the
 *      computed path in `data.auditGoalPath`.
 *
 * The stub provider short-circuits BEFORE `prepareFinalReview()` is
 * invoked, so the test stays a pure CLI-shape integration test (no LLM,
 * no real service call). The only filesystem work the CLI does in the
 * stub path is `existsSync()` for the pre-flight.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerFinalReviewCommands, type FinalReviewData } from '../../../../src/cli/commands/final-review-commands.js';
import type { ProgramIO } from '../../../../src/cli/cli-helpers.js';
import type { ResultEnvelope } from '../../../../src/shared/result.js';

function captureIo(): {
  io: ProgramIO;
  stdout: () => string;
  stderr: () => string;
} {
  const out: string[] = [];
  const err: string[] = [];
  const io: ProgramIO = {
    stdout: (text: string) => out.push(text),
    stderr: (text: string) => err.push(text)
  };
  return {
    io,
    stdout: () => out.join(''),
    stderr: () => err.join('')
  };
}

/**
 * Pre-create the audit-goal JSON at the path the service WOULD read.
 * Returns the absolute path. Required for the stub path to fire
 * (case a/b/c).
 */
function seedAuditGoal(projectRoot: string, sessionId: string, rid: string): string {
  const auditGoalPath = join(
    projectRoot,
    '.peaks',
    '_runtime',
    sessionId,
    'audit-goal',
    `${rid}.json`
  );
  mkdirSync(join(projectRoot, '.peaks', '_runtime', sessionId, 'audit-goal'), {
    recursive: true
  });
  writeFileSync(auditGoalPath, JSON.stringify({ successCriteria: ['c1', 'c2'] }), 'utf8');
  return auditGoalPath;
}

describe('cli/final-review-commands: peaks prepare-final-review', () => {
  let projectRoot: string;
  let sessionId: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-m2-final-review-cli-'));
    // Use a session id that is a single safe segment (no `..`, `/`, `\`).
    sessionId = 'sid-test-001';
    // Reset commander exitCode state between tests so a prior failure
    // (process.exitCode = 1) does not leak into a later success case.
    process.exitCode = 0;
  });

  afterEach(() => {
    if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('stub provider (default) returns a scaffold-only envelope and exits 0', async () => {
    const rid = 'rid-aaa-001';
    const auditGoalPath = seedAuditGoal(projectRoot, sessionId, rid);

    const { io, stdout } = captureIo();
    const program = new Command();
    registerFinalReviewCommands(program, io);
    program.exitOverride();

    await program.parseAsync([
      'node',
      'peaks',
      'prepare-final-review',
      rid,
      '--project',
      projectRoot,
      '--session-id',
      sessionId,
      '--json'
    ]);

    const envelope = JSON.parse(stdout()) as ResultEnvelope<FinalReviewData>;
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('final-review.prepare');
    expect(envelope.data.status).toBe('scaffold-only');
    expect(envelope.data.serviceWired).toBe(true);
    expect(envelope.data.providerBinding).toBe('pending-follow-up-slice');
    expect(envelope.data.rid).toBe(rid);
    expect(envelope.data.sessionId).toBe(sessionId);
    // The auditGoalPath is the path the service WOULD read.
    const normalized = envelope.data.auditGoalPath.replaceAll('\\', '/');
    expect(normalized).toBe(auditGoalPath.replaceAll('\\', '/'));
    expect(process.exitCode).toBe(0);
  });

  it('stub + --json emits the standard ResultEnvelope shape with command="final-review.prepare"', async () => {
    const rid = 'rid-shape-002';
    seedAuditGoal(projectRoot, sessionId, rid);

    const { io, stdout } = captureIo();
    const program = new Command();
    registerFinalReviewCommands(program, io);
    program.exitOverride();

    await program.parseAsync([
      'node',
      'peaks',
      'prepare-final-review',
      rid,
      '--project',
      projectRoot,
      '--session-id',
      sessionId,
      '--json'
    ]);

    // ResultEnvelope<T> = { ok, command, data, warnings, nextActions, ... }
    const envelope = JSON.parse(stdout()) as {
      ok?: unknown;
      command?: unknown;
      data?: unknown;
      warnings?: unknown;
      nextActions?: unknown;
    };
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('final-review.prepare');
    expect(envelope.data).toBeDefined();
    expect(Array.isArray(envelope.warnings)).toBe(true);
    expect(Array.isArray(envelope.nextActions)).toBe(true);
  });

  it('non-stub provider returns LLM_PROVIDER_NOT_IMPLEMENTED and exits 1', async () => {
    const rid = 'rid-openai-003';
    // Seed the file so the pre-flight passes and the provider check fires.
    seedAuditGoal(projectRoot, sessionId, rid);

    const { io, stdout, stderr } = captureIo();
    const program = new Command();
    registerFinalReviewCommands(program, io);
    program.exitOverride();

    await program.parseAsync([
      'node',
      'peaks',
      'prepare-final-review',
      rid,
      '--project',
      projectRoot,
      '--session-id',
      sessionId,
      '--llm-provider',
      'openai',
      '--json'
    ]);

    // Failure envelope is written to stderr in JSON mode; check both.
    const output = stdout() + stderr();
    expect(output).toContain('LLM_PROVIDER_NOT_IMPLEMENTED');
    expect(output).toContain('openai');
    expect(process.exitCode).toBe(1);
  });

  it('missing --project fails with a non-zero commander exit code', async () => {
    const { io, stdout } = captureIo();
    const program = new Command();
    registerFinalReviewCommands(program, io);
    program.exitOverride();

    // commander.exitOverride() rejects on missing required options; capture
    // the rejection so the test does not blow up.
    let exitCode = 0;
    try {
      await program.parseAsync([
        'node',
        'peaks',
        'prepare-final-review',
        'rid-no-proj-004',
        '--session-id',
        sessionId,
        '--json'
      ]);
    } catch (err) {
      const e = err as { code?: string | number };
      exitCode = typeof e.code === 'number' ? e.code : 1;
    }

    // commander emits an error.message that mentions the missing flag.
    expect(exitCode).not.toBe(0);
    expect(stdout().trim()).toBe('');
  });

  it('missing --session-id fails with a non-zero commander exit code', async () => {
    const { io, stdout } = captureIo();
    const program = new Command();
    registerFinalReviewCommands(program, io);
    program.exitOverride();

    let exitCode = 0;
    try {
      await program.parseAsync([
        'node',
        'peaks',
        'prepare-final-review',
        'rid-no-sid-005',
        '--project',
        projectRoot,
        '--json'
      ]);
    } catch (err) {
      const e = err as { code?: string | number };
      exitCode = typeof e.code === 'number' ? e.code : 1;
    }

    expect(exitCode).not.toBe(0);
    expect(stdout().trim()).toBe('');
  });

  it('path-traversal in --session-id is rejected with INVALID_SESSION_ID', async () => {
    const { io, stdout, stderr } = captureIo();
    const program = new Command();
    registerFinalReviewCommands(program, io);
    program.exitOverride();

    await program.parseAsync([
      'node',
      'peaks',
      'prepare-final-review',
      'rid-traversal-006',
      '--project',
      projectRoot,
      '--session-id',
      '../../etc',
      '--json'
    ]);

    const output = stdout() + stderr();
    expect(output).toContain('INVALID_SESSION_ID');
    // The pre-flight must NOT have fired (no `audit-goal/<rid>.json`
    // path leaked into the error message).
    expect(output).not.toContain('AUDIT_GOAL_NOT_FOUND');
    expect(process.exitCode).toBe(1);
  });

  it('missing audit-goal file pre-flight fires BEFORE the stub/provider check', async () => {
    const { io, stdout, stderr } = captureIo();
    const program = new Command();
    registerFinalReviewCommands(program, io);
    program.exitOverride();

    const rid = 'rid-missing-007';
    // The audit-goal file does NOT exist; the pre-flight must return
    // AUDIT_GOAL_NOT_FOUND, NOT the stub scaffold envelope.
    await program.parseAsync([
      'node',
      'peaks',
      'prepare-final-review',
      rid,
      '--project',
      projectRoot,
      '--session-id',
      sessionId,
      '--json'
    ]);

    const stdoutText = stdout();
    const stderrText = stderr();
    const output = stdoutText + stderrText;
    expect(output).toContain('AUDIT_GOAL_NOT_FOUND');
    // The scaffold-only envelope must NOT have fired.
    expect(output).not.toContain('"scaffold-only"');
    // The data.auditGoalPath in the error envelope points at the file
    // the service would have read.
    const envelope = JSON.parse(stdoutText + stderrText) as ResultEnvelope<FinalReviewData>;
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('AUDIT_GOAL_NOT_FOUND');
    const normalized = (envelope.data.auditGoalPath as string).replaceAll('\\', '/');
    expect(normalized.endsWith(`.peaks/_runtime/${sessionId}/audit-goal/${rid}.json`)).toBe(true);
    expect(process.exitCode).toBe(1);
  });
});
