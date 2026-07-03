/**
 * v3.1.1 Step 0.8 — block-guard test for the SKILL.md / runbook prose.
 *
 * Asserts the orchestrator (Solo) actually wrote the v3.1.1 prose:
 *   - `skills/peaks-solo/SKILL.md` contains `BLOCKING on LLM judgement`
 *     (the gate is explicit).
 *   - `skills/peaks-solo/SKILL.md` mentions `peaks solo detect-job`
 *     (so the LLM sees the recorder instruction).
 *   - `skills/peaks-solo/references/runbook.md` references
 *     `peaks solo detect-job` BEFORE the line `# After Step 7`
 *     (so the runbook reaches Step 0.8 before the post-Step-7 handoff).
 *
 * The orchestrator updated SKILL.md / runbook — this test locks the
 * contract so a future "drive-by simplification" doesn't silently
 * drop Step 0.8.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SKILL_MD = join(process.cwd(), 'skills', 'peaks-solo', 'SKILL.md');
const RUNBOOK_MD = join(process.cwd(), 'skills', 'peaks-solo', 'references', 'runbook.md');

describe('peaks-solo Step 0.8 (v3.1.1) block-guard', () => {
  test('SKILL.md contains the BLOCKING on LLM judgement marker for Step 0.8', async () => {
    const body = await readFile(SKILL_MD, 'utf8');
    expect(body).toMatch(/BLOCKING on LLM judgement/);
  });

  test('SKILL.md mentions `peaks solo detect-job` (recorder instruction)', async () => {
    const body = await readFile(SKILL_MD, 'utf8');
    expect(body).toMatch(/peaks solo detect-job/);
  });

  test('SKILL.md mentions `read-job-shape` (downstream gate)', async () => {
    const body = await readFile(SKILL_MD, 'utf8');
    // SKILL.md uses backtick-quoted `read-job-shape` (without the `peaks solo` prefix)
    // in the runbook prose; match the substring as it actually appears.
    expect(body).toMatch(/read-job-shape/);
  });

  test('runbook.md references `peaks solo detect-job` BEFORE `# After Step 7`', async () => {
    const body = await readFile(RUNBOOK_MD, 'utf8');
    const detectJobIdx = body.indexOf('peaks solo detect-job');
    const afterStep7Idx = body.indexOf('# After Step 7');
    expect(detectJobIdx, 'runbook.md must reference `peaks solo detect-job`').toBeGreaterThanOrEqual(0);
    expect(afterStep7Idx, 'runbook.md must contain the `# After Step 7` heading').toBeGreaterThanOrEqual(0);
    expect(detectJobIdx, 'detect-job must appear BEFORE `# After Step 7`').toBeLessThan(afterStep7Idx);
  });
});
