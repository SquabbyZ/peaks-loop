// tests/unit/hooks/code-gate-residual-spellings-cli.test.ts
//
// `peaks code-gate` is what the PreToolUse hook actually runs, so the
// spelling-independence has to hold THROUGH the command — the pure decision
// function is not the whole surface. Two of the three residual spellings are
// visible here (a case variant, and a relative path carrying `..`), and the
// third one is only reachable through the command: the project root the
// families are relative to is the one the CALLER names, and a project nested
// inside a git repository is judged against itself rather than against the
// git root above it.
//
// The nested case needs a REAL repository: a directory that is not inside a
// git repository cannot reproduce it, because there the canonical root and
// the named root are the same directory and the two spellings agree for a
// reason that has nothing to do with the fix.
//
// Dimensions covered:
//   - behavior:   one verdict for one file, whatever the spelling
//   - integration: the real CLI, spawned
//   - render:     the verdict envelope the command prints
//   - a11y:       the stderr marker of a denial, and the exit code

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveCanonicalProjectRoot } from '~/src/services/config/config-service';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { createScratchGitRepo, type ScratchGitRepo } from '../_setup/scratch-git-repo.js';

const ROOT = resolve(__dirname, '..', '..', '..');

vi.setConfig({ testTimeout: SUBPROCESS_TEST_TIMEOUT_MS });

const tmpRoots: string[] = [];
const repos: ScratchGitRepo[] = [];

/**
 * A project the canonical resolver answers with itself: it carries a
 * `.peaks/config.json` marker, so the root it reports IS this directory and
 * not an ancestor of it.
 */
function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-code-gate-residual-'));
  tmpRoots.push(root);
  mkdirSync(join(root, '.peaks'), { recursive: true });
  writeFileSync(join(root, '.peaks', 'config.json'), JSON.stringify({ schemaVersion: 1 }));
  return root;
}

/**
 * A project INSIDE a git repository: the repository is the root, and the
 * project is a subdirectory of it. The two roots the command needs are then
 * two different directories, which is the whole point of the fixture.
 */
function makeNestedProject(): { repo: ScratchGitRepo; projectDir: string } {
  const repo = createScratchGitRepo('peaks-code-gate-nested-');
  repos.push(repo);
  const projectDir = join(repo.path, 'app');
  mkdirSync(join(projectDir, 'src', 'services'), { recursive: true });
  writeFileSync(join(projectDir, 'src', 'services', 'foo.ts'), 'export const x = 1;\n', 'utf8');
  return { repo, projectDir };
}

function payload(filePath: string): string {
  return JSON.stringify({ tool: 'Edit', input: { file_path: filePath } });
}

function runCodeGate(
  projectRoot: string,
  stdin: string
): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      join(ROOT, 'src', 'cli', 'index.ts'),
      'code-gate',
      '--project',
      projectRoot,
      '--dry-run',
      '--json'
    ],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true, input: stdin, env: { ...process.env } }
  );
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

function runCodeGateLive(
  projectRoot: string,
  stdin: string
): { status: number | null; stdout: string; stderr: string } {
  const run = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      join(ROOT, 'src', 'cli', 'index.ts'),
      'code-gate',
      '--project',
      projectRoot
    ],
    { cwd: ROOT, encoding: 'utf8', windowsHide: true, input: stdin, env: { ...process.env } }
  );
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

afterEach(() => {
  while (repos.length > 0) {
    const repo = repos.pop();
    if (repo !== undefined) repo.dispose();
  }
  while (tmpRoots.length > 0) {
    const root = tmpRoots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

describe('peaks code-gate — a case variant is the file it names', () => {
  it(
    'denies a case variant of a hard-blocked path',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeProject();
      const { status, stdout } = runCodeGate(root, payload('SRC/services/foo.ts'));
      expect(status).toBe(0);
      expect(stdout).toContain('"action": "deny"');
      expect(stdout).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
      expect(stdout).toContain('src/');
    }
  );

  it('denies a relative path carrying `..`', { timeout: SUBPROCESS_TEST_TIMEOUT_MS }, () => {
    const root = makeProject();
    const { status, stdout } = runCodeGate(root, payload('docs/../src/services/foo.ts'));
    expect(status).toBe(0);
    expect(stdout).toContain('"action": "deny"');
    expect(stdout).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });

  it('allows a `..` that leaves the project', { timeout: SUBPROCESS_TEST_TIMEOUT_MS }, () => {
    const root = makeProject();
    const { stdout } = runCodeGate(root, payload('../../elsewhere/src/services/foo.ts'));
    expect(stdout).toContain('"action": "allow"');
  });

  it(
    'denies a case variant through the exit channel too',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const root = makeProject();
      const denied = runCodeGateLive(root, payload('SRC/services/foo.ts'));
      expect(denied.status).toBe(2);
      expect(denied.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
    }
  );
});

describe('peaks code-gate — a project nested inside a git repository', () => {
  it(
    'judges the absolute spelling and the relative spelling the same way',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const { repo, projectDir } = makeNestedProject();

      // The precondition, asserted: the canonical root IS the git root, one
      // level above the project the caller names. Without this the arm would
      // pass for a reason that has nothing to do with the fix.
      expect(realpathSync(resolveCanonicalProjectRoot(projectDir))).toBe(realpathSync(repo.path));

      const relative = runCodeGate(projectDir, payload('src/services/foo.ts'));
      const absoluteNative = runCodeGate(
        projectDir,
        payload(resolve(projectDir, 'src', 'services', 'foo.ts'))
      );
      const absolutePosix = runCodeGate(
        projectDir,
        payload(`${projectDir.replace(/\\/g, '/')}/src/services/foo.ts`)
      );

      expect(relative.stdout).toContain('"action": "deny"');
      expect(absoluteNative.stdout).toContain('"action": "deny"');
      expect(absolutePosix.stdout).toContain('"action": "deny"');
    }
  );

  it('still allows a path outside the project', { timeout: SUBPROCESS_TEST_TIMEOUT_MS }, () => {
    const { repo, projectDir } = makeNestedProject();
    const outside = resolve(repo.path, 'src', 'services', 'foo.ts');
    const { stdout } = runCodeGate(projectDir, payload(outside));
    expect(stdout).toContain('"action": "allow"');
  });
});
