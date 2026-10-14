// tests/unit/cli/commands/request-init-session-resolution.test.ts
//
// D1 (backlog 9.33): `peaks request init` declared `--session-id` as optional
// with help text promising a "default date-stamped session id" that did not
// exist — the action refused with SESSION_ID_REQUIRED when the flag was absent.
//
// Fix: the flag keeps its optional declaration and the promised default is now
// real — `resolveInitSessionId` reads the workspace's active session from
// `.peaks/_runtime/session.json`, the same source `peaks sub-agent dispatch`
// already reads for this id. The refusal survives only for the genuinely
// no-session case. The RED-direction arm (the input the check exists to reject)
// is the flag omitted on a workspace whose `session.json` is valid.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { withTmpWorkspacePerTest, type TmpWorkspace } from '../../_setup/tmp-workspace.js';
import { makeCapturedIo } from '../../_setup/io.js';
import { registerRequestInitCommand } from '~/src/cli/commands/request-init-command';
import { parseCliEnvelope } from '~/src/cli/cli-envelope';

const getWs = withTmpWorkspacePerTest('peaks-request-init-');

const RID = '2026-10-13-rid-session-fallback';
const BOUND_SID = '2026-10-12-session-bound';
const FLAG_SID = '2026-10-12-session-flag';

/**
 * The caller id every invocation supplies. `request init` resolves one by
 * design (D4 priority: flag → `PEAKS_CALLER_ID` → the IDE adapter), and with
 * no flag the claude-code adapter falls back to the ambient
 * `CLAUDE_CODE_SESSION_ID` — present on a developer machine, absent in CI.
 * A test that borrowed that signal asserted the machine, not the command, so
 * it passed locally and failed on CI. Supplying the flag pins the same input
 * everywhere, and being level 1 it wins in both environments.
 */
const CALLER_ID = 'request-init-session-test-caller';

/** The single per-project binding file `getCurrentSessionId` reads. */
function writeSessionFile(ws: TmpWorkspace, sessionId: string): void {
  const runtimeDir = join(ws.path, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify({ sessionId, projectRoot: ws.path }) + '\n',
    'utf8'
  );
}

/** `createRequestArtifact` refuses a `...-session-*` id whose directory is absent. */
function mkSessionDir(ws: TmpWorkspace, sessionId: string): void {
  mkdirSync(join(ws.path, '.peaks', '_runtime', sessionId), { recursive: true });
}

/** The requests dir `request init` writes into. */
function requestsDir(ws: TmpWorkspace, sessionId: string, role = 'rd'): string {
  return join(ws.path, '.peaks', '_runtime', sessionId, role, 'requests');
}

/**
 * Every test drives the command through this one helper, which supplies the
 * caller id (see `CALLER_ID`) so no arm depends on the ambient environment.
 * The four refusal arms are unaffected: they refuse at session resolution,
 * which runs BEFORE `resolveInitCallerId`, so they still refuse.
 */
async function runInit(args: string[]): Promise<ReturnType<typeof makeCapturedIo>['captured']> {
  const program = new Command();
  const { io, captured } = makeCapturedIo();
  registerRequestInitCommand(program, io);
  await program.parseAsync(['init', '--caller-id', CALLER_ID, ...args], { from: 'user' });
  return captured;
}

describe('request init — the --session-id declaration, its help, and the refusal agree', () => {
  beforeEach(() => {
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
  });

  it('states the workspace source and no longer claims a date-stamped default', () => {
    const program = new Command();
    registerRequestInitCommand(program, makeCapturedIo().io);
    const init = program.commands.find((c) => c.name() === 'init');
    const option = init?.options.find((o) => o.long === '--session-id');
    expect(option).toBeDefined();
    // The flag stays optional (not `.requiredOption`) because a real default now
    // backs it; the help must name that default's source. `mandatory` — not
    // `required` — is the field `.requiredOption` sets; `required` merely marks
    // that a value follows the flag.
    expect(option?.mandatory).not.toBe(true);
    expect(option?.description).toContain('.peaks/_runtime/session.json');
    expect(option?.description).not.toContain('date-stamped');
  });

  it('when the flag is omitted on a workspace whose session.json is valid, should resolve that id', async () => {
    const ws = getWs();
    writeSessionFile(ws, BOUND_SID);
    mkSessionDir(ws, BOUND_SID);

    const captured = await runInit([
      '--role',
      'rd',
      '--id',
      RID,
      '--project',
      ws.path,
      '--apply',
      '--json'
    ]);

    const envelope = parseCliEnvelope(captured.text().trim());
    expect(envelope.ok).toBe(true);
    expect(process.exitCode === undefined || process.exitCode === 0).toBe(true);
    // The fallback resolved the id the workspace actually holds.
    expect(envelope.data.sessionId).toBe(BOUND_SID);
    const written = readdirSync(requestsDir(ws, BOUND_SID));
    expect(written.some((f) => f.endsWith(`${RID}.md`))).toBe(true);
    // And nothing landed under the flag session that was never passed.
    expect(existsSync(requestsDir(ws, FLAG_SID))).toBe(false);
  });

  it('when the flag is passed, should still win over the workspace binding — the control', async () => {
    const ws = getWs();
    writeSessionFile(ws, BOUND_SID);
    mkSessionDir(ws, BOUND_SID);
    mkSessionDir(ws, FLAG_SID);

    const captured = await runInit([
      '--role',
      'rd',
      '--id',
      RID,
      '--session-id',
      FLAG_SID,
      '--project',
      ws.path,
      '--apply',
      '--json'
    ]);

    const envelope = parseCliEnvelope(captured.text().trim());
    expect(envelope.ok).toBe(true);
    expect(envelope.data.sessionId).toBe(FLAG_SID);
    expect(existsSync(requestsDir(ws, FLAG_SID))).toBe(true);
    expect(existsSync(requestsDir(ws, BOUND_SID))).toBe(false);
  });

  it('when neither the flag nor the workspace holds a session, should refuse with SESSION_ID_REQUIRED', async () => {
    const ws = getWs();

    const captured = await runInit([
      '--role',
      'rd',
      '--id',
      RID,
      '--project',
      ws.path,
      '--apply',
      '--json'
    ]);

    const envelope = parseCliEnvelope(captured.text().trim());
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SESSION_ID_REQUIRED');
    expect(process.exitCode).toBe(1);
  });

  it('when --session-id is SUPPLIED but blank, should refuse rather than silently use the workspace id', async () => {
    // given: a workspace whose session.json is valid, and a blank flag — the
    // shape an unset shell variable produces. Before this arm the blank value
    // resolved to the workspace id, hiding the caller's mistake (HEAD refused).
    const ws = getWs();
    writeSessionFile(ws, BOUND_SID);
    mkSessionDir(ws, BOUND_SID);

    const captured = await runInit([
      '--role',
      'rd',
      '--id',
      RID,
      '--session-id',
      '   ',
      '--project',
      ws.path,
      '--apply',
      '--json'
    ]);

    const envelope = parseCliEnvelope(captured.text().trim());
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SESSION_ID_REQUIRED');
    expect(process.exitCode).toBe(1);
    expect(String(envelope.message)).toContain('blank');
    // and nothing was written under the workspace id it would have silently used
    expect(existsSync(requestsDir(ws, BOUND_SID))).toBe(false);
  });

  it('when session.json holds a PATH-SHAPED id, should refuse with SESSION_ID_REQUIRED — not a downstream REQUEST_INIT_FAILED', async () => {
    // given: a recorded id that is not one path segment
    const ws = getWs();
    writeSessionFile(ws, '../PWNED');

    const captured = await runInit([
      '--role',
      'rd',
      '--id',
      RID,
      '--project',
      ws.path,
      '--apply',
      '--json'
    ]);

    const envelope = parseCliEnvelope(captured.text().trim());
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SESSION_ID_REQUIRED');
    expect(process.exitCode).toBe(1);
    // the message names the source the caller must fix, not a request-init failure
    expect(String(envelope.message)).toContain('session.json');
  });

  it('when session.json holds an id with a NEWLINE, should refuse and must not print the raw id', async () => {
    // given: a recorded id carrying a control character. `isUnsafePathInput` does
    // NOT reject C0/C1 codes, so before this guard the newline id was ACCEPTED —
    // it forged a line in the preview and would have become a directory name.
    const ws = getWs();
    writeSessionFile(ws, 'evil\ninjected-line');

    const captured = await runInit([
      '--role',
      'rd',
      '--id',
      RID,
      '--project',
      ws.path,
      '--apply',
      '--json'
    ]);

    const envelope = parseCliEnvelope(captured.text().trim());
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SESSION_ID_REQUIRED');
    expect(process.exitCode).toBe(1);
    // no forged line: the raw id is never interpolated into the refusal
    expect(String(envelope.message)).not.toContain('evil');
    expect(String(envelope.message)).not.toContain('\n');
  });
});
