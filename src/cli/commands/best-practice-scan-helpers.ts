/**
 * extracted from `best-practice-scan-command.ts` (file-size cap campaign).
 * Partly a mechanical move: help-text constants, the artifact directory path
 * helper, and the synthetic-lookup refusal renderer. Later additions (the
 * refusal write-path rule, the fragments-free refusal) live here for the same
 * file-size reason.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

import { fail } from 'peaks-loop-shared/result';

import { printResult, type ProgramIO } from '../cli-helpers.js';

export const CATCH_GATE_PROMPT = [
  '⚠️ 任何跟你真实业务不一样,改 — LLM 推荐可能错。',
  '回应 (默认 = 接受): 接受 / 接受方案 A|接受方案 B|接受方案 C / 拒绝 + 原因'
].join('\n');

export const INTENT_REQUIRED_MESSAGE =
  'best-practice-scan requires --intent <text>: the intent is the business goal the scan is ' +
  'for, not the project path. Deriving it from the project path labelled a scan with a ' +
  'non-goal, so there is no fallback.';

export const SYNTHETIC_SOURCE_MESSAGE =
  'best-practice-scan: SKIPPED — the Context7 / WebSearch lookups in this build are stubs ' +
  '(synthetic fragments), so no real documentation was consulted and there is nothing to ' +
  'recommend. No recommendation, no comparison table and no ⚠️ catch gate were produced.';

export function bestPracticeDir(projectRoot: string): string {
  return join(projectRoot, 'best-practice');
}

/** `YYYY-MM-DD` is 10 characters, and the slug is capped at 32 so the filename
 *  stays a filename. Both are part of the pinned artifact path. */
const ISO_DATE_LENGTH = 10;
const SLUG_MAX_LENGTH = 32;

/** `<project>/best-practice/<date>-<slug>.md`. The slug is lossy by design:
 *  every character outside `[A-Za-z0-9_-]` collapses to `-` and the result is
 *  truncated to 32, so no intent can introduce a path separator. */
export function scanArtifactPath(projectRoot: string, slugSource: string): string {
  const dateStr = new Date().toISOString().slice(0, ISO_DATE_LENGTH);
  const slug = slugSource.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, SLUG_MAX_LENGTH) || 'intent';
  return join(bestPracticeDir(projectRoot), `${dateStr}-${slug}.md`);
}

/** Refusal body for a synthetic scan. It is written to the artifact path so
 *  the skip survives the fire-and-forget caller (`best-practice-auto-trigger`
 *  spawns with `stdio: 'ignore'`, so stdout never reaches anyone). */
export function renderSyntheticRefusal(opts: {
  readonly intent: string;
  readonly language: string;
  readonly source: string;
}): string {
  return [
    `# Best-Practice Scan — ${opts.intent}`,
    '',
    '> SKIPPED — synthetic (stub) lookup. No real documentation lookup was performed.',
    '',
    SYNTHETIC_SOURCE_MESSAGE,
    '',
    `- language: ${opts.language}`,
    `- transport that answered: ${opts.source} (stub)`,
    '- Step 2.5: recorded as skipped, reason "synthetic-lookup". Re-run this step with',
    '  --lookup-results <file> once real lookup results are available; a gate cannot be',
    '  satisfied from a fabricated scan.'
  ].join('\n');
}

/**
 * A refusal must never overwrite anything.
 *
 * The rendered table and the refusal are keyed on the same `(date, intent)`, and
 * an auto-triggered scan runs with the same intent as the injected one, so a
 * refusal landing second used to destroy a real recommendation. The rule is now
 * unconditional — *any* existing file at the primary path wins — because the
 * only way to tell a refusal from a recommendation without a forgeable content
 * test is to not need the test at all. Refusals for an occupied path go to
 * `best-practice/skipped/`, a directory no primary path can reach: the slug
 * collapses every character outside `[A-Za-z0-9_-]`, so no intent can produce a
 * separator. A fresh project still records its refusal at the primary path,
 * which `tests/unit/cli/commands/best-practice-scan-command.test.ts` pins.
 *
 * Returns where the refusal landed.
 */
export function writeRefusal(projectRoot: string, intent: string, refusal: string): string {
  const primary = scanArtifactPath(projectRoot, intent);
  const target = existsSync(primary)
    ? join(dirname(primary), 'skipped', parse(primary).base)
    : primary;
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, refusal + '\n', 'utf8');
  return target;
}

/**
 * Write the rendered table to `artifactPath` and return nothing.
 *
 * The artifact is the durable side effect and the envelope is not, so the
 * payload is proved to serialise *before* anything is written: a payload the
 * printer cannot render must not leave behind an artifact claiming a scan that
 * never reported.
 */
export function writeRenderedArtifact(artifactPath: string, table: string, payload: unknown): void {
  JSON.stringify(payload);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, table + '\n', 'utf8');
}

export const NO_FRAGMENTS_MESSAGE =
  'best-practice-scan: NO FRAGMENTS — the lookups this scan resolved against returned no ' +
  'documentation at all, so there is nothing to compare and no recommendation to make. ' +
  'No comparison table, no ★ and no ⚠️ catch gate were produced, and no artifact was written.';

/**
 * Refuse a scan that resolved against real lookups and still found nothing.
 *
 * This is not the synthetic path: no stub took part, so `scan.synthetic` is
 * false, and the orchestrator is right to say so — it answers "was anything
 * fabricated?", not "was anything found?". Without this refusal the empty
 * fallback renders a full table with a `★` on it, from zero fragments, and exits
 * 0. Writes nothing: an absent artifact is the honest record of an empty scan.
 */
export function emitNoFragmentsRefusal(
  io: ProgramIO,
  asJson: boolean,
  scope: {
    readonly project: string;
    readonly intent: string;
    readonly language: string;
    readonly source: string;
  }
): void {
  printResult(
    io,
    fail(
      'best-practice.scan',
      'BEST_PRACTICE_SCAN_NO_FRAGMENTS',
      NO_FRAGMENTS_MESSAGE,
      {
        project: scope.project,
        intent: scope.intent,
        language: scope.language,
        scanSource: scope.source,
        fragments: 0,
        synthetic: false,
        step25: 'skipped-no-fragments',
        artifactPath: null
      },
      [
        'Supply a results file whose context7 or websearch entry declares ok: true with at least one fragment',
        'Or rerun without --lookup-results to record the honest no-injection skip instead'
      ]
    ),
    asJson
  );
}
