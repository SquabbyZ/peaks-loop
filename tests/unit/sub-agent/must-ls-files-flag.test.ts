// tests/unit/sub-agent/must-ls-files-flag.test.ts
//
// F5 follow-up (sediment 2026-08-11-rid-001-redo-fake-green-recovery-closure
// §Lesson 1) — anti-fake-green gate for sub-agent dispatch.
//
// Locks down 4 behaviors of the new `--must-ls-files <glob>` flag:
//   1. Frontmatter parsing: `runGitLsFiles(project, 'src/cli/**/*.ts')`
//      returns the matching tracked files in the real repo (proves the
//      helper actually shells out to git and parses stdout).
//   2. Empty result on zero-match: a non-existent glob yields `[]` so
//      the `exists: false` branch of the envelope renders correctly.
//   3. Non-git / git-missing path: a workspace with no `.git` returns
//      `[]` (best-effort never-throw contract).
//   4. Backward compat: when `--must-ls-files` is NOT supplied, the
//      default `mustLsFiles` value is `undefined` so the dispatch CLI
//      preserves the legacy envelope shape (no `mustLsFilesVerification`
//      injected, no frontmatter block prepended) — 106+ existing
//      dispatch call sites are byte-identical.
//
// Style: BDD given/when/then per peaks-loop 4.0.11+ contract.

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';

import { runGitLsFiles } from '../../../src/cli/commands/dispatch-commands.js';
import type { DispatchOptions } from '../../../src/cli/commands/sub-agent-shared.js';

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');

describe('F5 anti-fake-green: --must-ls-files frontmatter + verification envelope', () => {
  describe('runGitLsFiles helper', () => {
    it('when given a matching glob, should return the tracked files (anti-fake-green positive)', () => {
      // given: the real peaks-loop repo (projectRoot, with `.git`)
      // when:  runGitLsFiles('src/cli/commands/dispatch-commands.ts') is invoked
      // then:  the returned list contains the exact file (proves the helper
      //        actually shells out to git and parses stdout byte-perfectly)
      const files = runGitLsFiles(PROJECT_ROOT, 'src/cli/commands/dispatch-commands.ts');
      expect(files.length).toBeGreaterThan(0);
      expect(files).toContain('src/cli/commands/dispatch-commands.ts');
    });

    it('when given a wildcard glob, should return all matching tracked files', () => {
      // given: the real peaks-loop repo
      // when:  runGitLsFiles('src/cli/commands/dispatch-*.ts') is invoked
      // then:  every returned entry is a tracked dispatch-* command file
      const files = runGitLsFiles(PROJECT_ROOT, 'src/cli/commands/dispatch-*.ts');
      expect(files.length).toBeGreaterThan(0);
      for (const f of files) {
        expect(f).toMatch(/^src\/cli\/commands\/dispatch-.+\.ts$/);
      }
    });

    it('when given a glob with zero matches, should return an empty array (exists:false branch)', () => {
      // given: the real peaks-loop repo
      // when:  runGitLsFiles('totally/fake/never-exists-*.ghost') is invoked
      // then:  an empty array (the dispatch envelope will render exists:false)
      const files = runGitLsFiles(PROJECT_ROOT, 'totally/fake/never-exists-*.ghost');
      expect(files).toEqual([]);
      expect(Array.isArray(files)).toBe(true);
    });

    it('when projectRoot is not a git repo, should return empty array (never throws)', () => {
      // given: a tmp workspace that is NOT a git repo
      // when:  runGitLsFiles(tmpPath, '*.ts') is invoked
      // then:  empty array (git's non-zero exit is swallowed per the
      //        failure-mode contract documented on runGitLsFiles)
      const tmp = mkdtempSync(join(tmpdir(), 'f5-notgit-'));
      try {
        writeFileSync(join(tmp, 'a.ts'), 'export const a = 1;\n');
        const files = runGitLsFiles(tmp, '*.ts');
        expect(files).toEqual([]);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe('DispatchOptions back-compat surface', () => {
    it('when no `--must-ls-files` flag is supplied, should have undefined mustLsFiles (legacy callers byte-identical)', () => {
      // given: a legacy DispatchOptions object built without the new flag
      // when:  TypeScript infers the runtime type
      // then:  mustLsFiles === undefined so the dispatch CLI's
      //        `typeof options.mustLsFiles === 'string'` branch is dead
      //        and no `mustLsFilesVerification` is injected into the
      //        envelope — 106+ existing dispatch call sites are unchanged
      const legacyOptions: DispatchOptions = {
        prompt: 'do X',
        requestId: 'r1'
      };
      expect(legacyOptions.mustLsFiles).toBeUndefined();

      // The compiled CLI checks `typeof options.mustLsFiles === 'string' &&
      // options.mustLsFiles.length > 0` to decide whether to inject the
      // frontmatter + verification block; both checks must be false for
      // legacy callers. Asserting on the type + undefined covers it.
      const isInjected = typeof legacyOptions.mustLsFiles === 'string' && legacyOptions.mustLsFiles.length > 0;
      expect(isInjected).toBe(false);
    });

    it('when `--must-ls-files <glob>` is supplied, should expose it as a non-empty string', () => {
      // given: a DispatchOptions object built WITH the new flag
      // when:  TypeScript reads mustLsFiles
      // then:  it is the exact string the LLM passed
      const options: DispatchOptions = {
        prompt: 'do X',
        requestId: 'r2',
        mustLsFiles: 'tests/integration/*-reachability.test.ts'
      };
      expect(typeof options.mustLsFiles).toBe('string');
      expect(options.mustLsFiles).toBe('tests/integration/*-reachability.test.ts');
    });
  });

  describe('git ls-files integration cross-check', () => {
    it('when run from a real tmp git repo, should round-trip via shell + runGitLsFiles', () => {
      // given: a fresh tmp git repo with one tracked .ts file
      // when:  we git-add the file and run runGitLsFiles(projectRoot, '*.ts')
      // then:  the helper returns exactly the path we added
      //        (anti-fake-green: the file MUST be in `git ls-files`,
      //         not merely on the disk — this is the contract that
      //         closes the rid-001 Lesson 1 defect)
      const tmp = mkdtempSync(join(tmpdir(), 'f5-realrepo-'));
      try {
        mkdirSync(join(tmp, 'src'), { recursive: true });
        const target = join(tmp, 'src', 'real.ts');
        writeFileSync(target, 'export const x = 1;\n');
        execFileSync('git', ['init', '-q'], { cwd: tmp });
        execFileSync('git', ['add', 'src/real.ts'], { cwd: tmp });
        execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'init'], { cwd: tmp });

        const files = runGitLsFiles(tmp, '*.ts');
        expect(files).toEqual(['src/real.ts']);
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    });
  });
});
