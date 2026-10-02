// tests/unit/lint/monotonic-split.test.ts
//
// The acceptance arms for rid `2026-10-02-wave9-monotonic-split`: the split of
// `.husky/peaks-gate-baseline-monotonic.mjs` into a stable entry plus
// `.husky/monotonic/*.mjs`.
//
// WHY A FILE OF ITS OWN. The four `baseline-monotonicity*.test.ts` files sit at
// 472/477/496/497 raw against the 500-line tests cap — the exact headroom trap this
// slice's brief names (slice 1 nearly raised `fileSizeOverCap` by adding arms to
// capped files). New arms live here, per the campaign convention
// `gate-module-staging.test.ts` established; the staging lists in those files were
// changed to walks and nothing else in them moved.
//
// WHAT IS GUARDED.
//   - M3: `CEILING_KEYS` is ONE list. `ceilingKeyListFileUnder` answers "which module
//     holds it" from the tree and THROWS on zero or two; the PLANT arm writes a second
//     copy and proves that refusal can actually fire — a guard that cannot fail is the
//     second-copy defect's accomplice, and this campaign files that defect most often.
//   - staging: the walked set picks up a new sibling with no list edited anywhere,
//     which is the property the fixtures' `GENERATOR_FILES` lists now rest on (the
//     fixed lists died `ERR_MODULE_NOT_FOUND` inside their temp repos in wave 7,
//     slice 1, and — for exactly this file — again on this slice's first run).
//   - M2 as a standing arm: the entry still resolves the thirteen public symbols.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { REPO_ROOT } from '../standards/_file-size-cap-scan.js';
import {
  CEILING_LIST_TAIL_ANCHOR,
  MONOTONIC_DIR_PREFIX,
  MONOTONIC_ENTRY_REL,
  ceilingKeyListFileUnder,
  monotonicModulePathsUnder,
  monotonicModuleTextUnder
} from './_monotonic-module-set.js';

declareDimensions(
  'tests/unit/lint/monotonic-split.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason:
        'the refusal and note texts are asserted verbatim by `baseline-monotonicity.test.ts` and the generator siblings; this file guards the MODULE SET, not its prose'
    },
    {
      dim: 'a11y',
      reason:
        'no operator-facing message originates here; the sentences the split must keep byte-identical are exercised through the generator fixture runs'
    }
  ]
);

/** The public surface of HEAD's single module, sorted — the M2 contract list. */
const PUBLIC_SYMBOLS = [
  'CEILING_KEYS',
  'SEED_FLAG',
  'canonicalKeyProblems',
  'ceilingProblem',
  'compareCeilings',
  'describeCanonicalKeyFailure',
  'describeMonotonicityFailure',
  'describeMonotonicityNotes',
  'missingCanonicalKeys',
  'parsePreviousArtifact',
  'settleDeferredAdded',
  'unseedableKeys',
  'workingCopyTrip'
];

const writeIn = (root: string, rel: string, text: string): void => {
  const abs = join(root, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, text, 'utf8');
};

describe('Scenario: behavior — CEILING_KEYS is one list in one module (M3)', () => {
  it('finds exactly one module of the walked set carrying the canonical list, off the entry', () => {
    const holder = ceilingKeyListFileUnder(REPO_ROOT);
    expect(holder.startsWith(MONOTONIC_DIR_PREFIX), `list holder: ${holder}`).toBe(true);
    // The declaration itself is a second copy candidate; there is exactly one.
    const pool = monotonicModuleTextUnder(REPO_ROOT);
    const declarations = pool.match(/export const CEILING_KEYS = Object\.freeze\(/g) ?? [];
    expect(declarations, 'CEILING_KEYS declared once').toHaveLength(1);
    // And the one list still carries the rows the hooks slice seeded, in the order
    // the seeding fixture's last-row patch anchor depends on.
    expect(pool.indexOf("'fileSizeHooksOverCap'") < pool.indexOf("'fileSizeExcessLines'")).toBe(
      true
    );
  });

  it('PLANT: refuses a second copy of the list in a sibling, and a set with none', () => {
    const root = mkdtempSync(join(tmpdir(), 'peaks-mono-m3-'));
    try {
      const list =
        "export const CEILING_KEYS = Object.freeze([\n  'eslintFindings',\n" +
        "  'fileSizeExcessLines'\n]);\n";
      writeIn(root, MONOTONIC_ENTRY_REL, "export { CEILING_KEYS } from './monotonic/keys.mjs';\n");
      writeIn(root, `${MONOTONIC_DIR_PREFIX}keys.mjs`, list);
      expect(ceilingKeyListFileUnder(root)).toBe(`${MONOTONIC_DIR_PREFIX}keys.mjs`);
      // A sibling RESTATING the list is the second-copy defect; the reader must fail
      // rather than pick one, so this is the arm that proves the guard has teeth.
      writeIn(root, `${MONOTONIC_DIR_PREFIX}restated.mjs`, list);
      expect(() => ceilingKeyListFileUnder(root)).toThrow(/found 2/);
      // Zero holders is the staleness half: the entry alone is not a list.
      rmSync(join(root, `${MONOTONIC_DIR_PREFIX}keys.mjs`));
      rmSync(join(root, `${MONOTONIC_DIR_PREFIX}restated.mjs`));
      expect(() => ceilingKeyListFileUnder(root)).toThrow(/found 0/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('Scenario: behavior — the staged set is a walk, so it cannot go stale', () => {
  it('grows when a module appears under .husky/monotonic/ with no list edited', () => {
    const root = mkdtempSync(join(tmpdir(), 'peaks-mono-stage-'));
    try {
      writeIn(root, MONOTONIC_ENTRY_REL, 'export const entry = 1;\n');
      writeIn(root, `${MONOTONIC_DIR_PREFIX}keys.mjs`, 'export const keys = 1;\n');
      expect(monotonicModulePathsUnder(root)).toEqual([
        MONOTONIC_ENTRY_REL,
        `${MONOTONIC_DIR_PREFIX}keys.mjs`
      ]);
      // The anti-list arm: a new sibling joins every reader — the fixture staging
      // loops, the pooled pins, and this file — without a single name edited.
      writeIn(root, `${MONOTONIC_DIR_PREFIX}later.mjs`, 'export const later = 1;\n');
      expect(monotonicModulePathsUnder(root)).toHaveLength(3);
      expect(monotonicModulePathsUnder(root)).toContain(`${MONOTONIC_DIR_PREFIX}later.mjs`);
      // And the census's rule, not "everything in the directory": a non-module left
      // under `.husky/` stays out of the set.
      writeIn(root, '.husky/notes.txt', 'not a module\n');
      expect(monotonicModulePathsUnder(root)).toHaveLength(3);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reads the real tree: the entry plus every walked sibling, entry first', () => {
    const paths = monotonicModulePathsUnder(REPO_ROOT);
    expect(paths[0]).toBe(MONOTONIC_ENTRY_REL);
    expect(paths.length, 'the split made this a module set').toBeGreaterThan(2);
    for (const rel of paths) {
      expect(readFileSync(join(REPO_ROOT, rel), 'utf8').length, rel).toBeGreaterThan(0);
    }
    expect(CEILING_LIST_TAIL_ANCHOR.test(monotonicModuleTextUnder(REPO_ROOT))).toBe(true);
  });
});

describe('Scenario: integration — the entry still resolves the public surface', () => {
  it('exports exactly the thirteen symbols HEAD exported, and they are live', async () => {
    const surface = (await import(
      pathToFileURL(join(REPO_ROOT, MONOTONIC_ENTRY_REL)).href
    )) as Record<string, unknown>;
    expect(Object.keys(surface).sort()).toEqual(PUBLIC_SYMBOLS);
    expect(Array.isArray(surface.CEILING_KEYS)).toBe(true);
    expect(surface.SEED_FLAG).toBe('--seed');
    for (const name of PUBLIC_SYMBOLS.filter((n) => n !== 'CEILING_KEYS' && n !== 'SEED_FLAG')) {
      expect(typeof surface[name], `${name} resolves as a function`).toBe('function');
    }
    // A live call through the module set, not a read of it: the refusal text the
    // generator prints is produced across `failures.mjs` + `internal.mjs`.
    const describeFailure = surface.describeMonotonicityFailure as (decision: unknown) => string;
    const failure = describeFailure({
      ok: false,
      raised: [{ key: 'eslintFindings', previous: 1, next: 2 }],
      lowered: [],
      added: [],
      removed: [],
      invalid: []
    });
    expect(failure).toContain('RAISED — 1 ceiling(s)');
    expect(failure).toContain('eslintFindings: 1 → 2');
  });
});
