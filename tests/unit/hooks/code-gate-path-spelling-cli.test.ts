// tests/unit/hooks/code-gate-path-spelling-cli.test.ts
//
// `peaks code-gate` is what the PreToolUse hook actually runs, so the
// spelling-independence has to hold THROUGH the command — not only in the
// pure decision function the command calls.
//
// The command resolves the project root (the hook entry passes it as
// `--project`), and that root is what relates an ABSOLUTE target path to the
// project. A payload that names the same file three ways must get the same
// verdict three times; before this, the relative spelling was denied and the
// other two were allowed.
//
// Dimensions covered:
//   - behavior:   one verdict for one file, whatever the spelling
//   - integration: the real CLI, spawned
//   - render:     the verdict envelope the command prints
//   - a11y:       the stderr marker of a denial, and the exit code

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

const ROOT = resolve(__dirname, '..', '..', '..');

vi.setConfig({ testTimeout: SUBPROCESS_TEST_TIMEOUT_MS });

const tmpRoots: string[] = [];

/**
 * A project the canonical resolver answers with itself: it carries a
 * `.peaks/config.json` marker, so the root it reports IS this directory and
 * not an ancestor of it.
 */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-code-gate-spelling-'));
  tmpRoots.push(root);
  mkdirSync(join(root, '.peaks'), { recursive: true });
  writeFileSync(join(root, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  return root;
}

function payload(filePath: string): string {
  return JSON.stringify({ tool: 'Edit', input: { file_path: filePath } });
}

function runCodeGate(root: string, stdin: string): { status: number | null; stdout: string } {
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
    { cwd: ROOT, encoding: 'utf8', windowsHide: true, input: stdin, env: { ...process.env } }
  );
  return { status: run.status, stdout: run.stdout ?? '' };
}

function runCodeGateLive(root: string, stdin: string): { status: number | null; stderr: string } {
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
  return { status: run.status, stderr: run.stderr ?? '' };
}

afterEach(() => {
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('peaks code-gate — one file, three spellings, one verdict', () => {
  it(
    'denies the same file however the payload spells it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeProject();
      const spellings = [
        'src/services/foo.ts',
        './src/services/foo.ts',
        `${root.replace(/\\/g, '/')}/src/services/foo.ts`
      ];

      const verdicts = spellings.map((spelling) => {
        const { status, stdout } = runCodeGate(root, payload(spelling));
        expect(status).toBe(0);
        expect(stdout, `spelling: ${spelling}`).toContain('"action": "deny"');
        expect(stdout, `spelling: ${spelling}`).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
        return stdout;
      });

      // The same family in every verdict — not three decisions that happen to
      // share a word.
      for (const stdout of verdicts) {
        expect(stdout).toContain('src/');
      }
    }
  );

  it(
    'allows the same allow-listed file however the payload spells it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeProject();
      const spellings = [
        'docs/spec.md',
        './docs/spec.md',
        `${root.replace(/\\/g, '/')}/docs/spec.md`
      ];

      for (const spelling of spellings) {
        const { status, stdout } = runCodeGate(root, payload(spelling));
        expect(status).toBe(0);
        expect(stdout, `spelling: ${spelling}`).toContain('"action": "allow"');
      }
    }
  );

  it(
    'denies an absolute path through the exit channel too',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeProject();
      const absolute = `${root.replace(/\\/g, '/')}/src/services/foo.ts`;

      const denied = runCodeGateLive(root, payload(absolute));
      expect(denied.status).toBe(2);
      expect(denied.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
    }
  );
});
