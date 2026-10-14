// tests/unit/services/scan/file-size-ratchet.test.ts
//
// Guard for rid `rid-size-gate-reads-ratchet` (session
// `2026-10-12-session-74bd69`).
//
// THE DEFECT. `request transition --role rd --state implemented` ran
// `scanFileSize()` and refused ANY changed file over its cap — while
// `.peaks/lint/gate-baseline.json` carries `ceilings.fileSizeOverCap` as an
// accepted ratcheted quantity. So a slice that fixes a bug inside one of those
// files could not reach `implemented` without an unrelated split the PRD's
// non-goals forbid. Reproduced twice, consecutively:
// `rid-esm-require-sweep`, then `rid-s3-artifact-contract-enforcement`
// (`artifact-prerequisites.ts`, 767 lines, over cap at HEAD, 2 description
// lines changed, 0 added, still refused).
//
// THE ARM. The scan is a RATCHET, like the commit gate's "a file you touch may
// not be WORSE than it was" (`.husky/peaks-gate.mjs`): a changed file is a
// violation only when this change makes it worse — it grew past its cap, or was
// created over it. A file already that large at `baseRef` passes, and is NAMED
// in `acceptedOverCapFiles` so "0 violations" cannot read as "nothing was over
// the cap".
//
// Dimensions covered: behavior (the three verdicts), integration (a real repo).

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { FileSizeViolationError } from '../../../../src/services/artifacts/request-artifact-state-helpers.js';
import { GitReadFailedError } from '../../../../src/services/scan/file-size-baseline.js';
import { scanFileSize } from '../../../../src/services/scan/file-size-scan.js';
import { FILE_SIZE_CAP_DEFAULT } from '../../../../src/services/scan/file-size-policy.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../../_setup/subprocess-timeouts.js';

declareDimensions('tests/unit/services/scan/file-size-ratchet.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

const OVER_CAP = FILE_SIZE_CAP_DEFAULT + 50;
const UNDER_CAP = FILE_SIZE_CAP_DEFAULT - 50;

let repo: string;

function git(cwd: string, args: readonly string[]): void {
  execFileSync('git', [...args], { cwd, stdio: 'pipe', windowsHide: true });
}

/** `count` content lines, the last one `marker`, so a same-count rewrite still
 *  shows up in `git diff` as MODIFIED without the file having grown. */
function writeMarked(relativePath: string, count: number, marker: string): void {
  const absolute = join(repo, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  const body = Array.from({ length: count }, (_, i) => (i === count - 1 ? marker : 'x'));
  writeFileSync(absolute, `${body.join('\n')}\n`, 'utf8');
}

function commitAll(message: string): void {
  git(repo, ['add', '-A']);
  git(repo, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', message]);
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'file-size-ratchet-'));
  git(repo, ['init', '-q']);
});

afterEach(() => {
  try {
    rmSync(repo, { recursive: true, force: true });
  } catch {
    // Windows open-handle race on .git; the tmp dir is reapable either way.
  }
});

describe('Scenario: the diff-scoped file-size scan judges a DELTA, not an absolute size', () => {
  it(
    'when a file was already over its cap at HEAD and this change does not enlarge it, should accept it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: src/big.ts is committed over its cap (351 raw lines at HEAD) —
      //        the shape of the recorded reproduction (767-line file, 2 lines
      //        changed, 0 added)
      writeMarked('src/big.ts', OVER_CAP, 'before');
      commitAll('over cap at head');
      // when: a later change edits it without adding a line
      writeMarked('src/big.ts', OVER_CAP, 'after');
      const result = scanFileSize({ projectRoot: repo });
      // then: the ratchet already carries it, so touching it passes — and the
      //       non-refusal is NAMED rather than silently dropped
      expect(result.ok).toBe(true);
      expect(result.violations).toEqual([]);
      expect(result.acceptedOverCapFiles).toEqual(['src/big.ts']);
    }
  );

  it(
    'when an over-cap file is reduced but is still over its cap, should accept it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a module committed over its cap (351 raw lines at HEAD)
      writeMarked('src/trimmed.ts', OVER_CAP, 'before');
      commitAll('over cap at head');
      // when: this change removes 20 lines and the file is STILL over the cap
      writeMarked('src/trimmed.ts', OVER_CAP - 20, 'after');
      const result = scanFileSize({ projectRoot: repo });
      // then: accepted — the rule is "did not grow", not "unchanged". Asserting
      //       only `ok` would also pass under a rule that accepted equal sizes
      //       alone, which would re-block the reduction the delta rule exists to
      //       permit; naming the accepted file fixes which rule answered, since
      //       that channel is filled only by the not-grown branch.
      expect(result.ok).toBe(true);
      expect(result.violations).toEqual([]);
      expect(result.acceptedOverCapFiles).toEqual(['src/trimmed.ts']);
    }
  );

  it(
    'when a file that was under its cap grows past it, should refuse it and name the growth',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a committed module under the cap
      writeMarked('src/growing.ts', UNDER_CAP, 'before');
      commitAll('under cap at head');
      // when: this change pushes it over the cap
      writeMarked('src/growing.ts', OVER_CAP, 'after');
      const result = scanFileSize({ projectRoot: repo });
      // then: it is refused, the row carries both sizes, and the message names
      //       the growth rather than only the cap
      expect(result.violations).toEqual([
        {
          file: 'src/growing.ts',
          lines: OVER_CAP + 1,
          cap: FILE_SIZE_CAP_DEFAULT,
          previousLines: UNDER_CAP + 1
        }
      ]);
      expect(new FileSizeViolationError(result.violations).message).toContain('grew +100 from 251');
    }
  );

  it(
    'when the base ref does not resolve, should refuse the scan instead of passing vacuously',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a repo with a commit, and a base ref git cannot resolve
      writeMarked('src/seed.ts', 5, 'seed');
      commitAll('seed');
      // when: the scan is asked to compare against it
      // then: it REFUSES — an empty file list may only ever mean "nothing
      //       changed", never "git could not answer"
      expect(() => scanFileSize({ projectRoot: repo, baseRef: 'v9.9.9-nope' })).toThrow(
        GitReadFailedError
      );
      // and the control: the same repo with a resolvable ref still enumerates
      expect(scanFileSize({ projectRoot: repo }).checkedFiles).toBe(0);
    }
  );

  it(
    'when an over-cap file is renamed without changing its bytes, should accept it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: an over-cap module committed at HEAD
      writeMarked('src/r1.ts', OVER_CAP, 'moved');
      commitAll('over cap at head');
      // when: it is renamed in the same working tree, unchanged
      git(repo, ['mv', 'src/r1.ts', 'src/r1-renamed.ts']);
      const result = scanFileSize({ projectRoot: repo });
      // then: a move is not growth — it is judged against the pre-rename path
      expect(result.ok).toBe(true);
      expect(result.violations).toEqual([]);
      expect(result.acceptedOverCapFiles).toEqual(['src/r1-renamed.ts']);
    }
  );

  it(
    'when a file is renamed AND grows past its cap, should refuse it naming the growth',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a committed module under the cap, renamed, then enlarged
      writeMarked('src/r2.ts', UNDER_CAP, 'moved');
      commitAll('under cap at head');
      git(repo, ['mv', 'src/r2.ts', 'src/r2-renamed.ts']);
      writeMarked('src/r2-renamed.ts', OVER_CAP, 'grown');
      // when: the scan runs
      const result = scanFileSize({ projectRoot: repo });
      // then: the OLD path's size is the baseline — a rename is not an escape
      expect(result.violations).toEqual([
        {
          file: 'src/r2-renamed.ts',
          lines: OVER_CAP + 1,
          cap: FILE_SIZE_CAP_DEFAULT,
          previousLines: UNDER_CAP + 1
        }
      ]);
    }
  );

  it(
    'when a genuinely new file is created over the cap, should refuse it as a creation',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a repo whose HEAD exists (the scan shells out to `git diff HEAD`),
      //        and a brand-new over-cap module with no version at that HEAD
      writeMarked('src/seed.ts', 5, 'seed');
      commitAll('seed');
      writeMarked('src/created.ts', OVER_CAP, 'only');
      // when: the scan runs
      const result = scanFileSize({ projectRoot: repo });
      // then: created-over-cap is a regression too, and the message says so
      expect(result.violations).toEqual([
        {
          file: 'src/created.ts',
          lines: OVER_CAP + 1,
          cap: FILE_SIZE_CAP_DEFAULT,
          previousLines: null
        }
      ]);
      expect(new FileSizeViolationError(result.violations).message).toContain(
        'created over the cap'
      );
    }
  );
});

describe('Scenario: the refusal names the rule it applied and the gate it can disagree with', () => {
  it(
    'when a change grows a file past its own cap, should say PER-FILE and name the aggregate ratchet row',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a committed module under the cap, grown past it in this change —
      //        the per-file violation, which is the input this gate refuses
      writeMarked('src/grown.ts', UNDER_CAP, 'before');
      commitAll('under cap at head');
      writeMarked('src/grown.ts', OVER_CAP, 'after');

      // when: the scan refuses and the refusal is rendered
      const result = scanFileSize({ projectRoot: repo });
      const message = new FileSizeViolationError(result.violations).message;

      // then: it names the granularity it measured...
      expect(message).toContain('PER-FILE rule');
      // ...and the aggregate gate a reader may have just seen go GREEN, by the
      // row's own label, its key, and the commands that print it — so a green
      // ratchet is not read as the per-file gate being broken.
      expect(message).toContain('file-size excess lines');
      expect(message).toContain('fileSizeExcessLines');
      expect(message).toContain('.husky/peaks-gate.mjs repo');
      expect(message).toContain('.husky/peaks-gate-baseline.mjs');
      // ...and it states the priority rather than leaving it to be inferred:
      // there is none, because the two measure different things.
      expect(message).toContain('neither takes priority');
    }
  );

  it(
    'should render the per-file sentence for a refusal and not for an accepted file in the same tree',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a module ALREADY over its cap at the base ref, edited without
      //        growing — the case `scanFileSize` accepts
      writeMarked('src/accepted.ts', OVER_CAP, 'before');
      commitAll('over cap at head');
      writeMarked('src/accepted.ts', OVER_CAP, 'after');
      const accepted = scanFileSize({ projectRoot: repo });

      // then: the accepted file is NAMED, not silent, and builds no error — so the
      // sentence at the centre of this slice is never rendered for it. This is the
      // input that would expose the sentence as an unconditional constant.
      expect(accepted.ok).toBe(true);
      expect(accepted.violations).toEqual([]);
      expect(accepted.acceptedOverCapFiles).toEqual(['src/accepted.ts']);

      // and the contrast, in the SAME tree: a file that grows past its cap is
      // refused and DOES render the sentence, so the check above is about the
      // refusal rather than about a module that never speaks.
      writeMarked('src/grown-here.ts', UNDER_CAP, 'before');
      commitAll('under cap');
      writeMarked('src/grown-here.ts', OVER_CAP, 'after');
      const refused = scanFileSize({ projectRoot: repo });
      expect(refused.violations.map((v) => v.file)).toEqual(['src/grown-here.ts']);
      expect(new FileSizeViolationError(refused.violations).message).toContain('PER-FILE rule');
    }
  );
});
