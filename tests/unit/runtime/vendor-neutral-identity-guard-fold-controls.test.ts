// tests/unit/runtime/vendor-neutral-identity-guard-fold-controls.test.ts
//
// The FOLD and REGEX half of `vendor-neutral-identity-guard.test.ts`, moved
// VERBATIM into this sibling for the C wave 7 file-size split (rid
// 2026-10-01-c-wave7-excess-w7-4). Same fixtures, same assertion literals, same
// expected `line:form:id` strings — only the file they run from changed.
//
// These eight cases are the ones that exist because of QA rounds that falsified
// the revision before them, which is why they are kept together and kept exact:
// a synthesized id (`'claude' + '-code'`, a backtick literal), a type wrapper
// (`('claude-code' as const)`), a wrapped value reported ONCE at its wrapper, an
// assertion into a LITERAL TYPE that must stay a type position, and the four
// regex cases that pin `regexAlternativeIds` and the boundary of limit 14. Every
// one of them runs on a fixture the case assembles, so none of them depends on
// the scanned tree; the fold they exercise is
// `vendor-neutral-identity-guard-fold.ts`, which derives the guarded id set from
// the `IdeId`/`IdeKind` unions rather than restating it.

import { describe, it, expect } from 'vitest';
import { parseSourceFile } from './vendor-neutral-identity-guard-reach.js';
import {
  findIdentityComparisons,
  findIdeValueLiterals,
  findSettingsPathLiterals,
  isRegistryConsumer
} from './vendor-neutral-identity-guard-shapes.js';

describe('vendor neutrality — IDE identity decisions outside the adapter layer (slice 2026-09-12)', () => {
  it('negative control — a SYNTHESIZED id is still an id (concatenation and backtick literals)', () => {
    // Round-3 injection: QA falsified the previous revision with
    // `ide === 'claude' + '-code'` and `` case `claude-code`: `` — both passed.
    // The cause was that the id test was `ts.isStringLiteral(node)`, so any
    // literal that is not a plain `'…'` token — a `+` chain, a no-substitution
    // template — was not even a candidate. The id a node DENOTES is what
    // matters, so both are folded to their static string value first.
    const fixture = [
      `import { getAdapter } from '../ide/ide-registry.js';`,
      `const a = ide === 'claude' + '-code';`,
      `const b = target === \`claude-code\`;`,
      `switch (ide) {`,
      `  case \`claude-code\` + '':`,
      `    break;`,
      `}`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findIdentityComparisons(parsed).map((h) => `${h.line}:${h.form}:${h.id}`)).toEqual([
      '2:comparison:claude-code',
      '3:comparison:claude-code',
      '5:switch-case:claude-code'
    ]);
  });

  it('negative control — a SYNTHESIZED id in a value position is caught too', () => {
    // Same fold, applied to shape 2. Recorded once per site: a `+` chain must
    // not also report its own sub-literals (`'claude' + '-code'` has two
    // string children, one hit).
    const fixture = [`const c1 = { ide: 'claude' + '-code' };`, `const c2 = \`claude-code\`;`].join(
      '\n'
    );
    expect(
      findIdeValueLiterals(parseSourceFile('fixture.ts', fixture)).map(
        (h) => `${h.line}:${h.position}:${h.id}`
      )
    ).toEqual(['1:ide::claude-code', '2:c2 =:claude-code']);
  });

  it('negative control — a REGEX test is an identity decision (the round-4 injection)', () => {
    // The three injections QA ran against `auto-compact-reader.ts` — a
    // MUST_BE_COVERED consumer — and got 20/20 green on that revision. Note
    // the shape: `.test(ide)` and `ide.match(re)` are CALLS. There is no
    // BinaryExpression and no `case` clause in any of them, so folding the
    // regex into a string value could not have reached them even if the fold
    // had existed; the branch that reaches them is what makes this shape
    // closed (see `regexAlternativeIds`).
    const fixture = [
      `const a = /^claude-code$/.test(ide);`,
      `const b = ide.match(/claude-code/);`,
      `const c = /^(claude-code|trae)$/.test(ide);`
    ].join('\n');
    expect(
      findIdentityComparisons(parseSourceFile('fixture.ts', fixture)).map(
        (h) => `${h.line}:${h.form}:${h.id}`
      )
    ).toEqual([
      '1:regex-literal:claude-code',
      '2:regex-literal:claude-code',
      '3:regex-literal:claude-code',
      '3:regex-literal:trae'
    ]);
  });

  it('negative control — regex normalisation: groups, anchors, escapes and parens do not hide an id', () => {
    const fixture = [
      `const a = /^(?:claude-code)$/i.test(ide);`,
      `const b = /claude\\-code/.test(ide);`,
      `const c = (/claude-code/).test(ide);`,
      `const d = /^(claude-code|codex|cursor)$/.test(ide);`,
      `const e = /trae$/.test(ide);`,
      `const f = /^codex/.test(ide);`
    ].join('\n');
    expect(
      findIdentityComparisons(parseSourceFile('fixture.ts', fixture)).map(
        (h) => `${h.line}:${h.id}`
      )
    ).toEqual([
      '1:claude-code',
      '2:claude-code',
      '3:claude-code',
      '4:claude-code',
      '4:codex',
      '4:cursor',
      '5:trae',
      '6:codex'
    ]);
  });

  it('negative control — a regex that only CONTAINS an id, or obfuscates it, is not a hit', () => {
    // The false-positive boundary of the alternative rule (header, limit 14):
    // the alternative must EQUAL the id. Every one of these is a plausible
    // non-identity pattern, and every one would be reported by a substring
    // rule. `v1` is the important one — `/claude-code-settings/` is the shape a
    // path/filename check takes, and reporting it would make the guard noise.
    const fixture = [
      `const v1 = /claude-code-settings/.test(x);`,
      `const v2 = /^claude-code-/.test(x);`,
      `const v3 = /claude-cod[e]/.test(x);`,
      `const v4 = /claude\\s+--compact/.test(x);`,
      `const v5 = /\\/\\.claude\\//.test(x);`,
      `const v6 = /x(claude-code)/.test(x);`,
      `const v7 = /claude-code\\b/.test(x);`,
      `const v8 = /claude_code/.test(x);`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findIdentityComparisons(parsed)).toEqual([]);
    // ...and the same decision keeps regexes out of the PATH shape: a regex
    // does not denote a string, so it must not read as a hardcoded settings
    // path (`v5` matches `.claude` exactly and is deliberately invisible here).
    expect(findSettingsPathLiterals(parsed)).toEqual([]);
  });

  it('negative control — a TYPE WRAPPER does not hide a comparison, even outside a consumer', () => {
    // Defect 2 of the 2026-09-13 QA round: the escape needed TWO conditions
    // together — a wrapped literal AND a file that is not a registry consumer
    // (where shape 2 does not run). The same file with a plain `!==` failed,
    // and an `as` coercion inside a CONSUMER failed via shape 2. So limit 6's
    // "Shape 1 still covers that file's comparisons" was false as written;
    // shape 1 now unfolds the assertion, and this case pins the non-consumer
    // half explicitly.
    const fixture = [
      `const a = ide === ('claude-code' as const);`,
      `const b = ide !== ('claude-code' as string);`,
      `const c = ide === <string>'trae';`,
      `const d = ('claude-code' as const) === ide;`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(isRegistryConsumer(parsed)).toBe(false);
    expect(findIdentityComparisons(parsed).map((h) => `${h.line}:${h.id}`)).toEqual([
      '1:claude-code',
      '2:claude-code',
      '3:trae',
      '4:claude-code'
    ]);
  });

  it('negative control — a wrapped literal is reported ONCE, at the wrapper (no regression, no double count)', () => {
    // `isFoldedIntoParent` hands the site to the outermost folding node. That
    // is what keeps a consumer's wrapped VALUE caught (it was caught before
    // this revision, by the inner literal) while keeping the count-pinned
    // assertions exact — skipping the inner literal WITHOUT the hand-off would
    // have silently dropped the site instead of de-duplicating it.
    const fixture = [
      `import { getAdapter } from '../ide/ide-registry.js';`,
      `const c1 = { ide: 'claude-code' as const };`,
      `const c2 = ('trae' as string);`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(isRegistryConsumer(parsed)).toBe(true);
    expect(findIdeValueLiterals(parsed).map((h) => `${h.line}:${h.position}:${h.id}`)).toEqual([
      '2:ide::claude-code',
      '3:c2 =:trae'
    ]);
  });

  it('negative control — an assertion into a LITERAL TYPE is still a type position, not a value', () => {
    // `x as 'claude-code'` narrows a type; it does not assert the id. The
    // assertion's own expression folds to `x` (not a literal) and the type
    // literal is excluded by `isTypePosition`, so neither shape reports it.
    const fixture = [
      `import { getAdapter } from '../ide/ide-registry.js';`,
      `const a = detected as 'claude-code';`,
      `const b: 'claude-code' = detected;`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findIdeValueLiterals(parsed)).toEqual([]);
    expect(findIdentityComparisons(parsed)).toEqual([]);
  });
});
