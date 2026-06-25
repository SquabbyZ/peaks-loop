/**
 * W5 Fix M1 — CLI integration tests for `peaks audit goal`.
 *
 * Five cases under test:
 *   a. `--llm-provider stub` (default) returns a "scaffold ready" envelope
 *      with `status: 'scaffold-only'`, `serviceWired: true`, and
 *      `providerBinding: 'pending-follow-up-slice'`. The route is wired
 *      without a real LLM provider.
 *   b. Stub path + `--json` emits the canonical `ResultEnvelope<AuditGoalData>`
 *      shape so downstream consumers can parse it.
 *   c. Non-stub provider (`--llm-provider openai`) fails with
 *      `LLM_PROVIDER_NOT_IMPLEMENTED` and exit code 1.
 *   d. Missing `--project` is rejected by commander at parse time —
 *      exit code != 0 and no JSON envelope is emitted on stdout.
 *   e. Missing `--need` is rejected by commander at parse time — same shape.
 *
 * No mocking is needed: the stub provider short-circuits BEFORE the
 * `auditGoal()` service is invoked, so the test stays a pure CLI-shape
 * integration test (no LLM, no project files beyond the projectRoot).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { registerAuditCommands, type AuditGoalData } from '../../../../src/cli/commands/audit-commands.js';
import type { ProgramIO } from '../../../../src/cli/cli-helpers.js';
import type { ResultEnvelope } from '../../../../src/shared/result.js';

function captureIo(): { io: ProgramIO; stdout: () => string; stderr: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  const io: ProgramIO = {
    stdout: (text: string) => out.push(text),
    stderr: (text: string) => err.push(text)
  };
  return { io, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('cli/audit-commands: peaks audit goal', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-m1-audit-goal-cli-'));
    // Reset commander exitCode state between tests so a prior failure
    // (process.exitCode = 1) does not leak into a later success case.
    process.exitCode = 0;
  });

  afterEach(() => {
    if (existsSync(projectRoot)) rmSync(projectRoot, { recursive: true, force: true });
    process.exitCode = 0;
  });

  it('stub provider (default) returns a scaffold-only envelope and exits 0', async () => {
    const { io, stdout } = captureIo();
    const program = new Command();
    registerAuditCommands(program, io);
    program.exitOverride();

    await program.parseAsync([
      'node',
      'peaks',
      'audit',
      'goal',
      '--project',
      projectRoot,
      '--need',
      'test need from scaffold',
      '--json'
    ]);

    const envelope = JSON.parse(stdout()) as ResultEnvelope<AuditGoalData>;
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('audit.goal');
    expect(envelope.data.status).toBe('scaffold-only');
    expect(envelope.data.serviceWired).toBe(true);
    expect(envelope.data.providerBinding).toBe('pending-follow-up-slice');
    expect(envelope.data.need).toBe('test need from scaffold');
    // projectRoot is the resolved absolute path; compare normalized forms
    // so the test works on Windows (backslashes) and POSIX (forward slashes).
    expect(envelope.data.projectRoot.replaceAll('\\', '/')).toBe(
      projectRoot.replaceAll('\\', '/')
    );
    expect(process.exitCode).toBe(0);
  });

  it('stub + --json emits the standard ResultEnvelope shape with command="audit.goal"', async () => {
    const { io, stdout } = captureIo();
    const program = new Command();
    registerAuditCommands(program, io);
    program.exitOverride();

    await program.parseAsync([
      'node',
      'peaks',
      'audit',
      'goal',
      '--project',
      projectRoot,
      '--need',
      'standard envelope check',
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
    expect(envelope.command).toBe('audit.goal');
    expect(envelope.data).toBeDefined();
    expect(Array.isArray(envelope.warnings)).toBe(true);
    expect(Array.isArray(envelope.nextActions)).toBe(true);
  });

  it('non-stub provider returns LLM_PROVIDER_NOT_IMPLEMENTED and exits 1', async () => {
    const { io, stdout, stderr } = captureIo();
    const program = new Command();
    registerAuditCommands(program, io);
    program.exitOverride();

    await program.parseAsync([
      'node',
      'peaks',
      'audit',
      'goal',
      '--project',
      projectRoot,
      '--need',
      'real provider please',
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
    registerAuditCommands(program, io);
    program.exitOverride();

    // commander.exitOverride() rejects on missing required options; capture
    // the rejection so the test does not blow up.
    let exitCode = 0;
    try {
      await program.parseAsync([
        'node',
        'peaks',
        'audit',
        'goal',
        '--need',
        'no project here'
      ]);
    } catch (err) {
      const e = err as { code?: string | number };
      exitCode = typeof e.code === 'number' ? e.code : 1;
    }

    // commander emits an error.message that mentions the missing flag.
    expect(exitCode).not.toBe(0);
    expect(stdout().trim()).toBe('');
  });

  it('missing --need fails with a non-zero commander exit code', async () => {
    const { io, stdout } = captureIo();
    const program = new Command();
    registerAuditCommands(program, io);
    program.exitOverride();

    let exitCode = 0;
    try {
      await program.parseAsync([
        'node',
        'peaks',
        'audit',
        'goal',
        '--project',
        projectRoot
      ]);
    } catch (err) {
      const e = err as { code?: string | number };
      exitCode = typeof e.code === 'number' ? e.code : 1;
    }

    expect(exitCode).not.toBe(0);
    expect(stdout().trim()).toBe('');
  });
});