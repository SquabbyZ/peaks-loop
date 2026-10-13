// tests/unit/final-review/final-review-partial-delivery.test.ts
//
// Partial delivery — a source over the per-file cap arrives as a BOUNDED,
// self-describing EXCERPT, and the delivery report says which of the two states
// is true instead of asserting the one it did not measure.
//
// The arms are built from the input the report exists to reject: a dimension
// whose every source on disk is larger than the per-file cap, which is the
// 2026-10-12 measurement (19,256 / 42,335 / 28,414 bytes against a 10,240 cap).
// The measured fact that started this: the allocator had ALREADY inlined a
// cap-sized head of each of those three — 30,720 bytes — while the report read
// "NO deliverable source" and "no source CAN be delivered", about a prompt the
// reviewer was reading.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_EVIDENCE_BYTES_PER_FILE,
  MAX_EVIDENCE_BYTES_TOTAL,
  prepareFinalReview,
  undeliverableDimensions
} from '~/src/services/final-review/final-review-service';
import { collectEvidence } from '~/src/services/final-review/final-review-evidence-collect';
import type { DimensionKind } from '~/src/services/final-review/final-review-types';
import type { CollectedEvidence } from '~/src/services/final-review/final-review-evidence-sources';
import {
  RID,
  SESSION_ID,
  allVerdicts,
  captureRunner,
  makeProject,
  reviewJson,
  writeAllEvidence,
  writeAuditGoal,
  writeUnderProject
} from './final-review-service-helpers.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';

/** Exactly `bytes` bytes, ASCII, with a readable marker in the head. */
function sized(marker: string, bytes: number): string {
  const head = `# ${marker}\n\n${marker}\n`;
  return head + 'X'.repeat(Math.max(0, bytes - head.length));
}

/** The measured 2026-10-12 sizes. Every one of them is over the per-file cap. */
const MEASURED_2026_10_12: ReadonlyArray<{ segments: readonly string[]; bytes: number }> = [
  { segments: ['qa', 'test-reports', `${RID}.md`], bytes: 19256 },
  { segments: ['qa', 'test-cases', `${RID}.md`], bytes: 42335 },
  { segments: ['prd', `handoff-${RID}.md`], bytes: 28414 }
];

function writeMeasuredOversizedSet(root: string): void {
  for (const file of MEASURED_2026_10_12) {
    writeUnderProject(root, file.segments, sized(file.segments.join('/'), file.bytes));
  }
}

function blockFor(prompt: string, key: string): string {
  return (
    prompt
      .split(/^### \[/m)
      .slice(1)
      .find((block) => block.match(/^\d+\]\s+(\S+)/)?.[1] === key) ?? ''
  );
}

function statusLine(prompt: string, key: string): string {
  return blockFor(prompt, key).match(/^STATUS: .*$/m)?.[0] ?? '';
}

/** The bytes inside one source's `<<<EVIDENCE … >>>EVIDENCE` block. */
function excerptContent(prompt: string, key: string): string {
  return blockFor(prompt, key).match(/<<<EVIDENCE\n([\s\S]*?)\n>>>EVIDENCE/)?.[1] ?? '';
}

function onDiskBytes(root: string, segments: readonly string[]): number {
  return readFileSync(join(root, '.peaks', '_runtime', SESSION_ID, ...segments), 'utf8').length;
}

const FOUR: readonly DimensionKind[] = [
  'functional-completeness',
  'problem-resolution',
  'no-new-bugs',
  'existing-functionality-intact'
];

describe('prepareFinalReview — partial delivery of an over-cap source', () => {
  it(
    'delivers a bounded, self-describing EXCERPT where every source exceeds the per-file cap',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const root = makeProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      writeMeasuredOversizedSet(root);

      const { runner, calls } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      const out = await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });
      const prompt = calls[0]?.userPrompt ?? '';

      // (1) THE EXCERPT ARRIVES, and it is the per-file cap — not the file, and
      // not a fragment the budget happened to cut.
      expect(statusLine(prompt, 'qa-test-report')).toBe(
        `STATUS: FOUND at .peaks/_runtime/${SESSION_ID}/qa/test-reports/${RID}.md — TRUNCATED EXCERPT (a HEAD, not the whole file): showing the first ${MAX_EVIDENCE_BYTES_PER_FILE} of 19256 bytes, 9016 bytes (46.8%) withheld.`
      );
      // (2) IT IS SELF-DESCRIBING, at three sizes: the withheld byte count, the
      // withheld FRACTION, and the sentence that says it is not the document.
      expect(statusLine(prompt, 'qa-test-cases')).toContain('32095 bytes (75.8%) withheld');
      expect(statusLine(prompt, 'prd-handoff')).toContain('18174 bytes (64.0%) withheld');
      expect(statusLine(prompt, 'prd-handoff')).toContain('a HEAD, not the whole file');

      // (3) The bytes really are a PREFIX of the file on disk, and really stop
      // at the cap (compare, do not assert the allocator's own arithmetic).
      const excerpted = excerptContent(prompt, 'qa-test-report');
      const [head, second, third] = MEASURED_2026_10_12;
      const fileOnDisk = readFileSync(
        join(root, '.peaks', '_runtime', SESSION_ID, ...(head?.segments ?? [])),
        'utf8'
      );
      expect(fileOnDisk.length).toBe(head?.bytes);
      expect(excerpted).toBe(fileOnDisk.slice(0, MAX_EVIDENCE_BYTES_PER_FILE));
      expect(Buffer.byteLength(excerpted, 'utf8')).toBe(MAX_EVIDENCE_BYTES_PER_FILE);
      expect(onDiskBytes(root, second?.segments ?? [])).toBe(second?.bytes);
      expect(onDiskBytes(root, third?.segments ?? [])).toBe(third?.bytes);

      // (4) THE REPORT, CORRECTED. Every dimension here has an excerpt in its
      // prompt, so "NO deliverable source" is the sentence that must not appear.
      expect(prompt).toContain('## Evidence delivery reachability (structural)');
      for (const dimension of FOUR) {
        expect(prompt).toContain(`- ${dimension}: EXCERPT ONLY`);
      }
      expect(prompt).not.toContain('NO deliverable source');

      // (5) The ENVELOPE repeats it, and the dimension is still red — an
      // excerpt is a head, not the document, so it may not back a `pass`.
      for (const dimension of FOUR) {
        const entry = out.dimensions.find((d) => d.dimension === dimension);
        expect(entry?.verdict).toBe('inconclusive');
        expect(entry?.summary).toContain('delivery-reachability');
        expect(entry?.summary).toContain('bounded EXCERPT');
        expect(entry?.summary).toContain('inlined as an excerpt');
        expect(entry?.summary).toContain('withheld');
      }
      expect(out.allPass).toBe(false);
      expect([...out.needsAttention].sort()).toEqual([...FOUR].sort());
    }
  );

  it('bounds the excerpt at the per-file cap and the whole set at the total budget', () => {
    const root = makeProject();
    writeMeasuredOversizedSet(root);

    const collected = collectEvidence(root, SESSION_ID, RID, false);
    const inlined = collected.reduce((sum, item) => sum + item.includedBytes, 0);

    // Not "smaller" — BOUNDED. Each excerpt is exactly the unit the allocator
    // hands out, and their sum cannot exceed the total budget.
    for (const item of collected) {
      expect(item.includedBytes).toBeLessThanOrEqual(MAX_EVIDENCE_BYTES_PER_FILE);
    }
    expect(inlined).toBe(3 * MAX_EVIDENCE_BYTES_PER_FILE);
    expect(inlined).toBeLessThanOrEqual(MAX_EVIDENCE_BYTES_TOTAL);
  });

  it(
    'still bounds the prompt when the evidence set is far larger than the budget',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const root = makeProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      // Nine sources x 40 KiB on disk = 360 KiB of raw evidence. Partial
      // delivery must not become a way for the prompt to grow with the input.
      writeAllEvidence(root, 'X'.repeat(40 * 1024));

      const { runner, calls } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });
      const prompt = calls[0]?.userPrompt ?? '';

      const inlined = collectEvidence(root, SESSION_ID, RID, false);
      const spent = inlined.reduce((sum, item) => sum + item.includedBytes, 0);
      // The budget is spent TO THE BYTE, and the sources it could not reach are
      // OMITTED — the excerpt path does not quietly buy them more room.
      expect(spent).toBe(MAX_EVIDENCE_BYTES_TOTAL);
      expect(inlined.filter((item) => item.status === 'omitted').length).toBeGreaterThan(0);
      expect(prompt).toContain('MISSING (omitted)');
      expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThanOrEqual(
        MAX_EVIDENCE_BYTES_TOTAL + 10 * 1024
      );
    }
  );

  it(
    'delivers a source UNDER the cap whole and byte-identical to the file on disk',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const root = makeProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      // 6,286 bytes is the source size that carried the ONE dimension this
      // review could judge on 2026-10-12: under the cap, so it arrives whole.
      const body = sized('QA-REPORT', 6286);
      writeUnderProject(root, ['qa', 'test-reports', `${RID}.md`], body);

      const { runner, calls } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });
      const prompt = calls[0]?.userPrompt ?? '';

      // Byte-identical to the file on disk — compared, not restated.
      expect(excerptContent(prompt, 'qa-test-report')).toBe(
        readFileSync(
          join(root, '.peaks', '_runtime', SESSION_ID, 'qa', 'test-reports', `${RID}.md`),
          'utf8'
        )
      );
      expect(statusLine(prompt, 'qa-test-report')).toBe(
        `STATUS: FOUND at .peaks/_runtime/${SESSION_ID}/qa/test-reports/${RID}.md — 6286 bytes`
      );
      expect(prompt).not.toContain('TRUNCATED EXCERPT');
      expect(prompt).not.toContain('## Evidence delivery reachability');
    }
  );

  it('reports NO deliverable source only when nothing was inlined for the dimension', () => {
    // The input the other branch exists to reject: the same oversized source,
    // but the allocator never reached it. This is the ONLY state in which "no
    // evidence reached the reviewer" is a true sentence, and it is driven
    // directly so the branch is exercised rather than assumed.
    const overCap = (
      key: string,
      supports: readonly DimensionKind[],
      inlined: boolean
    ): CollectedEvidence => ({
      source: { key, label: key, segments: [`${key}.md`], supports, delivery: { kind: 'whole' } },
      relativePath: `.peaks/_runtime/${SESSION_ID}/${key}.md`,
      absolutePath: join('/nonexistent', `${key}.md`),
      status: inlined ? 'found' : 'omitted',
      totalBytes: 42335,
      includedBytes: inlined ? MAX_EVIDENCE_BYTES_PER_FILE : 0,
      excerpt: inlined,
      content: inlined ? 'x'.repeat(MAX_EVIDENCE_BYTES_PER_FILE) : '',
      reason: inlined ? '' : 'the total evidence budget is exhausted'
    });

    const silent = undeliverableDimensions([overCap('qa-test-report', ['no-new-bugs'], false)]);
    expect(silent).toHaveLength(1);
    expect(silent[0]?.excerptDelivered).toBe(false);
    expect(silent[0]?.sources[0]?.excerptBytes).toBe(0);

    // ...and the SAME source, once inlined as an excerpt, is the other state —
    // so the flag is measuring delivery and not the file's size.
    const excerpted = undeliverableDimensions([overCap('qa-test-report', ['no-new-bugs'], true)]);
    expect(excerpted).toHaveLength(1);
    expect(excerpted[0]?.excerptDelivered).toBe(true);
    expect(excerpted[0]?.sources[0]?.excerptBytes).toBe(MAX_EVIDENCE_BYTES_PER_FILE);
    expect(excerpted[0]?.sources[0]?.totalBytes).toBe(42335);

    // A source that fits the cap is not this report's business at all.
    expect(
      undeliverableDimensions([
        {
          ...overCap('qa-test-report', ['no-new-bugs'], true),
          totalBytes: 4096,
          includedBytes: 4096
        }
      ])
    ).toHaveLength(0);
  });
});
