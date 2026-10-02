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
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { FILE_SIZE_SCOPE_EXTENSIONS } from '../../../src/services/scan/file-size-policy.js';

/** The one function allowed to decide delivery. */
export const DELIVERY_PREDICATE = 'isDelivered';

/**
 * The guarded directory, spelled ONCE. Both test files used to build this path
 * themselves and nothing compared the two, so editing either spelling narrowed
 * that file's view while the other kept asserting a wide one — the second-copy
 * shape this campaign has filed repeatedly. Every consumer imports this
 * constant, and `final-review-guard-teeth.test.ts` counts the spellings so a
 * third one cannot appear unnoticed.
 */
export const GUARDED_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'src',
  'services',
  'final-review'
);

/**
 * The extensions the walk accepts, taken from the shared file-size policy
 * instead of restated as a second `.ts` literal. The ratchet that caps these
 * files measures seven extensions; a guard that measured one could be narrowed
 * by a rename, which nobody would review as a narrowing.
 */
export const SCAN_EXTENSIONS: readonly string[] = FILE_SIZE_SCOPE_EXTENSIONS;

/** Is `name` a module this walk is meant to read? */
function isGuardedFileName(name: string): boolean {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && SCAN_EXTENSIONS.includes(name.slice(dot + 1));
}

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
 * A function-like nested INSIDE a scanned body is recorded when it has a name of
 * its own — a second `isDelivered` shadowed inside `isDelivered`'s own body is a
 * second definition, and `definitionCount` has to be able to count it — and is
 * deliberately NOT recorded when it is anonymous: an anonymous nested body is
 * already covered by the enclosing body, and recording it separately would
 * report `renderEvidenceSection`'s own status test as a stray `<anonymous>`
 * offender and invite somebody to widen `RENDER_ONLY` to make the noise stop.
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
 *
 * Coverage of this list is deliberately wider than "inside a function body":
 * `moduleLevelProxyRegions` below feeds the SAME patterns over the residue of
 * every top-level statement, so a delivery decision written as a module-level
 * initialiser (`const gate = rows[0].status === 'found';`) is an offender too.
 * Before that, `namedFunctionBodies` was the only thing the patterns were ever
 * applied to, and a top-level decision — the shape `§2.28` item 5 names — was
 * invisible however many tokens it typed. A module-level offender is never
 * sanctioned: `sanctionedOffender` only accepts `isDelivered` and the
 * `RENDER_ONLY` names, and a top-level region is labelled `top-level:`, so
 * there is no allow-list entry a module-level decision can hide behind.
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
 * A top-level statement with every function-like body inside it cut out, so the
 * patterns run over the part no scanned body already covers and no proxy is
 * counted twice. `owner` names the declaration the residue came from.
 */
export interface ModuleLevelRegion {
  readonly owner: string;
  readonly text: string;
}

const isFunctionLikeNode = (node: ts.Node): boolean =>
  ts.isFunctionDeclaration(node) ||
  ts.isMethodDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) ||
  ts.isSetAccessorDeclaration(node) ||
  ts.isConstructorDeclaration(node) ||
  ts.isArrowFunction(node) ||
  ts.isFunctionExpression(node);

/**
 * The residue of each module-level statement — imports skipped, whole
 * function-like statements skipped because they are already scanned as bodies,
 * and every nested function-like span cut out of what remains, so no proxy is
 * counted twice. Comments are stripped from the residue, because these modules
 * DOCUMENT the proxies in prose (`final-review-delivery.ts:34` quotes
 * `includedBytes === totalBytes`, `final-review-gates.ts:169` quotes
 * `totalBytes === 0`) and a quoted token is not a delivery decision.
 */
export function moduleLevelProxyRegions(source: string): readonly ModuleLevelRegion[] {
  const file = ts.createSourceFile(
    'guard-c-module-level.ts',
    source,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    ts.ScriptKind.TS
  );
  const regions: ModuleLevelRegion[] = [];
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) || isFunctionLikeNode(statement)) continue;
    const spans: [number, number][] = [];
    const collect = (node: ts.Node): void => {
      if (isFunctionLikeNode(node)) {
        spans.push([node.getStart(file), node.getEnd()]);
        ts.forEachChild(node, collect);
        return;
      }
      ts.forEachChild(node, collect);
    };
    collect(statement);
    spans.sort((a, b) => a[0] - b[0]);
    let text = '';
    let cursor = statement.getStart(file);
    for (const [start, end] of spans) {
      if (start <= cursor) continue;
      text += `${source.slice(cursor, start)}\n`;
      cursor = Math.max(cursor, end);
    }
    if (cursor < statement.getEnd()) text += source.slice(cursor, statement.getEnd());
    text = text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*(?:\/\/)[^\n]*$/gm, ' ')
      .replace(/\/\/[^\n]*/g, ' ');
    const names: string[] = [];
    const collectNames = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        names.push(node.name.text);
        return;
      }
      if (ts.isClassDeclaration(node) && node.name !== undefined) {
        names.push(node.name.text);
        return;
      }
      if (ts.isEnumDeclaration(node)) {
        names.push(node.name.text);
        return;
      }
      if (isFunctionLikeNode(node)) return;
      ts.forEachChild(node, collectNames);
    };
    collectNames(statement);
    regions.push({
      owner: `top-level:${names.join('+') || ts.SyntaxKind[statement.kind]}`,
      text
    });
  }
  return regions;
}

/**
 * The one function allowed to branch on `status === 'found'` without deciding
 * delivery: it chooses which STATUS LINE to print, and its result is prompt
 * text, so it cannot gate a verdict. Pinned to exactly one entry on purpose —
 * widening this list is a decision someone has to make in the guard, in
 * daylight, rather than a judgement that appears in a helper nobody re-reads.
 */
export const RENDER_ONLY = ['renderEvidenceSection'];

/** `"<owner> uses <proxy>"` for every proxy in a body or in module-level residue. */
export function deliveryProxyOffenders(source: string): readonly string[] {
  const offenders: string[] = [];
  for (const fn of namedFunctionBodies(source)) {
    for (const proxy of PROXIES) {
      if (proxy.re.test(fn.body)) offenders.push(`${fn.name} uses ${proxy.name}`);
    }
  }
  for (const region of moduleLevelProxyRegions(source)) {
    for (const proxy of PROXIES) {
      if (proxy.re.test(region.text)) offenders.push(`${region.owner} uses ${proxy.name}`);
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
 * path RELATIVE to the walked directory (`/`-separated), so a failure names
 * WHERE the judgement was faked — including when that where is a subdirectory.
 */
export interface ScannedModule {
  readonly module: string;
  readonly path: string;
  readonly bytes: number;
  readonly functions: readonly ScannedFunction[];
  readonly offenders: readonly string[];
}

/**
 * Scan EVERY module of `dir`, recursively, in the extensions the shared policy
 * measures. The file list comes from `readdirSync`, never from a literal: the
 * §2.28 amputation happened because the guard's subject was a single path in a
 * constant, and a split that moved the bodies elsewhere moved them out of the
 * guard's view without touching the guard.
 *
 * RECURSION IS A CHOICE, not an accident. The walk used to be one directory
 * deep and to accept `.ts` only, so a proxy-bearing module in
 * `final-review/delivery/` or written as `.mts` was outside the subject while
 * every arm stayed green, including the arm built to detect a shrinking subject
 * — which repeated the same flat rule and so could not see a subject that had
 * never been wide. `final-review-guard-teeth.test.ts` plants both shapes in a
 * temporary copy and requires the plant to be reported, so dropping either half
 * of this walk reddens that file rather than silencing it.
 */
export function scanModuleSet(dir: string): readonly ScannedModule[] {
  const found: ScannedModule[] = [];
  const walk = (here: string, prefix: string): void => {
    for (const entry of readdirSync(here, { withFileTypes: true })) {
      const path = join(here, entry.name);
      if (entry.isDirectory()) {
        walk(path, `${prefix}${entry.name}/`);
        continue;
      }
      if (!entry.isFile() || !isGuardedFileName(entry.name)) continue;
      const source = readFileSync(path, 'utf8');
      found.push({
        module: `${prefix}${entry.name}`,
        path,
        bytes: source.length,
        functions: namedFunctionBodies(source),
        offenders: deliveryProxyOffenders(source)
      });
    }
  };
  walk(dir, '');
  return found.sort((a, b) => (a.module < b.module ? -1 : a.module > b.module ? 1 : 0));
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

/**
 * Everything that breaks "the delivery judgement has exactly one home", for any
 * module set — the real one or a mutated copy. The predicate's HOME was asserted
 * at MODULE granularity, so a second `isDelivered` shadowed inside the parent's
 * own body left every arm green: the home was still one module, the offender
 * sweep still sanctioned both bodies by name, and nothing ever called
 * `definitionCount` on the predicate. Putting the count in this one function is
 * what lets the same checks run against a fixture copy, which is the only place
 * a mutation of the guarded tree can be reproduced without editing it.
 */
export function predicateHomeViolations(
  modules: readonly ScannedModule[],
  home = 'final-review-service.ts'
): readonly string[] {
  const violations: string[] = [];
  const defining = modulesDefining(modules, DELIVERY_PREDICATE);
  if (defining.length !== 1) {
    violations.push(`${DELIVERY_PREDICATE} is defined in ${defining.length} modules`);
  } else if (defining[0] !== home) {
    violations.push(`${DELIVERY_PREDICATE} lives in ${defining[0]}, not ${home}`);
  }
  const decisions = definitionCount(modules, DELIVERY_PREDICATE);
  if (decisions !== 1) {
    violations.push(`${DELIVERY_PREDICATE} is defined ${decisions} times, not once`);
  }
  for (const name of RENDER_ONLY) {
    const count = definitionCount(modules, name);
    if (count !== 1) violations.push(`allow-listed ${name} is defined ${count} times, not once`);
  }
  const illegal = illegalOffenders(modules.flatMap((scanned) => scanned.offenders));
  if (illegal.length > 0) violations.push(`illegal offenders: ${illegal.join('; ')}`);
  return violations;
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
