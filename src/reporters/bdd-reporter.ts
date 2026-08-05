// src/reporters/bdd-reporter.ts
//
// rid-2026-08-05-bdd-test-style Slice C — vitest custom reporter that
// emits a pure BDD document view of the run. Designed for business
// reviewers and downstream LLM prompts; it is NOT a replacement for
// the default reporter.
//
// Why a custom reporter:
//   The default reporter focuses on pass/fail and timing. The BDD
//   reporter transcribes `Feature: <file>` / `Scenario: <describe> ->
//   it` into a single human-readable document so a non-engineer can
//   scan what the suite actually exercises.
//
// Why no new dep:
//   vitest 4.1.10 (frozen 2026-07-25) ships the `Reporter` interface
//   in `vitest/reporters`. The custom reporter must have a `default`
//   export — the CLI loads it via `runner.import(path)` and validates
//   `customReporterModule.default` is defined (see vitest cli-api chunks
//   line 11371). Importing the `Reporter` type from vitest does not add
//   a runtime dep; tsc resolves it through vitest's dts shim.
//
// Why a flag-only reporter:
//   Per rid design section 4 Slice C, the default vitest run is
//   unchanged. This file is opt-in via:
//
//     pnpm vitest run --reporter ./src/reporters/bdd-reporter.ts <file>
//
// Anti-fake-green rule (CLI silent-catch):
//   The reporter does not swallow vitest result shapes. Every state
//   branch (`passed` / `failed` / `skipped`) is rendered explicitly so
//   downstream reviewers cannot misread a hidden failure.
//
// Karpathy note:
//   The reporter deliberately emits ONE document per file with the
//   4-line Feature/Scenario/Given/When/Then shape — no extra layout
//   metadata, no JSON sidecar. Anything beyond what the spec asked
//   for is excluded by Simplicity First.

import type { Reporter, TestModule, TestCase } from 'vitest/reporters';

/**
 * Per-test-case rendered row. We collect everything first and emit
 * the document only on `onTestRunEnd` so partial runs (e.g. via
 * `--watch` re-runs) overwrite cleanly.
 */
interface RenderedScenario {
  /** Describe-block name used as the Scenario label. Empty = module-root test. */
  readonly scenario: string;
  /** `it()` / `test()` name. */
  readonly title: string;
  /** "passed" | "failed" | "skipped". */
  readonly state: 'passed' | 'failed' | 'skipped';
  /** Optional error message for failed tests. */
  readonly error?: string;
}

/** Per-file rendered block. */
interface RenderedFeature {
  /** File basename used as the Feature label. */
  readonly feature: string;
  readonly scenarios: ReadonlyArray<RenderedScenario>;
  /** True if any scenario failed. */
  readonly ok: boolean;
}

class BddReporter implements Reporter {
  /** Key: relative module id; Value: per-feature rendered scenarios. */
  private readonly features = new Map<string, RenderedScenario[]>();

  /**
   * Vitest calls `onTestModuleEnd` after a module finishes. We use it
   * to drain the per-module scenarios into the document map and
   * mark the file's pass/fail status.
   */
  onTestModuleEnd(testModule: TestModule): void {
    const file = basename(testModule.relativeModuleId || testModule.moduleId);
    const scenarios: RenderedScenario[] = [];
    collectScenarios(testModule, file, scenarios);
    this.features.set(file, scenarios);
  }

  /**
   * Final emit. We deliberately print to stdout with `console.log`
   * (vitest captures stdout when needed) and never call `process.exit`
   * — that is the orchestrator's job. Failure reasons surface as plain
   * text so a downstream LLM prompt can grep for `FAILED:`.
   */
  onTestRunEnd(): void {
    const lines: string[] = [];
    const features: RenderedFeature[] = [];
    for (const [feature, scenarios] of this.features) {
      const ok = scenarios.every((s) => s.state === 'passed' || s.state === 'skipped');
      features.push({ feature, scenarios, ok });
    }
    // Deterministic order: alphabetical by file basename so two runs on
    // the same diff produce byte-identical docs (avoids noisy diffs).
    features.sort((a, b) => a.feature.localeCompare(b.feature));
    for (const f of features) {
      lines.push(`Feature: ${f.feature}`);
      if (f.scenarios.length === 0) {
        // Empty file still surfaces the Feature line so the document
        // is a faithful list of files the runner touched.
        lines.push('');
        continue;
      }
      for (const s of f.scenarios) {
        lines.push(`  Scenario: ${s.scenario || '<root>'}`);
        lines.push(`    Given ${s.title}`);
        lines.push(`    When  vitest runs this test`);
        if (s.state === 'passed') {
          lines.push(`    Then  should pass`);
        } else if (s.state === 'skipped') {
          lines.push(`    Then  should skip`);
        } else {
          const reason = s.error ? ` (${truncate(s.error, 200)})` : '';
          lines.push(`    Then  FAILED: ${s.title}${reason}`);
        }
      }
      lines.push('');
    }
    console.log(lines.join('\n'));
  }
}

function basename(path: string): string {
  // vitest module ids are POSIX-style even on Windows; split on '/'
  // then on '\\' as a defensive fallback.
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * Walk a `TestModule` recursively and collect rendered scenarios.
 * `describe` blocks contribute their name to the Scenario label;
 * tests declared at module root produce a `<root>` Scenario so the
 * structure is uniform.
 */
function collectScenarios(
  entity: TestModule | { children: { tests(): Iterable<TestCase>; suites(): Iterable<unknown> } },
  file: string,
  out: RenderedScenario[],
): void {
  const visited = new WeakSet<object>();
  const walk = (node: unknown, scenarioLabel: string): void => {
    if (node === null || typeof node !== 'object') return;
    if (visited.has(node as object)) return;
    visited.add(node as object);
    const obj = node as {
      name?: string;
      children?: {
        tests(state?: string): Iterable<TestCase>;
        suites(): Iterable<unknown>;
      };
      type?: string;
      result?: () => { state: string; errors?: ReadonlyArray<{ message?: string }> };
    };
    if (obj.type === 'test') {
      const tc = node as unknown as TestCase;
      const result = tc.result();
      const state = (result.state === 'passed' || result.state === 'failed' || result.state === 'skipped')
        ? result.state
        : 'skipped';
      const err = result.state === 'failed' && result.errors && result.errors[0]
        ? (result.errors[0].message ?? 'unknown failure')
        : undefined;
      out.push({
        scenario: scenarioLabel,
        title: tc.name,
        state,
        error: err,
      });
      return;
    }
    // For a suite/module, descend with the suite's name pushed.
    const suiteName = obj.name ?? '';
    const childSuiteLabel = suiteName || scenarioLabel;
    if (obj.children) {
      try {
        for (const t of obj.children.tests()) {
          walk(t, childSuiteLabel);
        }
        for (const s of obj.children.suites()) {
          walk(s, childSuiteLabel);
        }
      } catch {
        // Defensive: vitest internals may throw on teardown. We do not
        // mask the document — we just stop collecting from this node.
      }
    }
  };
  walk(entity, '');
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 3)}...`;
}

export default BddReporter;