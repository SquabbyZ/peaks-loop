// tests/unit/lint/format-check-ratchet.test.ts
//
// rid-038 W2/D2 — the wide formatting check is a SET ratchet, and now it has a test.
//
// THE DEFECT THIS CLOSES (found by the rid-038 QA pass, 2026-10-09). The ratchet
// asserted a COUNT: `unformatted <= 12`. So cleaning ONE pre-existing unformatted
// file while adding ONE new one left the count at 12 — still GREEN — while the
// script printed "no new unformatted file", a sentence that is FALSE in exactly
// the case the check exists to catch. This slice exists to remove checks that
// look like passes without being passes; shipping one would defeat its purpose.
// The predicate is now SET CONTAINMENT: the 12 baseline NAMES are the allowed
// set, and the current unformatted set must be a SUBSET of it. Arm C below is the
// defect itself, pinned RED.
//
// WHY A FIXTURE REPOSITORY. The arms need a tree whose unformatted set the test
// controls exactly — the baseline names, or one fewer, or those plus a new one —
// without touching the 12 real unformatted files and without writing into the
// repository (backlog §2.31). Each arm builds a repository under OS tmp, copies
// the REAL ratchet in byte-for-byte, and runs it as a child process against the
// fixture's own `package.json#scripts['format:check']`. The baseline NAMES are NOT
// restated here: they are read from the ratchet's own export, so a name added or
// removed there is exercised here with no edit to this file.
//
// WHAT IS REAL AND WHAT IS A SHIM. The fixture's `node_modules/prettier/bin` is a
// FORWARDER to the repository's real prettier with the same argv and cwd, so "this
// file is unformatted" is a real measurement, not a stub's opinion. Nothing else
// about the ratchet is replaced: the copied module is the committed one.
//
// THE CONTROL ARMS. Arm C is the count-vs-set defect (a count predicate would pass
// it). Arm F is the positive control for that: the SAME scenario with the predicate
// weakened to a constant in the fixture's copy is asserted GREEN, so arm C's red is
// attributable to the predicate and not to the fixture around it.
//
// NOTHING IS WRITTEN INTO THE REPOSITORY: every arm's tree lives under
// `mkdtempSync(join(tmpdir(), …))` and is removed in its own `finally`.

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RATCHET_REL = join('.husky', 'format-check-ratchet.mjs');
const PRETTIER_BIN = join(REPO_ROOT, 'node_modules', 'prettier', 'bin', 'prettier.cjs');
const NEW_FILE_REL = 'tests/unit/lint/__format-ratchet-new.ts';

// Deliberately different from prettier's output under the repo's own config: two
// spaces after `const`, and `{a:1,b:2}` — so `--list-different` really lists it.
const UNFORMATTED = 'const  fixture={a:1,b:2}\nexport default  fixture\n';

// The predicate line arm F patches. If this marker stops matching, the control
// arm throws rather than silently losing its subject.
const PREDICATE = 'files.filter((file) => !allowed.has(file))';

declareDimensions(
  'tests/unit/lint/format-check-ratchet.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason:
        'the subject is a process exit code and its sentences; there is no structured output shape to assert'
    }
  ]
);

let baselineNames: readonly string[] = [];

beforeAll(async () => {
  const mod = (await import(pathToFileURL(join(REPO_ROOT, RATCHET_REL)).href)) as {
    FORMAT_CHECK_BASELINE_FILES: readonly string[];
  };
  baselineNames = mod.FORMAT_CHECK_BASELINE_FILES;
  // Every arm derives its counts from this list, so an empty one would make them
  // vacuous rather than red.
  expect(baselineNames.length, 'the ratchet exports no baseline names').toBeGreaterThan(0);
});

type Fixture = {
  root: string;
  write(rel: string, text: string): void;
  /** Materialize the first `count` baseline names as really-unformatted files. */
  baseline(count: number): void;
  run(): { code: number; out: string };
  /** Weaken the predicate to a constant, for the positive control. */
  weakenPredicate(): void;
  cleanup(): void;
};

function buildFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'peaks-format-ratchet-'));
  const abs = (rel: string): string => join(root, rel);
  const write = (rel: string, text: string): void => {
    const a = abs(rel);
    mkdirSync(dirname(a), { recursive: true });
    writeFileSync(a, text, 'utf8');
  };

  write(
    'package.json',
    `${JSON.stringify(
      {
        name: 'peaks-format-ratchet-fixture',
        version: '0.0.0',
        scripts: { 'format:check': 'prettier --check "tests/**/*.{ts,mts,mjs,js}"' }
      },
      null,
      2
    )}\n`
  );

  const ratchetDest = abs(RATCHET_REL);
  mkdirSync(dirname(ratchetDest), { recursive: true });
  copyFileSync(join(REPO_ROOT, RATCHET_REL), ratchetDest);

  // A forwarder, not a stub: the fixture's prettier IS the repository's real one.
  write(
    join('node_modules', 'prettier', 'package.json'),
    `${JSON.stringify({ name: 'prettier', version: '0.0.0-fixture' })}\n`
  );
  write(
    join('node_modules', 'prettier', 'bin', 'prettier.cjs'),
    [
      "const { spawnSync } = require('node:child_process');",
      `const real = ${JSON.stringify(PRETTIER_BIN)};`,
      'const r = spawnSync(process.execPath, [real, ...process.argv.slice(2)], {',
      '  cwd: process.cwd(),',
      "  stdio: 'inherit',",
      '  windowsHide: true',
      '});',
      'process.exit(r.status === null ? 1 : r.status);',
      ''
    ].join('\n')
  );

  return {
    root,
    write,
    baseline(count) {
      for (const name of baselineNames.slice(0, count)) write(name, UNFORMATTED);
    },
    run() {
      const r = spawnSync(process.execPath, [RATCHET_REL], {
        cwd: root,
        encoding: 'utf8',
        windowsHide: true
      });
      if (r.error !== undefined) throw r.error;
      return { code: r.status ?? 1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    },
    weakenPredicate() {
      const path = abs(RATCHET_REL);
      const before = readFileSync(path, 'utf8');
      const after = before.replace(PREDICATE, 'files.filter(() => false)');
      if (after === before) {
        throw new Error(`the control arm's predicate marker did not match: ${PREDICATE}`);
      }
      writeFileSync(path, after, 'utf8');
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

/** Build a fixture, hand it to `body`, and remove it whatever happens. */
function withFixture(body: (fx: Fixture) => void): void {
  const fx = buildFixture();
  try {
    body(fx);
  } finally {
    fx.cleanup();
  }
}

/** The breach block only, so "named" means named as OUTSIDE, not merely listed. */
function breachBlock(out: string): string {
  const at = out.indexOf('OUTSIDE the baseline set:');
  expect(at, `no breach block in the output:\n${out}`).toBeGreaterThanOrEqual(0);
  return out.slice(at);
}

describe('Scenario: integration — the ratchet measures a SET, not a count', () => {
  it(
    'A: the full baseline set is a subset of itself — green, no breach claimed',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      withFixture((fx) => {
        fx.baseline(baselineNames.length);
        const run = fx.run();
        expect(run.code, run.out).toBe(0);
        expect(run.out).toContain('no unformatted file outside the baseline set');
        expect(run.out).not.toContain('BREACHED');
      });
    }
  );

  it(
    'B: an unformatted file OUTSIDE the set is RED, named, and no baseline name is blamed',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      withFixture((fx) => {
        fx.baseline(baselineNames.length);
        fx.write(NEW_FILE_REL, UNFORMATTED);
        const run = fx.run();
        expect(run.code, run.out).toBe(1);
        const breach = breachBlock(run.out);
        expect(breach).toContain(NEW_FILE_REL);
        // The old message named ALL unformatted files; this one names the encroacher.
        expect(breach).not.toContain(baselineNames[0]);
      });
    }
  );

  it(
    'C: clean one baseline file AND add one new one — count unchanged — is still RED',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      withFixture((fx) => {
        // One old file is now formatted, one new file appeared: the COUNT is the
        // same as the baseline's, which is what the old predicate measured.
        fx.baseline(baselineNames.length - 1);
        fx.write(NEW_FILE_REL, UNFORMATTED);
        const run = fx.run();
        expect(run.out).toContain(`: ${baselineNames.length} unformatted file(s);`);
        // ...and it is RED anyway, because the new NAME is outside the set.
        expect(run.code, run.out).toBe(1);
        expect(breachBlock(run.out)).toContain(NEW_FILE_REL);
      });
    }
  );

  it(
    'D: cleaning a baseline file with nothing new SHRINKS the set — green, and says so',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      withFixture((fx) => {
        const dropped = baselineNames[baselineNames.length - 1];
        fx.baseline(baselineNames.length - 1);
        const run = fx.run();
        expect(run.code, run.out).toBe(0);
        expect(run.out).toContain('no unformatted file outside the baseline set');
        expect(run.out).toContain('The debt shrank');
        expect(run.out).toContain(dropped);
      });
    }
  );
});

describe('Scenario: a11y — the sentence cannot be false', () => {
  it(
    'E: green never claims "no new unformatted file", and a breach never claims "held"',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      withFixture((fx) => {
        fx.baseline(baselineNames.length);
        const green = fx.run();
        expect(green.code, green.out).toBe(0);
        // The retired sentence: true only under a count predicate, and false there
        // in the defect case. It may not appear at all.
        expect(green.out).not.toContain('no new unformatted file');
      });
      withFixture((fx) => {
        fx.baseline(baselineNames.length);
        fx.write(NEW_FILE_REL, UNFORMATTED);
        const red = fx.run();
        expect(red.code, red.out).toBe(1);
        expect(red.out).not.toContain('held —');
        expect(red.out).toContain('Do NOT add them to FORMAT_CHECK_BASELINE_FILES');
      });
    }
  );
});

describe('Scenario: behavior — the red is attributable to the predicate', () => {
  it(
    'F (positive control): with the predicate weakened to a constant, scenario B goes GREEN',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      withFixture((fx) => {
        fx.baseline(baselineNames.length);
        fx.write(NEW_FILE_REL, UNFORMATTED);
        fx.weakenPredicate();
        const run = fx.run();
        expect(run.code, run.out).toBe(0);
        expect(run.out).toContain('no unformatted file outside the baseline set');
      });
    }
  );
});
