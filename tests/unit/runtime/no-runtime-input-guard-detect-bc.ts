// tests/unit/runtime/no-runtime-input-guard-detect-bc.ts
//
// Rules B and C of `no-runtime-input-guard.test.ts`, moved VERBATIM into this
// sibling for the C wave 7 file-size split (rid 2026-10-01-c-wave7-excess-w7-5).
// The guard's semantics, its scans and its fixtures live in the test files and
// in `no-runtime-input-guard-scan.ts`; this module is only the two detectors
// and the anchor machinery they assert on.

import * as ts from 'typescript';

export const collapse = (text: string): string => text.replace(/\s+/g, '');

export const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
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
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined
    ) {
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
export const ARTIFACT_READERS: readonly (readonly [string, string])[] = [
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
      const family = ARTIFACT_READERS.find(
        ([verb, noun]) => word(elements[0]) === verb && word(elements[1]) === noun
      );
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
