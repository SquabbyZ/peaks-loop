// tests/unit/hooks/code-gate-undecidable.test.ts
//
// The gate fails OPEN when it cannot decide — deliberately, because a
// blocked edit on every call would be worse than an allowed one. But a
// silent allow is invisible, and the failure it hides is the expensive kind:
// an acceptance that feeds the payload through a pipe (which some shells do
// not forward to the process) then "passes" every case while proving
// nothing.
//
// So the case says so on stderr, with a marker, and says HOW to deliver a
// payload so that it arrives. These cases pin the marker on the empty
// payload, its absence when the payload IS delivered — by a real file
// redirection, not a pipe — and the recipe the next reader needs.
//
// Dimensions covered:
//   - behavior:   the empty payload is still ALLOWED (the policy is unchanged)
//   - integration: the real CLI, spawned; the payload delivered by a file
//   - render:     the dry-run envelope carries the recipe
//   - a11y:       the stderr marker and the recipe it carries

import { spawnSync } from 'node:child_process';
import { closeSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

const ROOT = resolve(__dirname, '..', '..', '..');

vi.setConfig({ testTimeout: SUBPROCESS_TEST_TIMEOUT_MS });

const UNDECIDABLE_MARKER = 'PEAKS_CODE_GATE_UNDECIDABLE';

const tmpRoots: string[] = [];

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-code-gate-undecidable-'));
  tmpRoots.push(root);
  mkdirSync(join(root, '.peaks'), { recursive: true });
  writeFileSync(join(root, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  return root;
}

interface GateRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

/** The command with the payload on stdin as TEXT. */
function runWithInput(root: string, stdin: string): GateRun {
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      join(ROOT, 'src', 'cli', 'index.ts'),
      'code-gate',
      '--project',
      root,
      '--json'
    ],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true, input: stdin, env: { ...process.env } }
  );
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

/**
 * The command with the payload on stdin as a FILE — the delivery the recipe
 * names. The file descriptor is handed to the child as its stdin, so the
 * bytes arrive the way `cmd /c "node ... < payload.json"` delivers them, and
 * not the way a shell pipeline may fail to.
 */
function runWithFileRedirect(root: string, payloadPath: string): GateRun {
  const fd = openSync(payloadPath, 'r');
  try {
    const run = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        join(ROOT, 'src', 'cli', 'index.ts'),
        'code-gate',
        '--project',
        root,
        '--json'
      ],
      {
        cwd: ROOT,
        encoding: 'utf8',
        windowsHide: true,
        stdio: [fd, 'pipe', 'pipe'],
        env: { ...process.env }
      }
    );
    return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
  } finally {
    closeSync(fd);
  }
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('peaks code-gate — the case it could not decide', () => {
  it(
    'when no payload arrives, should still allow, and should say so on stderr',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The POLICY is unchanged: an undecidable call is allowed. What
      // changed is that the case is visible — before, nothing said so.
      const root = makeProject();

      const result = runWithInput(root, '');

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(UNDECIDABLE_MARKER);
      expect(result.stderr).toContain('FILE REDIRECTION');
    }
  );

  it(
    'when the payload names a gated tool but no path, should allow, and should say so on stderr',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeProject();

      const result = runWithInput(root, JSON.stringify({ tool: 'Edit', input: {} }));

      expect(result.status).toBe(0);
      expect(result.stderr).toContain(UNDECIDABLE_MARKER);
    }
  );

  it(
    'when a payload arrives by file redirection, should judge it and leave no undecidable marker',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // The discriminating case: the marker must be ABSENT when the payload
      // really arrived, or the marker says nothing.
      const root = makeProject();
      const payloadPath = join(root, 'payload.json');
      writeFileSync(
        payloadPath,
        JSON.stringify({ tool: 'Edit', input: { file_path: 'src/services/foo.ts' } }),
        'utf8'
      );

      const result = runWithFileRedirect(root, payloadPath);

      expect(result.status).toBe(2);
      expect(result.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
      expect(result.stderr).not.toContain(UNDECIDABLE_MARKER);
    }
  );

  it(
    'when a payload arrives by file redirection for an ungated path, should allow without the marker',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeProject();
      const payloadPath = join(root, 'payload.json');
      writeFileSync(
        payloadPath,
        JSON.stringify({ tool: 'Edit', input: { file_path: 'docs/spec.md' } }),
        'utf8'
      );

      const result = runWithFileRedirect(root, payloadPath);

      expect(result.status).toBe(0);
      expect(result.stderr).not.toContain(UNDECIDABLE_MARKER);
    }
  );
});

describe('peaks code-gate — the dry-run envelope carries the recipe', () => {
  it(
    'when no payload arrives, should put the delivery recipe in the envelope',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeProject();

      const run = spawnSync(
        process.execPath,
        [
          '--import',
          'tsx',
          join(ROOT, 'src', 'cli', 'index.ts'),
          'code-gate',
          '--project',
          root,
          '--dry-run',
          '--json'
        ],
        { cwd: ROOT, encoding: 'utf8', windowsHide: true, input: '', env: { ...process.env } }
      );

      expect(run.status).toBe(0);
      const envelope = JSON.parse(run.stdout ?? '') as {
        nextActions: string[];
        data: { reason: string };
      };
      expect(envelope.data.reason).toBe('empty-or-malformed-payload');
      expect(envelope.nextActions.join('\n')).toContain('FILE REDIRECTION');
    }
  );
});
