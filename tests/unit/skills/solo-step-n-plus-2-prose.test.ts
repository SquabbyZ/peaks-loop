/**
 * Slice 2026-07-02-auto-compact-zero-pause — AC-3 test.
 *
 * Pins the contract that the Solo Step N+2 paragraph in
 * `skills/peaks-code/SKILL.md` reflects the v2.13.0 design:
 *
 *   - uses 0.85 / 0.95 thresholds (NOT the legacy 50/75/90)
 *   - explicitly cites the Karpathy §4 compact-red-line exception
 *   - cites `peaks solo context-now --json` as the probe primitive
 *     (not `peaks context check --prompt-size`)
 *
 * If any of these drift, the auto-compact surface regresses to
 * the pre-slice behaviour where the LLM waits for the user to
 * run `/compact` instead of firing `peaks solo auto-compact`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SKILL_MD = readFileSync(
  join(process.cwd(), 'skills', 'peaks-code', 'SKILL.md'),
  'utf8'
);

// Extract just the Step N+2 paragraph (between the heading and the next ### heading).
const STEP_N_PLUS_2_REGEX = /### Peaks-Loop Step N\+2:[\s\S]*?(?=\n### |\n## )/;
const match = SKILL_MD.match(STEP_N_PLUS_2_REGEX);
if (match === null) {
  throw new Error('Could not locate Step N+2 paragraph in skills/peaks-code/SKILL.md');
}
const STEP_N_PLUS_2 = match[0];

describe('skills/peaks-code/SKILL.md — Step N+2 prose (AC-3)', () => {
  it('contains the v2.13.0 0.85 pre-compact threshold', () => {
    expect(STEP_N_PLUS_2).toContain('0.85');
  });

  it('contains the v2.13.0 0.95 red-line threshold', () => {
    expect(STEP_N_PLUS_2).toContain('0.95');
  });

  it('does NOT contain the legacy 75% user-red-line tier text', () => {
    expect(STEP_N_PLUS_2).not.toContain('75%');
  });

  it('cites peaks solo context-now --json as the probe primitive', () => {
    expect(STEP_N_PLUS_2).toContain('peaks solo context-now');
  });

  it('cites peaks solo auto-compact --execute as the 0.85+ action', () => {
    expect(STEP_N_PLUS_2).toContain('peaks solo auto-compact');
  });

  it('explicitly cites the Karpathy §4 compact-red-line exception', () => {
    expect(STEP_N_PLUS_2).toContain('Karpathy §4');
    expect(STEP_N_PLUS_2).toMatch(/exception/i);
  });
});
