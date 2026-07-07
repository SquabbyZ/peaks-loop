import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Regression guard for slice 2026-07-03-code-memory-sediment.
 *
 * Audit (2026-07-03) confirmed that peaks-code workflows were silently
 * skipping memory sediment at the end of the workflow — 2 consecutive
 * sessions (2026-07-01 + 2026-07-02) produced zero files in
 * `.peaks/memory/`. Root cause: SKILL.md "Completion handoff" section was
 * advisory (no BLOCKING mandate), and `assisted` mode skipped runbook
 * Step 10 because there was no STOP / [CONFIRM] gate.
 *
 * This test asserts the four conditions that must hold forever:
 *   (a) SKILL.md mandates Step 11 as BLOCKING on workflow complete.
 *   (b) SKILL.md points at the canonical `peaks memory extract` CLI.
 *   (c) runbook.md includes a `--apply` invocation (without --apply, the
 *       extract only previews and writes nothing to .peaks/memory/).
 *   (d) completion-handoff.md does NOT reference the conflicting
 *       `peaks project memories:extract` CLI that previously caused
 *       LLM confusion.
 */

const SKILL_PATH = join(process.cwd(), 'skills', 'peaks-code', 'SKILL.md');
const RUNBOOK_PATH = join(process.cwd(), 'skills', 'peaks-code', 'references', 'runbook.md');
const COMPLETION_PATH = join(process.cwd(), 'skills', 'peaks-code', 'references', 'completion-handoff.md');

describe('peaks-code memory sediment regression guard (slice 2026-07-03)', () => {
  test('SKILL.md declares Step 11 as BLOCKING with memory extract CLI', async () => {
    const body = await readFile(SKILL_PATH, 'utf8');

    // (a) Heading must exist and be BLOCKING-marked.
    expect(body).toMatch(/^##\s+Peaks-Loop Step 11:?\s*Memory sediment/m);
    expect(body, 'Step 11 must be marked BLOCKING').toMatch(/Step 11[\s\S]{0,200}BLOCKING/);

    // (b) Canonical CLI must be present, with --apply (otherwise no write).
    expect(body).toMatch(/peaks memory extract/);
    expect(body).toMatch(/--apply/);

    // The 11a/11b/11c/11d substep pattern must exist — proves this isn't
    // a one-liner addendum that future readers can ignore.
    expect(body).toMatch(/11a/);
    expect(body).toMatch(/11b/);
    expect(body).toMatch(/11c/);
    expect(body).toMatch(/11d/);
  });

  test('runbook.md Step 10 (TXT handoff) includes the --apply extract CLI', async () => {
    const body = await readFile(RUNBOOK_PATH, 'utf8');

    // (c) --apply must be present in the runbook; otherwise the LLM-only
    // dry-runs contract silently writes nothing.
    expect(body).toMatch(/peaks memory extract[^\n]*--apply/);

    // The runbook must acknowledge `assisted` mode (the mode that
    // previously skipped Step 10).
    expect(body, 'runbook must explicitly cover assisted mode').toMatch(/assisted/i);
  });

  test('completion-handoff.md does not cite the conflicting memories:extract CLI as the run command', async () => {
    const body = await readFile(COMPLETION_PATH, 'utf8');

    // (d) The conflicting CLI must NOT appear as a code-fenced runnable
    // command in the completion-handoff doc. An explanatory mention
    // ("not peaks project memories:extract") is OK; a code-fenced invocation
    // would re-introduce the LLM-confusion bug.
    expect(body).not.toMatch(/```[\s\S]*?peaks project memories:extract[\s\S]*?```/);

    // It should still point at the artifact-scoped canonical CLI.
    expect(body).toMatch(/peaks memory extract/);
  });

  test('canonical Step 11 CLI is the artifact-scoped peaks memory extract, not the batch-scoped sibling', async () => {
    const skillBody = await readFile(SKILL_PATH, 'utf8');

    // Both CLIs may exist in the codebase; SKILL.md must unambiguously pick
    // the artifact-scoped one (`peaks memory extract --artifact ...`) as the
    // Step 11 command. The batch-scoped one (`peaks project memories:extract`)
    // must NOT be cited as the Step 11 invocation (explanatory contrast is OK).
    expect(skillBody).toMatch(/peaks memory extract --project .* --artifact/);
    expect(
      skillBody,
      'SKILL.md must not cite `peaks project memories:extract` inside a code block as the Step 11 command'
    ).not.toMatch(/```[\s\S]*?peaks project memories:extract[\s\S]*?```/);
  });
});