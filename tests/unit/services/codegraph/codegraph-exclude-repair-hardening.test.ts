// tests/unit/services/codegraph/codegraph-exclude-repair-hardening.test.ts
//
// Three hardening defects in `src/services/codegraph/codegraph-exclude-repair.ts`
// (slice S1 of rid-2026-09-12-defect-remediation). Each one is a way the
// writer misdescribed or mishandled the third-party file it edits:
//
//   F1 — a single-line (minified) `config.json` came back pretty-printed
//        with two-space indent, contradicting `detectIndent`'s own
//        promise to keep the file's shape. Upstream's default template
//        is pretty, so only a hand-minified config hit this.
//   F2 — `removedRules` was a plain `filter`, so a rule listed twice in
//        `exclude` was COUNTED twice. The dedupe result was right; the
//        count reported to the user (and to the warning text) was not.
//   F3 — the rewrite was copy-then-write (`writeFileSync(configPath, …)`
//        straight onto the target), so a crash or a full disk between
//        the two writes could leave a third-party tool's config
//        truncated. It is now a same-directory temp file + `renameSync`.
//
// This file carries F1 (render) and F2 (behavior). F3 and the atomic-write /
// backup-guard cases (N5, the slice-002 link guard, the two-axis rewrite)
// live in the sibling codegraph-exclude-repair-atomic-write.test.ts (b1
// filesplit campaign); project-root fixtures are shared from
// codegraph-exclude-repair-hardening-support.ts, moved verbatim.
//
// `node:fs` is mocked in this file ONLY to observe and to interrupt the
// rename. `renameSync` is the sole hooked call; everything else is the
// real implementation, and all temp dirs are real.
//
// Dimensions covered:
//   - render:      the serialized config bytes (compact vs indented)
//   - behavior:    `removedRules` dedupe
//   - integration: — the atomic-write sweep lives in the sibling file
//   - a11y:        omitted — no user-facing text or exit code here

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/codegraph/codegraph-exclude-repair-hardening.test.ts',
  ['render', 'behavior'],
  [
    {
      dim: 'integration',
      reason:
        'the atomic-write / backup-guard cases live in codegraph-exclude-repair-atomic-write.test.ts'
    },
    { dim: 'a11y', reason: 'the module returns a plan/outcome; it prints nothing' }
  ]
);

const fsRef = vi.hoisted(() => ({ actual: null as null | typeof import('node:fs') }));

/** Rename observation + one-shot failure injection. */
const renameHook = vi.hoisted(() => ({
  calls: [] as Array<{ from: string; to: string }>,
  failOn: null as null | string,
  armed: false
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  fsRef.actual = actual;
  return {
    ...actual,
    renameSync: (from: unknown, to: unknown): void => {
      const fromPath = String(from);
      const toPath = String(to);
      if (renameHook.armed) {
        renameHook.calls.push({ from: fromPath, to: toPath });
      }
      if (renameHook.armed && renameHook.failOn !== null && toPath === renameHook.failOn) {
        throw Object.assign(new Error('injected rename failure'), { code: 'EPERM' });
      }
      actual.renameSync(fromPath, toPath);
    }
  };
});

import {
  applyCodegraphConfigRepair,
  repairCodegraphExclude
} from '../../../../src/services/codegraph/codegraph-exclude-repair.js';
import {
  configPathOf,
  makeProjectRoot,
  seedConfig,
  cleanupProjectRoots
} from './codegraph-exclude-repair-hardening-support.js';

afterEach(() => {
  renameHook.armed = false;
  renameHook.failOn = null;
  renameHook.calls = [];
  cleanupProjectRoots();
});

// ── F2 — behavior ────────────────────────────────────────────────────

describe('repairCodegraphExclude — removedRules is a set, not a filter', () => {
  it('should count a duplicated rule once', () => {
    const plan = repairCodegraphExclude({
      exclude: ['**/a/**', '**/a/**'],
      rulesToRemove: ['**/a/**']
    });

    expect(plan.changed).toBe(true);
    // Before the fix this was ['**/a/**', '**/a/**'] — length 2.
    expect(plan.removedRules).toEqual(['**/a/**']);
    expect(plan.removedRules.length).toBe(1);
    // The dedupe result itself was already correct.
    expect(plan.exclude).toEqual([]);
  });

  it('should dedupe while keeping config order across several rules', () => {
    const plan = repairCodegraphExclude({
      exclude: ['**/b/**', '**/a/**', '**/b/**', '**/a/**', '**/keep/**'],
      rulesToRemove: ['**/a/**', '**/b/**']
    });

    expect(plan.removedRules).toEqual(['**/b/**', '**/a/**']);
    expect(plan.exclude).toEqual(['**/keep/**']);
  });
});

// ── F1 — render ──────────────────────────────────────────────────────

describe('applyCodegraphConfigRepair — the file keeps its shape', () => {
  it('should leave a single-line (minified) config single-line', () => {
    const projectRoot = makeProjectRoot();
    const original = '{"include":["**/*.ts"],"exclude":["**/vendor/**","**/dist/**"]}\n';
    seedConfig(projectRoot, original);

    const outcome = applyCodegraphConfigRepair(projectRoot, {
      rulesToRemove: ['**/vendor/**'],
      includePatternsToAdd: []
    });

    expect(outcome.applied).toBe(true);
    const after = readFileSync(configPathOf(projectRoot), 'utf8');
    // Before the fix this was pretty-printed with two-space indent.
    expect(after.trimEnd().includes('\n')).toBe(false);
    expect(after).toBe('{"include":["**/*.ts"],"exclude":["**/dist/**"]}\n');
  });

  it('should preserve a non-default indent on a pretty config', () => {
    const projectRoot = makeProjectRoot();
    const original = `${JSON.stringify(
      { include: ['**/*.ts'], exclude: ['**/vendor/**', '**/dist/**'] },
      null,
      4
    )}\n`;
    seedConfig(projectRoot, original);

    applyCodegraphConfigRepair(projectRoot, {
      rulesToRemove: ['**/vendor/**'],
      includePatternsToAdd: []
    });

    const after = readFileSync(configPathOf(projectRoot), 'utf8');
    expect(after).toContain('\n    "exclude"');
    expect(after).toBe(
      `${JSON.stringify({ include: ['**/*.ts'], exclude: ['**/dist/**'] }, null, 4)}\n`
    );
  });
});
