// tests/unit/runtime/no-runtime-input-guard.test.ts
//
// `.peaks/_runtime/` must never be an INPUT of a test.
//
// Why this file exists:
//   `.peaks/_runtime/**` is gitignored, session-scoped and single-use. A test
//   that reads session artifacts out of it is red the moment that session is
//   pruned — and red for a reason that has nothing to do with the product. It
//   is also red on CI by construction, because CI has no session artifacts at
//   all. Six integration tests shipped that way: they pinned
//   `EXISTING_RID`/`EXISTING_SESSION` and
//   `.peaks/_runtime/2026-07-25-session-6da9d9/rd/requests/…`, told the CLI the
//   REPOSITORY was the project root, and so passed only on a machine that still
//   held a July session.
//
// The property, in one sentence:
//   A test may create the runtime state it reads (a tmp project it made
//   itself); it may not consume the repository's own runtime state.
//
// ---------------------------------------------------------------------------
// HOW "DEPENDENCY" IS SEPARATED FROM "MENTION" — the whole design.
//
//   Not by the string. Peaks writes `.peaks/_runtime/<sessionId>/…` while it
//   runs, so that path is all over the test tree as a value a test is asserting
//   ABOUT (an output) or as the tail of a path joined to a directory the test
//   made. What makes a reference a DEPENDENCY is the ROOT it resolves against:
//
//     REPOSITORY ROOT          `__dirname` and anything declared from it
//                              (`const REPO = resolve(__dirname, '../..')`),
//                              plus `process.cwd()` — but ONLY where it is
//                              handed to another process (rules C/D below).
//     A TEST-MADE ROOT         `mkdtempSync(...)`, a `project` parameter,
//                              `process.cwd()` inside a suite that chdir'd into
//                              a tmp workspace. NOT anchored, NOT flagged.
//
//   And not by the ID either. A hardcoded session-id literal is NOT by itself
//   a dependency: `tests/**` legitimately contains dozens of them as INPUTS to
//   pure functions and as labels in tmp projects (measured: 50+ sites, all
//   green, e.g. `tests/unit/skills/caller-first-session-resolution.test.ts`).
//   What makes an id a dependency is being USED TO RESOLVE SESSION STATE FROM
//   THE REPOSITORY — which is what rule C asserts, and what a literal-only rule
//   could never assert without drowning in false positives.
//
// ---------------------------------------------------------------------------
// WHY IT PARSES INSTEAD OF GREPPING
//
//   A line/regex scan cannot tell a path in CODE from the same path in a
//   COMMENT (this repo documents the layout in prose constantly), and it cannot
//   tell `join(project, '.peaks', '_runtime', sid, …)` from a pinned literal.
//   That difference IS the property. So every `tests/**/*.ts` file is parsed
//   with the repo's own `typescript` devDependency and the AST is asked for the
//   property: this is the `guard-verifies-syntax-shape-not-the-property` lesson
//   applied the right way round.
//
// ---------------------------------------------------------------------------
// WHAT THIS GUARD DOES NOT CATCH — read before treating the tree as proven.
// This list is the guard's LIMIT, not a disclaimer. Every item is a live
// rewrite that stays invisible, and each is pinned by a passing test below.
//
//   a. ANCHOR LAUNDERING. `const here = () => process.cwd();` and then
//      `join(here(), '.peaks', '_runtime', sid)` is the same dependency and is
//      not flagged: the anchor set is a closed list of syntactic forms on
//      purpose — a dataflow analysis is a different, much larger tool.
//   b. AN ID SMUGGLED THROUGH A CONTAINER is invisible to a hypothetical
//      id-literal rule (`const SIDS = ['…']; … SIDS[0]`). It is NOT invisible
//      to rule C, which keys on the repo-root anchor rather than on the id —
//      pinned as a test so the difference is not lost.
//   c. A RUNTIME PATH ASSEMBLED FROM PARTS. `'.peaks/' + '_runtime' + …`, or a
//      path read out of a JSON fixture, defeats a path-literal rule.
//   d. `process.cwd()` INSIDE A SUITE THAT CHDIR'd. `tests/unit/_setup/tmp-workspace.ts`
//      chdirs into a tmp dir, so `process.cwd()` at those call sites is a
//      test-made root. Rule B therefore does NOT treat `process.cwd()` as a
//      repository anchor — three `compact-visibility` suites write
//      `join(process.cwd(), '.peaks', '_runtime', …)` and every one of them is
//      creating its own tree. The cost: a direct
//      `readFileSync(join(process.cwd(), '.peaks', '_runtime', …))` in a
//      NON-chdir test is invisible (no live instance). The gain: a rule with
//      zero false positives, which is what keeps this guard from being
//      allowlisted into uselessness.
//   e. AN ARTIFACT READER OUTSIDE `ARTIFACT_READERS`. The set is closed and
//      hand-written: a NEW command that resolves `.peaks/_runtime/<sid>/<role>/…`
//      is invisible here until someone adds it. Rule C is a command-family rule
//      precisely because "does this command touch on-disk session state" is
//      product knowledge, not syntax. Pinned by a limit test using
//      `workflow plan detect-trigger`, which takes `--rid`/`--session-id` and
//      looks identical at the call site but reads no on-disk artifact.
//   f. A READER GIVEN NO `--project`/`--artifact` AT ALL. It inherits the repo
//      root from cwd and rule C has no anchor argument to match. This is the
//      most likely next occurrence of the same defect and it is NOT covered.
//   g. FILES OUTSIDE `tests/**/*.ts`. `scripts/**`, `packages/**`,
//      `examples/**` and non-TypeScript assets are not scanned — including
//      `tests/fixtures/**`, which holds captured markdown naming old sessions.
//      That is data the product reads, not a test asserting on state, so it is
//      out of scope by construction.
//   h. THE REPOSITORY'S COMMITTED STATE. Nothing here constrains tests that
//      read `.peaks/memory/**`, `.peaks/sops/**` or `PROJECT.md`: those are
//      tracked, so depending on them is reproducible. Only the gitignored
//      `_runtime` tree is the subject.
//   i. It says nothing about whether a tmp fixture is REALISTIC. A test can
//      hand-build a shape the product never produces and be green.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import * as ts from 'typescript';

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const TESTS_ROOT = join(PROJECT_ROOT, 'tests');

/** POSIX-normalised path relative to the project root. */
function relativeToRoot(absolutePath: string): string {
  return absolutePath.slice(PROJECT_ROOT.length + 1).split(sep).join('/');
}

/** Every TypeScript file under `tests/`, recursively. `fs`, not a shell (Windows). */
function listTestFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      listTestFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

function parseSourceFile(absolutePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

const collapse = (text: string): string => text.replace(/\s+/g, '');

const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

/**
 * Identifiers in this file whose declaration is derived from the MODULE
 * LOCATION — `const REPO = resolve(__dirname, '../..')`. Those are the names a
 * test uses to mean "the repository", so they anchor exactly like `__dirname`.
 * Collected per file rather than assumed, because the repo spells it `REPO`,
 * `REPO_ROOT` and `PROJECT_ROOT` in different files.
 */
function moduleLocationNames(sourceFile: ts.SourceFile): ReadonlySet<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      if (/__dirname|import\.meta/.test(node.initializer.getText(sourceFile))) {
        names.add(node.name.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return names;
}

/** `__dirname`, `import.meta.url`, or a file-level constant derived from them. */
function isModuleLocationAnchor(
  node: ts.Node | undefined,
  sourceFile: ts.SourceFile,
  names: ReadonlySet<string>
): boolean {
  if (node === undefined) return false;
  const text = node.getText(sourceFile).trim();
  if (text === '__dirname') return true;
  if (text.startsWith('import.meta')) return true;
  return ts.isIdentifier(node) && names.has(node.text);
}

/** `.peaks` and `_runtime` both named — in one literal or across a path chain. */
const mentionsRuntimeTree = (node: ts.Node, sourceFile: ts.SourceFile): boolean => {
  const text = node.getText(sourceFile);
  return text.includes('.peaks') && text.includes('_runtime');
};

export interface AnchoredRuntimePath {
  readonly file: string;
  readonly line: number;
  readonly text: string;
}

/**
 * Rule B — the runtime tree resolved against the MODULE LOCATION, i.e. the
 * repository checkout: `readFileSync(join(__dirname, '..', '..', '.peaks', '_runtime', sid, …))`,
 * `resolve(REPO, '.peaks/_runtime')`, `existsSync(join(REPO_ROOT, …))`.
 *
 * These are the "读产物" and "断言其存在" shapes. The anchor check is what
 * separates them from the legal `join(project, '.peaks', '_runtime', sid)`
 * whose anchor is a tmp dir — and from `process.cwd()` in a chdir'd suite
 * (limit d), which is why `process.cwd()` is not an anchor here.
 */
export function findModuleLocationRuntimePaths(sourceFile: ts.SourceFile): AnchoredRuntimePath[] {
  const names = moduleLocationNames(sourceFile);
  const found: AnchoredRuntimePath[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      mentionsRuntimeTree(node, sourceFile) &&
      node.arguments.some((argument) => isModuleLocationAnchor(argument, sourceFile, names))
    ) {
      found.push({
        file: sourceFile.fileName,
        line: lineOf(sourceFile, node),
        text: collapse(node.getText(sourceFile))
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/**
 * The command families that RESOLVE role/session artifacts from disk: they read
 * `.peaks/_runtime/<sid>/<role>/requests/…`, or an `--artifact` path inside the
 * project. Pointing one of these at the REPOSITORY root means the test consumes
 * the repository's session state, whatever it asserts afterwards.
 *
 * Closed, hand-written set — see limit (e). It is product knowledge ("which
 * command touches on-disk session state") and cannot be inferred from syntax.
 */
const ARTIFACT_READERS: readonly (readonly [string, string])[] = [
  ['request', 'lint'],
  ['request', 'show'],
  ['request', 'list'],
  ['request', 'repair-status'],
  ['scan', 'diff-vs-scope'],
  ['memory', 'extract']
];

/** Flags whose value is the root the command resolves artifacts against. */
const ROOT_FLAGS: readonly string[] = ['--project', '--artifact'];

export interface RepoRootedArtifactRead {
  readonly file: string;
  readonly line: number;
  readonly command: string;
  readonly flag: string;
  readonly anchor: string;
}

/**
 * `process.cwd()` resolves the repository root in an integration test — the
 * test process runs at the repo root and hands the path to a CHILD process,
 * which cannot have been chdir'd by the tmp-workspace helper. It only counts
 * for a subprocess argument (see limit d for why it must not count for a
 * direct fs call).
 */
const isSubprocessCwdAnchor = (
  node: ts.Node | undefined,
  sourceFile: ts.SourceFile,
  names: ReadonlySet<string>
): boolean => {
  if (node === undefined) return false;
  if (collapse(node.getText(sourceFile)) === 'process.cwd()') return true;
  return isModuleLocationAnchor(node, sourceFile, names);
};

/**
 * Rule C — an artifact-reading command aimed at the repository root.
 *
 * The artifact it resolves is session-scoped and gitignored, so every version
 * of this is a dependency on one machine's leftovers; there is no reproducible
 * form. This is the rule that catches the six defects: the id may be a literal,
 * a constant, or smuggled through a container — the anchor is what is asserted
 * on, so none of those rewrites escapes it (pinned by a test below).
 */
export function findRepoRootedArtifactReads(sourceFile: ts.SourceFile): RepoRootedArtifactRead[] {
  const names = moduleLocationNames(sourceFile);
  const found: RepoRootedArtifactRead[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const first = node.arguments[0];
      if (first === undefined || !ts.isArrayLiteralExpression(first)) {
        ts.forEachChild(node, visit);
        return;
      }
      const elements = first.elements;
      const word = (element: ts.Node | undefined): string | undefined =>
        element !== undefined && ts.isStringLiteral(element) ? element.text : undefined;
      const family = ARTIFACT_READERS.find(([verb, noun]) => word(elements[0]) === verb && word(elements[1]) === noun);
      if (family !== undefined) {
        for (let index = 0; index < elements.length; index += 1) {
          const flag = word(elements[index]);
          if (flag === undefined || !ROOT_FLAGS.includes(flag)) continue;
          const value = elements[index + 1];
          if (isSubprocessCwdAnchor(value, sourceFile, names)) {
            found.push({
              file: sourceFile.fileName,
              line: lineOf(sourceFile, node),
              command: `${family[0]} ${family[1]}`,
              flag,
              anchor: collapse(value?.getText(sourceFile) ?? '')
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

interface ScanResult {
  readonly scannedFiles: number;
  readonly anchoredPaths: readonly AnchoredRuntimePath[];
  readonly repoRootedReads: readonly RepoRootedArtifactRead[];
}

function scanProject(): ScanResult {
  const files = listTestFiles(TESTS_ROOT);
  const anchoredPaths: AnchoredRuntimePath[] = [];
  const repoRootedReads: RepoRootedArtifactRead[] = [];
  for (const absolutePath of files) {
    // This is the one file in the tree that must be able to NAME a violating
    // fixture in order to test the rules against it. Its fixtures are ASSEMBLED
    // at runtime (`['2026','07','25'].join('-')`) rather than written as
    // literals, so it does not trip the rules it defines and needs no
    // self-exemption — an exemption by name would reopen exactly the hole this
    // guard exists to close.
    const sourceFile = parseSourceFile(absolutePath, readFileSync(absolutePath, 'utf8'));
    anchoredPaths.push(...findModuleLocationRuntimePaths(sourceFile));
    repoRootedReads.push(...findRepoRootedArtifactReads(sourceFile));
  }
  return { scannedFiles: files.length, anchoredPaths, repoRootedReads };
}

const SCAN = scanProject();

const where = (file: string, line: number): string => `${relativeToRoot(file)}:${line}`;

describe('`.peaks/_runtime` is never a test input (slice 2026-09-13)', () => {
  it('parses a real part of the tree (anti-silence: a broken scanner must not pass)', () => {
    // A scanner that walked nothing, or that stopped recognising anchors, would
    // make every assertion below vacuously green. Pin the walk, the artifact
    // reader set, and both anchor mechanisms against fixtures that MUST hit.
    expect(SCAN.scannedFiles).toBeGreaterThan(100);
    expect(ARTIFACT_READERS.length).toBeGreaterThan(0);
    const withAnchor = [
      `const REPO = resolve(__dirname, '../..');`,
      `const p = join(REPO, '.peaks', '_runtime', sid);`
    ].join('\n');
    expect(findModuleLocationRuntimePaths(parseSourceFile('fixture.ts', withAnchor))).toHaveLength(1);
    expect(
      findRepoRootedArtifactReads(
        parseSourceFile(
          'fixture.ts',
          `runCli(['request', 'show', 'x', '--project', process.cwd(), '--json'], process.cwd());`
        )
      )
    ).toHaveLength(1);
  });

  it('no test resolves the runtime tree against the module location', () => {
    const offenders = SCAN.anchoredPaths.map((hit) => `${where(hit.file, hit.line)} ${hit.text}`);
    expect(offenders).toEqual([]);
  });

  it('no artifact-reading command is aimed at the repository root', () => {
    const offenders = SCAN.repoRootedReads.map(
      (hit) => `${where(hit.file, hit.line)} \`peaks ${hit.command}\` resolves via ${hit.flag} ${hit.anchor}`
    );
    expect(offenders).toEqual([]);
  });
});

describe('negative control — the six defects this guard exists for are all detected', () => {
  // Fixtures are ASSEMBLED, never written as literals: this file lives inside
  // the scanned tree, so a literal `.peaks/_runtime/<dated-session>` here would
  // make the guard fail on itself.
  const SESSION = ['2026', '07', '25'].join('-') + '-session-' + '6da9d9';
  const RUNTIME_PATH = ['.peaks', '_runtime', SESSION, 'rd', 'requests', '001-x.md'].join('/');

  it('catches the `request …` family aimed at process.cwd() (defects 14-17)', () => {
    const fixture = [
      `const EXISTING_RID = 'x';`,
      `const EXISTING_SESSION = ${JSON.stringify(SESSION)};`,
      `runCli(['request', 'lint', EXISTING_RID, '--role', 'rd', '--project', process.cwd(), '--session-id', EXISTING_SESSION, '--json'], process.cwd());`,
      `runCli(['request', 'repair-status', EXISTING_RID, '--project', process.cwd(), '--session-id', EXISTING_SESSION, '--json'], process.cwd());`,
      `runCli(['request', 'list', '--project', process.cwd(), '--session-id', EXISTING_SESSION, '--json'], process.cwd());`,
      `runCli(['request', 'show', EXISTING_RID, '--role', 'rd', '--project', process.cwd(), '--session-id', EXISTING_SESSION, '--json'], process.cwd());`
    ].join('\n');
    expect(
      findRepoRootedArtifactReads(parseSourceFile('fixture.ts', fixture)).map(
        (hit) => `${hit.line}:${hit.command}:${hit.flag}`
      )
    ).toEqual([
      '3:request lint:--project',
      '4:request repair-status:--project',
      '5:request list:--project',
      '6:request show:--project'
    ]);
  });

  it('catches `scan diff-vs-scope` aimed at a REPO constant (defect 18)', () => {
    const fixture = [
      `const REPO = resolve(__dirname, '../..');`,
      `runCli(['scan', 'diff-vs-scope', '--rid', EXISTING_RID, '--project', REPO, '--session-id', EXISTING_SESSION, '--json'], REPO);`
    ].join('\n');
    expect(findRepoRootedArtifactReads(parseSourceFile('fixture.ts', fixture)).map((hit) => hit.line)).toEqual([2]);
  });

  it('catches `memory extract` pointed at the repo root with a pinned artifact path (defect 13)', () => {
    const fixture =
      `runCli(['memory', 'extract', '--project', process.cwd(), '--artifact', ` +
      `join(process.cwd(), ${JSON.stringify(RUNTIME_PATH)}), '--dry-run', '--json'], process.cwd());`;
    expect(findRepoRootedArtifactReads(parseSourceFile('fixture.ts', fixture)).map((hit) => hit.line)).toEqual([1]);
  });
});

describe('negative control — creating and reading your own runtime tree is NOT a violation', () => {
  const SESSION = ['2026', '09', '13'].join('-') + '-session-' + 'fixture0';

  it('a tmp project the test made anchors its own runtime paths', () => {
    const fixture = [
      `const project = mkdtempSync(join(tmpdir(), 'fixture-'));`,
      `bindSession(project);`,
      `mkdirSync(join(project, '.peaks', '_runtime', ${JSON.stringify(SESSION)}), { recursive: true });`,
      `writeFileSync(join(project, '.peaks', '_runtime', 'active-skill.json'), '{}');`,
      `writeFileSync(join(project, '.peaks', '_runtime', ${JSON.stringify(SESSION)}, 'rd', 'requests', 'r.md'), BODY);`,
      `runCli(['request', 'lint', FIXTURE_RID, '--project', project, '--session-id', FIXTURE_SESSION, '--json'], project);`,
      `runCli(['memory', 'extract', '--project', project, '--artifact', join(project, 'notes', 'x.md'), '--dry-run', '--json'], project);`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findModuleLocationRuntimePaths(parsed)).toEqual([]);
    expect(findRepoRootedArtifactReads(parsed)).toEqual([]);
  });

  it('a hardcoded session-id literal alone is a mention, not a dependency', () => {
    // The measured reason rule C is anchored on the ROOT rather than on the id:
    // `tests/**` holds dozens of these as pure-function inputs and tmp labels,
    // all legitimate. Only using one to resolve session state FROM THE
    // REPOSITORY makes it a dependency.
    const fixture = [
      `const SID = ${JSON.stringify(SESSION)};`,
      `const index = readMemoryIndex(tmpProjectRoot, SID);`,
      `expect(renderStatusLine({ sessionId: SID, isTTY: false })).toContain('Peaks');`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findModuleLocationRuntimePaths(parsed)).toEqual([]);
    expect(findRepoRootedArtifactReads(parsed)).toEqual([]);
  });

  it('a test that chdir\'d into a tmp workspace and writes process.cwd()/.peaks is legal', () => {
    // Limit (d), pinned. `tests/unit/_setup/tmp-workspace.ts` chdirs, so
    // `process.cwd()` here is the tmp root, not the repository — which is
    // exactly why rule B does not accept `process.cwd()` as an anchor.
    const fixture = [
      `withTmpWorkspacePerTest();`,
      `const runtime = join(process.cwd(), '.peaks', '_runtime', LIFECYCLE_SID);`,
      `mkdirSync(runtime, { recursive: true });`
    ].join('\n');
    expect(findModuleLocationRuntimePaths(parseSourceFile('fixture.ts', fixture))).toEqual([]);
  });

  it('mentioning the runtime tree in an assertion about OUTPUT is not a violation', () => {
    const bareDir = ['.peaks', '_runtime'].join('/');
    const layout = ['.peaks', '_runtime', '<sid>', '<role>', 'requests', '<rid>.md'].join('/');
    const fixture = [
      `expect(envelope.data.path).toContain(${JSON.stringify(bareDir)});`,
      `// prose: peaks writes envelopes only to .peaks/_runtime/<sessionId>/<role>/`,
      `const doc = ${JSON.stringify(layout)};`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findModuleLocationRuntimePaths(parsed)).toEqual([]);
    expect(findRepoRootedArtifactReads(parsed)).toEqual([]);
  });
});

describe('limits — pinned as passing tests, not left implicit', () => {
  it('limit (a): an anchor laundered through a helper is invisible', () => {
    const fixture = [
      `function here() { return process.cwd(); }`,
      `const p = join(here(), '.peaks', '_runtime', sid);`
    ].join('\n');
    expect(findModuleLocationRuntimePaths(parseSourceFile('fixture.ts', fixture))).toEqual([]);
  });

  it('limit (b) is NOT a limit for rule C: a smuggled id does not escape it', () => {
    // An id-literal rule would miss `SIDS[0]`. Rule C asserts on the ANCHOR, so
    // it does not care how the id was spelled.
    const fixture = [
      `const SIDS = [${JSON.stringify(['2026', '07', '25'].join('-') + '-session-' + '6da9d9')}];`,
      `runCli(['request', 'show', 'x', '--project', process.cwd(), '--session-id', SIDS[0], '--json'], process.cwd());`
    ].join('\n');
    expect(findRepoRootedArtifactReads(parseSourceFile('fixture.ts', fixture)).map((hit) => hit.line)).toEqual([2]);
  });

  it('limit (c): a runtime path assembled from parts is invisible', () => {
    const fixture = [
      `const dir = ${JSON.stringify('.peaks/')} + ${JSON.stringify('_runtime')};`,
      `const p = join(__dirname, dir, 'x');`
    ].join('\n');
    expect(findModuleLocationRuntimePaths(parseSourceFile('fixture.ts', fixture))).toEqual([]);
  });

  it('limit (d): process.cwd() in a direct fs call is invisible (chdir\'d suites)', () => {
    const fixture =
      `const p = readFileSync(join(process.cwd(), '.peaks', '_runtime', sid, 'session.json'), 'utf8');`;
    expect(findModuleLocationRuntimePaths(parseSourceFile('fixture.ts', fixture))).toEqual([]);
  });

  it('limit (e): a non-listed reader is invisible', () => {
    // `workflow plan detect-trigger` takes `--rid`/`--session-id` and looks
    // identical to a reader at the call site, but reads no artifact — verified
    // by running it with a synthetic session id in an empty tmp project, which
    // returns ok:true. Which commands read session state is product knowledge,
    // so the set is explicit rather than inferred.
    const fixture = [
      `const REPO = resolve(__dirname, '../..');`,
      `runCli(['workflow', 'plan', 'detect-trigger', '--rid', EXISTING_RID, '--project', REPO, '--session-id', EXISTING_SESSION, '--json'], REPO);`
    ].join('\n');
    expect(findRepoRootedArtifactReads(parseSourceFile('fixture.ts', fixture))).toEqual([]);
  });

  it('limit (f): an artifact reader given no --project at all is invisible', () => {
    // It inherits the repo root from cwd, with no anchor argument to match.
    // Named so the next reader does not read rule C as "artifact readers cannot
    // consume the repository".
    const fixture = `runCli(['request', 'show', 'x', '--json'], process.cwd());`;
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findRepoRootedArtifactReads(parsed)).toEqual([]);
    expect(findModuleLocationRuntimePaths(parsed)).toEqual([]);
  });
});
