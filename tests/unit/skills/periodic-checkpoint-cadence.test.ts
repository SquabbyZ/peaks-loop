// tests/unit/skills/periodic-checkpoint-cadence.test.ts
//
// AC-4 of slice 2026-09-17-4-0-51-cleanup — rewritten in slice D2
// (2026-09-18) because AC-4 was pinned against the WRONG cadence.
//
// The gap AC-4 was meant to close is the **20-tool-call periodic
// checkpoint** (slice 2026-06-24-efficiency-4p-bundle / G1), disclosed at:
//   - skills/peaks-code/references/periodic-checkpoint.md:29
//         "no guard fails on the drift — the test that pinned the cadence
//          was deleted in `f17aa377`"
//   - skills/peaks-code/references/startup-sequence.md:22
//         "(no guard fails on a missed cadence — the test that did was
//          deleted in `f17aa377`)"
//
// What AC-4 actually pinned was `tests/unit/slice/llm-arbitrator.test.ts` —
// `maxCallsPerInvocation`, the LLM-arbitrator BUDGET, which is a different
// cadence in a different subsystem. Measured before this file existed:
// `grep -rn "periodic-checkpoint|reason periodic|every 20" tests/` → 0 hits.
// Both disclosures were therefore literally true, and AC-4's "已 pin" claim
// did not close the site it named.
//
// This file pins the cadence the disclosures actually name. The contract is
// TEXTUAL by design — `periodic-checkpoint.md` says so itself ("the cadence
// is owned by the skill, not the CLI") — so the pin is a cross-file text
// lock: the number is owned by two documents and must not drift between
// them, and the CLI must not grow the override the doc promises is absent.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..', '..', '..');

/** The G1 frequency lock. Hard-coded on purpose: deriving it from either
 *  document would make the assertion tautological and let a coordinated
 *  drift of BOTH files pass silently. */
const CADENCE = 20;

const PERIODIC_REF = join(repoRoot, 'skills', 'peaks-code', 'references', 'periodic-checkpoint.md');
const STARTUP_REF = join(repoRoot, 'skills', 'peaks-code', 'references', 'startup-sequence.md');
const CHECKPOINT_CMD = join(repoRoot, 'src', 'cli', 'commands', 'session-checkpoint-command.ts');

/** Every `<n> tool calls` figure stated by a document. */
function cadencesIn(body: string): number[] {
  return [...body.matchAll(/\b(\d+)\s+tool calls\b/g)].map((m) => Number(m[1]));
}

describe('periodic checkpoint cadence — AC-4 coverage (G1 frequency lock)', () => {
  it('periodic-checkpoint.md locks the cadence at 20 tool calls', () => {
    const found = cadencesIn(readFileSync(PERIODIC_REF, 'utf8'));
    expect(found.length, 'the reference must state a cadence at least once').toBeGreaterThan(0);
    expect(new Set(found), 'every stated cadence must be the locked value').toEqual(
      new Set([CADENCE])
    );
  });

  it('startup-sequence.md states the same cadence', () => {
    const found = cadencesIn(readFileSync(STARTUP_REF, 'utf8'));
    expect(found.length, 'Step N must state the cadence').toBeGreaterThan(0);
    expect(new Set(found)).toEqual(new Set([CADENCE]));
  });

  it('the two documents are in lockstep — neither drifts from the other', () => {
    // "Any patch that relaxes this must update both files in lockstep."
    // The lock is the point: one file moving alone is the drift.
    expect(new Set(cadencesIn(readFileSync(PERIODIC_REF, 'utf8')))).toEqual(
      new Set(cadencesIn(readFileSync(STARTUP_REF, 'utf8')))
    );
  });

  it('periodic-checkpoint.md still states the lock as a hard lock, not an approximation', () => {
    const body = readFileSync(PERIODIC_REF, 'utf8');
    expect(body).toContain(`hard-locked at **${CADENCE} tool calls**`);
    // The trigger table row must carry the same value and the do-not-override
    // marker, so the table and the callout cannot disagree.
    expect(body).toContain(`| Every ${CADENCE} tool calls`);
    expect(body).toContain('hard-coded — do NOT override');
  });

  it('the CLI exposes no --periodic-every override (the cadence is owned by the skill)', () => {
    // The reference doc commits: "The CLI does **not** expose a
    // `--periodic-every <n>` override flag". If the flag ever lands, the
    // doc becomes wrong — this fails instead of the doc rotting silently.
    const body = readFileSync(CHECKPOINT_CMD, 'utf8');
    expect(body).not.toContain('--periodic-every');
  });
});
