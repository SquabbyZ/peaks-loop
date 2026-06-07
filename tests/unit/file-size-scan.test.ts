import { mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { describe, expect, test, afterEach } from 'vitest';
import { scanFileSize, DEFAULT_FILE_SIZE_THRESHOLD } from '../../src/services/scan/file-size-scan.js';

let tempDir: string;

function initGitRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'ignore' });
}

function commitAll(dir: string, message: string): void {
  execFileSync('git', ['add', '-A'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', message, '--allow-empty'], { cwd: dir, stdio: 'ignore' });
}

function makeFile(dir: string, name: string, lineCount: number): string {
  const filePath = join(dir, name);
  const content = Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`).join('\n');
  writeFileSync(filePath, content, 'utf8');
  return filePath;
}

async function makeProject(): Promise<string> {
  tempDir = await mkdtemp(join(tmpdir(), 'peaks-file-size-'));
  initGitRepo(tempDir);
  return tempDir;
}

afterEach(() => {
  // cleanup handled by test framework temp dirs
});

describe('scanFileSize', () => {
  test('returns ok when no changed files exist', async () => {
    const project = await makeProject();
    commitAll(project, 'initial');

    const result = scanFileSize({ projectRoot: project });

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    expect(result.threshold).toBe(DEFAULT_FILE_SIZE_THRESHOLD);
  });

  test('returns ok when all changed files are under the threshold', async () => {
    const project = await makeProject();
    commitAll(project, 'initial');
    makeFile(project, 'small.ts', 50);
    commitAll(project, 'add small file');
    makeFile(project, 'small.ts', 60);

    const result = scanFileSize({ projectRoot: project });

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
  });

  test('returns violations when a file exceeds the default threshold', async () => {
    const project = await makeProject();
    commitAll(project, 'initial');
    makeFile(project, 'big.ts', 50);
    commitAll(project, 'add big file');
    makeFile(project, 'big.ts', 850);

    const result = scanFileSize({ projectRoot: project });

    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.file).toBe('big.ts');
    expect(result.violations[0]?.lines).toBe(850);
  });

  test('uses custom threshold when provided', async () => {
    const project = await makeProject();
    commitAll(project, 'initial');
    makeFile(project, 'medium.ts', 50);
    commitAll(project, 'add medium file');
    makeFile(project, 'medium.ts', 60);

    const result = scanFileSize({ projectRoot: project, threshold: 50 });

    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.lines).toBe(60);
  });

  test('uses custom baseRef when provided', async () => {
    const project = await makeProject();
    makeFile(project, 'a.ts', 100);
    commitAll(project, 'commit a');
    makeFile(project, 'b.ts', 900);
    commitAll(project, 'commit b');

    const result = scanFileSize({ projectRoot: project, baseRef: 'HEAD~1' });

    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.file === 'b.ts')).toBe(true);
  });

  test('counts untracked files', async () => {
    const project = await makeProject();
    commitAll(project, 'initial');
    makeFile(project, 'untracked.ts', 820);

    const result = scanFileSize({ projectRoot: project });

    expect(result.ok).toBe(false);
    expect(result.violations.some((v) => v.file === 'untracked.ts')).toBe(true);
  });

  test('returns ok when git diff fails (empty repo with no commits)', async () => {
    const project = await mkdtemp(join(tmpdir(), 'peaks-file-size-nogit-'));
    initGitRepo(project);
    // No commits, so git diff will fail gracefully

    const result = scanFileSize({ projectRoot: project });

    expect(result.ok).toBe(true);
    expect(result.checkedFiles).toBe(0);
  });

  test('reports multiple violations', async () => {
    const project = await makeProject();
    commitAll(project, 'initial');
    makeFile(project, 'a.ts', 50);
    makeFile(project, 'b.ts', 60);
    commitAll(project, 'add files');
    makeFile(project, 'a.ts', 900);
    makeFile(project, 'b.ts', 1000);

    const result = scanFileSize({ projectRoot: project });

    expect(result.ok).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  test('does NOT crash on deleted files in the diff (slice #015 fix)', async () => {
    // Pre-#015: scanFileSize iterated every entry in `git diff --name-only
    // HEAD` and called readFileSync unconditionally. A refactor that
    // deleted files in the working tree produced ENOENT and aborted the
    // entire `peaks request transition rd → implemented` flow with
    // `code: PREREQUISITES_MISSING`. The fix uses `git diff --diff-filter=AM`
    // to exclude Deleted entries up-front; the existsSync guard stays as
    // belt-and-braces for untracked-then-deleted paths.
    const project = await makeProject();
    makeFile(project, 'keep.ts', 100);
    makeFile(project, 'delete-me.ts', 100);
    makeFile(project, 'also-delete-me.ts', 100);
    commitAll(project, 'initial commit with 3 files');

    // Delete 2 of them in the working tree.
    execFileSync('git', ['-C', project, 'rm', 'delete-me.ts'], { stdio: 'ignore' });
    execFileSync('git', ['-C', project, 'rm', 'also-delete-me.ts'], { stdio: 'ignore' });

    // Modify the survivor.
    writeFileSync(join(project, 'keep.ts'), Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n'), 'utf8');

    // Run the scan — should NOT throw ENOENT.
    const result = scanFileSize({ projectRoot: project });

    expect(result.ok).toBe(true);
    expect(result.violations).toEqual([]);
    // Only the surviving modified file is checked. The 2 deleted files
    // are excluded by `--diff-filter=AM` and never reach the file
    // system probe.
    expect(result.checkedFiles).toBe(1);
    expect(result.deletedFiles).toEqual([]);
  });
});

describe('DEFAULT_FILE_SIZE_THRESHOLD', () => {
  test('is set to 800', () => {
    expect(DEFAULT_FILE_SIZE_THRESHOLD).toBe(800);
  });
});
