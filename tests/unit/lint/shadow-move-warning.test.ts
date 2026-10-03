// tests/unit/lint/shadow-move-warning.test.ts
//
// Rid `2026-10-03-shadow-move-rider` W1: the exempt population gets a VOICE. The
// rescope (backlog §2.42, `561ba8b5`) moved 558 files out of the gated view and left
// their debt in the artifact's non-gated `shadow` block; §2.46 then found that block
// understating reality and nobody noticed, because a rise in an ungated row is
// invisible to a ratchet that reads only ceilings. This file guards the warning that
// closes that hole, plus the two things the owner's 2026-10-03 ruling forbids: it may
// NEVER change an exit code and NEVER add a key to the artifact. Four states —
// inactive (HEAD carries no shadow block), equal, rise, fall — and the `--rescope`
// annotation that tells "we stopped watching more files" apart from "the files we
// stopped watching got worse".
//
// Fixture posture (shared with `baseline-rescope-guard.test.ts`): a `mkdtempSync`
// scratch repo with its own `git init`, eslint/tsc stubbed, prettier and the CENSUS
// real, the generator spawned against THAT tree. Nothing here touches this
// repository's `.git` or its published artifact.
//
// The subprocess arms are real generator runs, so they carry `@slow` and the fast lane
// (`package.json#scripts.test:fast`) skips them; the state-machine arms are pure.

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { REPO_ROOT } from '../standards/_file-size-cap-scan.js';
import { FILE_SIZE_CAP_TESTS } from '../../../src/services/scan/file-size-policy.js';
import { createFixture, type Fixture } from './_file-size-hooks-fixture.js';

declareDimensions(
  'tests/unit/lint/shadow-move-warning.test.ts',
  ['behavior', 'integration', 'render', 'a11y'],
  []
);

/** The five numeric rows the shadow block carries, in the check's own order. */
const SHADOW_ROWS = [
  'measuredFiles',
  'eslintFindings',
  'eslintErrors',
  'fileSizeOverCap',
  'fileSizeExcessLines'
] as const;

/** The artifact's canonical key set — the warning may not add to it (hard property). */
const ARTIFACT_KEYS = [
  'version',
  'generatedAt',
  'note',
  'invocation',
  'scope',
  'shadow',
  'phantomRules',
  'ceilings',
  'fileSizeLineConvention',
  'fileSizePolicyInputs',
  'coverageGapFiles',
  'syntaxErrorFiles',
  'notLinted',
  'prettierUnparsable',
  'files'
];

const GENERATOR_REL = join('.husky', 'peaks-gate-baseline.mjs');

type ShadowBlock = Record<string, unknown>;

/** One shadow block, in the shape the generator writes; the pure arms vary one row. */
function shadowBlock(over: Partial<Record<(typeof SHADOW_ROWS)[number], number>>): ShadowBlock {
  return {
    scopeDirs: ['scripts', 'tests'],
    measuredFiles: 558,
    eslintFindings: 639,
    eslintErrors: 160,
    fileSizeOverCap: 35,
    fileSizeExcessLines: 13557,
    ...over
  };
}

type ShadowMoveInput = {
  headShadow: ShadowBlock | null;
  shadow: ShadowBlock;
  rescopeApplied?: boolean;
};

/** THE CHECK ITSELF, loaded where it lives rather than restated here. */
async function loadShadowMove(): Promise<(input: ShadowMoveInput) => string[]> {
  const module = (await import(
    pathToFileURL(join(REPO_ROOT, '.husky', 'baseline', 'rescope.mjs')).href
  )) as Record<string, unknown>;
  const check = module.shadowMoveLines;
  if (typeof check !== 'function') {
    throw new Error('.husky/baseline/rescope.mjs exports no `shadowMoveLines`');
  }
  return check as (input: ShadowMoveInput) => string[];
}

let fx: Fixture | null = null;
function fixture(): Fixture {
  if (fx === null) fx = createFixture('shadow-move-warning');
  return fx;
}

/** A generator run with stdout and stderr kept APART — the warning must be stderr-only. */
type GenRun = { code: number; stdout: string; stderr: string; artifact: string };

function generatorRun(args: readonly string[] = []): GenRun {
  const f = fixture();
  const spawned = spawnSync(process.execPath, [GENERATOR_REL, ...args], {
    cwd: f.root,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024
  });
  // A spawn failure is "did not run", never "no warning".
  if (spawned.error !== undefined) throw spawned.error;
  return {
    code: spawned.status ?? 1,
    stdout: spawned.stdout ?? '',
    stderr: spawned.stderr ?? '',
    artifact: f.read(join('.peaks', 'lint', 'gate-baseline.json'))
  };
}

const doc = (text: string): Record<string, unknown> =>
  JSON.parse(text) as Record<string, unknown>;
const blockOf = (text: string, which: string): Record<string, unknown> =>
  doc(text)[which] as Record<string, unknown>;
const rowOf = (text: string, which: string, key: string): number =>
  Number(blockOf(text, which)[key]);
/** The rise lines of one run, in the order the check emitted them. */
const riseLines = (stderr: string): string[] =>
  stderr.split('\n').filter((line) => line.startsWith('WARNING: shadow moved up:'));

const RISE_FILE = 'tests/exempt-over-cap.ts';
let seededArtifact = '';
let riseRun: GenRun | null = null;

afterAll(() => {
  fx?.cleanup();
});

describe('Scenario: behavior — the four states of the shadow-move check', () => {
  it('inactive: HEAD with no shadow block prints exactly one line, naming why and this run’s size', async () => {
    const check = await loadShadowMove();
    const lines = check({ headShadow: null, shadow: shadowBlock({}) });
    expect(lines.join('\n')).toContain('inactive');
    expect(lines.join('\n')).toContain('no shadow block');
    // §2.41: the state that compares nothing still names the population it holds.
    expect(lines.join('\n')).toContain('558');
    expect(lines.join('\n')).not.toContain('WARNING');
    expect(lines.length, lines.join('\n')).toBe(1);
  });

  it('equal: one comparison line naming every row of the population, and nothing else', async () => {
    const check = await loadShadowMove();
    const lines = check({ headShadow: shadowBlock({}), shadow: shadowBlock({}) });
    expect(lines.length, lines.join('\n')).toBe(1);
    expect(lines.join('\n')).toBe(
      'shadow unchanged: 558 files, 639 findings, 160 errors, 35 over-cap, 13557 excess lines'
    );
  });

  it('rise: one WARNING line per moved key, naming the key and both numbers', async () => {
    const check = await loadShadowMove();
    const one = check({
      headShadow: shadowBlock({ eslintFindings: 638 }),
      shadow: shadowBlock({})
    });
    expect(riseLines(one.join('\n')).length, one.join('\n')).toBe(1);
    expect(one.join('\n')).toContain('eslintFindings 638 -> 639');
    expect(one.join('\n')).toContain('the boundary exempts it; nobody fixed it');

    const two = check({
      headShadow: shadowBlock({ eslintFindings: 638, fileSizeExcessLines: 13500 }),
      shadow: shadowBlock({})
    });
    expect(riseLines(two.join('\n')).length, two.join('\n')).toBe(2);
  });

  it('rise with --rescope applied: the SAME line says the boundary moved this run', async () => {
    const check = await loadShadowMove();
    const plain = check({
      headShadow: shadowBlock({ measuredFiles: 557 }),
      shadow: shadowBlock({})
    });
    const rescoped = check({
      headShadow: shadowBlock({ measuredFiles: 557 }),
      shadow: shadowBlock({}),
      rescopeApplied: true
    });
    const plainWarning = riseLines(plain.join('\n')).join('\n');
    const scopedWarning = riseLines(rescoped.join('\n')).join('\n');
    expect(plainWarning).toContain('measuredFiles 557 -> 558');
    expect(scopedWarning).toContain(plainWarning);
    expect(scopedWarning).toContain('(the boundary moved this run — --rescope)');
    expect(scopedWarning.split('WARNING').length - 1).toBe(1);
  });

  it('fall: no warning at all — a fall is either real cleanup or a vanished population', async () => {
    const check = await loadShadowMove();
    const lines = check({
      headShadow: shadowBlock({ eslintFindings: 640, fileSizeOverCap: 36 }),
      shadow: shadowBlock({})
    });
    expect(riseLines(lines.join('\n')).length, lines.join('\n')).toBe(0);
    // ...and it says what it declined to warn on rather than printing nothing (§2.41).
    expect(lines.join('\n')).toContain('shadow moved down');
  });

  it('every shadow row the check can move moves, one row at a time', async () => {
    const check = await loadShadowMove();
    for (const row of SHADOW_ROWS) {
      const current = Number(shadowBlock({})[row]);
      const head = shadowBlock({});
      head[row] = current - 1;
      const lines = check({ headShadow: head, shadow: shadowBlock({}) });
      expect(lines.join('\n'), `${row}`).toContain(`${row} ${String(current - 1)} -> ${String(current)}`);
      expect(riseLines(lines.join('\n')).length, `${row}: ${lines.join('\n')}`).toBe(1);
    }
  });
});

describe('Scenario: integration — the real generator warns when an exempt file enters the index', () => {
  it(
    '@slow seed: the fixture seeds, commits its baseline, and calls the unchanged tree equal',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const seeded = generatorRun(['--seed']);
      expect(seeded.code, seeded.stderr).toBe(0);
      expect(rowOf(seeded.artifact, 'shadow', 'measuredFiles')).toBeGreaterThan(0);
      fixture().commitAll('fixture: HEAD carries the shadow block');
      seededArtifact = fixture().read(join('.peaks', 'lint', 'gate-baseline.json'));
      // The state this repository is actually in (HEAD's shadow refreshed from the
      // committed index): the check must call it equal and warn about nothing.
      const equal = generatorRun();
      expect(equal.code, equal.stderr).toBe(0);
      expect(equal.stderr).toContain('shadow unchanged');
      expect(equal.stderr).not.toContain('WARNING: shadow moved up');
    }
  );

  it(
    '@slow §2.46 regression: an EXEMPT file entering the git index raises the shadow and prints the rise',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const before = rowOf(seededArtifact, 'shadow', 'measuredFiles');
      // Staged, not committed: `git ls-files` is the population, and the index is
      // exactly where §2.46's understated shadow came from.
      fixture().addMainFile(RISE_FILE, FILE_SIZE_CAP_TESTS + 3);
      const run = generatorRun();
      riseRun = run;
      expect(run.code, run.stderr).toBe(0);
      const after = rowOf(run.artifact, 'shadow', 'measuredFiles');
      expect(after).toBe(before + 1);
      expect(run.stderr).toContain(
        `WARNING: shadow moved up: measuredFiles ${String(before)} -> ${String(after)}`
      );
      expect(run.stderr).toContain('the boundary exempts it; nobody fixed it');
    }
  );

  it(
    '@slow hard property: the rise run adds no key to the artifact and moves no ceiling row',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = riseRun;
      if (run === null) throw new Error('the rise run did not happen');
      expect(Object.keys(doc(run.artifact))).toEqual(ARTIFACT_KEYS);
      expect(Object.keys(doc(run.artifact))).toEqual(Object.keys(doc(seededArtifact)));
      expect(blockOf(run.artifact, 'ceilings')).toEqual(blockOf(seededArtifact, 'ceilings'));
      expect(Object.keys(blockOf(run.artifact, 'ceilings'))).not.toContain('shadow');
      expect(Object.keys(blockOf(run.artifact, 'shadow')).sort()).toEqual(
        Object.keys(blockOf(seededArtifact, 'shadow')).sort()
      );
    }
  );

  it(
    '@slow hard property: the warning never changes the exit code — the same rise decided without it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = riseRun;
      if (run === null) throw new Error('the rise run did not happen');
      const f = fixture();
      const decideRel = join('.husky', 'baseline', 'decide.mjs');
      const pristine = f.read(decideRel);
      const call = 'for (const line of shadowMoveLines(shadowMoveInput)) console.error(line);';
      expect(pristine.split(call).length - 1, 'the warning call is one site').toBe(1);
      try {
        f.write(decideRel, pristine.replace(call, '// the warning this control deletes'));
        const without = generatorRun();
        expect(without.stderr).not.toContain('WARNING: shadow moved up');
        expect(without.code, without.stderr).toBe(run.code);
        expect(run.code).toBe(0);
      } finally {
        f.write(decideRel, pristine);
        expect(f.read(decideRel), 'the mutant must not outlive its arm').toBe(pristine);
      }
    }
  );
});

describe('Scenario: render — the warning is stderr, so stdout stays an envelope', () => {
  it(
    '@slow the rise run’s stdout carries no shadow-move text while its stderr does',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = riseRun;
      if (run === null) throw new Error('the rise run did not happen');
      expect(run.stdout).not.toContain('shadow moved up');
      expect(run.stdout).not.toContain('shadow unchanged');
      expect(run.stdout).not.toContain('shadow-move check');
      expect(run.stderr).toContain('shadow moved up');
    }
  );

  it(
    '@slow the rise warns once per row that moved, and not once for the rows that did not',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    () => {
      const run = riseRun;
      if (run === null) throw new Error('the rise run did not happen');
      const moved = riseLines(run.stderr);
      const movedKeys = moved.map((l) => /shadow moved up: (\w+)/.exec(l)?.[1] ?? '');
      expect(movedKeys.sort()).toEqual(
        ['fileSizeExcessLines', 'fileSizeOverCap', 'measuredFiles'].sort()
      );
      expect(run.stderr).not.toContain('shadow moved up: eslintFindings');
      expect(run.stderr).not.toContain('shadow moved up: eslintErrors');
    }
  );
});

describe('Scenario: a11y — what the warning says to the human watching the run', () => {
  it('the rise line is the prescribed sentence, verbatim', async () => {
    const check = await loadShadowMove();
    expect(
      riseLines(
        check({
          headShadow: shadowBlock({ eslintFindings: 638 }),
          shadow: shadowBlock({})
        }).join('\n')
      )
    ).toEqual([
      'WARNING: shadow moved up: eslintFindings 638 -> 639 — the boundary exempts it; nobody fixed it'
    ]);
  });

  it('the inactive line is a full sentence, never an empty run', async () => {
    const check = await loadShadowMove();
    expect(check({ headShadow: null, shadow: shadowBlock({}) })).toEqual([
      "shadow-move check: inactive — HEAD's artifact carries no shadow block, so there is " +
        "nothing to compare this run's 558 exempt files against."
    ]);
  });

  it('@slow the fixture run keeps saying the H3 population line beside the new warning', () => {
    const run = riseRun;
    if (run === null) throw new Error('the rise run did not happen');
    expect(run.stderr).toMatch(
      /out-of-scope \(not gated, owner decision 2026-10-03\): \d+ files, \d+ findings, \d+ excess lines/
    );
    expect(run.stderr).toContain('shadow moved up');
    // Every state names BOTH populations it compared (§2.41: never a bare verdict).
    expect(run.stderr).toContain('compared: this run');
  });
});
