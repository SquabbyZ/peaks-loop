// tests/unit/services/scan/file-size-scan.test.ts
//
// 2026-09-10 — `peaks scan file-size` is diff-scoped and flags any changed file
// over the cap. `.peaks/memory/index.json` is 2657 lines and is
// rebuilt wholesale by `peaks memory reindex`, so every commit that reindexes
// memory reported a violation on a derived index. 2026-09-11 — the same gate
// fired on every release, on CHANGELOG.md (4747 lines), which no one can
// "simplify" without deleting history. The exemption lives in
// SIZE_CAP_EXEMPT_PATTERNS (file-size-scan.ts) and this file locks down both
// halves of the contract:
//   - an exempt path (tool output OR append-only record) is skipped and
//     reported in `exemptFiles`;
//   - an over-cap change in a REAL source file is still a violation —
//     an exemption that also hides source files would be worse than the
//     false positive it removes.
//
// THE CAP IS NOT THIS FILE'S EITHER (rid 2026-09-30-cap-unify-01). It used to
// read `DEFAULT_FILE_SIZE_THRESHOLD = 800`, a number this module owned; the scan
// now resolves each file's threshold from `file-size-policy.ts` — 300 raw lines,
// 500 under root `tests/` — the same module the husky gate's `fileSizeOverCap`
// row counts against. Every cap here is derived from that module, so a change to
// the policy moves these cases instead of contradicting them, and
// `tests/unit/standards/file-size-cap.test.ts` fails if a number reappears.
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
import { isSizeCapExempt, scanFileSize } from '../../../../src/services/scan/file-size-scan.js';
import {
  FILE_SIZE_CAP_DEFAULT,
  FILE_SIZE_CAP_TESTS
} from '../../../../src/services/scan/file-size-policy.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../../_setup/subprocess-timeouts.js';

declareDimensions('tests/unit/services/scan/file-size-scan.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const OVER_CAP = FILE_SIZE_CAP_DEFAULT + 50;
const TESTS_OVER_CAP = FILE_SIZE_CAP_TESTS + 50;
const GENERATED_INDEX = '.peaks/memory/index.json';

function writeLines(relativePath: string, count: number, root: string): void {
  const absolute = join(root, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${Array.from({ length: count }, () => 'x').join('\n')}\n`, 'utf8');
}

function git(cwd: string, args: readonly string[]): void {
  execFileSync('git', [...args], { cwd, stdio: 'pipe', windowsHide: true });
}

/** A throwaway repo: a small source file + an over-cap generated index, both
 *  committed, then both touched so they land in `git diff HEAD`. */
function makeRepoWithReindexCommit(): string {
  const root = mkdtempSync(join(tmpdir(), 'file-size-scan-'));
  git(root, ['init', '-q']);
  writeLines('src/small.ts', 5, root);
  writeLines(GENERATED_INDEX, OVER_CAP, root);
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init']);
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

describe('file-size scan — size-cap exemption', () => {
  describe('(integration) diff-scoped scan over a real repo', () => {
    it(
      'when the changed files are a source file and a reindexed generated index, should exempt the index and still check the source file',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: `git diff HEAD` lists src/small.ts and .peaks/memory/index.json
        // when:  the scan runs against the default HEAD base ref
        const result = scanFileSize({ projectRoot: repo });
        // then:  the generated index is skipped (not checked, not a violation),
        //        and the real source file is still counted
        expect(result.ok).toBe(true);
        expect(result.violations).toEqual([]);
        expect(result.exemptFiles).toEqual([GENERATED_INDEX]);
        expect(result.checkedFiles).toBe(1);
      }
    );

    it(
      'when an over-cap file is added under src/, should still report it as a violation (exemption is not weakened)',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: a new over-cap module in the real source tree
        writeLines('src/huge.ts', OVER_CAP, repo);
        // when:  the scan runs
        const result = scanFileSize({ projectRoot: repo });
        // then:  the acceptance case holds — source is NOT exempt, and the row
        //        carries the cap that decided it (the policy's, not a default)
        expect(result.ok).toBe(false);
        expect(result.threshold).toBeNull();
        expect(result.violations).toEqual([
          { file: 'src/huge.ts', lines: OVER_CAP + 1, cap: FILE_SIZE_CAP_DEFAULT }
        ]);
        // and the generated index is still exempt in the same run
        expect(result.exemptFiles).toEqual([GENERATED_INDEX]);
      }
    );

    it(
      'when a tracked source file grows past the cap in the working tree, should still report it (diff-scoped, not only untracked)',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: src/small.ts is tracked, modified, and listed by
        //        `git diff --diff-filter=AM HEAD`
        writeLines('src/small.ts', OVER_CAP, repo);
        // when:  the scan runs
        const result = scanFileSize({ projectRoot: repo });
        // then:  the exemption does not reach the tracked diff path either
        expect(result.violations).toEqual([
          { file: 'src/small.ts', lines: OVER_CAP + 1, cap: FILE_SIZE_CAP_DEFAULT }
        ]);
      }
    );

    it(
      'when an over-cap file is added under tests/, should report it against the tests cap',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: an oversized test file (tests/ is source too, at 500 raw lines)
        writeLines('tests/unit/huge.test.ts', TESTS_OVER_CAP, repo);
        // when:  the scan runs
        const result = scanFileSize({ projectRoot: repo });
        // then:  it is reported, and the cap named in the row is the `tests/` one
        //        — the two-cap policy is a property of the path, not of the run
        expect(result.violations).toEqual([
          { file: 'tests/unit/huge.test.ts', lines: TESTS_OVER_CAP + 1, cap: FILE_SIZE_CAP_TESTS }
        ]);
      }
    );

    it(
      'when a tests/ file is over the src cap but under its own, should report no violation',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: 400 raw lines — over `FILE_SIZE_CAP_DEFAULT`, under the 500 the
        //        policy grants the root `tests/` tree
        writeLines('tests/unit/mid.test.ts', FILE_SIZE_CAP_DEFAULT + 100, repo);
        // when:  the scan runs
        const result = scanFileSize({ projectRoot: repo });
        // then:  the dir-specific cap was applied, not the default one
        expect(result.violations).toEqual([]);
        expect(result.ok).toBe(true);
      }
    );

    it(
      'when a package tests file sits over the default cap, should be reported at 300 not 500',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: the reading decided 2026-09-30 — a `tests/` dir INSIDE a package
        //        keeps the package scope's 300, so 350 lines is already a breach
        writeLines('packages/peaks-loop-shared/tests/x.test.ts', OVER_CAP, repo);
        // when/then
        const result = scanFileSize({ projectRoot: repo });
        expect(result.violations).toEqual([
          {
            file: 'packages/peaks-loop-shared/tests/x.test.ts',
            lines: OVER_CAP + 1,
            cap: FILE_SIZE_CAP_DEFAULT
          }
        ]);
      }
    );

    it(
      'when the caller passes --threshold, should apply it to every file instead of the policy',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: a 6-line source file and an override below it
        // when:  the scan runs with the override
        const result = scanFileSize({ projectRoot: repo, threshold: 4 });
        // then:  the override is echoed, and each row carries the cap that was
        //        used — the policy's 300 would have passed this file
        expect(result.threshold).toBe(4);
        expect(result.violations).toEqual([{ file: 'src/small.ts', lines: 7, cap: 4 }]);
      }
    );

    it(
      'when a changed file is outside the policy scope, should report it as out of scope instead of inventing a cap for it',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: F3 of rid 2026-09-30-cap-unify-01. `fileSizeCapFor` answers 300 for
        //        anything that is not under root `tests/`, and the scan used to ask
        //        it about EVERY changed file. So a 320-line file under `.husky/` —
        //        a directory the policy does not measure, contributing 0 to the
        //        `fileSizeOverCap` row — reddened `request transition` with no
        //        ceiling to descend and no split campaign that could clear it.
        //        Three shapes of "not the policy's": another dir, another extension,
        //        and a root-level file.
        writeLines('.husky/big-hook.mjs', OVER_CAP, repo);
        writeLines('docs/notes.md', OVER_CAP, repo);
        writeLines('src/config.json', OVER_CAP, repo);
        // when:  the scan runs
        const result = scanFileSize({ projectRoot: repo });
        // then:  none of them is a violation...
        expect(result.violations).toEqual([]);
        expect(result.ok).toBe(true);
        // ...and none of them is silently skipped either: the verdict is named.
        expect(result.outOfScopeFiles.sort()).toEqual(
          ['.husky/big-hook.mjs', 'docs/notes.md', 'src/config.json'].sort()
        );
        expect(result.checkedFiles).toBe(1); // src/small.ts, the only measured change
      }
    );

    it(
      'when an out-of-scope file changed next to an over-cap source file, should report only the source file',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: the scope rule must not become an amnesty — the in-scope half of
        //        the same diff is still counted against its policy cap.
        writeLines('.husky/big-hook.mjs', OVER_CAP, repo);
        writeLines('src/huge.ts', OVER_CAP, repo);
        // when/then
        const result = scanFileSize({ projectRoot: repo });
        expect(result.violations).toEqual([
          { file: 'src/huge.ts', lines: OVER_CAP + 1, cap: FILE_SIZE_CAP_DEFAULT }
        ]);
        expect(result.outOfScopeFiles).toEqual(['.husky/big-hook.mjs']);
      }
    );

    it(
      'when the caller names --threshold, should measure every changed file including one outside the scope',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: an out-of-scope file over the caller's own number
        writeLines('.husky/big-hook.mjs', OVER_CAP, repo);
        // when:  the scan runs with an override
        const result = scanFileSize({ projectRoot: repo, threshold: 4 });
        // then:  the override means "apply this to EVERY file" — its documented
        //        meaning — so the scope rule does not narrow it, and nothing is
        //        reported as out of scope.
        expect(result.outOfScopeFiles).toEqual([]);
        expect(result.violations.map((v) => v.file).sort()).toContain('.husky/big-hook.mjs');
      }
    );

    it(
      'when an over-cap lockfile changed, should exempt it',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: a regenerated lockfile over the cap
        writeLines('pnpm-lock.yaml', OVER_CAP, repo);
        // when:  the scan runs
        const result = scanFileSize({ projectRoot: repo });
        // then:  lockfiles are whole-cloth tool output — never a violation
        expect(result.violations).toEqual([]);
        expect(result.exemptFiles).toContain('pnpm-lock.yaml');
      }
    );

    it(
      'when a release commit appends an over-cap CHANGELOG.md entry, should exempt it and still check the source it touched (the reported 4.0.37 case)',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: an over-cap CHANGELOG plus a real source change, both in the diff
        writeLines('CHANGELOG.md', OVER_CAP, repo);
        writeLines('src/small.ts', OVER_CAP, repo);
        // when:  the scan runs
        const result = scanFileSize({ projectRoot: repo });
        // then:  the changelog is history — nothing a human could simplify — so
        //        the release gate is green...
        expect(result.exemptFiles).toContain('CHANGELOG.md');
        // ...and the exemption is not a blanket amnesty: the source file in the
        // same commit is still counted and still reported.
        expect(result.violations).toEqual([
          { file: 'src/small.ts', lines: OVER_CAP + 1, cap: FILE_SIZE_CAP_DEFAULT }
        ]);
        expect(result.ok).toBe(false);
      }
    );

    it(
      'when a nested package CHANGELOG.md is over the cap, should exempt it too',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: the monorepo shape (packages/*/CHANGELOG.md), which the root
        //        CHANGELOG.md would not cover if the pattern were root-anchored
        writeLines('packages/peaks-loop-shared/CHANGELOG.md', OVER_CAP, repo);
        // when:  the scan runs
        const result = scanFileSize({ projectRoot: repo });
        // then:  it is the same kind of append-only record
        expect(result.violations).toEqual([]);
        expect(result.exemptFiles).toContain('packages/peaks-loop-shared/CHANGELOG.md');
      }
    );
  });

  describe('(behavior) isSizeCapExempt matcher', () => {
    it(
      'when given a generated artifact or append-only record path, should return true',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given/when/then: known tool output, plus the append-only records
        for (const file of [
          '.peaks/memory/index.json',
          '.peaks/lint/baseline.json',
          '.peaks/retrospective/index.json',
          'pnpm-lock.yaml',
          'examples/video-demo/pnpm-lock.yaml',
          'package-lock.json',
          'yarn.lock',
          'CHANGELOG.md',
          'packages/peaks-loop-shared/CHANGELOG.md'
        ]) {
          expect(isSizeCapExempt(file), file).toBe(true);
        }
      }
    );

    it(
      'when given a source or test path, should return false',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given/when/then: the exemption must not reach source, and must not
        // turn into "markdown in general" or "anything named like a changelog"
        for (const file of [
          'src/services/config/config-service.ts',
          'src/peaks/not-a-state-dir.ts',
          '.peaksfoo/index.json',
          'tests/unit/services/scan/file-size-scan.test.ts',
          '.peaks.json',
          'docs/peaks-lock.yaml.bak',
          'docs/CHANGELOG-history.md',
          'docs/superpowers/plans/2026-08-03-capability-baseline-guard-audit.md',
          'CHANGELOG.md.bak'
        ]) {
          expect(isSizeCapExempt(file), file).toBe(false);
        }
      }
    );

    it(
      'when given a Windows-separator path, should normalize before matching',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given: git emits forward slashes, but a caller may not
        // when/then: the separator does not change the verdict
        expect(isSizeCapExempt('.peaks\\memory\\index.json')).toBe(true);
        expect(isSizeCapExempt('src\\services\\config\\config-service.ts')).toBe(false);
      }
    );
  });

  describe('(render) result shape', () => {
    it(
      'when the scan completes, should report exemptFiles and outOfScopeFiles alongside the existing counters',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      () => {
        // given/when: any scan run
        const result = scanFileSize({ projectRoot: repo });
        // then: the exemption is auditable, not a silent skip — and so is the
        //       scope rule, which is a DIFFERENT verdict (the policy has no cap for
        //       these paths; it does not say they are small enough).
        expect(Object.keys(result).sort()).toEqual([
          'checkedFiles',
          'deletedFiles',
          'exemptFiles',
          'ok',
          'outOfScopeFiles',
          'threshold',
          'violations'
        ]);
        expect(Array.isArray(result.exemptFiles)).toBe(true);
        expect(Array.isArray(result.outOfScopeFiles)).toBe(true);
      }
    );
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

    it(
      'when only the generated index exceeds the cap, should exit 0 with no "exceed" instruction',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      async () => {
        // given: the reindex commit (no oversized source)
        // when:  the CLI runs
        const output = await runScanCli(['--project', repo, '--json']);
        // then:  the gate is green and stays quiet
        expect(process.exitCode).toBe(0);
        expect(output).not.toContain('exceed');
      }
    );

    it(
      'when an oversized source file is present, should exit 1 and name the split action',
      { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
      async () => {
        // given: an over-cap source module
        writeLines('src/huge.ts', OVER_CAP, repo);
        // when:  the CLI runs
        const output = await runScanCli(['--project', repo, '--json']);
        // then:  the gate blocks with a human-readable next action
        expect(process.exitCode).toBe(1);
        expect(output).toContain('src/huge.ts');
        expect(output).toContain('exceed');
      }
    );
  });
});
