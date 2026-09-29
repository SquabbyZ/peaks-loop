// tests/unit/cli/job-json-flag-support.ts
//
// Fixture helpers shared by the two halves of the `peaks job --json` test
// split (b1 filesplit campaign):
//   - tests/unit/cli/job-json-flag.test.ts            — render / behavior / a11y
//   - tests/unit/cli/job-json-flag-call-sites.test.ts — the per-call-site
//     integration sweep
//
// The `codegraph-autorefresh` mock (`vi.hoisted` + `vi.mock`) and the
// workspace beforeEach/afterEach hooks stay in EACH test file: vitest hoists
// mocks per file, and every case runs against its own tmp workspace.
// Everything here is moved verbatim from the original job-json-flag.test.ts.

import { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { registerJobCommands } from '../../../src/cli/commands/job-commands.js';
import { writeJobProgress } from '../../../src/services/job/job-progress-store.js';
import { makeCapturedIo } from '../_setup/io.js';
import type { TmpWorkspace } from '../_setup/tmp-workspace.js';

export const JOB_ID = 'e1-job';
export const SESSION_ID = '2026-09-17-session-e1';
export const COMMIT_SHA = 'deadbeef1234567';

export type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

/** A refresh that did not happen against a store that IS in use — a warning. */
export const REFRESH_NOTE =
  'auto codegraph refresh failed (exit 2): schema lock conflict. Run `peaks codegraph index --project <root>` to refresh the codegraph index.';

/**
 * The session binding the commands resolve through `getCurrentSessionId`.
 * The env tier is cleared per test: a stray `PEAKS_SESSION_ID` in the
 * operator's shell would otherwise resolve a session for the "no session"
 * controls and turn them green for the wrong reason.
 */
export function bindSession(wsPath: string): void {
  const runtimeDir = join(wsPath, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify({ sessionId: SESSION_ID, projectRoot: wsPath }, null, 2) + '\n',
    'utf8'
  );
}

/**
 * Run one `peaks job` invocation. `--json` is the ONLY axis these cases vary —
 * everything else about the invocation is held fixed.
 */
export async function runJob(
  args: readonly string[],
  projectPath: string,
  json: boolean
): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerJobCommands(program, io);
  const argv = ['job', ...args, '--project', projectPath];
  await program.parseAsync(json ? [...argv, '--json'] : argv, { from: 'user' });
  return captured;
}

/** Seed the job via the CLI itself, so the state under test is real. */
export async function seedJob(ws: TmpWorkspace): Promise<void> {
  bindSession(ws.path);
  await runJob(['init', '--job-id', JOB_ID, '--slice-list', 's1,s2'], ws.path, true);
}

/** Parse stdout as an envelope. Throws (fails the case) if it is not one. */
export function asEnvelope(captured: CapturedIo): {
  ok: boolean;
  command: string;
  warnings: string[];
  nextActions: string[];
} {
  return JSON.parse(captured.stdout.join('\n')) as {
    ok: boolean;
    command: string;
    warnings: string[];
    nextActions: string[];
  };
}

/** Parse stdout as the `data` payload the non-JSON branch prints. */
export function asData(captured: CapturedIo): Record<string, unknown> {
  return JSON.parse(captured.stdout.join('\n')) as Record<string, unknown>;
}

/**
 * True when an envelope reached stdout, whatever its `ok` value.
 *
 * The test parses rather than greps: a `data` payload can legitimately carry
 * an `ok`-shaped field (a decision record, a nested result), and a substring
 * rule would read that as an envelope. The envelope is identified by the two
 * keys `printResult` always writes at the top level.
 */
export function stdoutIsEnvelope(captured: CapturedIo): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(captured.stdout.join('\n'));
  } catch {
    return false;
  }
  return typeof parsed === 'object' && parsed !== null && 'ok' in parsed && 'warnings' in parsed;
}

/**
 * A directory inside the tmp workspace that holds no
 * `.peaks/_runtime/session.json`, so `getCurrentSessionId` resolves nothing
 * and the commands that require a session refuse. Returned as a path only —
 * the caller passes it through `--project`.
 */
export function bareWorkspace(wsPath: string): string {
  const bare = join(wsPath, 'no-session-subdir');
  mkdirSync(bare, { recursive: true });
  return bare;
}

/**
 * Seed the on-disk slice-progress mirror so `job progress` reaches its ok
 * call site. Written by the store's own writer, so the record shape is the
 * canonical one rather than a hand-rolled fixture.
 */
export function writeProgressMirror(projectDir: string): void {
  writeJobProgress(projectDir, SESSION_ID, {
    jobId: JOB_ID,
    done: 1,
    total: 2,
    currentSlice: 'slice-002',
    lastCommitSha: null
  });
}
