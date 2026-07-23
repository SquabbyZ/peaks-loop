/**
 * Slice 2026-07-02-auto-compact-zero-pause — AC-3 test.
 *
 * Pins the contract that the Code Step N+2 paragraph in
 * `skills/peaks-code/SKILL.md` reflects the v2.13.0 design and the
 * Task-1.7 (design §13.1) retirement of the never-existing
 * three never-existing command strings (see the FORBIDDEN_* constants below):
 *
 *   - uses 0.85 / 0.95 thresholds (NOT the legacy 50/75/90)
 *   - explicitly cites the Karpathy §4 compact-red-line exception
 *   - cites `peaks code context-now --json` as the probe primitive
 *     (not `peaks context check --prompt-size`)
 *   - cites `peaks compact auto` as the 0.85+ action
 *     (NOT any of the never-existing session/code auto-compact --execute strings)
 *
 * If any of these drift, the auto-compact surface regresses to
 * the pre-slice behaviour where the LLM waits for the user to
 * run `/compact` instead of firing the capability-first control
 * plane.
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

describe('skills/peaks-code/SKILL.md — Step N+2 prose (AC-3 + Task 1.7 §13.1)', () => {
  it('contains the v2.13.0 0.85 pre-compact threshold', () => {
    expect(STEP_N_PLUS_2).toContain('0.85');
  });

  it('contains the v2.13.0 0.95 red-line threshold', () => {
    expect(STEP_N_PLUS_2).toContain('0.95');
  });

  it('does NOT contain the legacy 75% user-red-line tier text', () => {
    expect(STEP_N_PLUS_2).not.toContain('75%');
  });

  it('cites peaks code context-now --json as the probe primitive', () => {
    expect(STEP_N_PLUS_2).toContain('peaks code context-now');
  });

  it('cites peaks compact auto as the 0.85+ action (Task 1.7, design §13.1)', () => {
    // Pre-1.7 the SKILL cited the never-existing session-auto-compact
    // execute string. Task 1.7 retired that and points the prose at
    // the capability-first control plane entry instead.
    expect(STEP_N_PLUS_2).toContain('peaks compact auto');
    const FORBIDDEN_SESSION_AUTO_COMPACT_EXECUTE = ['peaks', 'session', 'auto-compact', '--execute'].join(' ');
    const FORBIDDEN_CODE_AUTO_COMPACT_EXECUTE = ['peaks', 'code', 'auto-compact', '--execute'].join(' ');
    expect(STEP_N_PLUS_2).not.toContain(FORBIDDEN_SESSION_AUTO_COMPACT_EXECUTE);
    expect(STEP_N_PLUS_2).not.toContain(FORBIDDEN_CODE_AUTO_COMPACT_EXECUTE);
  });

  it('explicitly cites the Karpathy §4 compact-red-line exception', () => {
    expect(STEP_N_PLUS_2).toContain('Karpathy §4');
    expect(STEP_N_PLUS_2).toMatch(/exception/i);
  });
});
