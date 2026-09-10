// tests/unit/services/scan/file-size-scan.test.ts
//
// 2026-09-10 — `peaks scan file-size` is diff-scoped and flags any changed
// file over the 800-line cap. `.peaks/memory/index.json` is 2657 lines and is
// rebuilt wholesale by `peaks memory reindex`, so every commit that reindexes
// memory reported a violation on a derived index. The exemption lives in
// GENERATED_ARTIFACT_PATTERNS (file-size-scan.ts) and this file locks down
// both halves of the contract:
//   - a generated artifact is skipped and reported in `exemptFiles`;
//   - a >800-line change in a REAL source file is still a violation —
//     an exemption that also hides source files would be worse than the
//     false positive it removes.
//
// Dimensions covered: render (result shape), behavior (matcher + verdicts),
// integration (real git repo on disk), a11y (CLI exit code / human text).
//
// Style: BDD given/when/then per peaks-loop 4.0.11+ contract.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';
import { registerScanCommands } from '../../../../src/cli/commands/scan-commands.js';
import {
  DEFAULT_FILE_SIZE_THRESHOLD,
  isGeneratedArtifact,
  scanFileSize,
} from '../../../../src/services/scan/file-size-scan.js';

declareDimensions('tests/unit/services/scan/file-size-scan.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y',
]);

const OVER_CAP = DEFAULT_FILE_SIZE_THRESHOLD + 50;
const GENERATED_INDEX = '.peaks/memory/index.json';

function writeLines(relativePath: string, count: number, root: string): void {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${Array.from({ length: count }, () => 'x').join('\n')}\n`, 'utf8');
}

function git(cwd: string, args: readonly string[]): void {
  execFileSync('git', [...args], { cwd, stdio: 'pipe' });
}

/** A throwaway repo: a small source file + an over-cap generated index, both
 *  committed, then both touched so they land in `git diff HEAD`. */
function makeRepoWithReindexCommit(): string {
  const root = mkdtempSync(join(tmpdir(), 'file-size-scan-'));
  git(root, ['init', '-q']);
  writeLines('src/small.ts', 5, root);
  writeLines(GENERATED_INDEX, OVER_CAP, root);
  git(root, ['add', '-A']);
  git(root, [
    '-c', 'user.email=t@t', '-c', 'user.name=t',
    'commit', '-q', '-m', 'init',
  ]);
  // Touch both, mimicking "a slice reindexed memory and edited source".
  writeLines('src/small.ts', 6, root);
  writeLines(GENERATED_INDEX, OVER_CAP + 1, root);
  return root;
}

let repo: string;
let exitBefore: typeof process.exitCode;

beforeEach(() => {
  repo = makeRepoWithReindexCommit();
  exitBefore = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = exitBefore;
  try {
    rmSync(repo, { recursive: true, force: true });
  } catch {
    // Windows open-handle race on .git; the tmp dir is reapable either way.
  }
});

describe('file-size scan — generated-artifact exemption', () => {
  describe('(integration) diff-scoped scan over a real repo', () => {
    it('when the changed files are a source file and a reindexed generated index, should exempt the index and still check the source file', () => {
      // given: `git diff HEAD` lists src/small.ts and .peaks/memory/index.json
      // when:  the scan runs against the default HEAD base ref
      const result = scanFileSize({ projectRoot: repo });
      // then:  the generated index is skipped (not checked, not a violation),
      //        and the real source file is still counted
      expect(result.ok).toBe(true);
      expect(result.violations).toEqual([]);
      expect(result.exemptFiles).toEqual([GENERATED_INDEX]);
      expect(result.checkedFiles).toBe(1);
    });

    it('when a >800-line file is added under src/, should still report it as a violation (exemption is not weakened)', () => {
      // given: a new 850-line module in the real source tree
      writeLines('src/huge.ts', OVER_CAP, repo);
      // when:  the scan runs
      const result = scanFileSize({ projectRoot: repo });
      // then:  the acceptance case holds — source is NOT exempt
      expect(result.ok).toBe(false);
      expect(result.violations).toEqual([{ file: 'src/huge.ts', lines: OVER_CAP + 1 }]);
      // and the generated index is still exempt in the same run
      expect(result.exemptFiles).toEqual([GENERATED_INDEX]);
    });

    it('when a tracked source file grows past the cap in the working tree, should still report it (diff-scoped, not only untracked)', () => {
      // given: src/small.ts is tracked, modified, and listed by
      //        `git diff --diff-filter=AM HEAD`
      writeLines('src/small.ts', OVER_CAP, repo);
      // when:  the scan runs
      const result = scanFileSize({ projectRoot: repo });
      // then:  the exemption does not reach the tracked diff path either
      expect(result.violations).toEqual([{ file: 'src/small.ts', lines: OVER_CAP + 1 }]);
    });

    it('when a >800-line file is added under tests/, should still report it as a violation', () => {
      // given: an oversized test file (tests/ is source too)
      writeLines('tests/unit/huge.test.ts', OVER_CAP, repo);
      // when:  the scan runs
      const result = scanFileSize({ projectRoot: repo });
      // then:  it is reported
      expect(result.violations).toEqual([{ file: 'tests/unit/huge.test.ts', lines: OVER_CAP + 1 }]);
    });

    it('when an over-cap lockfile changed, should exempt it', () => {
      // given: a regenerated lockfile over the cap
      writeLines('pnpm-lock.yaml', OVER_CAP, repo);
      // when:  the scan runs
      const result = scanFileSize({ projectRoot: repo });
      // then:  lockfiles are whole-cloth tool output — never a violation
      expect(result.violations).toEqual([]);
      expect(result.exemptFiles).toContain('pnpm-lock.yaml');
    });
  });

  describe('(behavior) isGeneratedArtifact matcher', () => {
    it('when given a generated artifact path, should return true', () => {
      // given/when/then: known tool output only
      for (const file of [
        '.peaks/memory/index.json',
        '.peaks/lint/baseline.json',
        '.peaks/retrospective/index.json',
        'pnpm-lock.yaml',
        'examples/video-demo/pnpm-lock.yaml',
        'package-lock.json',
        'yarn.lock',
      ]) {
        expect(isGeneratedArtifact(file), file).toBe(true);
      }
    });

    it('when given a source or test path, should return false', () => {
      // given/when/then: the exemption must not reach source
      for (const file of [
        'src/services/config/config-service.ts',
        'src/peaks/not-a-state-dir.ts',
        '.peaksfoo/index.json',
        'tests/unit/services/scan/file-size-scan.test.ts',
        '.peaks.json',
        'docs/peaks-lock.yaml.bak',
      ]) {
        expect(isGeneratedArtifact(file), file).toBe(false);
      }
    });

    it('when given a Windows-separator path, should normalize before matching', () => {
      // given: git emits forward slashes, but a caller may not
      // when/then: the separator does not change the verdict
      expect(isGeneratedArtifact('.peaks\\memory\\index.json')).toBe(true);
      expect(isGeneratedArtifact('src\\services\\config\\config-service.ts')).toBe(false);
    });
  });

  describe('(render) result shape', () => {
    it('when the scan completes, should report exemptFiles alongside the existing counters', () => {
      // given/when: any scan run
      const result = scanFileSize({ projectRoot: repo });
      // then: the exemption is auditable, not a silent skip
      expect(Object.keys(result).sort()).toEqual(
        ['checkedFiles', 'deletedFiles', 'exemptFiles', 'ok', 'threshold', 'violations'],
      );
      expect(Array.isArray(result.exemptFiles)).toBe(true);
    });
  });

  describe('(a11y) CLI surface', () => {
    async function runScanCli(args: readonly string[]): Promise<string> {
      const { io, captured } = makeCapturedIo();
      const program = new Command();
      program.exitOverride();
      registerScanCommands(program, io);
      await program.parseAsync(['scan', 'file-size', ...args], { from: 'user' });
      return captured.stderrText() + captured.text();
    }

    it('when only the generated index exceeds the cap, should exit 0 with no "exceed" instruction', async () => {
      // given: the reindex commit (no oversized source)
      // when:  the CLI runs
      const output = await runScanCli(['--project', repo, '--json']);
      // then:  the gate is green and stays quiet
      expect(process.exitCode).toBe(0);
      expect(output).not.toContain('exceed');
    });

    it('when an oversized source file is present, should exit 1 and name the split action', async () => {
      // given: an over-cap source module
      writeLines('src/huge.ts', OVER_CAP, repo);
      // when:  the CLI runs
      const output = await runScanCli(['--project', repo, '--json']);
      // then:  the gate blocks with a human-readable next action
      expect(process.exitCode).toBe(1);
      expect(output).toContain('src/huge.ts');
      expect(output).toContain('exceed');
    });
  });
});
