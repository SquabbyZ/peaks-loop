// tests/unit/final-review/final-review-guard-teeth.test.ts
//
// R-B (repair cycle 1 of §2.28): the four attacks an out-of-band review landed
// on guard C AFTER C wave 8 had made it green, each reproduced here as a
// fixture against a `mkdtempSync` copy of the guarded directory, plus the two
// second-copy smells the same review filed (the guarded directory spelled twice,
// and a delivery decision at module top level).
//
// Every arm runs against the scanner guard C actually uses
// (`./final-review-guard-c-scan.ts`), never against a copy of it. Nothing is
// written inside `src/services/final-review/` or anywhere else in the repository:
// each mutation lives in a temporary tree that `afterAll` deletes, which is also
// why the subject-coverage arm for the CALL-SITE attack lives in
// `final-review-service-fact-states-and-guard.test.ts` — a filter inserted at
// guard C's own call site can only be observed from inside its `describe`.

import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import {
  DELIVERY_PREDICATE,
  GUARDED_DIR,
  SCAN_EXTENSIONS,
  definitionCount,
  illegalOffenders,
  labelledOffenders,
  moduleLevelProxyRegions,
  predicateHomeViolations,
  scanModuleSet
} from './final-review-guard-c-scan.js';
import { FILE_SIZE_SCOPE_EXTENSIONS } from '../../../src/services/scan/file-size-policy.js';

/** The parent module, i.e. the file `isDelivered` lives in today. */
const PARENT = 'final-review-service.ts';

/** A proxy in a named function, in the shape the real ones take. */
const PLANT = (fn: string): string =>
  `\nexport function ${fn}(item: { status: string }): boolean {\n  return item.status === 'found';\n}\n`;

/**
 * What one `status` plant scores: two offenders, because `PROXIES` lists
 * `=== 'found'` and `!== 'found'` as two named fakes over one shared pattern.
 */
const plantHits = (owner: string): readonly string[] => [
  `${owner} uses status === 'found'`,
  `${owner} uses status !== 'found'`
];

/** A delivery decision made OUTSIDE any function, at module top level. */
const MODULE_LEVEL_PLANT = `\nexport const gatesTopLevelDelivery = rows[0].status === 'found';\n`;

/** A second `isDelivered`, shadowed inside the parent's own `isDelivered` body. */
const SHADOW_PLANT = `\n  const isDelivered = (inner: { status: string }): boolean => inner.status === 'found';\n`;

const created: string[] = [];

/**
 * A whole-tree copy of the guarded directory (every file, every extension, every
 * subdirectory) under `mkdtempSync`, with the requested plants applied.
 */
function copyGuarded(options: {
  readonly mts?: boolean;
  readonly subdir?: boolean;
  readonly moduleLevel?: boolean;
  readonly shadow?: boolean;
  readonly inTo?: string;
}): string {
  const root = mkdtempSync(join(tmpdir(), 'guardc-teeth-'));
  created.push(root);
  const dir = join(root, 'final-review');
  cpSync(GUARDED_DIR, dir, { recursive: true });
  if (options.mts === true) {
    writeFileSync(join(dir, 'final-review-legacy-bridge.mts'), PLANT('bridgeDelivery'), 'utf8');
  }
  if (options.subdir === true) {
    mkdirSync(join(dir, 'delivery'), { recursive: true });
    writeFileSync(
      join(dir, 'delivery', 'final-review-delivery-legacy.ts'),
      PLANT('nestedDelivery'),
      'utf8'
    );
  }
  if (options.moduleLevel === true) {
    const target = join(dir, options.inTo ?? 'final-review-gates.ts');
    writeFileSync(target, `${readFileSync(target, 'utf8')}${MODULE_LEVEL_PLANT}`, 'utf8');
  }
  if (options.shadow === true) {
    const target = join(dir, options.inTo ?? PARENT);
    writeFileSync(
      target,
      readFileSync(target, 'utf8').replace(
        /(export function isDelivered[^\n{]*\{)/,
        `$1${SHADOW_PLANT}`
      ),
      'utf8'
    );
  }
  return dir;
}

/** Every file below `dir`, by path relative to it, `/`-separated. */
function everyFileBelow(dir: string): readonly string[] {
  const out: string[] = [];
  const walk = (here: string, prefix: string): void => {
    for (const entry of readdirSync(here, { withFileTypes: true })) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(here, entry.name), rel);
      else if (entry.isFile()) out.push(rel);
    }
  };
  walk(dir, '');
  return out.sort();
}

/** The illegal offenders a scan of `dir` reports, pooled. */
const pooled = (dir: string): readonly string[] =>
  illegalOffenders(scanModuleSet(dir).flatMap((scanned) => scanned.offenders));

afterAll(() => {
  for (const path of created) rmSync(path, { recursive: true, force: true });
  created.length = 0;
});

describe('guard C teeth — the out-of-band review four attacks (R-B)', () => {
  /**
   * TEETH-1 (attack 1a, RED at `3b3bb00c`): the walk ended in a hard-coded
   * `.ts` literal, so a proxy-bearing module written as `.mts` was not part of
   * guard C's subject at all. `.mts` is not hypothetical —
   * `FILE_SIZE_SCOPE_EXTENSIONS` in `src/services/scan/file-size-policy.ts`
   * publishes seven extensions and the file-size ratchet measures all seven,
   * while the guard measured one.
   */
  it('TEETH-1 scans a proxy-bearing .mts module in the guarded directory', () => {
    const dir = copyGuarded({ mts: true });
    expect(pooled(dir)).toEqual(plantHits('bridgeDelivery'));
    expect(labelledOffenders(scanModuleSet(dir)).join('\n')).toContain(
      'final-review-legacy-bridge.mts: bridgeDelivery'
    );
  });

  /**
   * TEETH-2 (attack 1b, RED at `3b3bb00c`): the walk was one `readdirSync`
   * deep, so a module in a subdirectory of the guarded directory —
   * `final-review/delivery/` is the shape the next split takes — sat outside the
   * subject, and the shrink arm that was built to catch a narrowing subject
   * repeated the same flat rule, so it could not see a subject that had never
   * been wide.
   */
  it('TEETH-2 scans a proxy-bearing module in a subdirectory', () => {
    const dir = copyGuarded({ subdir: true });
    expect(pooled(dir)).toEqual(plantHits('nestedDelivery'));
    expect(scanModuleSet(dir).map((scanned) => scanned.module)).toContain(
      'delivery/final-review-delivery-legacy.ts'
    );
  });

  /**
   * TEETH-3 (RED at `3b3bb00c`): the same hole as a byte count rather than as a
   * plant, so a split that adds NO proxy still cannot leave the guard's subject
   * smaller than the directory it is aimed at.
   */
  it('TEETH-3 reads every byte of every module that is on the directory', () => {
    const dir = copyGuarded({ mts: true, subdir: true });
    const onDisk = everyFileBelow(dir).reduce(
      (total, rel) => total + readFileSync(join(dir, rel), 'utf8').length,
      0
    );
    const read = scanModuleSet(dir).reduce((total, scanned) => total + scanned.bytes, 0);
    expect(read).toBe(onDisk);
    // 149,711 bytes of `.ts` plus the two plants: the flat `.ts` walk stopped at
    // the first number, which is the whole defect in one assertion.
    expect(onDisk).toBeGreaterThan(149_711);
  });

  /**
   * TEETH-4 (RED at `3b3bb00c`): one plant per extension the SHARED POLICY
   * measures, so the walk cannot quietly accept a subset of them again. The
   * `.ts` case is the only one that passed before R-B.
   */
  it('TEETH-4 scans a plant in every extension the file-size policy measures', () => {
    expect(SCAN_EXTENSIONS).toEqual([...FILE_SIZE_SCOPE_EXTENSIONS]);
    const dir = copyGuarded({});
    for (const extension of FILE_SIZE_SCOPE_EXTENSIONS) {
      const name = `final-review-probe-${extension}.${extension}`;
      writeFileSync(join(dir, name), PLANT(`probe${extension}`), 'utf8');
      const modules = scanModuleSet(dir);
      expect(modules.map((scanned) => scanned.module)).toContain(name);
      expect(labelledOffenders(modules).join('\n')).toContain(`${name}: probe${extension}`);
    }
    expect(FILE_SIZE_SCOPE_EXTENSIONS.length).toBeGreaterThanOrEqual(7);
  });

  /**
   * TEETH-5 (RED at `3b3bb00c`): `namedFunctionBodies` recorded function-likes,
   * so a delivery decision sitting at module top level — the shape
   * `const gate = rows[0].status === 'found'` takes — was not an offender at any
   * distance. `moduleLevelProxyRegions` now runs the same patterns over the
   * residue of every top-level statement, and a top-level region can never be
   * sanctioned, because the allow-list is a list of FUNCTION names.
   */
  it('TEETH-5 reports a delivery decision made outside any function', () => {
    const dir = copyGuarded({ moduleLevel: true });
    expect(pooled(dir)).toEqual(plantHits('top-level:gatesTopLevelDelivery'));
    expect(labelledOffenders(scanModuleSet(dir)).join('\n')).toContain(
      "final-review-gates.ts: top-level:gatesTopLevelDelivery uses status === 'found'"
    );
  });

  /**
   * TEETH-6 (RED at `3b3bb00c` in its first form): guard C's predicate-home
   * checks ran at MODULE granularity, so a second, independently-deciding
   * `isDelivered` shadowed inside the parent's own body passed every one of them
   * — the home was still one module, and the offender sweep sanctioned both
   * bodies by name. `definitionCount` was asserted for the allow-list names and
   * never for the predicate, which is the gap `predicateHomeViolations` closes.
   */
  it('TEETH-6 rejects a shadowed second predicate inside the parent body', () => {
    const modules = scanModuleSet(copyGuarded({ shadow: true }));
    expect(predicateHomeViolations(modules)).toContain('isDelivered is defined 2 times, not once');
    // The module-granularity checks the guard made before R-B — all of them
    // still pass on this mutated copy, which is exactly why the count is needed.
    const defining = modules.filter((scanned) =>
      scanned.functions.some((fn) => fn.name === DELIVERY_PREDICATE)
    );
    expect(defining).toHaveLength(1);
    expect(illegalOffenders(modules.flatMap((scanned) => scanned.offenders))).toEqual([]);
    // And the scanner does see the shadow, so this was never a parser limit:
    expect(definitionCount(modules, DELIVERY_PREDICATE)).toBe(2);
  });

  /**
   * TEETH-7 (RED at `3b3bb00c`): the guarded directory was spelled in two test
   * files with no identity assertion, so one spelling could be narrowed while
   * the other kept asserting a wide subject. It is now built once, in the
   * scanner, and this arm counts the spellings across this whole directory.
   */
  it('TEETH-7 builds the guarded directory path in exactly one place', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const sites: string[] = [];
    for (const entry of readdirSync(here).filter((name) => name.endsWith('.ts'))) {
      const source = readFileSync(join(here, entry), 'utf8');
      const hits = source.match(/['"]src['"]\s*,\s*['"]services['"]\s*,\s*['"]final-review['"]/g);
      if (hits !== null) sites.push(...hits.map(() => entry));
    }
    expect(sites).toEqual(['final-review-guard-c-scan.ts']);
    // and that one place points at a real directory holding the subject.
    expect(scanModuleSet(GUARDED_DIR).length).toBeGreaterThanOrEqual(16);
  });

  /**
   * MEASUREMENT (the surface item 5 used to leave unscanned, now counted): every
   * module-level region the widened patterns are applied to, and the number of
   * them that carry a proxy token on the real tree — which must stay 0, and is
   * the number that grows the moment somebody writes a delivery decision at top
   * level.
   */
  it('MEASURE-1 counts the module-level surface it now scans', () => {
    const modules = scanModuleSet(GUARDED_DIR);
    const regions = modules.reduce(
      (total, scanned) =>
        total + moduleLevelProxyRegions(readFileSync(scanned.path, 'utf8')).length,
      0
    );
    expect(regions).toBeGreaterThanOrEqual(69);
    const carrying = modules.filter((scanned) =>
      scanned.offenders.some((entry) => entry.startsWith('top-level:'))
    );
    expect(carrying).toEqual([]);
    expect(illegalOffenders(modules.flatMap((scanned) => scanned.offenders))).toEqual([]);
  });

  /**
   * CONTROL: the arms above are a claim only if the untouched tree stays clean
   * under the same scans. This arm is green at `3b3bb00c` and must stay green,
   * which is what makes the seven arms above tripwires rather than noise.
   */
  it('leaves the untouched copy reporting nothing illegal', () => {
    const dir = copyGuarded({});
    expect(pooled(dir)).toEqual([]);
    expect(predicateHomeViolations(scanModuleSet(dir))).toEqual([]);
    expect(pooled(GUARDED_DIR)).toEqual([]);
    expect(everyFileBelow(GUARDED_DIR)).toHaveLength(16);
  });
});
