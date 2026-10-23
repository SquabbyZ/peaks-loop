// tests/unit/standards/_bdd-test-style-scan.ts
//
// The scan machinery behind `tests/unit/standards/bdd-test-style-ratchet.test.ts`
// — the shrink-only ratchet for the BDD test-style contract.
//
// THE DEBT THIS LOCKS. `src/services/qa/bdd-test-style-verifier.ts` checks the
// contract in `contracts/test-style-contract.md`: an `it()` / `test()` description
// must read `when X, should Y`, and the callback body must start with exactly
// `// given:` / `// when:` / `// then:`. The checker existed and NOTHING called it
// from CI, so it rotted. Measured 2026-10-23 over the tracked `tests/**/*.test.ts`
// population: 691 files, of which 92 conform and 599 do not.
//
// WHY A RECORDED BASELINE AND NOT A ZERO FLOOR. A zero floor would fail on the
// tree this slice was written against, so it could never be committed. The
// baseline is the implementation-time measurement and the RATCHET DIRECTION is
// the mechanism: the only way the number moves is DOWN (fix a file and shrink its
// entry) or sideways behind a deliberate, reviewable baseline edit.
//
// EVERY VERDICT COMES FROM THE REAL CHECKER. This library never re-implements
// the contract: `verifyBddStyle` from `src/services/qa/bdd-test-style-verifier.ts`
// decides whether a file violates, and it also decides whether an individual
// `it()` / `test()` call violates (a call is measured by writing that call alone
// into a scratch file and asking the same checker). The only thing this file
// computes on its own is WHERE the calls are — the TypeScript AST walk — which
// decides what to measure, never whether it violates.
//
// This is a scan LIBRARY, not a test file: it has no `.test.ts` suffix, so the
// unit config (`include: tests/unit/**/*.test.ts`) does not collect it. The
// assertion half — including the control arms that prove this detector can
// fail — lives in the ratchet test.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import ts from 'typescript';

import {
  verifyBddStyle,
  type BddStyleFailureReason
} from '~/src/services/qa/bdd-test-style-verifier';

/** One tracked test file that violates the contract, and by how much. */
export interface BddStyleFileViolation {
  /** Repo-relative, POSIX separators. */
  readonly path: string;
  /** How many `it()` / `test()` calls in this file violate the contract. */
  readonly violations: number;
  /** The checker's reason for the FIRST violation in this file. */
  readonly reason: BddStyleFailureReason;
  /** The checker's line for the FIRST violation in this file. */
  readonly line: number;
}

/** One recorded violating file. */
export interface BddStyleBaselineEntry {
  /** Repo-relative, POSIX separators. */
  readonly path: string;
  /** How many violating calls the file had when the baseline was recorded. */
  readonly violations: number;
  /** The checker's reason for the first violation when the baseline was recorded. */
  readonly reason: BddStyleFailureReason;
  /** The checker's line for the first violation when the baseline was recorded. */
  readonly line: number;
}

/** The recorded baseline. */
export interface BddStyleBaseline {
  readonly version: number;
  readonly generatedAt: string;
  readonly note: string;
  readonly scope: {
    readonly dirs: readonly string[];
    readonly pattern: string;
  };
  readonly totals: {
    /** How many files violate the contract. */
    readonly violatingFiles: number;
    /** How many violating `it()` / `test()` calls the violating files hold. */
    readonly violations: number;
  };
  readonly files: readonly BddStyleBaselineEntry[];
}

/**
 * The three ways a measured population may disagree with the baseline.
 *
 * `unblessed` — a file violates the contract and the baseline does not record it.
 * `count-mismatch` — a recorded file's violating-call count changed.
 * `stale` — a recorded file no longer violates the contract at all.
 */
export type BddStyleBaselineViolation =
  | {
      readonly kind: 'unblessed';
      readonly path: string;
      readonly violations: number;
      readonly reason: BddStyleFailureReason;
      readonly line: number;
    }
  | {
      readonly kind: 'count-mismatch';
      readonly path: string;
      readonly violations: number;
      readonly expected: number;
    }
  | {
      readonly kind: 'stale';
      readonly path: string;
      readonly violations: number;
    };

/**
 * The tracked test files the ratchet measures — exactly `git ls-files`, no
 * untracked files, so a scratch file cannot red the suite.
 */
export function trackedTestFiles(repoRoot: string): string[] {
  const listed = execFileSync('git', ['ls-files', '-z', '--', 'tests'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    // Repo standard: every child_process call site pins this, or Windows flashes
    // a console window (tests/unit/spawn-windows-hide-guard.test.ts).
    windowsHide: true
  });
  return listed
    .split('\u0000')
    .filter((path) => path.endsWith('.test.ts'))
    .sort();
}

/**
 * How many of a file's `it()` / `test()` calls violate the contract.
 *
 * Each call is measured ALONE, by writing it into a scratch file and asking the
 * real checker. A call in isolation has the same description and the same
 * callback body as it has in its file, and the contract reads exactly those two
 * things, so the isolated verdict is the in-file verdict.
 */
function countViolatingCalls(repoRoot: string, rel: string, scratchFile: string): number {
  const source = readFileSync(join(repoRoot, rel), 'utf8');
  const sourceFile = ts.createSourceFile(
    rel,
    source,
    ts.ScriptTarget.ESNext,
    /* setParentNodes */ true,
    ts.ScriptKind.TS
  );
  const calls: ts.CallExpression[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && (callee.text === 'it' || callee.text === 'test')) {
        calls.push(node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  let violations = 0;
  for (const call of calls) {
    writeFileSync(scratchFile, `${call.getText(sourceFile)}\n`, 'utf8');
    const verdict = verifyBddStyle({
      projectRoot: dirname(scratchFile),
      testFiles: [basename(scratchFile)]
    });
    if (!verdict.ok) violations += 1;
  }
  return violations;
}

/**
 * The measured population: every tracked test file that violates the contract,
 * with the number of violating calls it holds.
 *
 * A conforming file is absent from the map — that is what makes a recorded
 * entry that no longer violates detectable as `stale`.
 */
export function buildBddStylePopulation(repoRoot: string): Map<string, BddStyleFileViolation> {
  const population = new Map<string, BddStyleFileViolation>();
  // The scratch tree lives OUTSIDE the repository: a fixture inside `tests/`
  // would move the very population this gate measures.
  const scratch = mkdtempSync(join(tmpdir(), 'peaks-bdd-style-'));
  const scratchFile = join(scratch, 'call.ts');
  try {
    for (const rel of trackedTestFiles(repoRoot)) {
      const verdict = verifyBddStyle({ projectRoot: repoRoot, testFiles: [rel] });
      if (verdict.ok) continue;
      population.set(rel, {
        path: rel,
        violations: countViolatingCalls(repoRoot, rel, scratchFile),
        reason: verdict.reason,
        line: verdict.line
      });
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
  return population;
}

/**
 * Compare a measured population with the recorded baseline. Pure, so the ratchet
 * test can watch every failure direction with a synthetic population instead of
 * editing the real tree.
 */
export function compareBaseline(
  population: ReadonlyMap<string, BddStyleFileViolation>,
  baseline: BddStyleBaseline
): BddStyleBaselineViolation[] {
  const violations: BddStyleBaselineViolation[] = [];
  const blessed = new Map(baseline.files.map((entry) => [entry.path, entry]));

  for (const [path, file] of population) {
    const entry = blessed.get(path);
    if (entry === undefined) {
      violations.push({
        kind: 'unblessed',
        path,
        violations: file.violations,
        reason: file.reason,
        line: file.line
      });
    } else if (entry.violations !== file.violations) {
      violations.push({
        kind: 'count-mismatch',
        path,
        violations: file.violations,
        expected: entry.violations
      });
    }
  }

  for (const entry of baseline.files) {
    if (!population.has(entry.path)) {
      violations.push({ kind: 'stale', path: entry.path, violations: 0 });
    }
  }

  return violations;
}
