// tests/unit/scripts/dist-freshness.test.ts
//
// `dist/` freshness: identity where possible, mtime as the fallback.
//
// The defect behind this module: the integration suite spawns the BUILT CLI,
// so a STALE `dist/` makes it pass against code that no longer exists
// (measured 2026-09-17: 18 files under `src/` newer than every artifact in
// `dist/`, suite green).
//
// The comparison choice is the load-bearing part, and these tests are what
// makes it a measurement rather than a preference:
//
//   - identity (a content digest recorded at build time) is the authority,
//     because it is the ONLY rule that separates "genuinely built before these
//     sources" from "these files' mtimes moved". The two cases below pin
//     exactly that difference:
//       * `touch` moves an mtime and changes nothing  -> still FRESH
//       * a content edit that preserves the mtime     -> STALE
//     An mtime-only rule gets both of those wrong, in opposite directions.
//   - mtime remains the fallback for a `dist/` built before the stamp existed,
//     and its soundness on this axis was measured, not assumed: `git checkout`
//     does not touch the mtime of a file whose content did not change, and
//     `scripts/clean-dist.mjs` wipes `dist/` before every build, so the newest
//     dist mtime IS the build completion time.
//
// Omitting the `render` dimension: the module returns discriminated objects
// and renders nothing. The operator-facing text it drives is asserted under
// `a11y`, on the preflight that consumes it.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assertDistFresh } from '../../integration/_dist-freshness-global-setup.js';
import type { DistFreshness } from '../../../scripts/dist-freshness.mjs';
import {
  computeSourceDigest,
  DIST_STAMP_RELATIVE_PATH,
  evaluateDistFreshness,
  REBUILD_COMMAND,
  writeDistStamp
} from '../../../scripts/dist-freshness.mjs';
import { z } from 'zod';
import { parseJson } from '../../../src/shared/json-parse.js';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/scripts/dist-freshness.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the module returns discriminated objects and renders nothing; its consumer text is covered by a11y'
    }
  ]
);

/**
 * Narrow a verdict for assertion.
 *
 * `expect(r.state).toBe('stale')` does NOT narrow `r` for the lines after it,
 * so each case re-states the state it expects through one of these two
 * helpers instead of leaving the union un-narrowed.
 */
function stale(r: DistFreshness): Extract<DistFreshness, { state: 'stale' }> {
  if (r.state !== 'stale') throw new Error(`expected a stale verdict, got ${r.state}`);

  return r;
}

function fresh(r: DistFreshness): Extract<DistFreshness, { state: 'fresh' }> {
  if (r.state !== 'fresh') throw new Error(`expected a fresh verdict, got ${r.state}`);

  return r;
}

const SOURCE_A = 'export const a = 1;\n';
const SOURCE_B = 'export const a = 2;\n';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-dist-freshness-'));
  mkdirSync(join(root, 'src'), { recursive: true });
  mkdirSync(join(root, 'dist'), { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeSource(rel: string, content: string): string {
  const full = join(root, 'src', rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  return full;
}

/** A built artifact, so `dist/` is non-empty and the mtime anchor exists. */
function writeBuilt(rel: string, content: string, mtimeMs?: number): string {
  const full = join(root, 'dist', rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content, 'utf8');
  if (mtimeMs !== undefined) utimesSync(full, mtimeMs / 1000, mtimeMs / 1000);
  return full;
}

/** Build `src` first, then `dist`, so the build is newer than its inputs. */
function builtTree(): void {
  writeSource('a.ts', SOURCE_A);
  const at = Date.now() + 5_000;
  writeBuilt('a.js', 'export const a = 1;\n', at);
}

// ── integration: the real filesystem ─────────────────────────────────

/**
 * The stamp file `writeDistStamp` puts in `dist/`.
 *
 * The assertion below is "the digest the evaluator reads equals the digest the
 * writer returned", so the stamp's own shape is the thing under test — and an
 * `any` read of it could not distinguish "the stamp carries the right digest"
 * from "the stamp carries no digest at all".
 */
const distStampFile = z.looseObject({ digest: z.string() });

describe('Scenario: integration — the real filesystem', () => {
  it('reports no-dist when nothing is built', () => {
    writeSource('a.ts', SOURCE_A);
    rmSync(join(root, 'dist'), { recursive: true, force: true });

    expect(evaluateDistFreshness(root).state).toBe('no-dist');
  });

  it('writes a stamp that the evaluator then accepts', () => {
    builtTree();
    const written = writeDistStamp(root);

    const stampRaw = readFileSync(join(root, 'dist', DIST_STAMP_RELATIVE_PATH), 'utf8');
    expect(parseJson(stampRaw, distStampFile).digest).toBe(written.digest);
    expect(written.fileCount).toBe(1);

    const result = fresh(evaluateDistFreshness(root));
    expect(result.method).toBe('digest');
  });

  it('digests the sources it was pointed at, not the process cwd', () => {
    writeSource('a.ts', SOURCE_A);
    writeSource('nested/b.ts', SOURCE_B);

    const here = computeSourceDigest(root);
    expect(here.fileCount).toBe(2);

    // A different tree with different contents must digest differently.
    const other = mkdtempSync(join(tmpdir(), 'peaks-dist-freshness-other-'));
    try {
      mkdirSync(join(other, 'src'), { recursive: true });
      writeFileSync(join(other, 'src', 'a.ts'), SOURCE_B, 'utf8');
      expect(computeSourceDigest(other).digest).not.toBe(here.digest);
    } finally {
      rmSync(other, { recursive: true, force: true });
    }
  });

  it('does not care about the checkout line-ending style', () => {
    // A CRLF working tree is not a source change. Without normalisation this
    // would read as stale on Windows and fresh on Linux for the same commit.
    writeSource('a.ts', SOURCE_A);
    const lf = computeSourceDigest(root).digest;

    writeFileSync(join(root, 'src', 'a.ts'), SOURCE_A.replace(/\n/g, '\r\n'), 'utf8');
    expect(computeSourceDigest(root).digest).toBe(lf);
  });
});

// ── behavior: the decision, and what it ignores ──────────────────────

describe('Scenario: behavior — identity vs mtime', () => {
  it('is STALE when a source changes after the build', () => {
    builtTree();
    writeDistStamp(root);
    writeSource('a.ts', SOURCE_B);

    const result = stale(evaluateDistFreshness(root));
    expect(result.method).toBe('digest');
  });

  it('stays FRESH when a source is touched but not changed', () => {
    // THE churn case the brief warned about: `touch`, a checkout of an
    // unchanged file, a packaging step — all move mtimes, none change the
    // program text. An mtime rule reports this as stale; the digest does not.
    builtTree();
    writeDistStamp(root);

    const far = Date.now() + 60_000;
    const source = join(root, 'src', 'a.ts');
    utimesSync(source, far / 1000, far / 1000);

    const result = fresh(evaluateDistFreshness(root));
    expect(result.method).toBe('digest');
  });

  it('is STALE when a source changes but its mtime is restored', () => {
    // The case an mtime rule CANNOT see, and the reason identity is the
    // authority: same length, same mtime, different text. The test makes the
    // contrast explicit by asking BOTH rules about the same tree — the digest
    // says stale, and the mtime fallback (reached by removing the stamp) says
    // fresh for the identical bytes on disk.
    builtTree();
    writeDistStamp(root);

    const source = join(root, 'src', 'a.ts');
    const before = statSync(source);
    expect(SOURCE_A.length).toBe(SOURCE_B.length);
    writeFileSync(source, SOURCE_B, 'utf8');
    utimesSync(source, before.atime, before.mtime);
    // `utimesSync` takes fractional seconds, so the restore lands within a
    // millisecond rather than exactly; that is far inside the resolution any
    // mtime rule uses.
    expect(Math.abs(statSync(source).mtimeMs - before.mtimeMs)).toBeLessThan(1);

    const byDigest = stale(evaluateDistFreshness(root));
    expect(byDigest.method).toBe('digest');

    rmSync(join(root, 'dist', DIST_STAMP_RELATIVE_PATH), { force: true });
    const byMtime = fresh(evaluateDistFreshness(root));
    expect(byMtime.method).toBe('mtime');
  });

  it('falls back to mtime when no stamp exists, and fires on a stale tree', () => {
    builtTree();
    writeSource('a.ts', SOURCE_A);
    const future = Date.now() + 60_000;
    utimesSync(join(root, 'src', 'a.ts'), future / 1000, future / 1000);

    const result = stale(evaluateDistFreshness(root));
    expect(result.method).toBe('mtime');
    // `stale` is a union of the digest and mtime variants; only the mtime one
    // carries the offending paths.
    if (result.method !== 'mtime') throw new Error('expected the mtime rule to have decided this');
    expect(result.newerSources.map((source) => source.path)).toEqual(['src/a.ts']);
  });

  it('falls back to mtime when no stamp exists, and stays silent on a fresh tree', () => {
    builtTree();

    const result = fresh(evaluateDistFreshness(root));
    expect(result.method).toBe('mtime');
  });

  it('reports no-dist for an empty dist rather than "fresh"', () => {
    // A clean-dist mid-build state must not read as "verified".
    writeSource('a.ts', SOURCE_A);

    expect(evaluateDistFreshness(root).state).toBe('no-dist');
  });
});

// ── a11y: the message the operator meets ─────────────────────────────

describe('Scenario: a11y — the preflight message', () => {
  it('names the stale file and the command that fixes it', () => {
    builtTree();
    writeSource('a.ts', SOURCE_A);
    const future = Date.now() + 60_000;
    utimesSync(join(root, 'src', 'a.ts'), future / 1000, future / 1000);

    expect(() => assertDistFresh(root)).toThrowError(
      new RegExp(
        `dist/ is STALE[\\s\\S]*src/a\\.ts[\\s\\S]*${REBUILD_COMMAND.replace(/[/\\]/g, '\\$&')}`
      )
    );
  });

  it('says which comparison produced the verdict', () => {
    builtTree();
    writeDistStamp(root);

    expect(assertDistFresh(root)).toContain('content digest');

    rmSync(join(root, 'dist', DIST_STAMP_RELATIVE_PATH), { force: true });
    expect(assertDistFresh(root)).toContain('mtime fallback');
  });

  it('is silent and short when there is nothing built', () => {
    writeSource('a.ts', SOURCE_A);
    rmSync(join(root, 'dist'), { recursive: true, force: true });

    const line = assertDistFresh(root);
    expect(line).toContain('no dist/');
    expect(line).toContain('skip');
  });
});
