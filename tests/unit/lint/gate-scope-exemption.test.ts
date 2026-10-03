// tests/unit/lint/gate-scope-exemption.test.ts
//
// Rid `2026-10-03-w10-rescope-a` H2 — the false-red the narrowing would create
// if it only moved half the machinery. `.husky/gate/ratchet.mjs` reads "the
// baseline has no row for this file" as NEW FILE, must be clean outright. If
// the artifact dropped its 552 out-of-scope rows while `inScope` still admitted
// them, every commit touching `tests/...` would be refused with "NEW file …
// has N lint finding(s)" — a narrowing that silently becomes STRICTER (the
// undefined-baseline-row hazard, §2.42 problem 2). `inScope` reads
// `scopeDirs()`, which reads `baseline.scope.dirs`, so with the artifact
// src-scoped the exemption is automatic — and this file proves three things
// about it, all against the REAL gate in a fixture repository:
//
//   A1: an out-of-scope file WITH findings and no baseline row is EXEMPT, and
//       the exemption is SAID OUT LOUD (a silent skip is §2.41's shape —
//       "0 findings" and "nothing checked" must never share an output).
//   A2: the mirror — an IN-scope file with no baseline row still trips the
//       NEW-file rule exactly as today. The exemption was not bought by
//       weakening the undefined-row branch.
//   A3/A4: the empty-change-set report keeps telling apart "the change set was
//       empty" from "every code path in it was dropped by the scope filter" —
//       the second is the new common case for docs/test-only commits.
//   A5: `changed` mode says it with the word "pushed", on the same rule.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { createFixture, type Fixture } from './_file-size-hooks-fixture.js';

declareDimensions(
  'tests/unit/lint/gate-scope-exemption.test.ts',
  ['integration', 'a11y'],
  [
    { dim: 'behavior', reason: 'the comparison under test is the gate process itself, not an in-process function' },
    { dim: 'render', reason: 'the sentences are asserted here as operator-visible evidence, which is the a11y leg of this gate' }
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
  '    ? [{ ruleId: \'no-console\', severity: 1, message: \'Unexpected console statement.\', line: 1, column: 1 }]',
  '    : [],',
  '}));',
  'process.stdout.write(JSON.stringify(reports));',
  ''
].join('\n');

let fx: Fixture | null = null;

function fixture(): Fixture {
  if (fx === null) {
    fx = createFixture('gate-scope-exemption');
    const f = fx;
    // A src-scoped artifact with rows only for gated files — exactly what the
    // rescoped generator writes, hand-built here so the arms are about the
    // GATE's reading of it, not the generator's.
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
    writeFileSync(join(f.root, 'node_modules', 'eslint', 'bin', 'eslint.js'), ESLINT_DIRTY_STUB, 'utf8');
    const write = (rel: string, text: string): void => {
      const abs = join(f.root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, text, 'utf8');
    };
    // All three files are prettier-clean: every failure these arms see is a
    // LINT failure, never a formatting one wearing the same exit code.
    write('tests/dirty.ts', 'export const dirty = 1;\n');
    write('src/new-dirty.ts', 'export const newDirty = 1;\n');
    write('notes/readme-helper.ts', 'export const helper = 1;\n');
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

afterAll(() => {
  fx?.cleanup();
});

describe('Scenario: integration — H2: the exemption is real and it is loud', () => {
  it(
    'A1: an out-of-scope file WITH findings and no baseline row is exempt, and the run SAYS which files it did not compare',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = runGate('staged', ['src/tidy.ts', 'tests/dirty.ts']);
      expect(run.code, run.out).toBe(0);
      expect(run.out).not.toContain('NEW file');
      expect(run.out).not.toContain('blocked');
      expect(run.out).toContain(
        'peaks-gate: 1 staged file(s) are outside the lint scope and were not compared: tests/dirty.ts'
      );
      expect(run.out).toContain('1 staged file(s) OK');
    }
  );

  it(
    'A2 (mirror): an IN-scope file with no baseline row still trips the NEW-file rule',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = runGate('staged', ['src/tidy.ts', 'src/new-dirty.ts', 'tests/dirty.ts']);
      expect(run.code, run.out).toBe(1);
      expect(run.out).toContain('NEW file src/new-dirty.ts has 1 lint finding');
      // The exemption sentence still prints for the OTHER file: the two facts
      // are independent and neither may silence the other.
      expect(run.out).toContain('are outside the lint scope and were not compared: tests/dirty.ts');
    }
  );
});

describe('Scenario: a11y — empty and all-dropped are different facts', () => {
  it(
    'A3: a change set whose code files are ALL out of scope says so, and does not print the empty-set sentence',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = runGate('staged', ['tests/dirty.ts']);
      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('outside the lint scope');
      expect(run.out).not.toContain('EMPTY CHANGE SET');
      expect(run.out).toContain('NOTHING WAS COMPARED');
    }
  );

  it(
    'A4: a change set with NO code files at all keeps the original empty-set sentence',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = runGate('staged', ['notes/plain.md']);
      expect(run.code, run.out).toBe(0);
      expect(run.out).toContain('EMPTY CHANGE SET (staged)');
      expect(run.out).not.toContain('were not compared');
    }
  );

  it(
    'A5: changed mode reports the same exemption with the word "pushed", on a real diff',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const f = fixture();
      // Track everything first, so the diff A5 measures is ONLY the tests/ edit.
      f.commitAll('fixture: the gate files are tracked');
      const base = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: f.root,
        encoding: 'utf8',
        windowsHide: true
      }).trim();
      f.write(join('tests', 'dirty.ts'), 'export const dirty = 2;\n');
      f.commitAll('fixture: a pushed change to an out-of-scope file with findings');
      const run = runGate('changed', [], { PEAKS_GATE_CHANGED_BASE: base });
      expect(run.code, run.out).toBe(0);
      expect(run.out).not.toContain('NEW file');
      expect(run.out).toContain(
        'peaks-gate: 1 pushed file(s) are outside the lint scope and were not compared: tests/dirty.ts'
      );
    }
  );
});
