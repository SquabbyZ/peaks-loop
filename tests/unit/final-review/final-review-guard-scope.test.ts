// tests/unit/final-review/final-review-guard-scope.test.ts
//
// The SCOPE arms of guard C, split out of
// `final-review-service-fact-states-and-guard.test.ts` because that file is at
// 415 raw lines of a 500 cap and the arms below do not fit in the remainder.
// They exercise the SAME scanner the guard runs
// (`./final-review-guard-c-scan.ts`), not a copy of it.
//
// Backlog §2.28: guard C asserts that only `isDelivered` may decide delivery by
// reading source. Its subject used to be ONE file, `final-review-service.ts`;
// C wave 7 (`78f764cb`) moved ten regions out of that 1,858-line service into
// twelve siblings and the guard kept passing while reading 11,815 of the
// directory's 149,711 characters (7.9 %). These arms are what makes that shape
// of failure — green and blind — impossible to repeat silently.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DELIVERY_PREDICATE,
  RENDER_ONLY,
  illegalOffenders,
  labelledOffenders,
  namedFunctionBodies,
  parentOnlyOffenders,
  scanModuleSet
} from './final-review-guard-c-scan.js';

const SERVICE_DIR = resolve(__dirname, '..', '..', '..', 'src', 'services', 'final-review');

/** A proxy in a named function, in the shape the real ones take. */
const PLANT = (fn: string): string =>
  `\nexport function ${fn}(item: { status: string }): boolean {\n  return item.status === 'found';\n}\n`;

/**
 * What one `status` plant scores: two offenders, because PROXIES lists
 * `=== 'found'` and `!== 'found'` as two named ways the judgement has been
 * faked over one shared pattern. Asserting both is what keeps these fixtures
 * honest about the scanner rather than about what a reader expects.
 */
const plantHits = (fn: string): readonly string[] => [
  `${fn} uses status === 'found'`,
  `${fn} uses status !== 'found'`
];

/**
 * An INDEPENDENT census of the named functions in a directory, deliberately
 * built a different way from the guard's walk: an explicit stack instead of
 * recursive visitors, `SyntaxKind` comparisons instead of `is*` guards, and
 * name resolution that reads the arrow's PARENT rather than matching a
 * declaration shape. Two implementations that agree is evidence; one
 * implementation checked against itself is not.
 */
function independentNamedFunctions(dir: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (!/\.[tT][sS]$/.test(entry)) continue;
    const file = ts.createSourceFile(
      entry,
      readFileSync(join(dir, entry), 'utf8'),
      ts.ScriptTarget.ESNext,
      /* setParentNodes */ true,
      ts.ScriptKind.TS
    );
    const stack: ts.Node[] = [];
    // `ts.forEachChild` stops at the first child whose callback returns a
    // truthy value, and `array.push()` returns the new length — so every push
    // here is wrapped in a block body. (The negative control below is what
    // caught this: an oracle that walks one child per node finds nothing.)
    ts.forEachChild(file, (child) => {
      stack.push(child);
    });
    while (stack.length > 0) {
      const node = stack.pop() as ts.Node;
      ts.forEachChild(node, (child) => {
        stack.push(child);
      });

      const named = node as { readonly name?: ts.Node; readonly parent?: ts.Node };
      const identifier = (value: ts.Node | undefined): string | undefined =>
        value !== undefined && ts.isIdentifier(value) ? value.text : undefined;
      switch (node.kind) {
        case ts.SyntaxKind.FunctionDeclaration:
        case ts.SyntaxKind.MethodDeclaration:
        case ts.SyntaxKind.GetAccessor:
        case ts.SyntaxKind.SetAccessor: {
          const name = identifier(named.name);
          if (name !== undefined) found.push(`${entry}#${name}`);
          break;
        }
        case ts.SyntaxKind.Constructor:
          found.push(`${entry}#constructor`);
          break;
        case ts.SyntaxKind.ArrowFunction:
        case ts.SyntaxKind.FunctionExpression: {
          const parent = named.parent;
          if (
            parent !== undefined &&
            (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) &&
            parent.initializer === node
          ) {
            found.push(`${entry}#${identifier(parent.name) ?? '<anonymous>'}`);
          } else if (node.kind === ts.SyntaxKind.FunctionExpression) {
            const own = identifier(named.name);
            if (own !== undefined) found.push(`${entry}#${own}`);
          }
          break;
        }
        default:
          break;
      }
    }
  }
  return found;
}

/** How many scanned functions across a module set carry a name of their own. */
function guardNamedFunctionNames(dir: string): readonly string[] {
  return scanModuleSet(dir)
    .flatMap((scanned) => scanned.functions.map((fn) => `${scanned.module}#${fn.name}`))
    .filter((label) => !label.endsWith('#<anonymous>'));
}

const created: string[] = [];

/**
 * A copy of the guarded directory under `mkdtempSync`, optionally with a proxy
 * planted into one of its modules or with a whole extra module added. Nothing
 * is ever written inside the repository.
 */
function moduleFixture(options: {
  readonly plantInto?: string;
  readonly plantName?: string;
  readonly extraModule?: string;
}): string {
  const root = mkdtempSync(join(tmpdir(), 'guardc-scope-'));
  created.push(root);
  const dir = join(root, 'final-review');
  mkdirSync(dir, { recursive: true });
  for (const entry of readdirSync(SERVICE_DIR)) {
    if (!entry.endsWith('.ts')) continue;
    let source = readFileSync(join(SERVICE_DIR, entry), 'utf8');
    if (options.plantInto === entry) source += PLANT(options.plantName ?? 'plantedDecision');
    writeFileSync(join(dir, entry), source, 'utf8');
  }
  if (options.extraModule !== undefined) {
    writeFileSync(join(dir, 'final-review-wave-eight.ts'), PLANT('plantedInNewModule'), 'utf8');
  }
  return dir;
}

afterAll(() => {
  for (const path of created) rmSync(path, { recursive: true, force: true });
  created.length = 0;
});

describe('guard C — its subject is the module set, not one file (§2.28)', () => {
  /**
   * B1, kept as a permanent assertion in the same style as
   * `legacyTopLevelFunctions`: the OLD subject is shown to find NOTHING in a
   * fixture where the widened subject finds a named plant. Without this pair
   * "the widened guard is better" is a claim with no evidence behind it.
   */
  it('is blind the way the parent-only guard was blind', () => {
    const dir = moduleFixture({ plantInto: 'final-review-gates.ts', plantName: 'plantedSibling' });
    // The guard exactly as §2.28 found it: one file, the parent.
    const oldSubject = illegalOffenders(parentOnlyOffenders(dir));
    const newSubject = illegalOffenders(scanModuleSet(dir).flatMap((m) => m.offenders));
    expect(oldSubject).toEqual([]);
    expect(newSubject).toEqual(plantHits('plantedSibling'));
  });

  it('catches a proxy planted in a SIBLING, and names the sibling', () => {
    const dir = moduleFixture({ plantInto: 'final-review-gates.ts', plantName: 'plantedSibling' });
    const modules = scanModuleSet(dir);
    const pooled = illegalOffenders(modules.flatMap((scanned) => scanned.offenders));
    expect(pooled).toEqual(plantHits('plantedSibling'));
    // The message carries the module path, so a failure points at the file.
    const located = labelledOffenders(modules).filter((entry) =>
      entry.startsWith('final-review-gates.ts: ')
    );
    expect(located).toEqual(
      plantHits('plantedSibling').map((hit) => `final-review-gates.ts: ${hit}`)
    );
    const offender = modules.find((scanned) => scanned.module === 'final-review-gates.ts');
    expect(offender?.path).toBe(join(dir, 'final-review-gates.ts'));
  });

  /** CONTROL (B2): the plant in the PARENT is caught too — no false negative. */
  it('still catches a proxy planted in the parent', () => {
    const dir = moduleFixture({
      plantInto: 'final-review-service.ts',
      plantName: 'plantedParent'
    });
    const pooled = illegalOffenders(scanModuleSet(dir).flatMap((scanned) => scanned.offenders));
    expect(pooled).toEqual(plantHits('plantedParent'));
  });

  /** CONTROL (B2): with the plant removed the same scan is clean, not noisy. */
  it('reports nothing illegal on the untouched directory', () => {
    const dir = moduleFixture({});
    const modules = scanModuleSet(dir);
    expect(illegalOffenders(modules.flatMap((scanned) => scanned.offenders))).toEqual([]);
    // ...and the anti-deletion fact still holds over the whole set.
    expect(
      modules
        .flatMap((scanned) => scanned.offenders)
        .some((entry) => entry.startsWith(`${DELIVERY_PREDICATE} `))
    ).toBe(true);
  });

  /**
   * B3 — the subject-shrink arm. The guard reports the files it OPENED; the
   * test enumerates the directory again by its own route and the two must
   * agree, so a walk narrowed back to a list (or to one file) fails here even
   * though every other arm still passes.
   */
  it('reads every module of the directory it is pointed at', () => {
    const modules = scanModuleSet(SERVICE_DIR);
    const read = modules.map((scanned) => scanned.module).sort();
    const enumerated = readdirSync(SERVICE_DIR)
      .filter((entry) => /\.(ts)$/.test(entry) && statSync(join(SERVICE_DIR, entry)).isFile())
      .sort();
    expect(read).toEqual(enumerated);
    // A subject of one file is the §2.28 amputation, stated as a number.
    expect(read.length).toBeGreaterThan(1);
    expect(read.length).toBeGreaterThanOrEqual(16);
    // Every path the guard claims to have read is the path it read from.
    expect(modules.map((scanned) => scanned.path)).toEqual(
      enumerated.map((e) => join(SERVICE_DIR, e))
    );
    const readBytes = modules.reduce((total, scanned) => total + scanned.bytes, 0);
    const onDiskBytes = enumerated.reduce(
      (total, entry) => total + readFileSync(join(SERVICE_DIR, entry), 'utf8').length,
      0
    );
    expect(readBytes).toBe(onDiskBytes);
  });

  /**
   * B3 — the content floor. Bytes rot with formatting; a named function that
   * the guard never opened is a hole. The oracle is a second implementation
   * (`independentNamedFunctions`), so agreement is evidence.
   */
  it('scans at least as many named functions as an independent walk finds', () => {
    const guard = guardNamedFunctionNames(SERVICE_DIR);
    const independent = independentNamedFunctions(SERVICE_DIR);
    expect(guard.length).toBeGreaterThanOrEqual(independent.length);
    // Every name the independent census found must be a body the guard read.
    for (const label of independent) expect(guard).toContain(label);
  });

  /**
   * NEGATIVE CONTROL: the floor above must be capable of failing. Measuring the
   * OLD subject — the parent alone — against the same oracle comes up short,
   * which is what turns the arm from a formality into a tripwire. An arm that
   * passes only because nothing can ever fail it is not evidence.
   */
  it('would fail the floor if the subject were narrowed back to the parent', () => {
    const oracle = independentNamedFunctions(SERVICE_DIR);
    const parentSource = readFileSync(join(SERVICE_DIR, 'final-review-service.ts'), 'utf8');
    const parentNamed = namedFunctionBodies(parentSource).filter(
      (fn) => fn.name !== '<anonymous>'
    ).length;
    expect(parentNamed).toBeLessThan(oracle.length);
    // The relation the real arm asserts, evaluated on the narrowed subject:
    // exactly the way §2.28 fails — silently, because nothing checked it.
    expect(parentNamed >= oracle.length).toBe(false);
    expect(oracle.length - parentNamed).toBeGreaterThan(30);
  });

  /**
   * B4 — split safety. The next wave moves code into a module that does not
   * exist yet. The scan that finds a plant in it must be the SAME call, with
   * no edit to the guard: this is the whole point of the slice, so it is
   * asserted rather than described.
   */
  it('finds a proxy in a module that does not exist today, with no code change', () => {
    const dir = moduleFixture({ extraModule: 'final-review-wave-eight.ts' });
    const before = illegalOffenders(scanModuleSet(dir).flatMap((scanned) => scanned.offenders));
    expect(before).toEqual(plantHits('plantedInNewModule'));
    expect(labelledOffenders(scanModuleSet(dir)).join('\n')).toContain(
      'final-review-wave-eight.ts: plantedInNewModule'
    );
    // The new module joined the subject without the guard being told about it.
    expect(scanModuleSet(dir).map((scanned) => scanned.module)).toContain(
      'final-review-wave-eight.ts'
    );
  });

  /**
   * B5 — the allow-list is a daylight decision, so it is pinned rather than
   * trusted: widening `RENDER_ONLY` to make a red scope arm go quiet is exactly
   * the move this file exists to make visible.
   */
  it('keeps the sanctioned render-only list at exactly one entry', () => {
    expect(RENDER_ONLY).toEqual(['renderEvidenceSection']);
  });
});
