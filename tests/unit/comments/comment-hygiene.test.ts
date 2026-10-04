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
