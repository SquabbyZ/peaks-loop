// tests/unit/final-review/final-review-service-whole-or-nothing.test.ts
//
// F-BLOCK-1BYTE — a source is delivered whole or not at all, split verbatim
// out of `final-review-service.test.ts` (C wave 7 file-size work).

import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_EVIDENCE_BYTES_PER_FILE,
  MAX_EVIDENCE_BYTES_TOTAL,
  assertFloorReservationAffordable,
  prepareFinalReview,
} from '~/src/services/final-review/final-review-service';
import {
  RID,
  SESSION_ID,
  REQUIRED,
  allVerdicts,
  captureRunner,
  makeGitProject,
  parseRenderedSources,
  reviewJson,
  writeAllEvidence,
  writeAuditGoal,
} from './final-review-service-helpers.js';
import {
  HEAVY_SUBPROCESS_TEST_TIMEOUT_MS,
  SUBPROCESS_TEST_TIMEOUT_MS
} from '../_setup/subprocess-timeouts.js';

// ---------------------------------------------------------------------------
// F-BLOCK-1BYTE — "found" (>= 1 byte inlined) was still being read as "the
// reviewer saw it", so the fourth hole in this primitive was the same hole with
// a new threshold. The QA round-4 probe: nine 4,551-byte sources leave exactly
// ONE byte of the budget before the appended baseline, and the pre-fix output
// was
//
//   [10] final-review-pre-post-diff  FOUND … TRUNCATED, showing the first 1 of 4226 bytes
//   producer block: STATUS: COMPUTED … Cite it
//   dim4: pass / high, with the ppd EvidenceItem attached
//   allPass: true, needsAttention: []
//
// — the reviewer's entire evidence being the character `#`. The fix is not
// another threshold: the allocator no longer hands out partial slices at all, so
// there is no `includedBytes` between 0 and a source's unit, and the baseline
// gate asks the delivered BYTES for the conclusion instead of asking a counter
// whether it is non-zero.
//
// All four tests here FAIL against the pre-fix service: the first on the
// fragment-as-delivered reading, the second on the half-source the old
// allocator handed out, the third on the missing scope-contract gate, and the
// fourth on the arithmetic the reservation now depends on.
// ---------------------------------------------------------------------------
describe('prepareFinalReview — a source is delivered whole or not at all (F-BLOCK-1BYTE)', () => {
  const NINE_SOURCE_KEYS = [
    'qa-test-report',
    'qa-test-cases',
    'qa-security-findings',
    'qa-performance-findings',
    'rd-code-review',
    'rd-security-review',
    'rd-tech-doc',
    'rd-bug-analysis',
    'prd-handoff'
  ] as const;

  const PP_DIFF_KEY = 'final-review-pre-post-diff';
  const ppDiffPath = (root: string): string =>
    join(root, '.peaks', '_runtime', SESSION_ID, 'final-review', 'api-diff.txt');

  it(
    'never treats a fragment of the baseline as a delivered baseline (the 1-byte repro)',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const root = makeGitProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      // The QA probe's shape: nine sources of exactly 4,551 B — 9 x 4,551 = 40,959
      // — leave 1 byte of the 40,960-byte budget free when the appended baseline
      // is reached.
      writeAllEvidence(root, '', 4551);

      const { runner, calls } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      const out = await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });

      const prompt = calls[0]?.userPrompt ?? '';
      const rendered = parseRenderedSources(prompt);
      const ppd = rendered.find((s) => s.key === PP_DIFF_KEY);

      // Ten blocks are rendered, and the tenth is delivered WHOLE. The one byte
      // the old allocator had left is no longer what the block rests on: F1
      // reserves this source's unit for the dimension whose contract names it,
      // and under all-or-nothing a reserved unit is served or the reservation is
      // a lie. What matters here is that the old reading is unreachable — no
      // source is ever delivered as a fragment (1 byte of 4,226 was the repro).
      expect(rendered).toHaveLength(10);
      expect(prompt).not.toMatch(/showing the first \d+ of/);
      expect(prompt).not.toContain('showing the first 1 of');
      expect(ppd?.status).toBe('found');
      expect(ppd?.includedBytes).toBe(statSync(ppDiffPath(root)).size);
      expect(prompt).toContain('VERDICT: ');
      expect(prompt).toContain('STATUS: COMPUTED —');

      // ...so the baseline the pass rests on is one the reviewer actually had,
      // and the artifact is attached because of it.
      const dimension = out.dimensions.find((d) => d.dimension === 'existing-functionality-intact');
      expect(dimension?.verdict).toBe('pass');
      expect((dimension?.evidence ?? []).filter((i) => i.kind === 'pre-post-diff')).toHaveLength(1);
      expect(out.allPass).toBe(true);
    }
  );

  it(
    'delivers the CONCLUSION even when the artifact is over the per-file cap',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // A baseline bigger than the cap arrives truncated — legitimately, because
      // the FILE is the thing that is too big. Truncation is only survivable
      // because the verdict is the first thing in the artifact: the head slice
      // contains the conclusion, so the dimension can still be judged. With the
      // verdict back at the END of the file (where it used to live), every
      // over-cap delivery deterministically lost it and this test goes red.
      const root = makeGitProject();
      mkdirSync(join(root, 'tests'), { recursive: true });
      mkdirSync(join(root, 'src'), { recursive: true });
      for (let i = 0; i < 240; i += 1) {
        writeFileSync(
          join(root, 'tests', `case-${String(i)}.test.ts`),
          `it('case ${String(i)}', () => {});\n`,
          'utf8'
        );
        writeFileSync(
          join(root, 'src', `module-${String(i)}.ts`),
          `export const value${String(i)} = ${String(i)};\n`,
          'utf8'
        );
      }
      writeAuditGoal(root, ['AC1: the widget renders']);
      writeAllEvidence(root);

      const { runner, calls } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      const out = await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });

      const artifact = statSync(ppDiffPath(root)).size;
      expect(artifact).toBeGreaterThan(MAX_EVIDENCE_BYTES_PER_FILE);

      const prompt = calls[0]?.userPrompt ?? '';
      const ppd = parseRenderedSources(prompt).find((s) => s.key === PP_DIFF_KEY);
      expect(ppd?.status).toBe('found');
      expect(ppd?.includedBytes).toBe(MAX_EVIDENCE_BYTES_PER_FILE);
      expect(prompt).toContain('TRUNCATED');
      // The whole point: the delivered slice CARRIES the conclusion.
      expect(prompt).toContain('VERDICT: ');

      const dimension = out.dimensions.find((d) => d.dimension === 'existing-functionality-intact');
      expect(dimension?.verdict).toBe('pass');
      expect(out.allPass).toBe(true);
    }
  );

  it(
    'inlines every source whole or omits it — never a slice in between',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const root = makeGitProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      // Every source is EXACTLY the 8 KiB per-file cap, so "a source stopped
      // strictly between 0 and its own size" is unambiguous: it is a slice the
      // budget cut, not a file the cap trimmed. Pre-fix the fifth source was cut
      // to the 4,096 bytes the reservation left free.
      writeAllEvidence(root, '', MAX_EVIDENCE_BYTES_PER_FILE);

      const { runner, calls } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });

      const prompt = calls[0]?.userPrompt ?? '';
      const rendered = parseRenderedSources(prompt);
      const onDisk: Record<string, number> = Object.fromEntries(
        NINE_SOURCE_KEYS.map((key) => [key, MAX_EVIDENCE_BYTES_PER_FILE])
      );
      onDisk[PP_DIFF_KEY] = statSync(ppDiffPath(root)).size;

      let omitted = 0;
      for (const source of rendered) {
        if (source.status === 'omitted') {
          omitted += 1;
          expect(source.includedBytes).toBe(0);
          continue;
        }
        // The invariant: whatever a FOUND block carries is its WHOLE unit —
        // `min(file bytes, per-file cap)` — never a fragment of it.
        expect(source.includedBytes).toBe(
          Math.min(onDisk[source.key] ?? 0, MAX_EVIDENCE_BYTES_PER_FILE)
        );
      }

      // The fixture is genuinely saturated (the invariant is not vacuous), and the
      // sources it holds back are F1's deliberate casualties, not fragments.
      expect(omitted).toBeGreaterThan(0);
      expect(rendered.find((s) => s.key === 'rd-code-review')?.status).toBe('omitted');
      expect(prompt).not.toMatch(/showing the first \d+ of/);
    }
  );

  it(
    'does not let a pass on functional-completeness outlive a contract that never arrived',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const root = makeGitProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      writeAllEvidence(root, '', MAX_EVIDENCE_BYTES_PER_FILE);
      // F4's repro, kept as the shell of the F-BLOCK-1BYTE one: the contract is
      // NOT absent (that is the test below), it is ON DISK for this run and the
      // reviewer received none of it. `qa-test-report` — which also backs this
      // dimension, and is first in the order — is delivered whole, which is the
      // exact configuration in which the pre-fix rule let the pass stand.
      writeFileSync(join(root, '.peaks', '_runtime', SESSION_ID, 'prd', 'handoff.md'), '', 'utf8');

      const { runner, calls } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      const out = await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });

      // The contract that defines the dimension ("complete" = the APPROVED scope,
      // non-goals included) exists and carried nothing — the dimension may not
      // report a pass on the strength of a test report alone.
      const handoff = parseRenderedSources(calls[0]?.userPrompt ?? '').find(
        (s) => s.key === 'prd-handoff'
      );
      expect(handoff?.status).toBe('empty');

      const dimension = out.dimensions.find((d) => d.dimension === 'functional-completeness');
      expect(dimension?.verdict).toBe('inconclusive');
      expect(dimension?.confidence).toBe('low');
      expect(dimension?.summary).toContain('scope-contract-gate');
      expect(out.allPass).toBe(false);
      expect(out.needsAttention).toContain('functional-completeness');
    }
  );

  it(
    'does not redden that dimension when there is no contract to deliver',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // The gate is a DELIVERY gate, not a blanket red: a workflow with no PRD
      // phase has no contract to lose, and a gate that can never go green is one
      // operators learn to ignore. `missing` (ENOENT) is therefore not a delivery
      // failure — F4's other half: the file that exists and could not be READ is.
      const root = makeGitProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      writeAllEvidence(root, '', MAX_EVIDENCE_BYTES_PER_FILE);
      rmSync(join(root, '.peaks', '_runtime', SESSION_ID, 'prd', 'handoff.md'));

      const { runner } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      const out = await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });

      const dimension = out.dimensions.find((d) => d.dimension === 'functional-completeness');
      expect(dimension?.verdict).toBe('pass');
      expect(dimension?.summary).not.toContain('scope-contract-gate');
      expect(out.allPass).toBe(true);
      expect(out.needsAttention).toEqual([]);
    }
  );

  it('keeps the reservation affordable for every dimension, by construction', () => {
    // The allocator reserves one UNIT per pending holder and promises the holder
    // is served when reached. That promise holds only while the whole set of
    // holder units fits the budget — four dimensions, one unit each. F5: the
    // cap is DIVIDED OUT OF the total, so the inequality cannot be typed wrong,
    // and the assertion at the point of use checks the division is exact and
    // still affordable.
    expect(REQUIRED.length * MAX_EVIDENCE_BYTES_PER_FILE).toBeLessThanOrEqual(
      MAX_EVIDENCE_BYTES_TOTAL
    );
    expect(() => assertFloorReservationAffordable()).not.toThrow();
  });
});
