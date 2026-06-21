/**
 * Production Stryker invoker. Uses @stryker-mutator/core programmatic API.
 * Note: this is a thin wrapper — actual Stryker invocation requires the
 * Stryker config in `stryker.conf.js` to live at the project root.
 */
import type { StrykerInvoker, StrykerRawResult } from './mut-runner.js';

export function createProductionStrykerInvoker(): StrykerInvoker {
  return async ({ project, testFiles }) => {
    // Lazy-load Stryker so unit tests don't need it installed.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Stryker = (await import('@stryker-mutator/core')).Stryker;
    const stryker = new Stryker({
      // Project-rooted config; explicit overrides here are minimal.
      mutate: testFiles as unknown as string[],
      // ... any per-project overrides ...
    });
    const result = await stryker.runMutationTest();
    // Stryker returns a StrykerResult; normalize to our shape.
    return normalize(result, project);
  };
}

function normalize(raw: unknown, _project: string): StrykerRawResult {
  // Stryker result shape varies by version; v8 uses { mutants: [...] }.
  // Production wiring fills this in when first wired.
  const r = raw as { mutants: Array<{ status: string; fileName?: string; location?: { start?: { line?: number } } }> };
  const mutants = r.mutants ?? [];
  return {
    mutantsTotal: mutants.length,
    mutantsKilled: mutants.filter((m) => m.status === 'Killed').length,
    mutantsSurvived: mutants.filter((m) => m.status === 'Survived').length,
    mutantsTimeout: mutants.filter((m) => m.status === 'Timeout').length,
    perFile: [], // populated from mutants in production wiring
  };
}
