/**
 * Slice 018 — CLI surface tests for outer-session-mismatch auto-rotation.
 *
 * Verifies the new `--no-rotate-on-outer-mismatch` flag on
 * `peaks workspace init` and the new `data.rotation` field in the
 * JSON envelope. Uses the cli-program-test-utils harness so the CLI
 * parser is invoked for real (not bypassed via direct service calls),
 * per the slice 013 lesson ("service-layer unit tests cannot catch
 * CLI-option-parser bugs").
 *
 * Each test runs in its own temp project dir so the assertions on
 * the .peaks/_runtime/ state are isolated.
 */

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { parseJsonOutput, runCommand } from '../cli-program-test-utils.js';

function createTempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-slice-018-cli-'));
  mkdirSync(join(dir, '.peaks', '_runtime'), { recursive: true });
  return dir;
}

function writeBoundSession(projectRoot: string, sessionId: string, outerSessionId?: string): void {
  // Binding file
  const bindingFile = join(projectRoot, '.peaks', '_runtime', 'session.json');
  writeFileSync(
    bindingFile,
    JSON.stringify(
      {
        sessionId,
        projectRoot,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString()
      },
      null,
      2
    ),
    'utf8'
  );
  // Per-session meta file (carries the outerSessionId)
  const metaDir = join(projectRoot, '.peaks', '_runtime', sessionId);
  mkdirSync(metaDir, { recursive: true });
  const metaFile = join(metaDir, 'session.json');
  writeFileSync(
    metaFile,
    JSON.stringify(
      {
        sessionId,
        projectRoot,
        createdAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        ...(outerSessionId !== undefined ? { outerSessionId } : {})
      },
      null,
      2
    ),
    'utf8'
  );
}

let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
});

afterEach(() => {
  process.chdir(originalCwd);
});

describe('peaks workspace init — slice 018 outer-session-mismatch auto-rotation', () => {
  test('CLI: outer-mismatch → JSON envelope includes data.rotation with previousSessionId', async () => {
    const projectRoot = createTempProject();
    const oldSid = '2026-06-07-session-cliauto';
    writeBoundSession(projectRoot, oldSid, 'old-outer-uuid');

    process.chdir(projectRoot);
    const result = await runCommand(
      ['workspace', 'init', '--project', projectRoot, '--json'],
      { PEAKS_OUTER_SESSION_ID: 'new-outer-uuid' }
    );

    expect(result.exitCode).toBeUndefined();
    const parsed = parseJsonOutput(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('workspace.init');
    // data.rotation is surfaced when rotation fired
    expect(parsed.data).toBeDefined();
    type Rotation = { previousSessionId: string; reason: string };
    const rotation = (parsed.data as { rotation?: Rotation }).rotation;
    expect(rotation).toBeDefined();
    expect(rotation?.previousSessionId).toBe(oldSid);
    expect(rotation?.reason).toBe('outer-session-mismatch');
    // nextActions includes a human-readable rotation message
    expect(parsed.nextActions?.some((a: string) => a.includes('Auto-rotated session binding'))).toBe(true);
  });

  test('CLI: --no-rotate-on-outer-mismatch suppresses rotation, no data.rotation in envelope', async () => {
    const projectRoot = createTempProject();
    const oldSid = '2026-06-07-session-cliopt';
    writeBoundSession(projectRoot, oldSid, 'old-outer-uuid');

    process.chdir(projectRoot);
    const result = await runCommand(
      ['workspace', 'init', '--project', projectRoot, '--no-rotate-on-outer-mismatch', '--json'],
      { PEAKS_OUTER_SESSION_ID: 'new-outer-uuid' }
    );

    expect(result.exitCode).toBeUndefined();
    const parsed = parseJsonOutput(result.stdout);
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('workspace.init');
    // data.rotation is NOT present (the field is omitted, not null)
    const data = parsed.data as { sessionId?: string; rotation?: unknown };
    expect(data.rotation).toBeUndefined();
    expect(data.sessionId).toBe(oldSid);
    // No rotation message in nextActions
    expect(parsed.nextActions?.some((a: string) => a.includes('Auto-rotated session binding'))).toBe(false);
  });

  test('CLI: no env vars set → no rotation field (false-positive guard)', async () => {
    const projectRoot = createTempProject();
    const oldSid = '2026-06-07-session-clinenv';
    writeBoundSession(projectRoot, oldSid, 'some-old-outer');

    process.chdir(projectRoot);
    // Explicitly set BOTH outer-session env keys to empty strings so
    // getCurrentOuterSessionId() returns undefined for the duration of
    // this test. (The parent shell may have CLAUDE_CODE_SESSION_ID
    // exported, which would otherwise trigger a false-positive rotation.
    // Empty string is treated as "no signal" by the helper, equivalent
    // to the env var being absent.)
    const result = await runCommand(
      ['workspace', 'init', '--project', projectRoot, '--json'],
      { PEAKS_OUTER_SESSION_ID: '', CLAUDE_CODE_SESSION_ID: '' }
    );

    expect(result.exitCode).toBeUndefined();
    const parsed = parseJsonOutput(result.stdout);
    expect(parsed.ok).toBe(true);
    const data = parsed.data as { sessionId?: string; rotation?: unknown };
    expect(data.rotation).toBeUndefined();
    expect(data.sessionId).toBe(oldSid);
  });

  test('CLI: same outer session (reconnect) → no rotation, no data.rotation', async () => {
    const projectRoot = createTempProject();
    const sid = '2026-06-07-session-clirec';
    writeBoundSession(projectRoot, sid, 'same-outer-uuid');

    process.chdir(projectRoot);
    const result = await runCommand(
      ['workspace', 'init', '--project', projectRoot, '--json'],
      { PEAKS_OUTER_SESSION_ID: 'same-outer-uuid' }
    );

    expect(result.exitCode).toBeUndefined();
    const parsed = parseJsonOutput(result.stdout);
    expect(parsed.ok).toBe(true);
    const data = parsed.data as { sessionId?: string; rotation?: unknown };
    expect(data.rotation).toBeUndefined();
    expect(data.sessionId).toBe(sid);
  });
});
