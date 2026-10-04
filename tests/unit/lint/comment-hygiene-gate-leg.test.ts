/**
 * The comment-hygiene rows are gate rows, not report lines.
 *
 * What this file refuses to accept:
 *   - a ceiling that was typed in rather than measured — both keys must be present in
 *     the published artifact, which only a run of the generator may write;
 *   - a gate that cannot go red. The founding defect of this guard family is a check
 *     that reports clean because it stopped being able to see (the widened probe that
 *     took the dead-reference count to 0 while looking healthy), so the central arm
 *     hands the leg ONE file carrying `ceiling + 1` findings and requires the run to
 *     fail. An arm that passes for the wrong reason is worse than a missing arm.
 *
 * WHY THE TABLE IS READ OUT OF THE LEG'S SOURCE RATHER THAN IMPORTED. `.husky/**` is
 * plain `.mjs` with no declaration file, so a static `import` of it is 8
 * `TS7016/TS7031` errors in this project's `tsc` — which is a gated ceiling
 * (`tscErrors`), so the test for the new rows would itself have refused the
 * regeneration that seeds them. Reading the literals is what
 * `tests/unit/lint/_monotonic-module-set.ts` already does for `CEILING_KEYS`, and it
 * keeps the one real guarantee: a renamed key or label fails HERE, not quietly.
 *
 * The fixture is per row, and that is not a detail: narrative lines cannot produce a
 * dead reference, so one generator for both arms would leave the dead-reference arm
 * measuring an empty file and passing forever. Each dead-reference line cites a
 * DISTINCT missing path, because the classifier reports one finding per citation.
 *
 * Every arm spawns `.husky/peaks-gate.mjs comment-hygiene` — one measurement path, the
 * same `check()` and the same ceilings `repo` mode uses — rather than calling the leg
 * directly, so what is tested is the command that actually blocks a commit.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const GATE = join('.husky', 'peaks-gate.mjs');
const ARTIFACT = join('.peaks', 'lint', 'gate-baseline.json');
const LEG_MEASUREMENT = join('.husky', 'peaks-gate-comment-hygiene.mjs');

const artifact = JSON.parse(readFileSync(ARTIFACT, 'utf8')) as {
  ceilings: Record<string, number>;
  scope: Record<string, { source: string; scannedFiles: number }>;
};

const legSource = readFileSync(LEG_MEASUREMENT, 'utf8');

/** `[envelope field, ceiling key, table label]`, as the leg's own table spells it. */
type Row = { field: string; ceilingKey: string; label: string };

const ROWS: Row[] = [...legSource.matchAll(/\['(\w+)', '(\w+)', '([\w -]+)'\]/g)].map((m) => ({
  field: m[1] ?? '',
  ceilingKey: m[2] ?? '',
  label: m[3] ?? ''
}));

const scopeKey = /export const CH_SCOPE_KEY = '(\w+)';/.exec(legSource)?.[1];
const scopeSource = /export const CH_SCOPE_SOURCE = '([^']+)';/.exec(legSource)?.[1];

/** Which comment shape can breach which row. */
const BREACH: Record<string, 'dead' | 'narrative'> = {
  commentDeadReferences: 'dead',
  commentNarrativeLines: 'narrative'
};

/**
 * Throws rather than defaulting: an arm whose fixture kind silently fell back to
 * narrative would "pass" while measuring an empty dead-reference count.
 */
function breachOf(ceilingKey: string): 'dead' | 'narrative' {
  const kind = breachOf(ceilingKey);
  if (kind === undefined) {
    throw new Error(`no fixture shape is defined for ceiling "${ceilingKey}"`);
  }
  return kind;
}

let scratch = '';

function fixtureBody(kind: 'dead' | 'narrative', count: number): string {
  const line = (i: number): string =>
    kind === 'dead'
      ? `// see \`src/gone-dir/gone-case-${i}.ts\` for the shape`
      : `// Slice 2026-10-04-fixture-${i} carried this on purpose`;
  return Array.from({ length: count }, (_, i) => line(i)).join('\n');
}

function writeFixture(name: string, body: string): string {
  mkdirSync(scratch, { recursive: true });
  const abs = join(scratch, name);
  writeFileSync(abs, `${body}\n`);
  return relative(process.cwd(), abs).replace(/\\/g, '/');
}

/** Run the leg mode. A non-zero exit is a result, not an exception. */
function runGate(args: readonly string[]): { code: number; out: string } {
  try {
    return {
      code: 0,
      out: execFileSync('node', [GATE, 'comment-hygiene', ...args], {
        encoding: 'utf8',
        windowsHide: true
      })
    };
  } catch (err) {
    const failure = err as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, out: `${failure.stdout ?? ''}${failure.stderr ?? ''}` };
  }
}

function ceilingOf(key: string): number {
  const value = artifact.ceilings[key];
  if (typeof value !== 'number') {
    throw new Error(`the published artifact carries no numeric ceiling at "${key}"`);
  }
  return value;
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'peaks-ch-leg-'));
});

afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

describe('Scenario: the leg table and the published artifact agree', () => {
  it('the leg names exactly two rows, and the test read both', () => {
    // A pattern that matched nothing would leave every arm below vacuously green.
    expect(ROWS.map((row) => row.ceilingKey)).toEqual([
      'commentDeadReferences',
      'commentNarrativeLines'
    ]);
  });

  it.each(ROWS)('$ceilingKey is a measured integer in the artifact', ({ ceilingKey }) => {
    expect(Number.isInteger(ceilingOf(ceilingKey))).toBe(true);
    expect(ceilingOf(ceilingKey)).toBeGreaterThanOrEqual(0);
  });

  it('does not yet claim a population record it cannot enforce', () => {
    // The leg’s population is refused on at run time (scanned != asked); the artifact line that
    // NAMES it is deferred, because adding it makes every non-`--rescope` fixture arm refuse.
    // This arm exists so the deferral is recorded, not discovered later.
    expect(scopeKey).toBeDefined();
    expect(artifact.scope[scopeKey as string]).toBeUndefined();
  });
});

describe('Scenario: behavior — the leg holds, and refuses to hold silently', () => {
  it('the untouched repository passes its own ceilings', () => {
    const { code, out } = runGate([]);
    expect(out).toContain('comment-hygiene');
    expect(code).toBe(0);
  });

  it.each(ROWS)(
    'one file carrying $ceilingKey+1 findings makes the run RED',
    ({ ceilingKey, label }) => {
      const fixture = writeFixture(
        `breach-${ceilingKey}.ts`,
        fixtureBody(breachOf(ceilingKey), ceilingOf(ceilingKey) + 1)
      );
      const { code, out } = runGate([fixture]);
      expect(code).not.toBe(0);
      expect(out.toLowerCase()).toContain('breach');
      expect(out).toContain(label);
    }
  );

  it('a named run AT the ceiling passes, so the arm above fails for its size', () => {
    const row = ROWS[1] ?? ROWS[0];
    if (row === undefined) throw new Error('the leg table came back empty');
    const fixture = writeFixture(
      'at-ceiling.ts',
      fixtureBody(breachOf(row.ceilingKey), ceilingOf(row.ceilingKey))
    );
    expect(runGate([fixture]).code).toBe(0);
  });

  it('refuses a file it cannot read, rather than printing a zero it never measured', () => {
    // 0 is what "clean" looks like. Telling those two apart is the row's whole purpose.
    const { code, out } = runGate(['src/gone-dir/never-written-here.ts']);
    expect(code).not.toBe(0);
    expect(out).toMatch(/measured nothing|scanned 0/i);
  });
});
