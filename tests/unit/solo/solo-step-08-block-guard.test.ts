/**
 * v3.1.1 + v3.1.2 Step 0.8 — block-guard test for the SKILL.md / runbook prose.
 *
 * Asserts the orchestrator (Solo) actually wrote the v3.1.1 prose:
 *   - `skills/peaks-code/SKILL.md` contains `BLOCKING on LLM judgement`
 *     (the gate is explicit).
 *   - `skills/peaks-code/SKILL.md` mentions `peaks solo detect-job`
 *     (so the LLM sees the recorder instruction).
 *   - `skills/peaks-code/references/runbook.md` references
 *     `peaks solo detect-job` BEFORE the line `# After Step 7`
 *     (so the runbook reaches Step 0.8 before the post-Step-7 handoff).
 *
 * v3.1.2 additions — also asserts the four mechanical gates are
 * mentioned in SKILL.md / runbook:
 *   - `peaks solo gate-step-08` (PreToolUse hook)
 *   - `peaks solo emit-handoff` (size-fear ban)
 *   - `peaks job progress` (on-disk slice progress)
 *   - `--enforce-job-mode` (forced auto-compact)
 *
 * The orchestrator updated SKILL.md / runbook — this test locks the
 * contract so a future "drive-by simplification" doesn't silently
 * drop Step 0.8.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SKILL_MD = join(process.cwd(), 'skills', 'peaks-code', 'SKILL.md');
const RUNBOOK_MD = join(process.cwd(), 'skills', 'peaks-code', 'references', 'runbook.md');

describe('peaks-code Step 0.8 (v3.1.1) block-guard', () => {
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

describe('peaks-code Step 0.8 (v3.1.2) mechanical gates — SKILL.md / runbook lock', () => {
  test('SKILL.md mentions `peaks solo gate-step-08` (PreToolUse hook)', async () => {
    const body = await readFile(SKILL_MD, 'utf8');
    expect(body, 'SKILL.md must reference peaks solo gate-step-08 (v3.1.2 PreToolUse hook)').toMatch(/peaks solo gate-step-08/);
  });

  test('SKILL.md mentions `peaks solo emit-handoff` (size-fear ban)', async () => {
    const body = await readFile(SKILL_MD, 'utf8');
    expect(body, 'SKILL.md must reference peaks solo emit-handoff (v3.1.2 size-fear ban)').toMatch(/peaks solo emit-handoff/);
  });

  test('SKILL.md mentions `peaks job progress` (on-disk slice progress)', async () => {
    const body = await readFile(SKILL_MD, 'utf8');
    expect(body, 'SKILL.md must reference peaks job progress (v3.1.2 slice progress mirror)').toMatch(/peaks job progress/);
  });

  test('SKILL.md mentions Job-mode MANDATORY auto-compact (≥ 0.85 forced)', async () => {
    const body = await readFile(SKILL_MD, 'utf8');
    expect(body, 'SKILL.md Step N+2 prose must say Job-mode ≥0.85 is MANDATORY auto-compact').toMatch(/Job mode.*MANDATORY auto-compact|MANDATORY auto-compact.*Job mode|≥ 0\.85 is MANDATORY auto-compact/i);
  });

  test('SKILL.md mentions progress.json read-FIRST rule on resume', async () => {
    const body = await readFile(SKILL_MD, 'utf8');
    expect(body, 'SKILL.md Step 0.7 prose must surface `Next: slice #N of M` from progress.json').toMatch(/slice #N of M|Next: slice/);
  });

  test('runbook.md mentions `peaks solo gate-step-08`', async () => {
    const body = await readFile(RUNBOOK_MD, 'utf8');
    expect(body, 'runbook.md must reference peaks solo gate-step-08').toMatch(/peaks solo gate-step-08/);
  });

  test('runbook.md mentions `peaks solo emit-handoff`', async () => {
    const body = await readFile(RUNBOOK_MD, 'utf8');
    expect(body, 'runbook.md must reference peaks solo emit-handoff').toMatch(/peaks solo emit-handoff/);
  });
});
