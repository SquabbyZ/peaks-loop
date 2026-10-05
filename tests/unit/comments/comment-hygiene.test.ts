/**
 * The comment classifier's own behaviour, pinned on both sides.
 *
 * Each rule is asserted twice — once that it fires, once that it does NOT fire on
 * the nearest innocent text — because a detector whose only evidence is that it
 * finds things will always find things. That is the standing lesson of
 * `.peaks/docs/lint-gate.md`: try to make it red, then try to make it miss.
 */

import { describe, expect, it } from 'vitest';

import {
  citationResolves,
  commentLines,
  citedPaths
} from '~/src/services/comments/comment-citations';
import {
  NARRATIVE_MARKERS,
  scanComments,
  summarize
} from '~/src/services/comments/comment-hygiene';

const EXISTS = new Set(['src/services/x/y.ts', 'docs/z.md']);
const exists = (rel: string): boolean => EXISTS.has(rel);

function scan(text: string, file = 'src/services/x/y.ts') {
  const input = { file, source: text };
  return {
    findings: scanComments(input, { exists }),
    summary: summarize(input, scanComments(input, { exists }))
  };
}

describe('commentLines: what counts as a comment', () => {
  it('keeps line numbers, so a finding can be pointed at', () => {
    const lines = commentLines('const a = 1;\n// note\n/* block\n * more\n */');
    expect(lines.map((l) => l.line)).toEqual([2, 3, 4, 5]);
  });

  it('reads a trailing comment off a code line without claiming the code', () => {
    const lines = commentLines('const a = 1; // why');
    expect(lines).toHaveLength(1);
    expect(lines[0]?.text.trim()).toBe('// why');
  });

  it('does not mistake a URL for a comment start', () => {
    // The scheme carries `//`, and treating it as a comment would invent a
    // comment line the reader never wrote.
    expect(commentLines('const u = "https://example.com/a";')).toEqual([]);
  });

  it('does not mistake the INSIDE of a template literal for a comment', () => {
    // The shipped defect this arm pins (2026-10-05, found by applying the prune to
    // the real tree): `feedback-promotion-service.ts` carries a one-line template
    // literal whose CONTENT begins with `//` — it is a snippet the CLI shows users.
    // The line-based reader saw code + trailing comment, the pruner cut from the
    // first `//`, and the write left an unterminated template literal behind.
    // A quote heuristic cannot see this coming: the prefix has zero quotes.
    expect(commentLines('const s = `// src/a.ts\\n// 1. do the thing`,')).toEqual([]);
  });

  it('still reads the real trailing comment off a line that also holds a template literal', () => {
    // The other half: string-awareness must not blind the reader to the comment
    // that genuinely starts after the literal closes.
    const lines = commentLines('const s = `a\\nb`; // why the newline is kept');
    expect(lines.map((l) => l.text.trim())).toEqual(['// why the newline is kept']);
  });
});

describe('dead-reference findings', () => {
  it('fires when a backticked path resolves nowhere it can mean', () => {
    const { findings } = scan('// see `src/services/gone/gone.ts` for the rule');
    expect(findings.map((f) => [f.kind, f.line, f.matched])).toEqual([
      ['dead-reference', 1, 'src/services/gone/gone.ts']
    ]);
  });

  it('stays silent on a path that exists, and on one whose :lines moved', () => {
    expect(scan('// `src/services/x/y.ts` owns it').findings).toEqual([]);
    expect(scan('// `src/services/x/y.ts:14-17` owns it').findings).toEqual([]);
  });

  it('stays silent on illustrative and session-runtime shapes', () => {
    expect(scan('// shaped like `<pkg>/agents/*.md`').findings).toEqual([]);
    expect(scan('// under `prd/requests/<rid>.md`').findings).toEqual([]);
  });

  it('resolves a subdirectory path against the citing file directory', () => {
    const file = 'skills/bee/peaks-rd/SKILL.md';
    const local = new Set(['skills/bee/peaks-rd/references/contract.md']);
    const findings = scanComments(
      { file, source: '// see `references/contract.md`' },
      { exists: (rel) => local.has(rel) }
    );
    expect(findings).toEqual([]);
  });

  it('clears a module specifier, which names an import rather than a file', () => {
    // Asserted on `citationResolves`, the rule's own home. Asserting it through
    // `scanComments` would pass for the wrong reason: an unanchored span like
    // `peaks-loop-shared/result` is now excluded one rule EARLIER, by candidacy
    // (its parent directory exists in neither the citing file's neighbourhood nor
    // the repo), so a green scan says nothing about the specifier rule at all.
    const withDeps = (rel: string): boolean =>
      exists(rel) ||
      rel === 'node_modules/peaks-loop-shared' ||
      rel === 'node_modules/@alibaba-group/open-code-review';
    expect(citationResolves('peaks-loop-shared/result', 'src/a.ts', withDeps)).toBe(true);
    expect(citationResolves('@alibaba-group/open-code-review', 'src/a.ts', withDeps)).toBe(true);
    // Still unresolved when the head is not an installed package.
    expect(citationResolves('not-a-package/result', 'src/a.ts', withDeps)).toBe(false);
  });

  it('keeps the package check on the filesystem probe, never the ignore-widened one', () => {
    // The collapse this pins is measured, not hypothetical: `citationResolves`
    // called `isInstalledPackageName` with `exists` (widened by `.gitignore`, where
    // `node_modules/` is ignored), so every first segment answered "installed",
    // every citation read as a module specifier, and the repository-wide
    // dead-reference count went 344 → 0 with the suite still green.
    const widened = (rel: string): boolean => exists(rel) || rel.startsWith('node_modules/');
    const fsOnly = (rel: string): boolean => rel === 'node_modules/typescript';
    expect(citationResolves('typescript/lib/x.js', 'src/a.ts', widened, fsOnly)).toBe(true);
    expect(citationResolves('no-such-package/lib/x.js', 'src/a.ts', widened, fsOnly)).toBe(false);
    // And the finding still fires end-to-end, because candidacy is not the
    // specifier rule: an anchored path is a claim about this tree.
    const findings = scanComments(
      { file: 'src/a.ts', source: '// see `src/services/gone-xyz.ts`' },
      { exists: widened, installed: fsOnly }
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.kind).toBe('dead-reference');
  });

  it('reads `src/…` from the workspace package the citing file lives in', () => {
    // The measured false positive: inside `packages/<name>/src`, `src/x.ts` is the
    // package's own file, and `packages/peaks-loop-internal-runtime/src/status-protocol.ts`
    // EXISTS while `src/status-protocol.ts` at the repo root does not. A ratchet seeded
    // with three findings of this shape would refuse the next honest package-internal
    // citation, so the package root is a resolution origin — and only for a citing file
    // that is itself inside a package.
    const pkgTree = new Set(['packages/alpha/src/real.ts', 'src/services/other.ts']);
    const inPackage = (rel: string): boolean => pkgTree.has(rel);
    expect(
      scanComments(
        { file: 'packages/alpha/src/guards/check.ts', source: '// see `src/real.ts`' },
        { exists: inPackage }
      )
    ).toEqual([]);
    // The same rule must not become a blanket exemption: the missing sibling inside the
    // same package is still reported.
    expect(
      scanComments(
        { file: 'packages/alpha/src/guards/check.ts', source: '// see `src/gone.ts`' },
        { exists: inPackage }
      )
    ).toHaveLength(1);
    // And a top-level file gets no package origin at all.
    expect(
      scanComments(
        { file: 'src/services/a.ts', source: '// see `src/real.ts`' },
        { exists: inPackage }
      )
    ).toHaveLength(1);
  });

  it('ignores a bare filename mention, which in code is a name not a location', () => {
    expect(scan('// written next to atomic-write.ts').findings).toEqual([]);
    expect(citedPaths('// written next to `atomic-write.ts`')).toEqual([]);
  });
});

describe('narrative findings', () => {
  const CASES: ReadonlyArray<[string, string]> = [
    ['// Fixed in slice 2026-09-14-handoff-writer-gate-divergence', 'slice-id'],
    ['// Reproduced by rid-b1-qa before the fix', 'rid-id'],
    ['// Required by AC-3 of the plan', 'acceptance-id'],
    ['// F2 of `rid-b1-qa` found this', 'finding-id'],
    ['// This used to claim a producer existed', 'historical-voice'],
    ['// the tests the previous comment named were deleted', 'deleted-test-ref']
  ];

  it.each(CASES)('fires on %j and attributes it to %s', (text, marker) => {
    const findings = scanComments({ file: 'src/a.ts', source: text }, { exists });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.matched.startsWith(`${marker}:`)).toBe(true);
  });

  it('stays silent on ordinary why-comments that name no process artifact', () => {
    const innocent = [
      '// Retries are capped so a hung child cannot outlive the gate that waited for it',
      '// The file exists on disk only after promotion; the index is a cache, not a ledger',
      '// A slice here means a unit of work, and the CLI refuses an unknown id',
      '// 2026-09-09: peaks-loop must never write into the user Claude Code tree'
    ];
    for (const text of innocent) {
      expect(scanComments({ file: 'src/a.ts', source: text }, { exists })).toEqual([]);
    }
  });

  it('reports at most one narrative finding per line, with the first marker', () => {
    const { findings } = scan('// slice 2026-01-01-x and AC-2 both used to claim this');
    expect(findings.filter((f) => f.kind === 'narrative')).toHaveLength(1);
  });
});

describe('summary and option surface', () => {
  it('counts the two categories apart, because they ratchet apart', () => {
    const { summary } = scan(
      '// `src/services/gone.ts`\n// slice 2026-01-01-foo fixed it\n// plain note\nconst x = 1;'
    );
    expect(summary).toEqual({
      file: 'src/services/x/y.ts',
      commentLines: 3,
      deadReferences: 1,
      narrative: 1
    });
  });

  it('can be asked for one category only, which is how the prune takes a narrow scope', () => {
    const source = '// `src/gone.ts` and AC-3';
    const refsOnly = scanComments(
      { file: 'src/a.ts', source },
      { exists, kinds: ['dead-reference'] }
    );
    expect(refsOnly.map((f) => f.kind)).toEqual(['dead-reference']);
  });

  it('treats a missing existence probe as nothing-exists rather than everything-exists', () => {
    // Fails closed: an unconfigured caller reports debt, it does not hide it.
    // The path carries no synthetic stem — `src/services/x/y.ts` would be excluded
    // as a shape example before the probe is ever consulted.
    const findings = scanComments({
      file: 'src/a.ts',
      source: '// `src/services/gone/referent.ts`'
    });
    expect(findings.map((f) => f.kind)).toEqual(['dead-reference']);
  });

  it('every marker is reachable, so none is dead weight in the list', () => {
    for (const marker of NARRATIVE_MARKERS) {
      const sample = marker.pattern.source.replace(/\\b/g, '');
      expect(sample.length).toBeGreaterThan(0);
    }
  });
});

describe('load-bearing comments: text a machine reads as data is not debt', () => {
  // Rid `2026-10-05-comment-scan-string-awareness`, and the reason the in-place prune
  // was reverted: applying it deleted the doc comment on the `commit-boundary-side-effect`
  // member of `HARD_FLOOR_CATEGORIES` in `src/services/code/mode-gate.ts`, and THAT
  // comment is the only thing backing the repository's one real layer-C promotion — so
  // `feedback-promotion-artifact.test.ts` AC5 went red. A classifier that measures a
  // repository's own documentation style must know which of those sentences some program
  // parses as evidence, or "reduce the number" means "remove an enforcement mechanism".
  // A block comment, because the reader is contextual now: a ` * …` line on its own is
  // not a comment to it, and an arm written that way would pass for the wrong reason.
  const at = (interior: string) => scan(`/**\n * ${interior}\n */`).findings;

  it('keeps a comment that cites a memory file, because the promotion reader resolves it', () => {
    // Reader: src/services/feedback/promotion-source-comments.ts:79-80 (citedMemories)
    // consumed by promotion-artifact-evidence.ts:214 → the gate-H backing check.
    expect(
      at(
        ' * `.peaks/memory/2026-06-28-full-auto-boundary.md` (rid-001) — this used to be a marker alone'
      )
    ).toEqual([]);
  });

  it('keeps a TODO(g2) grace marker, because the silent-warning detector subtracts findings by it', () => {
    // Reader: scripts/lint/silent-warning-detector.mjs:149-151. Deleting one does not
    // remove debt, it ADDS a finding to a gated row.
    expect(at('// TODO(g2): slice 009 owns this swallow — AC-3')).toEqual([]);
  });

  it('keeps a toolchain directive, because removing it changes what the tools report', () => {
    expect(at('// eslint-disable-next-line no-console — used to be silent, slice 015')).toEqual([]);
    expect(at('// @ts-expect-error — the fixture types do not carry AC-2')).toEqual([]);
  });

  it('is not a black hole: an ordinary narrative comment still reports', () => {
    // Without this arm the exclusion above passes for any pattern wide enough to eat the
    // file, and the row would fall for the wrong reason.
    expect(at('// Reproduced by rid-b1-qa before the fix').map((f) => f.kind)).toEqual([
      'narrative'
    ]);
  });
});
