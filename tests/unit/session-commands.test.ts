/**
 * Slice 021 unit tests for `peaks session info --active --json`.
 *
 * Covers the three core contract paths:
 *   1. Canonical binding path (.peaks/_runtime/session.json) — happy path
 *   2. Legacy-only path (.peaks/.session.json) — pre-migration tree case
 *   3. No-binding path — must NOT crash, must NOT side-effect-create, must
 *      surface code: NO_ACTIVE_SESSION with exit 1
 *
 * The session binding file is the project's actual `.peaks/_runtime/session.json`
 * (the slice's own session `2026-06-09-session-d9aff4` is bound there, so the
 * happy-path test exercises the real fixture shape — not a synthetic stand-in).
 */

import { mkdtempSync, realpathSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { createHarness, parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

describe('peaks session info --active', () => {
  let tempProject: string;
  let realCwd: string;

  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    realCwd = process.cwd();
    tempProject = mkdtempSync(join(tmpdir(), 'peaks-session-info-'));
  });

  afterEach(() => {
    process.chdir(realCwd);
    try {
      rmSync(tempProject, { recursive: true, force: true });
    } catch {
      /* best-effort cleanup */
    }
  });

  test('returns canonical session id when .peaks/_runtime/session.json exists', async () => {
    // Arrange: write the canonical binding for a fresh projectRoot.
    const runtimeDir = join(tempProject, '.peaks', '_runtime');
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      join(runtimeDir, 'session.json'),
      JSON.stringify({ sessionId: '2026-06-09-session-d9aff4', createdAt: '2026-06-09T00:00:00.000Z', projectRoot: tempProject }),
      'utf8'
    );

    // Act
    const result = await runCommand(['session', 'info', '--active', '--project', tempProject, '--json']);
    const output = parseJsonOutput<{ active: true; sessionId: string; bindingPath: string; projectRoot: string; source: 'canonical' | 'legacy' }>(result.stdout);

    // Assert: AC1 — ok: true, source: 'canonical', sessionId matches.
    expect(output.ok).toBe(true);
    expect(output.command).toBe('session.info');
    expect(output.data.active).toBe(true);
    expect(output.data.sessionId).toBe('2026-06-09-session-d9aff4');
    expect(output.data.source).toBe('canonical');
    expect(output.data.bindingPath).toBe(join(tempProject, '.peaks', '_runtime', 'session.json'));
    expect(output.data.projectRoot).toBe(tempProject);
    expect(result.exitCode).not.toBe(1);
  });

  test('returns legacy source when only .peaks/.session.json exists', async () => {
    // Arrange: write the legacy binding only (pre-migration tree shape).
    const peaksDir = join(tempProject, '.peaks');
    mkdirSync(peaksDir, { recursive: true });
    writeFileSync(
      join(peaksDir, '.session.json'),
      JSON.stringify({ sessionId: '2026-05-20-session-legacy01', createdAt: '2026-05-20T00:00:00.000Z', projectRoot: tempProject }),
      'utf8'
    );

    // Act
    const result = await runCommand(['session', 'info', '--active', '--project', tempProject, '--json']);
    const output = parseJsonOutput<{ sessionId: string; bindingPath: string; projectRoot: string; source: 'canonical' | 'legacy' }>(result.stdout);

    // Assert: AC3 — ok: true, source: 'legacy', sessionId matches, warning emitted.
    expect(output.ok).toBe(true);
    expect(output.command).toBe('session.info');
    expect(output.data.sessionId).toBe('2026-05-20-session-legacy01');
    expect(output.data.source).toBe('legacy');
    expect(output.data.bindingPath).toBe(join(tempProject, '.peaks', '.session.json'));
    expect(output.warnings).toBeDefined();
    expect(output.warnings?.some((w) => w.includes('legacy'))).toBe(true);
  });

  test('returns NO_ACTIVE_SESSION with exit 1 when no binding exists (no crash, no side-effect)', async () => {
    // Arrange: empty projectRoot — no .peaks/ at all.
    // Act
    const result = await runCommand(['session', 'info', '--active', '--project', tempProject, '--json']);
    const output = parseJsonOutput<{ projectRoot: string }>(result.stdout);

    // Assert: AC2 — ok: false, code: NO_ACTIVE_SESSION, exit 1, NO .peaks/ side-effect.
    expect(output.ok).toBe(false);
    expect(output.command).toBe('session.info');
    expect(output.code).toBe('NO_ACTIVE_SESSION');
    expect(output.message).toContain('peaks workspace init');
    expect(output.data.projectRoot).toBe(tempProject);
    expect(result.exitCode).toBe(1);

    // The primitive must NOT side-effect-create a binding. The lookup is read-only.
    // We assert the canonical binding file does not exist after the call.
    const canonicalPath = join(tempProject, '.peaks', '_runtime', 'session.json');
    let created = false;
    try {
      const fs = await import('node:fs');
      created = fs.existsSync(canonicalPath);
    } catch {
      created = false;
    }
    expect(created).toBe(false);
  });

  test('resolves binding via the canonicalize-on-read fallback (relative stored projectRoot)', async () => {
    // Arrange: write the canonical binding with the relative projectRoot form "."
    // (the legacy strict-equality read returns null for this; getSessionIdCanonical
    //  resolves "." against the caller's absolute projectRoot). This guards the
    //  F22 fix against regression.
    const runtimeDir = join(tempProject, '.peaks', '_runtime');
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      join(runtimeDir, 'session.json'),
      JSON.stringify({ sessionId: '2026-06-09-session-relativeform', createdAt: '2026-06-09T00:00:00.000Z', projectRoot: '.' }),
      'utf8'
    );

    // Act: chdir into the project so "." resolves to it
    process.chdir(tempProject);
    const result = await runCommand(['session', 'info', '--active', '--json']);
    const output = parseJsonOutput<{ sessionId: string; bindingPath: string; source: 'canonical' | 'legacy' }>(result.stdout);

    // Assert: the canonicalize-on-read path finds the binding even though
    // the stored projectRoot is "." and the caller-passed projectRoot (cwd)
    // is the absolute realpath.
    expect(output.ok).toBe(true);
    expect(output.data.sessionId).toBe('2026-06-09-session-relativeform');
    expect(output.data.source).toBe('canonical');
    // Slice 022 (LOW-4): bindingPath must be surfaced on the canonicalize-on-read
    // path too, pointing at the canonical runtime home (not the relative form).
    // Slice 2026-06-13-repair-pre-existing-test-failures: realpathSync
    // `tempProject` because on macOS the OS exposes /tmp and
    // /var/folders/... as symlinks to /private/tmp and
    // /private/var/folders/.... `mkdtempSync` returns the unresolved
    // form; the CLI realpath-resolves it on read. The bindingPath
    // surface therefore reflects the resolved form.
    expect(output.data.bindingPath).toBe(join(realpathSync(tempProject), '.peaks', '_runtime', 'session.json'));
  });

  test('does NOT surface a bindingPath when no binding exists (NO_ACTIVE_SESSION boundary)', async () => {
    // Slice 022 (LOW-4): the read-failed path has no on-disk binding to report,
    // so the envelope's data must not carry a bindingPath field. Guards against
    // a future regression that defaults bindingPath to a bogus/empty path.
    const result = await runCommand(['session', 'info', '--active', '--project', tempProject, '--json']);
    const output = parseJsonOutput<{ projectRoot: string; bindingPath?: string }>(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('NO_ACTIVE_SESSION');
    expect(output.data.bindingPath).toBeUndefined();
  });
});
