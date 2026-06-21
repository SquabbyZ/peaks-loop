/**
 * Plan 1 followup hotfix — one-axis envelope layout regression tests.
 *
 * Verifies that `peaks request init`:
 *   1. Writes envelopes ONLY to `.peaks/_runtime/<sessionId>/<role>/...`
 *      (never to the forbidden `.peaks/<id>/<role>/...` root).
 *   2. Refuses to run without `--session-id` (SESSION_ID_REQUIRED).
 *   3. The legacy `--change-id` flag is no longer accepted by the parser.
 *
 * Reference: `.peaks/memory/2026-06-21-peaks-request-session-id-leaks-into-change-id.md`.
 * Hard rule (user 2026-06-21): the `.peaks/<id>/` root layout is completely
 * forbidden — all envelopes land under `.peaks/_runtime/<sid>/`.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { registerRequestCommands } from '../../../../src/cli/commands/request-commands.js';
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

function buildProgram(io: ProgramIO): Command {
  const program = new Command();
  program.exitOverride();
  registerRequestCommands(program, io);
  return program;
}

async function runInit(args: string[], projectRoot: string): Promise<{ io: ProgramIO; stdout: string; stderr: string; exitCode: number | undefined }> {
  // Reset the process-global exitCode. Vitest runs test files in one Node
  // process, so a sibling file (e.g. mut-commands.test.ts) may have set
  // process.exitCode earlier in the run; that sticky value would otherwise
  // leak into this helper and poison the assertions below.
  process.exitCode = undefined;
  const { io, stdout, stderr } = captureIo();
  const program = buildProgram(io);
  let exitCode: number | undefined;
  try {
    await program.parseAsync(['node', 'peaks', 'request', 'init', ...args, '--project', projectRoot]);
    const ec = process.exitCode;
    exitCode = typeof ec === 'number' ? ec : 0;
  } catch (err: unknown) {
    // exitOverride throws CommanderError; capture its code.
    const code = (err as { code?: string }).code;
    exitCode = typeof code === 'string' && /^\d+$/.test(code) ? Number(code) : 1;
  }
  return { io, stdout: stdout(), stderr: stderr(), exitCode };
}

function listMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.md'))
    .map((e) => e.name)
    .sort();
}

describe('cli/request-commands: one-axis envelope layout (Plan 1 followup hotfix)', () => {
  let projectRoot: string;
  const STABLE_SESSION = '2026-06-21-session-test';
  const STABLE_RID = '2026-06-21-one-axis';

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-21T00:00:00.000Z'));
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-one-axis-'));
    // Pre-create the session dir the slice-008 F21 fix expects to
    // find. The CLI/service refuses to write under a session id
    // shaped like `YYYY-MM-DD-session-*` unless the dir already
    // exists (legitimate safety check against stale bindings).
    mkdirSync(join(projectRoot, '.peaks', '_runtime', STABLE_SESSION), { recursive: true });
    // CallerId resolver needs PEAKS_CALLER_ID (or a platform fallback)
    // to avoid the D2 EX_USAGE path. Tests in this file don't assert
    // on callerId, so a stable test value is fine.
    process.env['PEAKS_CALLER_ID'] = 'one-axis-test';
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env['PEAKS_CALLER_ID'];
    // Defensive: clear the process-global exitCode so it cannot leak into
    // sibling test files (mut-commands sets it to 2, which is sticky).
    process.exitCode = undefined;
    if (existsSync(projectRoot)) {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('writes the envelope ONLY to .peaks/_runtime/<sid>/rd/requests/<rid>.md', async () => {
    const { stdout, exitCode } = await runInit(
      [
        '--role', 'rd',
        '--id', STABLE_RID,
        '--session-id', STABLE_SESSION,
        '--apply',
        '--json'
      ],
      projectRoot
    );

    // Init must succeed.
    expect(exitCode ?? 0).toBe(0);
    const envelope = JSON.parse(stdout) as ResultEnvelope<{ path: string }>;
    expect(envelope.ok).toBe(true);
    expect(envelope.data.path).toBeTruthy();

    // The envelope MUST live under .peaks/_runtime/<sid>/rd/requests/.
    const expectedDir = join(projectRoot, '.peaks', '_runtime', STABLE_SESSION, 'rd', 'requests');
    expect(existsSync(expectedDir)).toBe(true);
    const files = listMarkdownFiles(expectedDir);
    // File name is numbered (NNN-<rid>.md) — check the rid is the stem.
    expect(files.some((f) => f.endsWith(`-${STABLE_RID}.md`))).toBe(true);

    // The forbidden .peaks/<sid>/rd/requests/ dir MUST NOT exist.
    const forbiddenDir = join(projectRoot, '.peaks', STABLE_SESSION, 'rd', 'requests');
    expect(existsSync(forbiddenDir)).toBe(false);

    // No stray top-level .peaks/<sid>/ dir (the "session-id-as-change-id" bug).
    const forbiddenRoot = join(projectRoot, '.peaks', STABLE_SESSION);
    expect(existsSync(forbiddenRoot)).toBe(false);
  });

  it('refuses to run without --session-id (SESSION_ID_REQUIRED)', async () => {
    const { stdout, exitCode } = await runInit(
      [
        '--role', 'rd',
        '--id', STABLE_RID,
        '--apply',
        '--json'
      ],
      projectRoot
    );

    expect(exitCode).toBe(1);
    const envelope = JSON.parse(stdout) as ResultEnvelope<unknown>;
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SESSION_ID_REQUIRED');
    // And no envelope file must have been written. The pre-created
    // session dir (slice-008 F21 fix) may still be present; we only
    // assert that no `requests/<rid>.md` file exists.
    expect(existsSync(join(projectRoot, '.peaks', '_runtime', STABLE_SESSION, 'rd', 'requests'))).toBe(false);
  });

  it('rejects the legacy --change-id flag (no such option on the parser)', async () => {
    // --change-id has been removed from the request-* subcommands. The
    // commander parser will reject it. The test pins this so the flag
    // cannot be silently re-introduced.
    const { exitCode } = await runInit(
      [
        '--role', 'rd',
        '--id', STABLE_RID,
        '--session-id', STABLE_SESSION,
        '--apply',
        '--change-id', 'should-be-rejected'
      ],
      projectRoot
    );

    // Commander exits with a non-zero code on unknown options.
    expect(exitCode).not.toBe(0);
    // No envelope must have been written.
    const expectedDir = join(projectRoot, '.peaks', '_runtime', STABLE_SESSION, 'rd', 'requests');
    expect(existsSync(expectedDir)).toBe(false);
  });
});
