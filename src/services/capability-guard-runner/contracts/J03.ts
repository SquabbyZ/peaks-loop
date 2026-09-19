import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GuardContext, GuardRunResult } from '../types.js';
import {
  combineProbes,
  fail,
  missingSourceFiles,
  pass,
  probe,
  requireBaselineRow
} from './_shared.js';

const DETECTOR = ['scripts', 'lint', 'silent-warning-detector.mjs'];

/**
 * Violation ceilings measured on the frozen tree when this contract was
 * written (2026-09-15, 767 files scanned). They are a RATCHET, not a target:
 * the invariant is "no silent-catch or fake-green pattern is REINTRODUCED", so
 * the check is that the count does not grow. Fixing violations lowers the
 * ceiling in the same slice that fixes them.
 */
const CEILING: Readonly<Record<string, number>> = {
  'catch-return-null': 41,
  'empty-catch': 59
};

function parseCounts(stdout: string): Record<string, number> | null {
  const line = /\[silent-warning-detector\] summary: (.+)$/m.exec(stdout);
  if (line === null) return null;
  const counts: Record<string, number> = {};
  for (const pair of line[1]!.split(',')) {
    const m = /^\s*([a-z-]+)=(\d+)\s*$/.exec(pair);
    if (m !== null) counts[m[1]!] = Number(m[2]);
  }
  return counts;
}

/**
 * Behavioural probe of the "no silent-catch / fake-green reintroduced"
 * invariant.
 *
 * The previous version read `final-review-types.ts` and asserted it contained
 * four dimension strings — a file whose own name is `final-review`, so the
 * check restated its filename.
 *
 * Here the repository's own AST guard (`scripts/lint/silent-warning-detector.mjs`)
 * is executed and its per-rule violation counts are compared against the frozen
 * ceilings. A newly swallowed `catch` in `src/**` raises a count and reddens the
 * journey.
 */
export async function runJ03Contract(ctx: GuardContext): Promise<GuardRunResult> {
  const row = requireBaselineRow(ctx);
  const missing = missingSourceFiles(ctx, row);

  const detectorPath = join(ctx.projectRoot, ...DETECTOR);
  const detectorPresent = existsSync(detectorPath);
  const run = detectorPresent
    ? spawnSync('node', [detectorPath], {
        cwd: ctx.projectRoot,
        encoding: 'utf8',
        windowsHide: true
      })
    : null;
  const stdout = run?.stdout ?? '';
  const counts = parseCounts(stdout);
  const scanned = /scanned (\d+) files/.exec(stdout);

  const grew: string[] = [];
  const missingRules: string[] = [];
  if (counts !== null) {
    for (const rule of Object.keys(CEILING)) {
      if (counts[rule] === undefined) missingRules.push(rule);
      else if (counts[rule] > CEILING[rule]!)
        grew.push(`${rule}: ${String(counts[rule])} > ${String(CEILING[rule])}`);
    }
  }

  const result = combineProbes([
    probe(missing.length === 0, `baseline sourceFiles present (${row.sourceFiles.length})`),
    probe(detectorPresent, `the repository AST guard is present (${detectorPath})`),
    probe(
      scanned !== null && Number(scanned[1]) > 0,
      `the AST guard scanned files (${scanned?.[1] ?? 'none'})`
    ),
    probe(
      counts !== null,
      `the AST guard reported per-rule counts (${counts === null ? 'unparseable' : JSON.stringify(counts)})`
    ),
    probe(
      missingRules.length === 0,
      `every ratcheted rule was reported (missing: ${missingRules.join(',') || 'none'})`
    ),
    probe(
      grew.length === 0,
      `no silent-catch rule count grew past its ceiling (${grew.join('; ') || 'none'})`
    )
  ]);

  const artifact = row.sourceFiles[1] ?? 'src/services/final-review/final-review-service.ts';
  if (result.ok) return pass(ctx, artifact);
  return fail(
    ctx,
    artifact,
    `silent-catch violation counts stay at or below ${JSON.stringify(CEILING)}`,
    result.detail,
    'J03 invariant broken: a silent-catch or fake-green pattern was reintroduced under src/**'
  );
}
