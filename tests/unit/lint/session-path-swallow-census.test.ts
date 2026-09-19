// tests/unit/lint/session-path-swallow-census.test.ts
//
// Repair slice R6 — the part of the deliverable that is a GATE rather than a
// test of one behaviour.
//
// WHY A CENSUS AND NOT A RULE. R4 established that no invariant exists here:
// TS has no checked exceptions, so no rule can make a swallow unwriteable, and
// a rule that tries (prose, or a scanner with a growing allow-list) has no
// fixed point — its residue is every site it cannot yet express, forever. The
// finding that reframes this slice is that **detection already produced a
// list, four times, and nothing acted on it**: R3's site sat on the previous
// enumeration's own list at `auto-compact-lifecycle.ts:342`, frame 3.
//
// So the substitute is not a better list. It is a list that FAILS A TEST.
// This file runs the repo's OWN AST guard (`scripts/lint/silent-warning-
// detector.mjs`) — not a fresh regex sweep, which this repo has already been
// burned by — over the session-path surface, and asserts the exact set of
// swallowing frames on it. Add one and the set differs and the suite is red.
//
// HONEST LIMITS, stated rather than implied:
//   - The census is keyed on (file, rule, line). Lines drift; when they do,
//     the failure prints the current set ready to paste. That cost is the
//     price of the gate being a gate — a census that auto-heals is prose.
//   - It covers the SURFACE (the files that resolve a session id), not `src/`
//     entire. The repo-wide count is NOT asserted: two sibling slices are
//     editing other files while this one runs, so a repo-wide number would be
//     measuring their work. Measured with the detector this run: repo-wide
//     98 (40 `catch-return-null` + 58 `empty-catch`), unchanged from the
//     slice's own record, with this slice's own contribution being -1.
//   - It cannot see a swallow that swallows without a `catch` (a `?? null`, an
//     ignored result). Those are the known modes (b-1)/(b-2) below.
//
// THE RULE, ITS CUTOFF, AND ITS RESIDUE (AC5)
//   Rule: a frame that degrades (a `catch` with an empty body, or one whose
//   first meaningful statement returns null/undefined) on the session-path
//   axis. Cutoff: convergence — a pass stops when the rule's own residue is a
//   set that no longer shrinks, NOT at a frame budget: (b) PROMISED ("the
//   frame's doc promises a contract the throw breaks") is prose, and prose has
//   no fixed point, so every (b) site is residue forever.
//   Known modes: (b-1) keys on the FILE, not the frame — `writeCheckpoint`
//   becomes a false positive because a sibling in the same file promised
//   something else; (b-2) keys on the frame NAME, so anonymous arrows are
//   invisible — and R3's site, an arrow inside `settleOpenLifecycleRun`'s
//   `emit`, is exactly one of those. Both modes are why this census pins
//   (file, rule, LINE) and names the frame in prose, and why it is a gate
//   rather than a discovery mechanism: it holds the sites that are KNOWN.
//
// Dimensions:
//   - render:      the violation envelope the detector emits
//   - behavior:    the census — set equality, not a count
//   - integration: the detector's real TS-compiler-API parse of real files
//   - a11y:        n/a — this suite reads source, it renders nothing to a human

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/lint/session-path-swallow-census.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'reads source with a parser; renders no human-visible text or exit code of its own'
    }
  ]
);

const REPO_ROOT = join(__dirname, '..', '..', '..');

type Violation = { readonly rule: string; readonly line: number };
type AnalyzeFn = (source: string, file: string) => Promise<readonly Violation[]>;

/**
 * The detector is loaded through a runtime-resolved URL rather than a static
 * import: it is a `.mjs` build script outside `src/`, so a static specifier
 * would be a TS resolution error rather than a dependency.
 */
async function analyze(source: string, file: string): Promise<readonly Violation[]> {
  const url = pathToFileURL(join(REPO_ROOT, 'scripts', 'lint', 'silent-warning-detector.mjs')).href;
  const mod = (await import(url)) as { analyzeSourceAsync: AnalyzeFn };
  return mod.analyzeSourceAsync(source, file);
}

/**
 * The surface: every file on the session-id axis that a `catch` has been
 * caught swallowing on, in this line of repair slices.
 */
const SURFACE = [
  'src/services/session/getSessionDir.ts',
  'src/services/code/auto-compact-lifecycle.ts',
  'src/services/code/auto-compact-orchestrator.ts',
  'src/services/compact-statusline/compact-lifecycle-store.ts',
  'src/services/observability/observability-service.ts',
  'src/services/observability/jsonl-store.ts'
] as const;

type Entry = {
  readonly file: string;
  readonly rule: 'empty-catch' | 'catch-return-null';
  readonly line: number;
  /** The frame the violation sits in. Documentation, and the reason it stays. */
  readonly frame: string;
  readonly reason: string;
};

/**
 * Every swallowing frame the surface is allowed to have. Each entry is a
 * decision, and the decision is what a reviewer should check — not the count.
 */
const CENSUS: readonly Entry[] = [
  {
    file: 'src/services/code/auto-compact-lifecycle.ts',
    rule: 'empty-catch',
    line: 302,
    frame: 'CompactLifecyclePublisher.write',
    reason: 'an observer is a passive listener; a throwing observer must not change the envelope'
  },
  {
    file: 'src/services/code/auto-compact-lifecycle.ts',
    rule: 'empty-catch',
    line: 439,
    frame: 'settleOpenLifecycleRun (emit)',
    reason: 'same observer contract as above, on the probe settle path'
  },
  {
    file: 'src/services/code/auto-compact-lifecycle.ts',
    rule: 'empty-catch',
    line: 580,
    frame: 'settleOpenLifecycleRunOnCompactEvent',
    reason: 'same observer contract, on the harness-event settle path'
  },
  {
    file: 'src/services/code/auto-compact-lifecycle.ts',
    rule: 'catch-return-null',
    line: 653,
    frame: 'fillEventSettledMeasurement',
    reason:
      'the ONLY remaining catch-return-null on the surface. null means "no number was filled", ' +
      'the caller appends nothing, and the next probe re-reads and retries — idempotent rather ' +
      'than silent. Kept deliberately (QA ruled on it, and the null is what its caller tests ' +
      'for), and named here so it is a decision rather than an omission.'
  },
  {
    file: 'src/services/compact-statusline/compact-lifecycle-store.ts',
    rule: 'empty-catch',
    line: 242,
    frame: 'writeCompactLifecycle',
    reason:
      'tmp-file unlink is best effort, and `throw error` follows the catch — nothing is swallowed'
  },
  {
    file: 'src/services/code/auto-compact-orchestrator.ts',
    rule: 'empty-catch',
    line: 956,
    frame: 'dispatch history append',
    reason: 'telemetry must not fail the compact return'
  },
  {
    file: 'src/services/code/auto-compact-orchestrator.ts',
    rule: 'empty-catch',
    line: 1059,
    frame: 'appendObservedCompactEvent',
    reason: 'same best-effort discipline on the post-compact measurement row'
  }
];

async function measuredCensus(): Promise<Array<{ file: string; rule: string; line: number }>> {
  const out: Array<{ file: string; rule: string; line: number }> = [];
  for (const file of SURFACE) {
    const source = readFileSync(join(REPO_ROOT, file), 'utf8');
    for (const v of await analyze(source, join(REPO_ROOT, file))) {
      out.push({ file, rule: v.rule, line: v.line });
    }
  }
  const byKey = (a: { file: string; line: number }, b: { file: string; line: number }) =>
    (a.file + String(a.line).padStart(6, '0')).localeCompare(
      b.file + String(b.line).padStart(6, '0')
    );
  return out.sort(byKey);
}

const expectedCensus = () =>
  CENSUS.map((c) => ({ file: c.file, rule: c.rule, line: c.line })).sort((a, b) =>
    (a.file + String(a.line).padStart(6, '0')).localeCompare(
      b.file + String(b.line).padStart(6, '0')
    )
  );

describe('Scenario: behavior — the swallow census on the session-path surface', () => {
  it('when scanned, should match the named census exactly — a swallow added or removed fails here', async () => {
    const measured = await measuredCensus();
    const expected = expectedCensus();
    // The message prints the measured set ready to paste, so reconciling is
    // mechanical rather than archaeological.
    expect(measured, `measured set (paste-ready):\n${JSON.stringify(measured)}`).toEqual(expected);
  });

  it('when scanned, should keep exactly ONE catch-return-null, at the site the census names', async () => {
    const measured = await measuredCensus();
    expect(measured.filter((v) => v.rule === 'catch-return-null')).toEqual([
      { file: 'src/services/code/auto-compact-lifecycle.ts', rule: 'catch-return-null', line: 653 }
    ]);
  });

  it('when scanned, should find NO swallow at all in the frames that resolve a session id', async () => {
    // These two frames used to answer `null` for an id the axis refused, which
    // each caller read as a real answer. They now resolve through the total
    // entry, so there is nothing left for a catch to swallow.
    for (const file of [
      'src/services/session/getSessionDir.ts',
      'src/services/observability/observability-service.ts',
      'src/services/observability/jsonl-store.ts'
    ]) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      expect(
        await analyze(source, join(REPO_ROOT, file)),
        `${file} must have zero swallowing frames`
      ).toEqual([]);
    }
  });
});

describe('Scenario: render — the envelope the detector itself emits', () => {
  it('when the guard is asked about a known swallow, should report it at the right rule and line', async () => {
    // A control on the INSTRUMENT: the census above is only a gate if the
    // detector actually fires. Feed it the pre-fix swallow verbatim.
    const source = [
      'export function f(): string | null {',
      '  try {',
      '    return g();',
      '  } catch {',
      '    return null;',
      '  }',
      '}'
    ].join('\n');
    // The detector reports the catch-body line, not the `return` line.
    expect(await analyze(source, 'control.ts')).toMatchObject([
      { rule: 'catch-return-null', line: 4 }
    ]);
  });

  it('when the same guard is handed the post-fix shape, should report nothing', async () => {
    // The invariance: the shape this slice wrote in place of the swallow is
    // not itself flagged, so the census above is not counting a relocation.
    const source = [
      'export function f(): Answer {',
      '  const resolved = tryGetSessionDir(root, sid);',
      "  if (!resolved.ok) return { kind: 'unresolvable', reason: resolved.reason };",
      "  return { kind: 'found' };",
      '}'
    ].join('\n');
    expect(await analyze(source, 'control.ts')).toEqual([]);
  });
});
