// tests/unit/workspace/top-level-change-id-guard.test.ts
//
// Defense test for the 2.8.3 hard-ban: a date-stamped / change-id-style dir
// must never sit at the top level of `.peaks/` (it belongs under
// `.peaks/_runtime/<sessionId>/`).
//
// PROVENANCE. This file originally landed with slice
// `2026-06-22-top-level-change-id-cleanup`; commit `457b9a87` (v2.16.0-alpha,
// 2026-06-29) deleted it as "AC-1 partial" while removing the change-id axis,
// and the later release notes for 3.0.2 claimed it had been "retargeted to ban
// `<YYYY-MM-DD-*>` sibling dirs" — a retarget that never happened. For ten weeks
// `CLAUDE.md` and `.peaks/PROJECT.md` kept citing this path as a live enforcement
// layer, and `.peaks/standards/loop-engineering-guidelines.md` kept citing a
// deleted test of its own, with nothing in the suite able to notice: a citation
// that outlives its referent reads exactly like a working one.
//
// Restored by slice 2026-09-15-s4-dangling-citations, which also added the
// repo-wide citation guard at
// `tests/unit/standards/repo-citation-integrity.test.ts` — the guard that would
// have caught the three stale citations above.
//
// What is asserted here is the MECHANISM of each defense layer, never its prose:
// the `.gitignore` rule is exercised through `git check-ignore`, the source
// refusal through a real `initWorkspace` call on a real tmp tree.
//
// Dimensions covered:
//   - behavior:    initWorkspace refuses a date-stamped sibling (typed error)
//   - integration: real git binary + real working tree + real tmp project
//   - render:      OMITTED — the effects asserted are fs/git state, not
//                  formatted output
//   - a11y:        OMITTED — no human-facing text surface; the refusal is
//                  asserted as a typed error, not as a rendered message

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';
import {
  initWorkspace,
  LegacyChangeIdSiblingError
} from '../../../src/services/workspace/workspace-service.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/workspace/top-level-change-id-guard.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the asserted effects are fs/git state, not formatted output' },
    {
      dim: 'a11y',
      reason: 'no human-facing text surface; the refusal is asserted as a typed error'
    }
  ]
);

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const GITIGNORE_PATH = join(REPO_ROOT, '.gitignore');
const PEAKS_DIR = join(REPO_ROOT, '.peaks');

/**
 * The defensive rule added in slice 2026-06-22-top-level-change-id-cleanup.
 * If this literal is dropped from the root `.gitignore`, layer 1 is gone.
 */
const DEFENSE_RULE = '.peaks/[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*/';

/**
 * The root `.gitignore` lines that git actually honours, in file order.
 *
 * The first version of this file asserted the rule with a plain
 * `toContain(DEFENSE_RULE)` over the whole file text. S4 measured what that
 * misses: prefixing the rule with `#` leaves the literal in the file, so a
 * `.gitignore` whose rule had been commented out — i.e. a `.gitignore` with
 * NO defense at all — passed the case that exists to detect exactly that. A
 * substring is not a rule.
 *
 * Git's own comment rule is reproduced exactly rather than approximated:
 *   - a line whose FIRST character is `#` is a comment (`#rule` and `# rule`
 *     both are; an indented ` #rule` is not, and is not treated as one here);
 *   - blank / all-whitespace lines are skipped;
 *   - trailing whitespace is ignored (git does the same), LEADING whitespace
 *     is significant (git does the same — a leading space makes the pattern
 *     include the space, so an indented rule is NOT this rule and must not
 *     count as it).
 */
function activeGitignoreRules(): string[] {
  return readFileSync(GITIGNORE_PATH, 'utf8')
    .split('\n')
    .map((line) => line.replace(/\r$/, ''))
    .filter((line) => line.trim().length > 0 && !line.startsWith('#'))
    .map((line) => line.trimEnd());
}

/** `windowsHide: true` is repo convention for every spawn. */
function git(args: readonly string[], cwd: string) {
  return spawnSync('git', [...args], { cwd, encoding: 'utf8', windowsHide: true });
}

/** A markdown body with every `<!-- ... -->` span removed. */
function withoutHtmlComments(markdown: string): string {
  return markdown.replace(/<!--[\s\S]*?-->/g, '');
}

function isDateStamped(name: string): boolean {
  return /^\d{4}-\d{2}-\d{2}-/.test(name);
}

describe('Scenario: integration — the root .gitignore still blocks a date-stamped sibling', () => {
  it('when the root .gitignore is parsed, should still carry the date-prefix rule as an ACTIVE rule', () => {
    // given: the repository working tree
    // when: the root .gitignore is read and parsed the way git parses it
    // then: the defensive rule is present as a rule git will honour — not
    //       merely as a substring. `#.peaks/[...]/` and `# .peaks/[...]/` both
    //       still CONTAIN the literal while defending nothing, and both are
    //       exactly the edit someone disables a rule with.
    expect(existsSync(GITIGNORE_PATH)).toBe(true);
    expect(activeGitignoreRules()).toContain(DEFENSE_RULE);
  });

  it('when the whole-file text alone is considered, should not be the shape this guard rests on', () => {
    // The counter-control for the case above, kept because the defect it
    // records was live for a release: the old assertion was a `toContain`
    // over the raw text, and this case shows that the raw text still passes
    // once the rule is commented out — so a guard built on it cannot fail.
    // If this control ever stops passing, the parser above has drifted from
    // what the file looks like and needs re-reading.
    const raw = readFileSync(GITIGNORE_PATH, 'utf8');
    const commentedOut = raw.replace(DEFENSE_RULE, `#${DEFENSE_RULE}`);
    expect(commentedOut).toContain(DEFENSE_RULE);
    expect(
      commentedOut
        .split('\n')
        .map((line) => line.replace(/\r$/, ''))
        .filter((line) => line.trim().length > 0 && !line.startsWith('#'))
        .map((line) => line.trimEnd())
    ).not.toContain(DEFENSE_RULE);
  });

  it(
    'when git evaluates a synthetic date-stamped sibling path, should ignore it via that rule',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: a path shaped like the 2.8.0-era orphan, which need not exist on disk
      // when: git check-ignore resolves it
      // then: the matching pattern is the defensive rule
      const result = git(
        ['check-ignore', '-v', '.peaks/2026-01-01-fake-sibling/rd/note.md'],
        REPO_ROOT
      );
      expect(result.status).toBe(0);
      expect(result.stdout).toContain(DEFENSE_RULE);
    }
  );

  it(
    'when git evaluates a bare-date sibling path, should leave it alone',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: `.peaks/<YYYY-MM-DD>/` — a plain date, no slug, which is NOT the
      //        auto-generated session shape the ban targets
      // when: git check-ignore resolves it
      // then: nothing ignores it: the rule's scope is `YYYY-MM-DD-*`, and a rule
      //       that also swallowed bare dates would ban paths the ban is not about
      //
      // This case deliberately probes a date-prefixed sibling rather than a
      // session dir under the runtime tree. A probe naming `.peaks/_runtime/…`
      // against the repo root is exactly what `tests/unit/runtime/no-runtime-input-guard.test.ts`
      // exists to reject, and it is red on CI by construction — the runtime tree
      // is gitignored session state, and no test may take it as an input, not even
      // to assert a `.gitignore` pattern about it.
      const result = git(['check-ignore', '-v', '.peaks/2026-01-01/note.md'], REPO_ROOT);
      expect(result.status).toBe(1);
      expect(result.stdout).not.toContain(DEFENSE_RULE);
    }
  );

  it('when the working tree is scanned, should hold no date-stamped sibling dir under .peaks/', () => {
    // given: the live repository tree
    // when: the immediate children of .peaks/ are enumerated
    // then: no date-stamped directory sits there
    const orphans = readdirSync(PEAKS_DIR).filter((name) => {
      if (name.startsWith('.')) return false;
      if (!isDateStamped(name)) return false;
      try {
        return statSync(join(PEAKS_DIR, name)).isDirectory();
      } catch {
        return false;
      }
    });
    expect(orphans).toEqual([]);
  });

  it(
    'when git lists the tracked .peaks entries, should hold no top-level date-stamped path',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the index, which a `--force-add` could have poisoned
      // when: git ls-files enumerates tracked paths under .peaks/
      // then: none of them is a top-level date-stamped entry
      const result = git(['ls-files', '.peaks/'], REPO_ROOT);
      expect(result.status).toBe(0);
      const offenders = result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && !line.startsWith('.peaks/_runtime/'))
        .filter((line) => isDateStamped(line.slice('.peaks/'.length).split('/')[0] ?? ''));
      expect(offenders).toEqual([]);
    }
  );

  it('when the two ban documents are read, should name the rule that blocks the pattern in live prose', () => {
    // given: the two documents layer 4 consists of
    // when: their bodies are read with every HTML comment removed
    // then: each still carries the defensive-rule literal OUTSIDE a comment.
    //       The comment-stripping is the same defect as the `.gitignore`
    //       case above: a citation wrapped in `<!-- -->` is still a
    //       substring, and a reader is still told nothing.
    for (const doc of ['CLAUDE.md', join('.peaks', 'PROJECT.md')]) {
      expect(withoutHtmlComments(readFileSync(join(REPO_ROOT, doc), 'utf8')), doc).toContain(
        DEFENSE_RULE
      );
    }
  });
});

describe('Scenario: behavior — initWorkspace refuses the pattern before writing', () => {
  const ws = withTmpWorkspacePerTest('peaks-top-level-guard-');

  it('when a date-stamped sibling dir holds non-writer content, should throw LegacyChangeIdSiblingError', async () => {
    // given: a project with `.peaks/2026-01-01-legacy-orphan/rd/note.txt`
    const orphan = join(ws().path, '.peaks', '2026-01-01-legacy-orphan', 'rd');
    mkdirSync(orphan, { recursive: true });
    writeFileSync(join(orphan, 'note.txt'), 'hand-authored residue\n', 'utf8');

    // when: the workspace is initialized
    const attempt = initWorkspace({
      projectRoot: ws().path,
      sessionId: '2026-01-02-restored-guard',
      noClaudeHooks: true
    });

    // then: init refuses instead of walking into the legacy layout
    await expect(attempt).rejects.toBeInstanceOf(LegacyChangeIdSiblingError);
  });

  it('when no date-stamped sibling exists, should initialize without refusing', async () => {
    // given: a clean project root
    // when: the workspace is initialized
    const report = await initWorkspace({
      projectRoot: ws().path,
      sessionId: '2026-01-02-clean-init',
      noClaudeHooks: true
    });

    // then: the guard does not fire on the happy path
    expect(report.bound).toBe(true);
  });
});
