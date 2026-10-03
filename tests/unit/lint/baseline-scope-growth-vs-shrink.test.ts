// tests/unit/lint/baseline-scope-growth-vs-shrink.test.ts
//
// Rid `2026-10-03-scope-growth-vs-shrink` §2.50 — the process arms of the owner's
// 2026-10-03 policy, run through the REAL generator in a REAL scratch repository
// (the `mkdtempSync` + own-`git init` posture of `baseline-rescope-guard.test.ts`;
// nothing here touches this repository's artifact or index).
//
// THE POLICY: `--rescope` is required when the rule text, the dirs set or the
// extensions changed, or when a file that was in scope at HEAD left it. Pure growth
// proceeds without the flag and prints `scope grew: N -> M (k entered, 0 left the
// scope)`. The relaxation is ceremony only: the monotonicity guard still refuses any
// raised ceiling regardless of the flag — that is arm G4, and it asserts the RAISED
// message, not only the code, so the exit provably comes from the ratchet and not
// from the scope trip.
//
// WHAT IS STUBBED DIFFERENTLY FROM THE NEIGHBOUR FILES, AND WHY. The shared
// fixture's eslint stub answers `[]` for every batch, which classifies EVERY file
// as not-linted and makes `eslintNotLintedFiles` ride the file count — under that
// stub a growth run cannot exit 0 for the right reason (it would refuse as RAISED).
// This file replaces the stub with an echo: one zero-message record per requested
// path, so lint rows hold still while the population grows and the only thing that
// moved is the population. The census, prettier and the monotonicity comparison stay
// real, like every sibling file.

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { FILE_SIZE_CAP_DEFAULT } from '../../../src/services/scan/file-size-policy.js';
import { createFixture, fileOf, type Fixture } from './_file-size-hooks-fixture.js';
import { artifactSha } from './_silent-warning-scope-fixture.js';

declareDimensions(
  'tests/unit/lint/baseline-scope-growth-vs-shrink.test.ts',
  ['behavior', 'integration', 'render', 'a11y'],
  []
);

/** One in-scope file, clean under the real prettier leg and the echo stub's lint leg. */
const CLEAN_SRC = 'export const planted = 1;\n';

/**
 * The eslint echo stub: a zero-message record for every requested file, so the
 * measurement universe and the ceilings hold still across a population change.
 * The generator's argv is `[--config, cfg, --no-ignore, --format, json, ...files]`;
 * everything after the `json` token is a scope path, echoed verbatim (the leg's
 * `rel()` keeps fixture-relative slash paths as they are).
 */
const ESLINT_ECHO_STUB = [
  "const argv = process.argv.slice(2);",
  "const i = argv.indexOf('json');",
  'const files = i === -1 ? [] : argv.slice(i + 1);',
  'process.stdout.write(',
  '  JSON.stringify(files.map((f) => ({ filePath: f, messages: [] }))) + "\\n"',
  ');',
  ''
].join('\n');

let fx: Fixture | null = null;
function fixture(): Fixture {
  if (fx === null) throw new Error('the fixture was not built before the arms ran');
  return fx;
}

/** The artifact's enforced-scope enumeration, read as the guard reads it: the `files` map. */
function scopedFiles(): string[] {
  const doc = fixture().artifactDocument();
  return Object.keys(doc.files as Record<string, unknown>).sort();
}

/** Rewrite the artifact on disk (one crafted field, everything else kept) and make HEAD say so. */
function commitArtifactCraft(edit: (doc: Record<string, unknown>) => void): void {
  const doc = fixture().artifactDocument();
  edit(doc);
  fixture().writeArtifact(doc);
  fixture().commitAll('fixture: HEAD carries the crafted artifact');
}

function scopeFieldOf(doc: Record<string, unknown>, field: string): string {
  const scope = doc.scope as Record<string, unknown>;
  return String(scope[field]);
}

function craftScopeField(field: string, value: string): void {
  commitArtifactCraft((doc) => {
    const scope = doc.scope as Record<string, unknown>;
    scope[field] = value;
  });
}

type Run = { code: number; out: string };
function run(argv: readonly string[]): Run {
  return fixture().runGenerator(argv);
}

beforeAll(() => {
  const f = createFixture('scope-growth');
  fx = f;
  f.write(join('node_modules', 'eslint', 'bin', 'eslint.js'), ESLINT_ECHO_STUB);
  // A file that later arms move OUT of the enforced scope while the population grows.
  f.write('src/leaver.ts', CLEAN_SRC);
  f.commitAll('fixture: the echo eslint stub and a leaver file join the tree');
  const seeded = run(['--seed']);
  expect(seeded.code, seeded.out).toBe(0);
  f.commitAll('fixture: HEAD carries the seeded baseline');
});

afterAll(() => {
  fx?.cleanup();
});

describe('Scenario: behavior — pure growth proceeds without the flag and prints itself', () => {
  it(
    'G0 control: nothing moved, a plain regeneration exits 0 and says nothing about growth',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const ok = run([]);
      expect(ok.code, ok.out).toBe(0);
      expect(ok.out).not.toContain('scope grew');
      expect(ok.out).not.toContain('SCOPE CHANGE');
      fixture().commitAll('fixture: the unchanged regeneration landed');
    }
  );

  it(
    'G1: two files enter, none leave — exit 0 without the flag, and the growth line prints with both numbers and the entered count',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const before = scopedFiles().length;
      fixture().write('src/grown-a.ts', CLEAN_SRC);
      fixture().write('src/grown-b.ts', CLEAN_SRC);
      fixture().commitAll('fixture: two clean files enter the enforced scope');

      const ok = run([]);
      expect(ok.code, ok.out).toBe(0);
      expect(ok.out).toContain(
        `scope grew: ${String(before)} -> ${String(before + 2)} (2 entered, 0 left the scope)`
      );
      expect(ok.out).not.toContain('SCOPE CHANGE');
      expect(scopedFiles().length).toBe(before + 2);
      fixture().commitAll('fixture: the growth write landed');
    }
  );

  it(
    'G4: growth AND a rising ceiling — still RAISED, still exit 1, and the refusal comes from the ratchet, not the trip',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const before = scopedFiles().length;
      const sha = artifactSha(fixture());
      // The real census measures one more file over the cap: a ceiling rises.
      fixture().write('src/big-grown.ts', fileOf(FILE_SIZE_CAP_DEFAULT + 3));
      fixture().commitAll('fixture: one over-cap file enters the scope');

      const refused = run([]);
      expect(refused.code, refused.out).toBe(1);
      // The safety arm: the exit is the monotonicity rule speaking, not the scope trip.
      expect(refused.out).toContain('RAISED');
      expect(refused.out).toContain('fileSizeOverCap');
      expect(refused.out).not.toContain('SCOPE CHANGE');
      // And the growth still printed itself, so the operator sees both facts.
      expect(refused.out).toContain(
        `scope grew: ${String(before)} -> ${String(before + 1)} (1 entered, 0 left the scope)`
      );
      expect(artifactSha(fixture()), 'the refusal happens before any byte changes').toBe(sha);
      rmSync(join(fixture().root, 'src', 'big-grown.ts'));
      fixture().commitAll('fixture: the over-cap growth file is taken back out');
    }
  );
});

describe('Scenario: integration — the leaving set refuses even when the count grows', () => {
  it(
    'G2: one file moves out of src/ while three enter — refuses, NAMES the leaver, and the artifact stays byte-identical',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const sha = artifactSha(fixture());
      rmSync(join(fixture().root, 'src', 'leaver.ts'));
      // The same file, now outside the enforced scope; three NEW files in, so the
      // arithmetic difference is +2 — a count-only guard would call this growth.
      fixture().write('tests/leaver.ts', CLEAN_SRC);
      fixture().write('src/grown-c.ts', CLEAN_SRC);
      fixture().write('src/grown-d.ts', CLEAN_SRC);
      fixture().write('src/grown-e.ts', CLEAN_SRC);
      fixture().commitAll('fixture: a file leaves src/ while three enter');

      const refused = run([]);
      expect(refused.code, refused.out).toBe(1);
      expect(refused.out).toContain('REFUSING to write');
      expect(refused.out).toContain('SCOPE CHANGE');
      expect(refused.out).toContain('src/leaver.ts');
      expect(refused.out).toContain('--rescope');
      expect(refused.out).not.toContain('scope grew');
      expect(artifactSha(fixture()), 'the refusal happens before any byte changes').toBe(sha);
    }
  );

  it(
    'G2 fix-forward: the same state with --rescope states the boundary and writes',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const applied = run(['--rescope']);
      expect(applied.code, applied.out).toBe(0);
      expect(applied.out).toContain('RESCOPE applied');
      expect(scopedFiles()).not.toContain('src/leaver.ts');
      fixture().commitAll('fixture: the stated rescope landed');
    }
  );
});

describe('Scenario: render — the boundary text is the boundary', () => {
  it(
    'G5: a crafted HEAD rule text (dirs and enumeration identical) refuses and names both spellings',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const real = scopeFieldOf(fixture().artifactDocument(), 'rule');
      const crafted = 'src/** ONLY (crafted for the §2.50 rule-text arm)';
      craftScopeField('rule', crafted);
      // The sha is the CRAFTED bytes: the arm proves the refused run did not move
      // them, and the craft itself is allowed to (it is the premise, not the verdict).
      const sha = artifactSha(fixture());
      try {
        const refused = run([]);
        expect(refused.code, refused.out).toBe(1);
        expect(refused.out).toContain('SCOPE CHANGE');
        expect(refused.out).toContain(crafted);
        expect(refused.out).toContain(real);
        expect(artifactSha(fixture())).toBe(sha);
      } finally {
        craftScopeField('rule', real);
      }
    }
  );

  it(
    'G5b: the same for the extensions text, and the restored artifact regenerates plain again',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const real = scopeFieldOf(fixture().artifactDocument(), 'extensions');
      const crafted = 'ts only (crafted for the §2.50 extensions arm)';
      craftScopeField('extensions', crafted);
      const sha = artifactSha(fixture());
      try {
        const refused = run([]);
        expect(refused.code, refused.out).toBe(1);
        expect(refused.out).toContain('SCOPE CHANGE');
        expect(refused.out).toContain(crafted);
        expect(artifactSha(fixture())).toBe(sha);
      } finally {
        craftScopeField('extensions', real);
      }
      const ok = run([]);
      expect(ok.code, ok.out).toBe(0);
      fixture().commitAll('fixture: the restored boundary regenerates as an ordinary run');
    }
  );
});

describe('Scenario: a11y — the flag still means the boundary, never the crowd', () => {
  it(
    'G3: --rescope over pure growth is refused as nothing to rescope, and says growth is not a rescope',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const before = scopedFiles().length;
      const sha = artifactSha(fixture());
      fixture().write('src/grown-f.ts', CLEAN_SRC);
      fixture().commitAll('fixture: one more clean file enters the scope');

      const overuse = run(['--rescope']);
      expect(overuse.code, overuse.out).toBe(1);
      expect(overuse.out).toContain('REFUSING to write');
      expect(overuse.out).toContain('nothing to rescope');
      expect(overuse.out).toContain('growth is not a rescope');
      expect(artifactSha(fixture())).toBe(sha);

      const plain = run([]);
      expect(plain.code, plain.out).toBe(0);
      expect(plain.out).toContain(
        `scope grew: ${String(before)} -> ${String(before + 1)} (1 entered, 0 left the scope)`
      );
      fixture().commitAll('fixture: the unflagged growth write landed');
    }
  );
});
