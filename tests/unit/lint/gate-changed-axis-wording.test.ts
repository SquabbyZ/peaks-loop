// tests/unit/lint/gate-changed-axis-wording.test.ts
//
// THE `changed` PATH NAMES ITS AXIS TOO. The commit path (`staged`) was
// axis-named first: the wide formatting leg reads the very files the lint scope
// drops, so "NOTHING WAS COMPARED" became "THE PER-FILE RATCHET COMPARED
// NOTHING" plus a note about the other axis. The push path (`changed`) kept
// the unqualified head — and the push path is where the unqualified head is
// FALSE, because the push hook's leg 1 (`.husky/format-check-ratchet.mjs`)
// compares the WHOLE TREE on the formatting axis right above it.
//
// These arms run the REAL gate in a fixture repository, over a real diff.
//
// Dimensions covered:
//   - integration: the comparison under test is the gate process itself
//   - a11y:        the sentences are operator-visible evidence

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { createFixture, type Fixture } from './_file-size-hooks-fixture.js';

declareDimensions(
  'tests/unit/lint/gate-changed-axis-wording.test.ts',
  ['integration', 'a11y'],
  [
    {
      dim: 'behavior',
      reason: 'the comparison under test is the gate process itself, not an in-process function'
    },
    {
      dim: 'render',
      reason:
        'the sentences are asserted here as operator-visible evidence, which is the a11y leg of this gate'
    }
  ]
);

const GATE_REL = join('.husky', 'peaks-gate.mjs');
const ARTIFACT_REL = join('.peaks', 'lint', 'gate-baseline.json');

/** One warning-severity finding on every path whose basename contains "dirty". */
const ESLINT_DIRTY_STUB = [
  "const path = require('node:path');",
  'const files = process.argv.slice(2).filter((a) => !a.startsWith("-"));',
  'const reports = files.map((f) => ({',
  '  filePath: path.resolve(f),',
  "  messages: path.basename(f).includes('dirty')",
  "    ? [{ ruleId: 'no-console', severity: 1, message: 'Unexpected console statement.', line: 1, column: 1 }]",
  '    : [],',
  '}));',
  'process.stdout.write(JSON.stringify(reports));',
  ''
].join('\n');

let fx: Fixture | null = null;

function fixture(): Fixture {
  if (fx === null) {
    fx = createFixture('gate-changed-axis-wording');
    const f = fx;
    // A src-scoped artifact with rows only for gated files — the same shape the
    // scope-exemption fixture writes, so the arms are about the GATE's reading
    // of the scope and not about the artifact.
    f.write(
      ARTIFACT_REL,
      `${JSON.stringify(
        {
          version: 3,
          scope: { dirs: ['src'], extensions: 'ts, tsx, mts, cts, mjs, cjs, js' },
          phantomRules: [],
          ceilings: {},
          files: {
            'src/tidy.ts': {
              eslint: 0,
              eslintErrors: 0,
              coverageGap: false,
              notLinted: false,
              prettierClean: true
            }
          }
        },
        null,
        2
      )}\n`
    );
    writeFileSync(
      join(f.root, 'node_modules', 'eslint', 'bin', 'eslint.js'),
      ESLINT_DIRTY_STUB,
      'utf8'
    );
    const write = (rel: string, text: string): void => {
      const abs = join(f.root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text, 'utf8');
    };
    write('tests/dirty.ts', 'export const dirty = 1;\n');
    write('notes/plain.md', '# notes\n');
  }
  return fx;
}

type GateRun = { code: number; out: string };

function runGate(mode: string, args: readonly string[], env: Record<string, string> = {}): GateRun {
  const f = fixture();
  const spawned = spawnSync(process.execPath, [GATE_REL, mode, ...args], {
    cwd: f.root,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ...env }
  });
  if (spawned.error !== undefined) throw spawned.error;
  return { code: spawned.status ?? 1, out: `${spawned.stdout ?? ''}${spawned.stderr ?? ''}` };
}

/** The commit the push diff is measured against. */
function headSha(): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: fixture().root,
    encoding: 'utf8',
    windowsHide: true
  }).trim();
}

afterAll(() => {
  fx?.cleanup();
});

describe('Scenario: a11y — the push path names the axis that compared nothing', () => {
  it(
    'when the pushed set holds only out-of-scope code files, should name the per-file ratchet as the axis',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const f = fixture();
      // given: a push whose only changed file is outside the lint scope
      f.write(join('notes', 'arm-one.md'), '# arm one\n');
      f.commitAll('fixture: the gate files are tracked');
      const base = headSha();
      f.write(join('tests', 'dirty.ts'), 'export const dirty = 2;\n');
      f.commitAll('fixture: a pushed change to an out-of-scope file');
      // when:  the push path runs over that diff
      const run = runGate('changed', [], { PEAKS_GATE_CHANGED_BASE: base });
      // then:  the head names WHICH check compared nothing, and the other axes
      //        the push gate measures are named too
      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('THE PER-FILE RATCHET COMPARED NOTHING (changed vs');
      expect(run.out).not.toContain('NOTHING WAS COMPARED (changed vs');
      expect(run.out).toContain('format-check-ratchet.mjs');
      expect(run.out).toContain('WHOLE TREE');
    }
  );

  it(
    'when the pushed set holds nothing to compare, should name the per-file ratchet as the axis',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const f = fixture();
      // given: a push whose only changed file is not a code file at all
      f.write(join('notes', 'arm-two.md'), '# arm two\n');
      f.commitAll('fixture: the gate files are tracked');
      const base = headSha();
      f.write(join('notes', 'plain.md'), '# notes\n\nmore notes\n');
      f.commitAll('fixture: a pushed change to a notes file');
      // when:  the push path runs over that diff
      const run = runGate('changed', [], { PEAKS_GATE_CHANGED_BASE: base });
      // then:  the empty-change-set sentence names the axis too
      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('EMPTY CHANGE SET (changed vs');
      expect(run.out).toContain('THE PER-FILE RATCHET CHECKED NOTHING');
      expect(run.out).toContain('format-check-ratchet.mjs');
    }
  );

  it(
    'when the staged set holds only out-of-scope code files, should keep the commit wording unchanged',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      // given: the same change set, on the commit path
      const run = runGate('staged', ['tests/dirty.ts']);
      // when:  the commit path runs over it
      // then:  the commit wording is exactly what it was — the wide leg's own
      //        sentence, and the push path's wording is nowhere in it
      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('THE PER-FILE RATCHET COMPARED NOTHING (staged)');
      expect(run.out).toContain('The wide formatting check compared 1 of them');
      expect(run.out).not.toContain('(changed vs');
    }
  );
});
