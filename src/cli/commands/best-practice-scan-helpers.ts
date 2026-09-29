/**
 * Slice 2026-08-12 best-practice-scan — support constants + pure helpers
 * extracted from `best-practice-scan-command.ts` (file-size cap campaign).
 * Mechanical move only: help-text constants, the artifact directory path
 * helper, and the synthetic-lookup refusal renderer.
 */
import { join } from 'node:path';

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
    '- Step 2.5: recorded as skipped, reason "synthetic-lookup". Re-run this step once the real',
    '  lookup lands; a gate cannot be satisfied from a fabricated scan.'
  ].join('\n');
}
