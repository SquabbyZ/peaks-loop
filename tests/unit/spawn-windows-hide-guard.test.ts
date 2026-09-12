// tests/unit/spawn-windows-hide-guard.test.ts
//
// Drift guard for the `windowsHide` repo convention, tightened by slice
// 2026-09-12 `integration-ci-and-windowshide`.
//
// Why this test file exists:
//   The convention is documented in-repo — `src/services/lint/detect-ocr-18.ts`
//   ("`windowsHide` on every spawn (repo convention): without it this probe
//   pops…"), and `packages/peaks-loop-internal-runtime/src/process-supervisor.ts`
//   sets it correctly with a comment saying it was added to stop the
//   "pre-F2 弹 PowerShell 窗口". So the convention was known, applied in one
//   place — and never swept. 14 source files still spawned without it, and the
//   user-visible symptom was a blank `cmd.exe` window per spawn while the
//   integration suite ran (an `ENOENT` spawn leaves the empty window behind
//   too, so a *failing* spawn still cost a manual window close).
//   A contributor who adds a spawn to one of these files restores the defect
//   silently. This guard makes the fix durable.
//
// How it checks, and why not by splitting source text:
//   It parses each guarded file with the TypeScript compiler and walks the AST
//   for `CallExpression`s whose callee is a name bound to a `child_process`
//   import — directly, or through a same-file alias such as
//   `const spawnFn = deps.spawnFn ?? spawn` (`test-commands.ts`). A regex or
//   line-based scan would also match `spawn(` inside comments and template
//   strings: `test-commands.ts` contains `spawn(shim, argv, { shell: true })`
//   inside a JSDoc block, which is a real false positive of exactly that shape.
//
// What this guard does NOT catch — read before trusting it:
//   1. Files outside GUARDED_FILES. The list is a *ratchet* over the 14 files
//      this slice fixed; a brand-new file that spawns without `windowsHide` is
//      not caught. Widening it is a one-line change (append the path); the
//      full remaining debt is recorded in the slice report.
//   2. Non-`child_process` window sources: `shell: true` around a `.cmd` shim,
//      PowerShell launched through another library, native addons. Only the
//      six `node:child_process` entry points below are inspected.
//   3. Anything indirect at a distance: an options object imported from
//      another module, a call assembled by a factory function, a re-exported
//      alias. Only same-file `const X = {…}` / `const X = <child_process
//      ref>` indirection is resolved, one level per reference.
//   4. Value correctness beyond the literal `true`: `windowsHide: someVar` is
//      rejected (conservative — it cannot be checked statically), but so would
//      any computed form a future refactor might legitimately want.
//   5. It asserts nothing about `detached` / `stdio` / `shell` semantics, and
//      it does not check that the flag is *effective* — only that it is set.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as ts from 'typescript';

const PROJECT_ROOT = resolve(__dirname, '..', '..');

/**
 * Ratchet list: the 14 files that spawned without `windowsHide` before slice
 * 2026-09-12. Every `child_process` call site in these files must pass
 * `windowsHide: true` in an options-object literal.
 */
const GUARDED_FILES = [
  'src/services/runtime/vendors/claude-code.ts',
  'src/services/runtime/vendors/codex.ts',
  'src/services/runtime/vendors/copilot.ts',
  'src/services/codegraph/codegraph-process-runner.ts',
  'src/services/env/shell-probe.ts',
  'src/services/lint/detect-eslint.ts',
  'src/services/lint/eslint-runner.ts',
  'src/cli/commands/test-commands.ts',
  'src/cli/commands/playwright-commands.ts',
  'src/cli/commands/shadcn-commands.ts',
  'src/hooks/pre-tool-use-sub-agent.ts',
  'src/services/adapter/adapter-registry.ts',
  'src/services/prd/best-practice-auto-trigger.ts',
  'src/services/release/version-precheck-service.ts'
] as const;

const CHILD_PROCESS_ENTRY_POINTS = new Set([
  'spawn',
  'spawnSync',
  'execFile',
  'execFileSync',
  'exec',
  'execSync'
]);

type Bindings = {
  /** `import { spawn } from 'node:child_process'` → 'spawn' (local name). */
  readonly named: Set<string>;
  /** `import * as cp from 'node:child_process'` → 'cp'. */
  readonly namespaces: Set<string>;
  /** same-file aliases, e.g. `const spawnFn = deps.spawnFn ?? spawn`. */
  readonly aliases: Set<string>;
};

/** Same-file `const X = { … }` literals, so `{ ...X, env }` can be resolved. */
type ObjectLiterals = ReadonlyMap<string, ts.ObjectLiteralExpression>;

type SpawnSite = {
  readonly line: number;
  readonly callee: string;
  readonly ok: boolean;
  readonly why: string;
};

function collectBindings(sourceFile: ts.SourceFile): Bindings {
  const named = new Set<string>();
  const namespaces = new Set<string>();
  const aliases = new Set<string>();
  const bindings: Bindings = { named, namespaces, aliases };

  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (specifier !== 'child_process' && specifier !== 'node:child_process') continue;
    const clause = statement.importClause?.namedBindings;
    if (clause === undefined) continue;
    if (ts.isNamespaceImport(clause)) {
      namespaces.add(clause.name.text);
      continue;
    }
    for (const element of clause.elements) {
      // `import { spawn as launch }` — the LOCAL name is what the call uses.
      named.add(element.name.text);
    }
  }

  // Aliases, in document order so `const a = spawn; const b = a;` resolves.
  const visitAliases = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      if (isChildProcessRef(node.initializer, bindings)) aliases.add(node.name.text);
    }
    ts.forEachChild(node, visitAliases);
  };
  visitAliases(sourceFile);
  return bindings;
}

function isChildProcessRef(expression: ts.Expression, bindings: Bindings): boolean {
  if (ts.isIdentifier(expression)) {
    return bindings.named.has(expression.text) || bindings.aliases.has(expression.text);
  }
  if (ts.isPropertyAccessExpression(expression) && ts.isIdentifier(expression.expression) && ts.isIdentifier(expression.name)) {
    return bindings.namespaces.has(expression.expression.text) && CHILD_PROCESS_ENTRY_POINTS.has(expression.name.text);
  }
  if (ts.isParenthesizedExpression(expression)) return isChildProcessRef(expression.expression, bindings);
  if (ts.isBinaryExpression(expression)) {
    const kind = expression.operatorToken.kind;
    if (kind === ts.SyntaxKind.QuestionQuestionToken || kind === ts.SyntaxKind.BarBarToken) {
      return isChildProcessRef(expression.left, bindings) || isChildProcessRef(expression.right, bindings);
    }
  }
  if (ts.isConditionalExpression(expression)) {
    return isChildProcessRef(expression.whenTrue, bindings) || isChildProcessRef(expression.whenFalse, bindings);
  }
  return false;
}

function collectObjectLiterals(sourceFile: ts.SourceFile): Map<string, ts.ObjectLiteralExpression> {
  const literals = new Map<string, ts.ObjectLiteralExpression>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      literals.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return literals;
}

function callSiteIfChildProcess(
  node: ts.CallExpression,
  bindings: Bindings
): { callee: string; options: ts.Expression | undefined } | null {
  const callee = node.expression;
  if (ts.isIdentifier(callee)) {
    const isEntryPoint = CHILD_PROCESS_ENTRY_POINTS.has(callee.text) && bindings.named.has(callee.text);
    const isAlias = bindings.aliases.has(callee.text);
    if (!isEntryPoint && !isAlias) return null;
    return { callee: callee.text, options: node.arguments[node.arguments.length - 1] };
  }
  if (ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.name) && ts.isIdentifier(callee.expression)) {
    if (!bindings.namespaces.has(callee.expression.text)) return null;
    if (!CHILD_PROCESS_ENTRY_POINTS.has(callee.name.text)) return null;
    return { callee: `${callee.expression.text}.${callee.name.text}`, options: node.arguments[node.arguments.length - 1] };
  }
  return null;
}

function propertyNameOf(property: ts.ObjectLiteralElementLike): string | null {
  if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return null;
  const key = property.name;
  if (ts.isIdentifier(key) || ts.isStringLiteral(key)) return key.text;
  return null;
}

function hasWindowsHideTrue(
  options: ts.Expression | undefined,
  literals: ObjectLiterals,
  visited: ReadonlySet<string>
): { ok: boolean; why: string } {
  if (options === undefined) {
    return { ok: false, why: 'no options argument at all — `windowsHide` cannot be set, the window will pop' };
  }
  if (!ts.isObjectLiteralExpression(options)) {
    return { ok: false, why: 'options are not an object literal here; `windowsHide` is not statically visible' };
  }
  let sawInlinedLiteral = false;
  for (const property of options.properties) {
    if (ts.isSpreadAssignment(property)) {
      const target = property.expression;
      if (ts.isIdentifier(target) && !visited.has(target.text)) {
        const inlined = literals.get(target.text);
        if (inlined !== undefined) {
          sawInlinedLiteral = true;
          const next = new Set(visited);
          next.add(target.text);
          const verdict = hasWindowsHideTrue(inlined, literals, next);
          if (verdict.ok) return verdict;
        }
      }
      continue;
    }
    if (propertyNameOf(property) !== 'windowsHide') continue;
    if (ts.isShorthandPropertyAssignment(property)) {
      return { ok: false, why: '`windowsHide` is present but not the literal `true`' };
    }
    if (ts.isPropertyAssignment(property) && property.initializer.kind === ts.SyntaxKind.TrueKeyword) {
      return { ok: true, why: '' };
    }
    return { ok: false, why: '`windowsHide` is present but not the literal `true`' };
  }
  return {
    ok: false,
    why: sawInlinedLiteral
      ? 'object literal options with a spread whose source object also lacks `windowsHide`'
      : 'object literal options without a `windowsHide` property'
  };
}

function collectSites(relativePath: string): SpawnSite[] {
  const absolutePath = resolve(PROJECT_ROOT, relativePath);
  const source = readFileSync(absolutePath, 'utf8');
  const sourceFile = ts.createSourceFile(absolutePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const bindings = collectBindings(sourceFile);
  const literals = collectObjectLiterals(sourceFile);
  const sites: SpawnSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const hit = callSiteIfChildProcess(node, bindings);
      if (hit !== null) {
        const verdict = hasWindowsHideTrue(hit.options, literals, new Set<string>());
        const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        sites.push({ line: line + 1, callee: hit.callee, ok: verdict.ok, why: verdict.why });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return sites;
}

describe('spawn hygiene — `windowsHide: true` on every child_process call site (slice 2026-09-12)', () => {
  it('when parsed, every guarded file still binds its child_process entry point', () => {
    // Anti-silence assertion: if a refactor moves these calls behind a helper
    // in another module (or renames the import binding to something the alias
    // pass cannot follow), `collectSites` would find nothing and the guard
    // below would pass vacuously. Fail loudly instead.
    const empty = GUARDED_FILES.filter((file) => collectSites(file).length === 0);
    expect(empty).toEqual([]);
  });

  it('when parsed, no guarded file has a child_process call site without `windowsHide: true`', () => {
    const violations = GUARDED_FILES.flatMap((file) =>
      collectSites(file)
        .filter((site) => !site.ok)
        .map((site) => `${file}:${site.line} ${site.callee}(…) — ${site.why}`)
    );
    expect(violations).toEqual([]);
  });
});
