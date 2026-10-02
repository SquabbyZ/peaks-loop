// tests/unit/final-review/final-review-guard-c-scan.ts
//
// The scanner behind guard C, split out of
// `final-review-service-fact-states-and-guard.test.ts` so the guard can be
// pointed at a DIRECTORY of modules instead of one file without growing the
// test past its raw-line cap.
//
// Why this exists (backlog §2.28): guard C asserts that only `isDelivered` may
// decide delivery by reading the SOURCE TEXT of the service. C wave 7
// (`78f764cb`) moved ten regions out of the 1,858-line service into twelve
// siblings and left the parent at 273 raw lines. The guard kept passing while
// examining 11,815 of 149,711 characters — 7.9 % of the text it used to read.
// Green, and blind. The subject of the guard is now every module in
// `src/services/final-review/`, enumerated at run time: a hard-coded list is
// exactly how the guard got amputated once.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

/** The one function allowed to decide delivery. */
export const DELIVERY_PREDICATE = 'isDelivered';

export interface ScannedFunction {
  readonly name: string;
  readonly body: string;
}

/**
 * Every function-like definition in `source`, by name, in EVERY syntax shape:
 * `function`, `async function`, `function*`, `export default function`, class
 * and object methods, getters/setters, constructors, and arrow / function
 * expressions bound to a `const`. An unnamed definition reports as
 * `<anonymous>` — it is still a body that must not decide delivery, so it is
 * still scanned.
 *
 * Two shapes were invisible to the scanner guard C shipped with, and both are
 * covered here because a proxy can hide in either: a `constructor`, which is a
 * MethodDeclaration-shaped node the old branch list left out; and a function
 * expression or arrow that sits at module scope without being bound to a name
 * (`on('exit', () => …)`, `export default () => …`), which is a body that is
 * not inside any other scanned body and therefore was never scanned at all.
 * A function-like nested INSIDE a scanned body is deliberately not recorded a
 * second time under its own name: it is already covered by the enclosing body,
 * and recording it separately would report `renderEvidenceSection`'s own status
 * test as a stray `<anonymous>` offender and invite somebody to widen
 * `RENDER_ONLY` to make the noise stop.
 */
export function namedFunctionBodies(source: string): readonly ScannedFunction[] {
  const file = ts.createSourceFile(
    'guard-c-fixture.ts',
    source,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    ts.ScriptKind.TS
  );
  const scanned: ScannedFunction[] = [];
  const record = (node: ts.Node, name: string | undefined): void => {
    scanned.push({
      name: name ?? '<anonymous>',
      body: source.slice(node.getStart(file), node.getEnd())
    });
  };
  const identifierName = (node: ts.Node): string | undefined => {
    const named = (node as { readonly name?: ts.Node }).name;
    return named !== undefined && ts.isIdentifier(named) ? named.text : undefined;
  };
  const isFunctionLike = (node: ts.Node): boolean =>
    ts.isArrowFunction(node) || ts.isFunctionExpression(node);
  const visit = (node: ts.Node, insideScannedBody: boolean): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isConstructorDeclaration(node)
    ) {
      record(
        node,
        identifierName(node) ?? (ts.isConstructorDeclaration(node) ? 'constructor' : undefined)
      );
      ts.forEachChild(node, (child) => visit(child, true));
      return;
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      isFunctionLike(node.initializer)
    ) {
      record(node.initializer, node.name.text);
      ts.forEachChild(node.initializer, (child) => visit(child, true));
      return;
    }
    if (isFunctionLike(node) && !insideScannedBody) {
      record(node, undefined);
      ts.forEachChild(node, (child) => visit(child, true));
      return;
    }
    ts.forEachChild(node, (child) => visit(child, insideScannedBody));
  };
  ts.forEachChild(file, (child) => visit(child, false));
  return scanned;
}

/**
 * Every way a delivery judgement has been faked in this module's history.
 * Each one is a PROXY that a source can satisfy without the reviewer having
 * received its conclusion.
 *
 * THIS LIST IS THE GUARD'S LIMIT, not its definition. It matches the TOKENS a
 * proxy comparison has been written with, so it now catches them in any syntax
 * shape — but a rewrite that never types those tokens is invisible to it. The
 * test below pins that residual blindness in both directions so nobody can
 * read this guard as "delivery has one home, guaranteed".
 */
export const PROXIES: readonly { readonly name: string; readonly re: RegExp }[] = [
  { name: "status === 'found'", re: /status\s*[!=]==\s*'found'/ },
  { name: "status !== 'found'", re: /status\s*[!=]==\s*'found'/ },
  { name: 'includedBytes === totalBytes', re: /includedBytes\s*[!=]==\s*totalBytes/ },
  { name: 'totalBytes === 0', re: /totalBytes\s*[!=]==\s*0/ },
  { name: 'includedBytes > 0', re: /includedBytes\s*[<>]=?\s*0/ },
  { name: 'content.length > 0', re: /content\.length\s*[<>]=?\s*[0-9]/ }
];

/**
 * The one function allowed to branch on `status === 'found'` without deciding
 * delivery: it chooses which STATUS LINE to print, and its result is prompt
 * text, so it cannot gate a verdict. Pinned to exactly one entry on purpose —
 * widening this list is a decision someone has to make in the guard, in
 * daylight, rather than a judgement that appears in a helper nobody re-reads.
 */
export const RENDER_ONLY = ['renderEvidenceSection'];

/** `"<owner> uses <proxy>"` for every proxy found in every function body. */
export function deliveryProxyOffenders(source: string): readonly string[] {
  const offenders: string[] = [];
  for (const fn of namedFunctionBodies(source)) {
    for (const proxy of PROXIES) {
      if (proxy.re.test(fn.body)) offenders.push(`${fn.name} uses ${proxy.name}`);
    }
  }
  return offenders;
}

/** Is this offender one the guard sanctions? */
export function sanctionedOffender(entry: string): boolean {
  return (
    entry.startsWith(`${DELIVERY_PREDICATE} `) ||
    RENDER_ONLY.some((name) => entry.startsWith(`${name} `))
  );
}

/** Offenders the guard does NOT sanction — the ones that must be `[]`. */
export function illegalOffenders(offenders: readonly string[]): readonly string[] {
  return offenders.filter((entry) => !sanctionedOffender(entry));
}

/**
 * One module of the guarded directory: the path the scanner actually read, the
 * functions it found there, and the proxies those bodies use. `module` is the
 * file name so a failure names WHERE the judgement was faked, not just what.
 */
export interface ScannedModule {
  readonly module: string;
  readonly path: string;
  readonly bytes: number;
  readonly functions: readonly ScannedFunction[];
  readonly offenders: readonly string[];
}

/**
 * Scan EVERY `.ts` module in `dir`. The file list comes from `readdirSync`,
 * never from a literal: the §2.28 amputation happened because the guard's
 * subject was a single path in a constant, and a split that moved the bodies
 * elsewhere moved them out of the guard's view without touching the guard.
 */
export function scanModuleSet(dir: string): readonly ScannedModule[] {
  const modules: ScannedModule[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })
    .filter((dirent) => dirent.isFile() && dirent.name.endsWith('.ts'))
    .map((dirent) => dirent.name)
    .sort()) {
    const path = join(dir, entry);
    const source = readFileSync(path, 'utf8');
    modules.push({
      module: entry,
      path,
      bytes: source.length,
      functions: namedFunctionBodies(source),
      offenders: deliveryProxyOffenders(source)
    });
  }
  return modules;
}

/**
 * The PRE-§2.28 subject, kept in the suite for the same reason
 * `legacyTopLevelFunctions` is: the scope test below asserts that it finds
 * NOTHING in a fixture where the module-set scan finds a named plant. That is
 * the amputation reproduced as an assertion, which makes "the widened guard
 * observes more" a fact rather than a claim.
 */
export function parentOnlyOffenders(
  dir: string,
  parent = 'final-review-service.ts'
): readonly string[] {
  return deliveryProxyOffenders(readFileSync(join(dir, parent), 'utf8'));
}

/**
 * Which modules of the set carry a scanned function called `name`. The guard
 * uses this to assert that `isDelivered` has exactly one HOME across the whole
 * directory, not merely that the one file it used to read still defines it: a
 * split can move a predicate, and a second copy of it is the same defect the
 * guard exists to catch.
 */
export function modulesDefining(
  modules: readonly ScannedModule[],
  name: string
): readonly string[] {
  return modules
    .filter((scanned) => scanned.functions.some((fn) => fn.name === name))
    .map((scanned) => scanned.module);
}

/** How many scanned functions across the whole set carry `name`. */
export function definitionCount(modules: readonly ScannedModule[], name: string): number {
  return modules.reduce(
    (total, scanned) => total + scanned.functions.filter((fn) => fn.name === name).length,
    0
  );
}

/** Every offender in the set, prefixed with the module that produced it. */
export function labelledOffenders(modules: readonly ScannedModule[]): readonly string[] {
  return modules.flatMap((scanned) =>
    scanned.offenders.map((entry) => `${scanned.module}: ${entry}`)
  );
}

/**
 * The PRE-H1 scanner, kept verbatim in the test for one reason: the shape test
 * asserts that it finds NOTHING in a source where the AST scanner finds
 * four proxies. That is the H1 defect reproduced as an assertion — it is what
 * makes "this test fails against the old guard" a fact rather than a claim.
 */
export function legacyTopLevelFunctions(
  source: string
): readonly { readonly name: string; readonly body: string }[] {
  const start = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/;
  const lines = source.split('\n');
  const blocks: { name: string; body: string }[] = [];
  let current: { name: string; body: string[] } | null = null;
  for (const line of lines) {
    const match = start.exec(line);
    if (match !== null) {
      if (current !== null) blocks.push({ name: current.name, body: current.body.join('\n') });
      current = { name: match[1] as string, body: [line] };
      continue;
    }
    if (current !== null) {
      current.body.push(line);
      if (line === '}') {
        blocks.push({ name: current.name, body: current.body.join('\n') });
        current = null;
      }
    }
  }
  if (current !== null) blocks.push({ name: current.name, body: current.body.join('\n') });
  return blocks;
}
