/**
 * One shape rule, two homes — pinned by behaviour, not by spelling.
 *
 * `src/services/comments/comment-citations.ts` re-declares the citation shapes
 * the standards guard in `tests/unit/standards/repo-citation-integrity.test.ts`
 * already owns. That duplication is exactly the defect this repository keeps
 * documenting (a shape rule restated in a second place, then drifting), and it
 * exists because importing a `.test.ts` module into another test would register
 * its 1,400 lines of suites a second time in every run.
 *
 * So the two are compared SEMANTICALLY: the guard's literal is read out of its
 * source, compiled, and run against the same probes as the shipped rule. Text
 * equality would pass on a reformatted file and fail on an equivalent one; equal
 * answers on every probe is the thing that actually has to hold.
 *
 * KNOWN LIMIT OF THIS PIN, stated rather than hidden: it compares the regex and
 * Set LITERALS and the two anchor lists, not the guard's `isCandidate` function
 * body. One difference is deliberate and is recorded here: the guard resolves an
 * unanchored span against EVERY ancestor directory of the citing document, while
 * the classifier accepts only the citing file's OWN directory. Measured on this
 * repository's source comments, the every-ancestor walk adopted `hooks/hooks.json`
 * through `src/services/hooks/` four levels up and `memory/index.json` through
 * `src/services/memory/` — 16 findings of paths inside installed packages and
 * under `.peaks/_runtime/<sessionId>/`, reported as missing repository files. A
 * sibling-only reading still reports a deleted sibling, which is the case that
 * matters in a source tree.
 */

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ELLIPSIS_SEGMENT,
  HYPOTHETICAL_CUE,
  ILLUSTRATION_CUE,
  OPTIONAL_RUNTIME_PATHS,
  PATH_SHAPED,
  REPO_ANCHORS,
  RUNTIME_STATE_PREFIXES,
  RUNTIME_STATE_ROOT_FILE,
  SESSION_WORKSPACE_DIRS,
  SYNTHETIC_STEMS,
  isCitationCandidate
} from '~/src/services/comments/citation-rules';

const ROOT = resolve(__dirname, '..', '..', '..');
const GUARD = join(ROOT, 'tests/unit/standards/repo-citation-integrity.test.ts');

/**
 * Pull a regex literal out of source, escapes and line wraps included.
 *
 * A `/` inside a character class does not end the literal, so the scan tracks
 * bracket state. Without that, this reader would force every pinned rule to carry
 * a `\/` that exists only to be readable here — and eslint is right to call such
 * an escape useless. A rule this reader cannot find still throws rather than
 * defaulting to a match that is not there.
 */
function compiledRule(source: string, name: string): RegExp {
  const head = new RegExp(`const ${name}\\s*=\\s*/`).exec(source);
  if (head === null || head.index === undefined) {
    throw new Error(`${name} is not declared as a regex literal — the pinned rule moved`);
  }
  let body = '';
  let inClass = false;
  for (let i = head.index + head[0].length; i < source.length; i += 1) {
    const c = source[i] ?? '';
    if (c === '\\') {
      body += c + (source[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) {
      return new RegExp(body, /^[gimsuyd]*/.exec(source.slice(i + 1))?.[0] ?? '');
    }
    body += c;
  }
  throw new Error(`${name}: no closing slash — the pinned rule moved`);
}

function setMembers(source: string, name: string): string[] {
  const block = new RegExp(`const ${name} = new Set\\(\\[([\\s\\S]*?)\\]\\)`).exec(source);
  if (block === null || block[1] === undefined) {
    throw new Error(`${name} is not a Set literal — the pinned rule moved`);
  }
  return [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1] as string).sort();
}

/** Backtick-span candidates a code comment can contain, and their verdicts. */
const SHAPE_PROBES: ReadonlyArray<readonly [string, boolean]> = [
  ['src/services/x/y.ts', true],
  ['docs/z.md', true],
  ['a.ts', false],
  ['atomic-write.ts', false],
  ['src/services/x/y.ts:14', false],
  ['https://example.com/a', false],
  ['.peaks/standards/x.md', true],
  ['packages/peaks-loop-mut/src/index.ts', true]
];

const ANCHOR_PROBES: ReadonlyArray<readonly [string, boolean]> = [
  ['src/a.ts', true],
  ['tests/unit/a.test.ts', true],
  ['scripts/x.mjs', true],
  ['skills/x/SKILL.md', true],
  ['packages/p/src/index.ts', true],
  ['bin/x.js', true],
  ['.peaks/docs/x.md', true],
  ['.claude/x.md', true],
  ['.github/workflows/x.yml', true],
  ['openspec/x.md', true],
  ['docs/x.md', true],
  ['contracts/test-style-contract.md', true],
  ['references/x.md', false]
];

/**
 * The classes that were reporting as "missing file" before the candidate rule was
 * ported from the guard — each one a shape the tree never owes.
 */
const NON_CITATIONS: readonly string[] = [
  'hooks/hooks.json',
  'extraction/index.js',
  'pages/api',
  'a/b',
  'cmd/server',
  'bedrock/.../claude-...',
  '@npmcli/run-script/lib/make-spawn-args.js',
  './feishu-doc-snapshot.md',
  '.peaks/cron/schedule.json',
  '.peaks/_runtime/session.json',
  '.peaks/.session.json',
  'src/services/x/y.ts'
];

describe('Scenario: the comment classifier and the citation guard share one shape rule', () => {
  const guard = readFileSync(GUARD, 'utf8');

  it.each(SHAPE_PROBES)('PATH_SHAPED answers the same for %j', (probe, expected) => {
    const theirs = compiledRule(guard, 'PATH_SHAPED');
    expect(theirs.test(probe)).toBe(PATH_SHAPED.test(probe));
    expect(PATH_SHAPED.test(probe)).toBe(expected);
  });

  it.each(ANCHOR_PROBES)('REPO_ANCHORS answers the same for %j', (probe, expected) => {
    const theirs = compiledRule(guard, 'REPO_ANCHORS');
    expect(theirs.test(probe)).toBe(expected);
    expect(REPO_ANCHORS.test(probe)).toBe(expected);
  });

  it('the session-runtime exemption is the same list, so neither can mask the other', () => {
    expect(setMembers(guard, 'SESSION_WORKSPACE_DIRS')).toEqual([...SESSION_WORKSPACE_DIRS].sort());
  });

  it('the runtime-state and synthetic-stem lists are the same on both sides', () => {
    const theirs = setMembers(guard, 'SYNTHETIC_STEMS');
    expect(theirs).toEqual([...SYNTHETIC_STEMS].sort());
    expect(setMembers(guard, 'OPTIONAL_RUNTIME_PATHS')).toEqual([...OPTIONAL_RUNTIME_PATHS].sort());
    const prefixBlock = /const RUNTIME_STATE_PREFIXES = \[([\s\S]*?)\]/.exec(guard);
    expect([...(prefixBlock?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1])).toEqual([
      ...RUNTIME_STATE_PREFIXES
    ]);
    expect(compiledRule(guard, 'RUNTIME_STATE_ROOT_FILE').source).toBe(
      RUNTIME_STATE_ROOT_FILE.source
    );
  });

  it('the ellipsis, illustration-cue and hypothetical-cue rules are the same regex', () => {
    expect(compiledRule(guard, 'ELLIPSIS_SEGMENT').source).toBe(ELLIPSIS_SEGMENT.source);
    expect(compiledRule(guard, 'ILLUSTRATION_CUE').source).toBe(ILLUSTRATION_CUE.source);
    expect(compiledRule(guard, 'HYPOTHETICAL_CUE').source).toBe(HYPOTHETICAL_CUE.source);
  });
});

describe('Scenario: a sentence that reasons about a path is not an existence claim', () => {
  const ctx = { file: 'src/services/scan/diff-scope-service.ts', dirExists: () => true };
  const cited = (line: string, span: string) => ({
    span,
    from: line.indexOf(span) - 1,
    to: line.indexOf(span) + span.length + 1
  });

  it('clears the second operand of an example, which the cue-before-span rule misses', () => {
    // The measured false positive: `E.g.` sits before the FIRST operand only, so a
    // cue test anchored to the text before the span leaves the second one reported.
    const line = '// E.g. `src/services/login` should match `src/services/login/handler.ts`.';
    expect(isCitationCandidate(cited(line, 'src/services/login'), line, ctx)).toBe(false);
    expect(isCitationCandidate(cited(line, 'src/services/login/handler.ts'), line, ctx)).toBe(
      false
    );
  });

  it('clears a path named as a counterexample', () => {
    const line = ' * they resolved to `.peaks/.claude/settings.local.json` and';
    expect(isCitationCandidate(cited(line, '.peaks/.claude/settings.local.json'), line, ctx)).toBe(
      false
    );
  });

  it('still reports the assertion beside it, which is the whole point', () => {
    // `src/services/workspace/claude-settings-template.ts:90` says the handler
    // "invokes the shipped script `src/services/hooks/write-gate.js`". No modal, no
    // example cue — and that file is gone, so it must stay a finding.
    const line = ' *           `src/services/hooks/write-gate.js` instead, so the command';
    expect(isCitationCandidate(cited(line, 'src/services/hooks/write-gate.js'), line, ctx)).toBe(
      true
    );
  });
});

describe('Scenario: what is not a claim about this tree is never reported', () => {
  const ctx = {
    file: 'src/services/comments/comment-citations.ts',
    dirExists: (rel: string) => rel === 'src/services/comments'
  };
  /** A span as it sits inside a backtick pair in a comment line. */
  const cited = (line: string, span: string) => ({
    span,
    from: line.indexOf(span) - 1,
    to: line.indexOf(span) + span.length + 1
  });

  it.each(NON_CITATIONS)('excludes %j', (span) => {
    const line = `* see \`${span}\` for the shape`;
    expect(isCitationCandidate(cited(line, span), line, ctx)).toBe(false);
  });

  it('keeps an anchored citation, which is the invariant the exclusions must not break', () => {
    const line = '* see `src/services/gone/referent.ts` for the shape';
    expect(isCitationCandidate(cited(line, 'src/services/gone/referent.ts'), line, ctx)).toBe(true);
    const deletedTest = '* covered by `tests/unit/x/deleted-case.test.ts`';
    expect(
      isCitationCandidate(cited(deletedTest, 'tests/unit/x/deleted-case.test.ts'), deletedTest, ctx)
    ).toBe(true);
  });

  it('admits a file-relative span only when its parent directory is real', () => {
    const line = '* see `references/runbook.md` beside it';
    expect(isCitationCandidate(cited(line, 'references/runbook.md'), line, ctx)).toBe(false);
    const near = '* see `comments/comment-hygiene.ts` beside it';
    expect(
      isCitationCandidate(cited(near, 'comments/comment-hygiene.ts'), near, {
        ...ctx,
        dirExists: (rel: string) => rel === 'src/services/comments/comments'
      })
    ).toBe(true);
  });
});
