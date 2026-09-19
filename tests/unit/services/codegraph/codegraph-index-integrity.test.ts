// tests/unit/services/codegraph/codegraph-index-integrity.test.ts
//
// 4-dimension unit test for the read-only index-integrity inspector
// (slice-001 of rid-2026-09-16-codegraph-index-integrity).
//
// The defect this guards: the exclude gate runs the `include` filter FIRST
// and never reads the index, so (①) a git-tracked file whose extension
// upstream's extractor supports but whose path `include` does not admit is
// silently absent from the index, and (②) the index keeps rows for paths
// that no longer exist — and `peaks codegraph status` printed
// `[OK] Index is up to date` over both.
//
// Controls (this repo's standard, non-negotiable):
//   - INJECTION control: each axis is injected independently and the guard
//     must report it, with the other axis held at zero so a guard that
//     reports "something" cannot be mistaken for a guard that reports
//     THIS.
//   - CLEAN control: on a defect-free input the guard reports no gap at
//     all and RENDERS NOTHING — a probe that always says "caught" is
//     indistinguishable from a working guard.
//
// Dimensions covered:
//   - behavior:    both axes, independently and together, plus the clean case
//   - render:      the human lines name the axis, the counts and a concrete path
//   - integration: the real upstream grammar oracle (`detectLanguage` +
//                  `isLanguageSupported`) against the real installed package
//   - a11y:        `[OK]`-suppressing contract — the report is non-empty
//                  exactly when `gap` is true, so nothing can print "fine"
//                  over a gap
//
// Run with: pnpm vitest run tests/unit/services/codegraph/codegraph-index-integrity.test.ts

import { describe, expect, it } from 'vitest';

import {
  CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE,
  CODEGRAPH_INDEX_STRICT_ENV_VAR,
  CODEGRAPH_INDEX_UNEVALUABLE_EXIT_CODE,
  codegraphIndexIntegrityExitCode,
  inspectCodegraphIndexIntegrityFrom,
  isCodegraphIndexStrictMode,
  renderCodegraphIndexIntegrityLines,
  resolveCodegraphIndexIntegrityVerdict,
  upstreamSupportsPath,
  type CodegraphIndexIntegrityInput,
  type CodegraphIndexIntegrityReport
} from '~/src/services/codegraph/codegraph-index-integrity';
import { CODEGRAPH_INTEGRITY_EXIT_CODE } from '~/src/services/codegraph/codegraph-exclude-integrity';
import {
  filterAdmittedTrackedFiles,
  reconcileCodegraphExclude
} from '~/src/services/codegraph/codegraph-exclude-reconciler';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions('tests/unit/services/codegraph/codegraph-index-integrity.test.ts', [
  'behavior',
  'render',
  'integration',
  'a11y'
]);

// The fixture mirrors the real shape of the defect: an `include` list that
// admits `.ts` but not `.mjs`, one tracked `.mjs` the extractor DOES
// support, one tracked `.md` it does NOT, and one index row whose file is
// gone. Nothing here is peaks-loop-specific — this is any project.
const BASE: CodegraphIndexIntegrityInput = {
  configPath: '/proj/.codegraph/config.json',
  databasePath: '/proj/.codegraph/codegraph.db',
  trackedFiles: ['src/ok.ts', 'scripts/tool.mjs', 'README.md'],
  include: ['**/*.ts'],
  indexedPaths: ['src/ok.ts'],
  // Stands in for upstream's oracle: `.ts`/`.mjs` are supported, `.md` is not.
  supportsPath: (filePath) => filePath.endsWith('.ts') || filePath.endsWith('.mjs'),
  pathExists: () => true
};

function withInput(overrides: Partial<CodegraphIndexIntegrityInput>): CodegraphIndexIntegrityInput {
  return { ...BASE, ...overrides };
}

// ── behavior: the CLEAN control ──────────────────────────────────────

describe('inspectCodegraphIndexIntegrityFrom (clean control)', () => {
  it('on a defect-free input, should report no gap on either axis', () => {
    const report = inspectCodegraphIndexIntegrityFrom(
      withInput({ trackedFiles: ['src/ok.ts'], include: ['**/*.ts'], indexedPaths: ['src/ok.ts'] })
    );

    expect(report.gap).toBe(false);
    expect(report.includeGap).toEqual([]);
    expect(report.deadRows).toEqual([]);
    expect(report.trackedSourceCount).toBe(1);
    expect(report.admittedTrackedCount).toBe(1);
    expect(report.indexedFileCount).toBe(1);
  });

  it('on a clean input, should render nothing so no caller can print a gap', () => {
    const report = inspectCodegraphIndexIntegrityFrom(
      withInput({ trackedFiles: ['src/ok.ts'], include: ['**/*.ts'], indexedPaths: ['src/ok.ts'] })
    );

    expect(renderCodegraphIndexIntegrityLines(report, false)).toEqual([]);
    expect(renderCodegraphIndexIntegrityLines(report, true)).toEqual([]);
  });

  it('should not count a file the extractor does not support as a gap', () => {
    // `README.md` is not admitted by `include`, but upstream would never
    // ingest it either — reporting it would be a false positive that
    // drowns the real finding.
    const report = inspectCodegraphIndexIntegrityFrom(BASE);

    expect(report.includeGap).toEqual(['scripts/tool.mjs']);
    expect(report.trackedSourceCount).toBe(2); // ok.ts + tool.mjs, not README.md
  });
});

// ── behavior: INJECTION control, axis ① ──────────────────────────────

describe('inspectCodegraphIndexIntegrityFrom (include-axis injection)', () => {
  it('when a supported tracked file is not admitted, should report the include gap', () => {
    const report = inspectCodegraphIndexIntegrityFrom(BASE);

    expect(report.gap).toBe(true);
    expect(report.includeGap).toEqual(['scripts/tool.mjs']);
    expect(report.deadRows).toEqual([]); // the other axis stays at zero
  });

  it('when include is widened to admit the file, should go clean', () => {
    // The control's inverse: the SAME input with only the defect removed.
    const report = inspectCodegraphIndexIntegrityFrom(
      withInput({ include: ['**/*.ts', '**/*.mjs'] })
    );

    expect(report.includeGap).toEqual([]);
    expect(report.gap).toBe(false);
  });
});

// ── behavior: INJECTION control, axis ② ──────────────────────────────

describe('inspectCodegraphIndexIntegrityFrom (staleness injection)', () => {
  it('when the index holds a row for a missing file, should report the dead row', () => {
    const report = inspectCodegraphIndexIntegrityFrom(
      withInput({
        trackedFiles: ['src/ok.ts'],
        include: ['**/*.ts'],
        indexedPaths: ['src/ok.ts', 'src/deleted.ts'],
        pathExists: (p) => p !== 'src/deleted.ts'
      })
    );

    expect(report.gap).toBe(true);
    expect(report.deadRows).toEqual(['src/deleted.ts']);
    expect(report.includeGap).toEqual([]); // the other axis stays at zero
    expect(report.indexedFileCount).toBe(2);
  });

  it('when the dead row is dropped from the index, should go clean', () => {
    const report = inspectCodegraphIndexIntegrityFrom(
      withInput({ trackedFiles: ['src/ok.ts'], include: ['**/*.ts'], indexedPaths: ['src/ok.ts'] })
    );

    expect(report.deadRows).toEqual([]);
    expect(report.gap).toBe(false);
  });
});

// ── behavior: both axes at once ──────────────────────────────────────

describe('inspectCodegraphIndexIntegrityFrom (both axes)', () => {
  it('should report both axes independently when both are present', () => {
    const report = inspectCodegraphIndexIntegrityFrom(
      withInput({
        indexedPaths: ['src/ok.ts', 'src/deleted.ts'],
        pathExists: (p) => p !== 'src/deleted.ts'
      })
    );

    expect(report.includeGap).toEqual(['scripts/tool.mjs']);
    expect(report.deadRows).toEqual(['src/deleted.ts']);
    expect(report.gap).toBe(true);
  });

  it('should tolerate Windows separators in both directions', () => {
    const report = inspectCodegraphIndexIntegrityFrom(
      withInput({
        trackedFiles: ['src\\ok.ts', 'scripts\\tool.mjs'],
        indexedPaths: ['src\\ok.ts', 'src\\deleted.ts'],
        pathExists: (p) => p !== 'src/deleted.ts'
      })
    );

    expect(report.includeGap).toEqual(['scripts/tool.mjs']);
    expect(report.deadRows).toEqual(['src/deleted.ts']);
  });
});

// ── render ───────────────────────────────────────────────────────────

describe('renderCodegraphIndexIntegrityLines', () => {
  it('should name each axis, its counts and a concrete path', () => {
    const report = inspectCodegraphIndexIntegrityFrom(
      withInput({
        indexedPaths: ['src/ok.ts', 'src/deleted.ts'],
        pathExists: (p) => p !== 'src/deleted.ts'
      })
    );

    const lines = renderCodegraphIndexIntegrityLines(report, true).join('\n');

    expect(lines).toContain('[FAIL] codegraph index does not cover the repository');
    expect(lines).toContain('not admitted: scripts/tool.mjs');
    expect(lines).toContain('stale: src/deleted.ts');
    // The exit-code contract lives elsewhere; the text must not claim it.
    expect(lines).not.toContain('[OK]');
  });

  it('should tag the same gap [WARN] when advisory and name the opt-in switch', () => {
    // User decision (option C): advisory by default. The TAG carries the
    // policy, not the finding — the wording after it is identical, so the
    // operator still sees exactly which defect they have.
    const report = inspectCodegraphIndexIntegrityFrom(BASE);
    const advisory = renderCodegraphIndexIntegrityLines(report, false);

    expect(advisory[0]).toContain('[WARN] codegraph index does not cover the repository');
    expect(advisory[0]).not.toContain('[FAIL]');
    // Byte-identical finding text either side of the tag.
    expect(advisory[0]?.replace('[WARN]', '[FAIL]')).toBe(
      renderCodegraphIndexIntegrityLines(report, true)[0]
    );
    // The switch is discoverable from the output, not only from the docs.
    expect(advisory.join('\n')).toContain('PEAKS_CODEGRAPH_INDEX_STRICT=1');
    expect(advisory.join('\n')).toContain(String(CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE));
  });

  it('should elide past the per-axis cap instead of printing every path', () => {
    const many = Array.from({ length: 25 }, (_, i) => `src/gen-${String(i)}.ts`);
    const report = inspectCodegraphIndexIntegrityFrom(
      withInput({
        trackedFiles: ['src/ok.ts'],
        include: ['**/*.ts'],
        indexedPaths: many,
        pathExists: (p) => p === 'src/ok.ts'
      })
    );

    const lines = renderCodegraphIndexIntegrityLines(report, true);

    expect(lines.some((line) => line.includes('… and 15 more stale row(s)'))).toBe(true);
    expect(lines.filter((line) => line.startsWith('  stale: ')).length).toBe(10);
  });
});

// ── integration: the real upstream oracle ────────────────────────────

describe('upstreamSupportsPath (real installed @colbymchenry/codegraph)', () => {
  it("should answer from upstream's own grammar data, not a hardcoded list", () => {
    // `.mjs` / `.cjs` are the two the default `include` template omits;
    // they must be supported, or the include-axis gap is config-only and
    // the whole gate has nothing to report.
    expect(upstreamSupportsPath('scripts/tool.mjs')).toBe(true);
    expect(upstreamSupportsPath('config/x.cjs')).toBe(true);
    expect(upstreamSupportsPath('src/a.ts')).toBe(true);

    // And the negative side, so a probe that always answers `true` cannot
    // pass this file.
    expect(upstreamSupportsPath('README.md')).toBe(false);
    expect(upstreamSupportsPath('data.json')).toBe(false);
  });
});

// ── integration: AC6 as a cross-module counting identity (QA-03) ─────

describe("the two reports' `trackedSourceCount` (QA-03, corrected)", () => {
  // QA-03 as first written was unsatisfiable and its note was inverted: it
  // claimed the identity holds under a permissive oracle (`() => true`).
  // Measured, it is the reverse. Both reports use the SAME field name for
  // two DIFFERENT predicates — the exclude report's count is |admitted by
  // `include`|, the index report's is |supported by the extractor| — so a
  // permissive oracle INFLATES the index-side number by admitting files
  // `include` legitimately withheld from the index (2 against 1 below).
  //
  // The identity is real but CONDITIONAL, and the conditions are the point:
  // `include` must admit every tracked file AND the oracle must reject
  // nothing. Both halves are asserted, plus the divergence that gives the
  // case its teeth — without it, an always-equal implementation would pass.
  const TRACKED = ['src/ok.ts', 'scripts/tool.mjs'];

  it('should agree once `include` admits everything and the oracle rejects nothing', () => {
    const reconciled = reconcileCodegraphExclude({
      trackedFiles: TRACKED,
      include: ['**/*'],
      exclude: []
    });
    const filtered = filterAdmittedTrackedFiles(TRACKED, ['**/*']);
    const inspected = inspectCodegraphIndexIntegrityFrom(
      withInput({
        trackedFiles: TRACKED,
        include: ['**/*'],
        indexedPaths: [],
        supportsPath: () => true
      })
    );

    // 2 = every tracked file, which is what both predicates reduce to here.
    expect(reconciled.trackedSourceCount).toBe(2);
    expect(filtered.length).toBe(2);
    expect(inspected.trackedSourceCount).toBe(2);
    expect(inspected.includeGap).toEqual([]);
  });

  it('should diverge as soon as `include` drops a file the oracle would support', () => {
    const reconciled = reconcileCodegraphExclude({
      trackedFiles: TRACKED,
      include: ['**/*.ts'],
      exclude: []
    });
    const inspected = inspectCodegraphIndexIntegrityFrom(
      withInput({
        trackedFiles: TRACKED,
        include: ['**/*.ts'],
        indexedPaths: [],
        supportsPath: () => true
      })
    );

    // The measurement QA recorded: exclude 1, index 2 — the include gap is
    // ADMITTED by the permissive oracle, not erased by it.
    expect(reconciled.trackedSourceCount).toBe(1);
    expect(inspected.trackedSourceCount).toBe(2);
    expect(inspected.includeGap).toEqual(['scripts/tool.mjs']);
  });
});

// ── a11y: the verdict + exit-code contract ───────────────────────────

describe('resolveCodegraphIndexIntegrityVerdict', () => {
  const report = (gap: boolean): CodegraphIndexIntegrityReport => ({
    ...inspectCodegraphIndexIntegrityFrom(BASE),
    gap
  });

  it('should keep "clean" and "gap" apart', () => {
    expect(resolveCodegraphIndexIntegrityVerdict(report(false), null)).toBe('clean');
    expect(resolveCodegraphIndexIntegrityVerdict(report(true), null)).toBe('gap');
  });

  it('should give "could not evaluate" its own verdict, not clean and not not-applicable', () => {
    // The defect this replaces: `null` + no warning meant "there is no
    // index here", and an unreadable index ALSO produced `null` — so
    // "I could not check" was reported identically to "nothing to check".
    expect(resolveCodegraphIndexIntegrityVerdict(null, 'no such table: files')).toBe(
      'not-evaluated'
    );
    expect(resolveCodegraphIndexIntegrityVerdict(null, null)).toBe('not-applicable');
    expect(resolveCodegraphIndexIntegrityVerdict(report(true), 'boom')).toBe('not-evaluated');
  });
});

describe('codegraphIndexIntegrityExitCode', () => {
  it('should not fail the command on a detected gap in advisory mode', () => {
    expect(codegraphIndexIntegrityExitCode('gap', false)).toBeNull();
  });

  it('should use the index-gap code on a detected gap in strict mode', () => {
    expect(codegraphIndexIntegrityExitCode('gap', true)).toBe(CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE);
  });

  it('should give "not evaluated" a non-zero code IN EVERY MODE', () => {
    // The load-bearing assertion for R1(b): advisory is a policy about a
    // FINDING, and "I could not check" is not a finding. If this returned
    // null in advisory mode, the unmeasured axis would exit as "fine".
    for (const strict of [false, true]) {
      expect(codegraphIndexIntegrityExitCode('not-evaluated', strict)).toBe(
        CODEGRAPH_INDEX_UNEVALUABLE_EXIT_CODE
      );
      expect(codegraphIndexIntegrityExitCode('not-evaluated', strict)).not.toBe(0);
      expect(codegraphIndexIntegrityExitCode('not-evaluated', strict)).not.toBe(
        codegraphIndexIntegrityExitCode('gap', strict) ?? -1
      );
    }
  });

  it('should leave the exit code alone when the axis is clean or not applicable', () => {
    expect(codegraphIndexIntegrityExitCode('clean', false)).toBeNull();
    expect(codegraphIndexIntegrityExitCode('clean', true)).toBeNull();
    expect(codegraphIndexIntegrityExitCode('not-applicable', false)).toBeNull();
    expect(codegraphIndexIntegrityExitCode('not-applicable', true)).toBeNull();
  });
});

describe('isCodegraphIndexStrictMode', () => {
  it('should be advisory unless the project opts in', () => {
    expect(isCodegraphIndexStrictMode({})).toBe(false);
    expect(isCodegraphIndexStrictMode({ [CODEGRAPH_INDEX_STRICT_ENV_VAR]: '' })).toBe(false);
    expect(isCodegraphIndexStrictMode({ [CODEGRAPH_INDEX_STRICT_ENV_VAR]: '0' })).toBe(false);
    expect(isCodegraphIndexStrictMode({ [CODEGRAPH_INDEX_STRICT_ENV_VAR]: 'yes' })).toBe(false);
    expect(isCodegraphIndexStrictMode({ [CODEGRAPH_INDEX_STRICT_ENV_VAR]: '1' })).toBe(true);
    expect(isCodegraphIndexStrictMode({ [CODEGRAPH_INDEX_STRICT_ENV_VAR]: 'true' })).toBe(true);
  });
});

describe('index-integrity exit code', () => {
  it("should be non-zero and distinct from the exclude gate's code", () => {
    expect(CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE).not.toBe(0);
    expect(CODEGRAPH_INDEX_INTEGRITY_EXIT_CODE).not.toBe(CODEGRAPH_INTEGRITY_EXIT_CODE);
  });
});
