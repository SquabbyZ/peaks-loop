// tests/unit/lint/lint-file-list-parity.test.ts
//
// Slice a1-lint-script-parity — `pnpm lint` must measure the file set the push
// is judged by, not a cheaper approximation of it.
//
// THE DEFECT THIS PINS (measured 2026-09-29, whole repo, 1298 in-scope files).
// `package.json#scripts.lint` was
//     eslint --config config/eslint/.peaks-rules.cjs --ext .ts src tests packages
// while the authoritative invocation is `.husky/peaks-gate.mjs` -> `runEslint()`:
// an EXPLICIT list from `git ls-files`, filtered to the published scope
// (`scope.dirs` x ts|tsx|mts|cts|mjs|cjs|js) and passed with `--no-ignore`.
// Two divergences, both measured the same day:
//   1. the script never reached `scripts/**`, where 73 real findings live;
//   2. `--ext .ts` excludes the .mts/.cts/.mjs/.cjs/.js files the gate counts.
// A developer running `pnpm lint` therefore saw a STRICTLY SMALLER number than
// the number the gate blocks the push on. `scripts/lint/lint-file-list.mjs` is
// now the one list; every arm below compares it against the published rule.
//
// WHY THE SET AND NOT THE COUNT. 1298 is today's membership, not the property.
// A file added by any other slice moves the membership of BOTH arms at once, so
// a count assertion would go red for a change that keeps parity intact — and a
// guard that goes red on correct work gets switched off, which is how this repo
// lost the gate the first time.
//
// WHY AN ORACLE RATHER THAN A DIFF. The claim is about two spellings of one
// rule: this repo's script and the gate's filter. Comparing the module against
// itself proves nothing, so the expected set is rebuilt here from the published
// rule (`.peaks/lint/gate-baseline.json` `scope.dirs`, the seven extensions,
// suffix matching by extension) instead of by importing the module's own
// classifier. `.husky/peaks-gate.mjs` imports this module as of slice a5 and is
// no longer read as a reference copy — it is EXECUTED, and the count it reports
// for its own `repo`-mode scope is compared against the oracle below.
//
// THE CONTROL ARMS ARE THE POINT. A parity check that can only pass shows that
// an empty comparison was empty. Three weakening arms: two drop one scope dir and
// one extension through the module's REAL code path and require the very same
// assertion to go red, naming the files it lost; the third runs a scratch copy of
// the GATE with a dropped dir and requires the gate-side count check to go red.
//
// WHY THE GATE SIDE NEEDED ITS OWN ARM (measured 2026-09-29). Everything above
// this line observed the module, the baseline and `package.json` — and the gate,
// which then kept its own copy of the rule, was observed by NOTHING. Cutting that
// copy to `ts|tsx` made `repo` mode check 1259 files instead of 1298, lose 80
// findings, and exit 0 printing `all whole-repo ceilings held`. So dev-lint and
// the gate could still diverge with no signal, which is the drift this slice was
// opened to kill. Slice a5 wired the gate to this module and the last two arms
// below run the gate process: the drift is now caught where it would happen.
//
// Dimensions:
//   - behavior:    the module's filter, and the same filter weakened
//   - integration: real `git ls-files`, the real published baseline, the real
//                  `package.json` script wired to the real runner
//   - render:      omitted — no output surface is asserted here; the runner's
//                  reported totals are acceptance-criterion evidence, not a
//                  rendered contract this file pins
//   - a11y:        omitted — nothing user-facing is rendered; the observable is
//                  set membership

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

declareDimensions(
  'tests/unit/lint/lint-file-list-parity.test.ts',
  ['behavior', 'integration'],
  [
    {
      dim: 'render',
      reason: 'no output surface is asserted; the observable is set membership'
    },
    {
      dim: 'a11y',
      reason: 'nothing user-facing is rendered by the file list'
    }
  ]
);

const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const BASELINE_PATH = join(REPO_ROOT, '.peaks/lint/gate-baseline.json');
const FILE_LIST_MODULE = join(REPO_ROOT, 'scripts', 'lint', 'lint-file-list.mjs');
const GATE_PATH = join(REPO_ROOT, '.husky', 'peaks-gate.mjs');

/**
 * The seven extensions the published scope names — the answer key, spelled
 * independently of this module's `EXTENSIONS` so a drift in either is visible.
 * `.husky/peaks-gate.mjs` has no copy of the list to drift: since slice a5 it
 * imports the module (see the arms that RUN the gate, below).
 */
const GATE_EXTENSIONS = ['ts', 'tsx', 'mts', 'cts', 'mjs', 'cjs', 'js'];

/**
 * The command `package.json#scripts.lint` must hold: the runner that consumes
 * the one list. Pinned literally, because a runner nothing points at covers
 * nothing — the same wiring-first assertion shape
 * `eslint-rules-config-coverage.test.ts` uses for the lint tsconfig.
 */
const LINT_SCRIPT_COMMAND = 'node ./scripts/lint/run-lint.mjs';

/** The pre-fix command, used as the negative arm of the wiring check. */
const PRE_FIX_LINT_SCRIPT =
  'eslint --config config/eslint/.peaks-rules.cjs --ext .ts src tests packages';

type FileListModule = {
  readonly EXTENSIONS: readonly string[];
  scopeDirs(): readonly string[];
  trackedFiles(): string[];
  filterScopeFiles(
    paths: readonly string[],
    dirs: readonly string[],
    extensions: readonly string[]
  ): string[];
  lintFileList(): string[];
};

/** The module is a `.mjs` build script outside `src/`, so it loads by URL. */
async function loadFileList(): Promise<FileListModule> {
  return (await import(pathToFileURL(FILE_LIST_MODULE).href)) as FileListModule;
}

/**
 * The published baseline, SHAPE FIRST. `JSON.parse` returns `any`, and this file
 * reads `.scope.dirs` / `.scope.extensions` off it — which on a NEW file is a
 * batch of `@typescript-eslint/no-unsafe-*` ERRORS, and the gate's rule "a NEW
 * file must be clean outright" then refuses the commit (measured 2026-09-29: 7
 * findings, first `no-unsafe-return at 118:3`). Naming the shape once here beats
 * casting at each read, and it is the reads themselves that stay untyped-safe.
 */
type PublishedBaseline = {
  readonly scope: { readonly dirs: string[]; readonly extensions: string };
};

/** The one script this file pins, typed for the same reason. */
type RootPackageJson = { readonly scripts: { readonly lint: string } };

function publishedBaseline(): PublishedBaseline {
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) as PublishedBaseline;
}

function trackedFiles(): string[] {
  return execFileSync('git', ['ls-files'], { cwd: REPO_ROOT, encoding: 'utf8', windowsHide: true })
    .trim()
    .split('\n');
}

function publishedScopeDirs(): string[] {
  return publishedBaseline().scope.dirs;
}

/**
 * A scope dir with real members to lose, picked from the published list — not
 * typed. Since rid `2026-10-03-w10-rescope-a` the dirs are DERIVED from the
 * root-`src` plus `packages/<name>/src` rule, so a hand-typed `'scripts'` here
 * would drop nothing and the CONTROL would silently stop controlling.
 */
function aLiveScopeDir(): string {
  const dirs = publishedScopeDirs().filter((d) =>
    trackedFiles().some((f) => f.startsWith(`${d}/`))
  );
  const hit = dirs[dirs.length - 1];
  if (hit === undefined) throw new Error('the published scope dirs carry no populated dir');
  return hit;
}

/**
 * The ONE editable scope rule (`.husky/lint-scope.mjs`, rid
 * `2026-10-03-w10-rescope-a`), loaded the way this file loads everything else
 * it observes. The parity claim gains a THIRD leg here: not just "the module's
 * list equals the published rule" and "the gate executes the published rule",
 * but "the published rule is the derivation of the one rule" — an artifact whose
 * dir list drifted from the tracked files would go red in this arm, and only in
 * this arm.
 */
type LintScopeRule = {
  LINT_SCOPE_RULE: string;
  isLintScoped(file: string): boolean;
  deriveScopeDirs(gatedFiles: readonly string[]): string[];
};

/** The published rule, applied here — the answer key, never the module's own code. */
function gateScopeSet(): Set<string> {
  const dirs = publishedScopeDirs();
  return new Set(
    trackedFiles().filter(
      (p) =>
        GATE_EXTENSIONS.includes(extname(p).slice(1)) && dirs.some((d) => p.startsWith(`${d}/`))
    )
  );
}

/**
 * Set equality, reported as the files each side lost rather than as a length.
 * A count-only failure would say "1298 != 1260" and leave the reader to find the
 * 38 missing files themselves.
 *
 * The names go into the message rather than into an `expect(...).toEqual(array)`
 * because vitest abbreviates long arrays in the text it builds (`[ …(38) ]`), and
 * the CONTROL arms below assert on that text: a weakening the message cannot name
 * is a weakening a reader cannot act on.
 */
function expectSameSet(actual: readonly string[], expected: ReadonlySet<string>): void {
  const actualSet = new Set(actual);
  const missing = [...expected].filter((f) => !actualSet.has(f));
  const extra = actual.filter((f) => !expected.has(f));
  if (missing.length === 0 && extra.length === 0) return;
  const lost = (label: string, files: readonly string[]): string =>
    files.length === 0 ? '' : ` ${label} ${files.length} -> ${files.slice(0, 3).join(', ')};`;
  throw new Error(
    `file-set parity broken.${lost('missing', missing)}${lost('extra', extra)}`.replace(/;$/, '')
  );
}

// ---------------------------------------------------------------------------
// RUNNING the gate, for the two arms at the bottom of the file
// ---------------------------------------------------------------------------
// `repo` mode is the enforcement surface, and it costs minutes: eslint over
// 1298 type-aware files, then prettier, then `tsc`. The line that says HOW MANY
// files it is about is printed before any of that work starts, so reading the
// gate's own scope is a spawn-and-kill, not a payment.
//
// WHY A COUNT HERE, WHEN THE HEADER REFUSES A COUNT-ONLY FAILURE. The set arms
// above own membership: they are the ones that name the files each side lost, and
// they are why a drift is diagnosable. This arm asks a different question — does
// the GATE execute the module, or does it measure something else — and the only
// observable `repo` mode offers for that without costing minutes is the number on
// its first line. So the failure below is a count mismatch BY DESIGN, and the set
// arms are what the reader follows it into.

/** The gate's repo-mode list, spelled the way the gate spells it (slice a5). */
const GATE_REPO_MODE_LIST = 'const files = lintFileList();';

/** The first line `repo` mode prints. */
const GATE_SCOPE_LINE = /peaks-gate: checking (\d+) file\(s\) against the whole-repo ceilings/;

/**
 * Ask the gate process how many files its `repo` mode measures: read the first
 * line, then kill it.
 */
async function gateReportedFileCount(gatePath: string): Promise<number> {
  const child = spawn(process.execPath, [gatePath, 'repo'], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
  const stdout = child.stdout;
  if (stdout === null) throw new Error(`no stdout pipe on the gate child at ${gatePath}`);
  stdout.setEncoding('utf8');
  return await new Promise<number>((measured, refused) => {
    let seen = '';
    let settled = false;
    stdout.on('data', (chunk: string) => {
      seen += chunk;
      const hit = GATE_SCOPE_LINE.exec(seen);
      if (settled || hit === null) return;
      settled = true;
      child.kill();
      measured(Number(hit[1]));
    });
    child.on('error', (err: Error) => {
      if (settled) return;
      refused(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      refused(new Error(`the gate exited (${code}) before printing its scope line:\n${seen}`));
    });
  });
}

/** The assertion the real arm and its control share. */
function expectGateCountsTheScope(counted: number, expected: ReadonlySet<string>): void {
  if (counted === expected.size) return;
  throw new Error(
    `the gate's repo-mode scope is not the published scope: it measures ${counted} file(s), ` +
      `the published rule has ${expected.size} — ${expected.size - counted} file(s) it never ` +
      `looks at. A gate over a smaller surface prints "all whole-repo ceilings held" about ` +
      `debt it did not read.`
  );
}

/**
 * A scratch copy of the gate whose repo-mode list drops `droppedDir` — the shape
 * QA measured on 2026-09-29, where the weakened gate checked 1259 files instead
 * of 1298, lost 80 findings, and still printed `all whole-repo ceilings held`
 * with exit 0, because nothing in the repo ran the gate's own copy of the rule.
 *
 * It sits DIRECTLY under the gitignored `.tmp/`, not in a subdirectory of it: the
 * gate resolves its repo root as `<its own dir>/..` and imports the file-list
 * module as `../scripts/lint/…`, so one extra level of depth would point both at
 * `.tmp/`. The pid suffix keeps two concurrent runs of this file off each other.
 */
function weakenedGateCopy(droppedDir: string): string {
  const copyPath = join(REPO_ROOT, '.tmp', `gate-weakened-${process.pid}.mjs`);
  const source = readFileSync(GATE_PATH, 'utf8');
  const weakened = source.replace(
    GATE_REPO_MODE_LIST,
    `const files = lintFileList().filter((f) => !f.startsWith('${droppedDir}/'));`
  );
  if (weakened === source) {
    throw new Error(
      `the weakening did not apply: the gate has no \`${GATE_REPO_MODE_LIST}\` line to weaken, ` +
        'so the CONTROL arm below would be comparing nothing. Update this helper with the gate.'
    );
  }
  mkdirSync(dirname(copyPath), { recursive: true });
  writeFileSync(copyPath, weakened, 'utf8');
  return copyPath;
}

describe('(behavior) the file list is the published gate scope, exactly', () => {
  it(
    'when the module list is compared to the published scope rule, should return the same set',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const module = await loadFileList();
      expectSameSet(module.lintFileList(), gateScopeSet());
    }
  );

  it(
    'when the set is non-trivial, should contain the classes the old script could not reach',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // Anti-vacuity. Set equality between two empty arms would pass. Since rid
      // `2026-10-03-w10-rescope-a` the two POPULATED classes of the enforced
      // scope are the root `src` tree and the package `src` trees — the second
      // one only exists because `scope.dirs` is now DERIVED from the rule, and
      // the `skills/` one is still the blind spot the `--no-ignore` posture was
      // opened for.
      const module = await loadFileList();
      const files = module.lintFileList();
      expect(files.some((f) => /^packages\/[^/]+\/src\//.test(f))).toBe(true);
      expect(files.filter((f) => f.includes('/skills/')).length).toBeGreaterThan(0);
    }
  );

  it('when the module reads its constants, should publish the extensions the baseline declares', async () => {
    // Two spellings of one rule are compared here: this module's list and the
    // baseline's published string. `.husky/peaks-gate.mjs` used to be a THIRD
    // spelling (its own `CODE_EXT` regex) that no test read — since slice a5 it
    // imports the module, and the arms at the bottom of this file run the gate
    // instead of reading a copy of its rule.
    const module = await loadFileList();
    expect([...module.EXTENSIONS].join(', ')).toBe(publishedBaseline().scope.extensions);
    expect(module.scopeDirs()).toEqual(publishedScopeDirs());
  });

  it('when the published scope.dirs are re-derived from the ONE rule, they match exactly', async () => {
    // Item 7 of rid `2026-10-03-w10-rescope-a`: the artifact's dir list is not a
    // typed enumeration — it is `deriveScopeDirs` over this run's tracked,
    // extension-matching, gated files. A regeneration that drifts from the rule
    // (or a hand-edited artifact) reddens here, because this arm rebuilds the
    // dirs from `git ls-files` and the rule module, not from the artifact.
    const rule = (await import(
      pathToFileURL(join(REPO_ROOT, '.husky', 'lint-scope.mjs')).href
    )) as LintScopeRule;
    const gatedTracked = trackedFiles().filter(
      (p) => GATE_EXTENSIONS.includes(extname(p).slice(1)) && rule.isLintScoped(p)
    );
    expect(rule.deriveScopeDirs(gatedTracked)).toEqual(publishedScopeDirs());
    expect(rule.LINT_SCOPE_RULE).toBe('src/** + packages/*/src/**');
  });

  it('CONTROL: a brand-new packages/<x>/src path is in the rule with no constant edited, and joins the derivation', async () => {
    // The pattern-vs-enforcement arm the slice brief demands: `new-pkg` exists in
    // no list anywhere, and the derivation still enumerates its dir.
    const rule = (await import(
      pathToFileURL(join(REPO_ROOT, '.husky', 'lint-scope.mjs')).href
    )) as LintScopeRule;
    expect(rule.isLintScoped('packages/new-pkg/src/a.ts')).toBe(true);
    expect(rule.isLintScoped('packages/new-pkg/tests/a.ts')).toBe(false);
    const base = rule.deriveScopeDirs(['src/a.ts']);
    expect(rule.deriveScopeDirs(['src/a.ts', 'packages/new-pkg/src/a.ts'])).toEqual(
      [...base, 'packages/new-pkg/src'].sort()
    );
    expect(
      rule.deriveScopeDirs(['src/a.ts', 'packages/new-pkg/src/a.ts'])
    ).toContain('packages/new-pkg/src');
  });

  // CONTROL ARMS — the guard must be able to see its own weakening.
  it(
    'CONTROL: when one scope dir is dropped, the parity assertion should go red naming it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const module = await loadFileList();
      const expected = gateScopeSet();
      const droppedDir = aLiveScopeDir();
      const weakened = module.filterScopeFiles(
        module.trackedFiles(),
        module.scopeDirs().filter((d) => d !== droppedDir),
        module.EXTENSIONS
      );
      // The weakening is real before the assertion is shown to catch it: a
      // control that passes because nothing was dropped proves nothing.
      expect(weakened.some((f) => f.startsWith(`${droppedDir}/`))).toBe(false);
      const firstLost = [...expected].find((f) => f.startsWith(`${droppedDir}/`));
      expect(() => expectSameSet(weakened, expected)).toThrow(String(firstLost));
    }
  );

  it(
    'CONTROL: when one extension is dropped, the parity assertion should go red naming it',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const module = await loadFileList();
      const expected = gateScopeSet();
      // The dropped extension is the first one the PUBLISHED scope actually
      // contains — since the rescope the repo's in-scope population is all `.ts`,
      // and a hand-typed `'mjs'` would drop nothing and stop controlling.
      const usedExt = module.EXTENSIONS.find((e) =>
        [...expected].some((f) => f.endsWith(`.${e}`))
      );
      if (usedExt === undefined) throw new Error('the published scope contains no known extension');
      const droppedExt = usedExt;
      const weakened = module.filterScopeFiles(
        module.trackedFiles(),
        module.scopeDirs(),
        module.EXTENSIONS.filter((e) => e !== droppedExt)
      );
      expect(weakened.some((f) => f.endsWith(`.${droppedExt}`))).toBe(false);
      const firstLost = [...expected].find((f) => f.endsWith(`.${droppedExt}`));
      expect(() => expectSameSet(weakened, expected)).toThrow(String(firstLost));
    }
  );
});

describe('(integration) pnpm lint is wired to the one file set', () => {
  it('when package.json is read, should point scripts.lint at the file-list runner', () => {
    const scripts = (
      JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')) as RootPackageJson
    ).scripts;
    expect(scripts.lint).toBe(LINT_SCRIPT_COMMAND);
  });

  it('CONTROL: the pre-fix directory glob should not satisfy that wiring', () => {
    // The arm above is an equality against a literal; this shows the literal is
    // discriminating rather than merely true, by replaying the command the
    // measured defect shipped with.
    expect(PRE_FIX_LINT_SCRIPT).not.toBe(LINT_SCRIPT_COMMAND);
    expect(PRE_FIX_LINT_SCRIPT).toMatch(/--ext \.ts/);
  });

  it('when the runner is read, should hand eslint that explicit list with --no-ignore', () => {
    const source = readFileSync(join(REPO_ROOT, 'scripts', 'lint', 'run-lint.mjs'), 'utf8');
    expect(source).toContain('./lint-file-list.mjs');
    expect(source).toContain('lintFileList()');
    expect(source).toContain("'--no-ignore'");
  });

  it(
    'when the gate runs repo mode, should measure exactly the published scope',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // The gate no longer HAS a copy of the rule to compare against an oracle,
      // so this arm runs it: the number the real `repo` mode prints for its own
      // file list, against the scope rebuilt from the published rule. Not
      // against `module.lintFileList()` — that would be the module compared with
      // itself, which is the tautology this file's header refuses.
      expectGateCountsTheScope(await gateReportedFileCount(GATE_PATH), gateScopeSet());
    }
  );

  it(
    'CONTROL: when the gate measures a weakened scope, that count check should go red',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // Replay of the measured attack, on a scratch copy of the gate rather than
      // on a copy of its rule. The arm above is the guard; this one is what stops
      // the guard from being decoration: a gate that quietly checks less than the
      // published scope has to be RED, not "held".
      const expected = gateScopeSet();
      const droppedDir = aLiveScopeDir();
      const copy = weakenedGateCopy(droppedDir);
      try {
        const counted = await gateReportedFileCount(copy);
        // The weakening is real before the guard is shown to catch it.
        expect(counted, `the weakened copy should have dropped ${droppedDir}/`).toBeLessThan(
          expected.size
        );
        expect(() => expectGateCountsTheScope(counted, expected)).toThrow(
          /not the published scope/
        );
      } finally {
        rmSync(copy, { force: true });
      }
    }
  );
});
