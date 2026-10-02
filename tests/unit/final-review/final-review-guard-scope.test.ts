// tests/unit/final-review/final-review-guard-scope.test.ts
//
// The SCOPE arms of guard C, split out of
// `final-review-service-fact-states-and-guard.test.ts` because that file was at
// 415 raw lines of a 500 cap (406 now) and the arms below did not fit in the
// remainder. They exercise the SAME scanner the guard runs
// (`./final-review-guard-c-scan.ts`), not a copy of it.
//
// Backlog §2.28: guard C asserts that only `isDelivered` may decide delivery by
// reading source. Its subject used to be ONE file, `final-review-service.ts`;
// C wave 7 (`78f764cb`) moved ten regions out of that 1,858-line service into
// twelve siblings and the guard kept passing while reading 11,815 of the
// directory's 149,711 characters (7.9 %). These arms are what makes that shape
// of failure — green and blind — impossible to repeat silently.

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ts from 'typescript';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DELIVERY_PREDICATE,
  GUARDED_DIR,
  RENDER_ONLY,
  SCAN_EXTENSIONS,
  illegalOffenders,
  labelledOffenders,
  namedFunctionBodies,
  parentOnlyOffenders,
  scanModuleSet
} from './final-review-guard-c-scan.js';
import { FILE_SIZE_SCOPE_EXTENSIONS } from '../../../src/services/scan/file-size-policy.js';

/**
 * The guarded directory, imported rather than re-spelled: two test files used to
 * build the same path independently with nothing comparing them (R-B item 3).
 */
const SERVICE_DIR = GUARDED_DIR;

/** A module of the guarded tree, by path relative to the directory. */
const isGuardedFileName = (name: string): boolean => {
  const dot = name.lastIndexOf('.');
  return dot >= 0 && SCAN_EXTENSIONS.includes(name.slice(dot + 1));
};

/**
 * An independent full census of a directory: every file below it, `/`-separated
 * and relative. Built by a different route from the guard's walk (node's own
 * recursive `readdirSync`) so that agreement is evidence, and wide on purpose —
 * the flat `.ts` version of this rule was the second copy of the narrowing.
 */
function independentModulePaths(dir: string): readonly string[] {
  const nested = readdirSync(dir, { recursive: true, encoding: 'utf8' });
  return nested
    .map((entry) => `${entry}`.split('\\').join('/'))
    .filter((rel) => rel !== '' && rel !== '.' && isGuardedFileName(rel))
    .filter((rel) => statSync(join(dir, ...rel.split('/'))).isFile())
    .sort();
}

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
 * recursive visitors, `SyntaxKind` comparisons instead of `is*` guards, a queue
 * of directories it pops instead of a recursive `walk`, and name resolution that
 * reads the arrow's PARENT rather than matching a declaration shape. Two
 * implementations that agree is evidence; one implementation checked against
 * itself is not.
 *
 * It covers the same scope the guard now claims — every file below `dir`, in the
 * extensions the shared policy measures. Before R-B this oracle used a flat
 * `/\.[tT][sS]$/` rule, so it agreed with a narrow walk and a nested or `.mts`
 * module could be missing from the subject while the agreement arm stayed green.
 */
function independentNamedFunctions(dir: string): readonly string[] {
  const found: string[] = [];
  const pending: { readonly here: string; readonly prefix: string }[] = [{ here: dir, prefix: '' }];
  while (pending.length > 0) {
    const { here, prefix } = pending.pop() as { here: string; prefix: string };
    for (const entry of readdirSync(here)) {
      const rel = `${prefix}${entry}`;
      const path = join(here, entry);
      if (statSync(path).isDirectory()) {
        pending.push({ here: path, prefix: `${rel}/` });
        continue;
      }
      // `endsWith('.' + extension)` over the shared list: a different test from
      // the guard's `lastIndexOf('.')` slice, same scope.
      if (!FILE_SIZE_SCOPE_EXTENSIONS.some((extension) => entry.endsWith(`.${extension}`))) {
        continue;
      }
      const file = ts.createSourceFile(
        rel,
        readFileSync(path, 'utf8'),
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
            if (name !== undefined) found.push(`${rel}#${name}`);
            break;
          }
          case ts.SyntaxKind.Constructor:
            found.push(`${rel}#constructor`);
            break;
          case ts.SyntaxKind.ArrowFunction:
          case ts.SyntaxKind.FunctionExpression: {
            const parent = named.parent;
            if (
              parent !== undefined &&
              (ts.isVariableDeclaration(parent) || ts.isPropertyDeclaration(parent)) &&
              parent.initializer === node
            ) {
              found.push(`${rel}#${identifier(parent.name) ?? '<anonymous>'}`);
            } else if (node.kind === ts.SyntaxKind.FunctionExpression) {
              const own = identifier(named.name);
              if (own !== undefined) found.push(`${rel}#${own}`);
            }
            break;
          }
          default:
            break;
        }
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
 * planted into one of its modules or with a whole extra module added. The copy is
 * the WHOLE tree — every extension, every subdirectory — because a copier that
 * filtered to `.ts` would quietly remove the thing the scope arms are testing
 * (R-B item 1). Nothing is ever written inside the repository.
 */
function moduleFixture(options: {
  readonly plantInto?: string;
  readonly plantName?: string;
  readonly extraModule?: string;
  readonly nestedModule?: string;
  readonly nestedPlant?: string;
  readonly otherExtensionModule?: string;
}): string {
  const root = mkdtempSync(join(tmpdir(), 'guardc-scope-'));
  created.push(root);
  const dir = join(root, 'final-review');
  cpSync(SERVICE_DIR, dir, { recursive: true });
  if (options.plantInto !== undefined) {
    const target = join(dir, options.plantInto);
    writeFileSync(
      target,
      `${readFileSync(target, 'utf8')}${PLANT(options.plantName ?? 'plantedDecision')}`,
      'utf8'
    );
  }
  if (options.extraModule !== undefined) {
    writeFileSync(join(dir, options.extraModule), PLANT('plantedInNewModule'), 'utf8');
  }
  if (options.nestedModule !== undefined) {
    const path = join(dir, ...options.nestedModule.split('/'));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, PLANT(options.nestedPlant ?? 'plantedNested'), 'utf8');
  }
  if (options.otherExtensionModule !== undefined) {
    writeFileSync(join(dir, options.otherExtensionModule), PLANT('plantedOtherExtension'), 'utf8');
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
   *
   * R-B: the independent enumerator used to repeat the guard's old flat `.ts`
   * rule, which made this arm unable to see a subject that had never been wide.
   * `independentModulePaths` walks recursively over the shared extension policy
   * now, and the next arm runs the same equality on a tree that HAS a
   * subdirectory and a non-`.ts` module, so the width is exercised rather than
   * assumed.
   */
  it('reads every module of the directory it is pointed at', () => {
    const modules = scanModuleSet(SERVICE_DIR);
    const read = modules.map((scanned) => scanned.module).sort();
    const enumerated = independentModulePaths(SERVICE_DIR);
    expect(read).toEqual(enumerated);
    // A subject of one file is the §2.28 amputation, stated as a number.
    expect(read.length).toBeGreaterThan(1);
    expect(read.length).toBeGreaterThanOrEqual(16);
    // Every path the guard claims to have read is the path it read from.
    expect(modules.map((scanned) => scanned.path)).toEqual(
      enumerated.map((rel) => join(SERVICE_DIR, ...rel.split('/')))
    );
    const readBytes = modules.reduce((total, scanned) => total + scanned.bytes, 0);
    const onDiskBytes = enumerated.reduce(
      (total, rel) => total + readFileSync(join(SERVICE_DIR, ...rel.split('/')), 'utf8').length,
      0
    );
    expect(readBytes).toBe(onDiskBytes);
  });

  /**
   * TEETH (R-B item 1): the equality above is only evidence if BOTH sides are
   * wide, so it is re-run on a copy of the tree that contains a subdirectory and
   * a `.mts` module. Narrowing either walk — the guard's or the census's — fails
   * here, which is the deliberate choice (recurse, do not assert-emptiness) made
   * visible as an arm rather than as a comment.
   */
  it('reads every module of a directory that has a subdirectory and other extensions', () => {
    const dir = moduleFixture({
      nestedModule: 'delivery/final-review-delivery-legacy.ts',
      otherExtensionModule: 'final-review-legacy-bridge.mts'
    });
    const modules = scanModuleSet(dir);
    const read = modules.map((scanned) => scanned.module).sort();
    expect(read).toEqual(independentModulePaths(dir));
    expect(read).toContain('delivery/final-review-delivery-legacy.ts');
    expect(read).toContain('final-review-legacy-bridge.mts');
    // The census is not the only side that grew: the named-function oracle walks
    // into subdirectories too, so a nested module is a subject AND a body list.
    expect(independentNamedFunctions(dir).length).toBeGreaterThan(
      independentNamedFunctions(SERVICE_DIR).length
    );
    // And the plant inside it is an offender, which is the point of reading it.
    expect(illegalOffenders(modules.flatMap((scanned) => scanned.offenders))).toEqual([
      ...plantHits('plantedNested'),
      ...plantHits('plantedOtherExtension')
    ]);
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
