// tests/unit/services/dispatch/karpathy-block.test.ts
//
// The Karpathy block used to be a prompt ritual: the RD dispatch reference told
// the orchestrator to append it verbatim and admitted that nothing asserted its
// presence. Measured 2026-10-12: four RD dispatch prompts carried zero
// occurrences of `Karpathy`, and a later reviewer fan-out appended a block with
// one word wrong. This file pins the executor that replaced the ritual.
//
// Dimensions covered:
//   - behavior:    a draft without the block gets it; a draft that already
//                  carries it is returned byte-identically
//   - integration: the canonical constant is byte-equal to the fenced block in
//                  the reference file, so the machine copy cannot drift
//   - render:      not applicable (returns a string, no structured surface)
//   - a11y:        not applicable (no user-visible text or exit code)

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  KARPATHY_GUIDELINES_BLOCK,
  ensureKarpathyBlock
} from '../../../../src/services/dispatch/karpathy-block.js';

declareDimensions(
  'tests/unit/services/dispatch/karpathy-block.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'returns a string, no structured output surface' },
    { dim: 'a11y', reason: 'no user-visible text or exit code' }
  ]
);

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

const countOccurrences = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

/**
 * The draft the caller hands to `peaks sub-agent dispatch`, exactly as the
 * preflight resolves it: no block anywhere in it.
 */
const DRAFT_WITHOUT_BLOCK = [
  '## Task',
  '',
  'Fix the failing statusline test and report back.',
  ''
].join('\n');

/** A block the caller copied with ONE word changed — the measured failure. */
const BLOCK_ONE_WORD_WRONG = KARPATHY_GUIDELINES_BLOCK.replace(
  'Minimum code that solves the problem.',
  'Minimum code that solves the problem quickly.'
);

describe('Scenario: behavior — a draft that lacks the block receives it', () => {
  it('when the caller draft carries no block, should deliver the canonical block to the prompt', () => {
    // given: a caller-supplied prompt with no block in it
    expect(DRAFT_WITHOUT_BLOCK).not.toContain('Karpathy');
    // when:  the dispatch composer ensures the block
    const out = ensureKarpathyBlock(DRAFT_WITHOUT_BLOCK);
    // then:  the child's prompt carries the canonical block exactly once, and
    //        the caller's own text is still there verbatim
    expect(out).toContain(KARPATHY_GUIDELINES_BLOCK);
    expect(countOccurrences(out, KARPATHY_GUIDELINES_BLOCK)).toBe(1);
    expect(out).toContain(DRAFT_WITHOUT_BLOCK);
    expect(out.length).toBeGreaterThan(DRAFT_WITHOUT_BLOCK.length);
  });

  it('when the caller only names Karpathy without carrying the block, should still deliver the canonical block', () => {
    // given: a draft that mentions the word — a role name, a passing reference
    const draft = '## Task\n\nRun the karpathy-reviewer fan-out for this slice.\n';
    // when:  the block is ensured
    const out = ensureKarpathyBlock(draft);
    // then:  naming Karpathy is not carrying it; the canonical text is added
    expect(countOccurrences(out, KARPATHY_GUIDELINES_BLOCK)).toBe(1);
  });

  it('when the caller carries a copy with one word wrong, should treat it as absent and add the canonical block', () => {
    // given: a block copied with a single word changed — the input the verbatim
    //        rule exists to reject
    const draft = `${DRAFT_WITHOUT_BLOCK}\n${BLOCK_ONE_WORD_WRONG}`;
    expect(draft).toContain('Karpathy-guidelines context');
    expect(draft).not.toContain(KARPATHY_GUIDELINES_BLOCK);
    // when:  the block is ensured
    const out = ensureKarpathyBlock(draft);
    // then:  the canonical text is present (the child reads the right words),
    //        and the near-miss copy did NOT satisfy the presence test
    expect(out).toContain(KARPATHY_GUIDELINES_BLOCK);
    expect(out).not.toBe(draft);
  });
});

describe('Scenario: behavior — a draft that already carries the block is byte-identical', () => {
  it('when the caller prompt already carries the block, should return it byte-identically', () => {
    // given: a compliant draft — the block is already there, verbatim
    const compliant = `${DRAFT_WITHOUT_BLOCK}\n\n${KARPATHY_GUIDELINES_BLOCK}`;
    // when:  the block is ensured
    const out = ensureKarpathyBlock(compliant);
    // then:  no double-append and no reflow: same bytes, proven by hash
    expect(out).toBe(compliant);
    expect(sha(out)).toBe(sha(compliant));
    expect(countOccurrences(out, KARPATHY_GUIDELINES_BLOCK)).toBe(1);
  });

  it('when a composed prompt already carries the block, should be idempotent', () => {
    // given: the output of the first application
    const once = ensureKarpathyBlock(DRAFT_WITHOUT_BLOCK);
    // when:  it is applied again
    const twice = ensureKarpathyBlock(once);
    // then:  the second application changes nothing
    expect(twice).toBe(once);
    expect(sha(twice)).toBe(sha(once));
  });
});

describe('Scenario: behavior — the trailing boundary is not part of the block', () => {
  it('when the caller copy lost its final newline to a shell round-trip, should not append a second copy', () => {
    // given: the real input that produced a duplicate — `--prompt
    //        "$(cat prompt.txt)"` strips the trailing newline, so the CLI
    //        received the canonical block minus its last byte
    const viaShell = `${DRAFT_WITHOUT_BLOCK}\n\n${KARPATHY_GUIDELINES_BLOCK}`.replace(/\n$/, '');
    expect(viaShell).not.toContain(KARPATHY_GUIDELINES_BLOCK);
    expect(viaShell.endsWith(KARPATHY_GUIDELINES_BLOCK)).toBe(false);
    // when:  the block is ensured
    const out = ensureKarpathyBlock(viaShell);
    // then:  no second copy: the prompt is returned byte-identically
    expect(out).toBe(viaShell);
    expect(sha(out)).toBe(sha(viaShell));
    // one copy, counted on the block's text (the one byte the shell ate is the
    // boundary, not content)
    expect(countOccurrences(out, KARPATHY_GUIDELINES_BLOCK.trimEnd())).toBe(1);
  });

  it('when the caller copy uses CRLF line endings, should not append a second copy', () => {
    // given: a copy whose line endings differ from the constant (a Windows
    //        checkout of the reference file is the realistic source)
    const crlf = `${DRAFT_WITHOUT_BLOCK}\n\n${KARPATHY_GUIDELINES_BLOCK}`.replace(/\n/g, '\r\n');
    // when:  the block is ensured
    const out = ensureKarpathyBlock(crlf);
    // then:  the copy counts as present and nothing is appended
    expect(out).toBe(crlf);
    expect(countOccurrences(out, KARPATHY_GUIDELINES_BLOCK.replace(/\n/g, '\r\n'))).toBe(1);
  });

  it('when the caller copy keeps only the header and a changed body, should inject the canonical block anyway', () => {
    // given: the near-miss — same header line, different body text. This is the
    //        stated policy of `ensureKarpathyBlock`: the body is not normalized
    //        away, because a header alone would accept a wrong body.
    const nearMiss = `${DRAFT_WITHOUT_BLOCK}\n\n${KARPATHY_GUIDELINES_BLOCK.replace(
      'Minimum code that solves the problem.',
      'Minimum code that solves the problem quickly.'
    )}`;
    // when:  the block is ensured
    const out = ensureKarpathyBlock(nearMiss);
    // then:  the canonical block is present (the child reads the right words),
    //        the caller's copy is left in place, and the two are told apart by
    //        the canonical body rather than by the heading
    expect(out).not.toBe(nearMiss);
    expect(countOccurrences(out, KARPATHY_GUIDELINES_BLOCK)).toBe(1);
    expect(countOccurrences(out, 'Karpathy-guidelines context (REQUIRED')).toBe(2);
  });
});

describe('Scenario: behavior — the presence test runs on the assembled prompt', () => {
  it('when the check runs on the draft instead of the assembled prompt, should be able to inject twice', () => {
    // given: an assembled prompt = the caller's draft + the isolation /
    //        must-ls-files blocks the composer appends after it. A second
    //        injection site keyed on the DRAFT cannot see that the assembled
    //        prompt may already carry the block.
    const assembled = `${DRAFT_WITHOUT_BLOCK}\n## Isolation\n\nworktree: /tmp/wt\n`;
    const assembledWithBlock = ensureKarpathyBlock(assembled);
    const fromDraftOnly = ensureKarpathyBlock(DRAFT_WITHOUT_BLOCK);
    // when:  the two readings are compared on the SAME assembled text
    const expandedKeyedCount = countOccurrences(assembledWithBlock, KARPATHY_GUIDELINES_BLOCK);
    const draftKeyedCount = countOccurrences(
      `${assembledWithBlock}\n${fromDraftOnly}`,
      KARPATHY_GUIDELINES_BLOCK
    );
    // then:  the assembled-prompt check yields one copy; the draft-keyed check
    //        yields two. The two readings differ, which is why the production
    //        call site runs on `effectivePrompt`.
    expect(expandedKeyedCount).toBe(1);
    expect(draftKeyedCount).toBe(2);
    expect(expandedKeyedCount).not.toBe(draftKeyedCount);
  });
});

describe('Scenario: integration — the machine copy cannot drift from the reference', () => {
  it('when the reference file and the constant are compared, should be byte-equal', () => {
    // given: the canonical human-facing block, fenced in the RD dispatch
    //        reference's §"Karpathy-guidelines context"
    const reference = readFileSync(
      join(repoRoot, 'skills', 'bee', 'peaks-rd', 'references', 'rd-sub-agent-dispatch.md'),
      'utf8'
    );
    const heading = '## Karpathy-guidelines context';
    const start = reference.indexOf(heading);
    expect(start, `the reference must carry ${heading}`).toBeGreaterThanOrEqual(0);
    const section = reference.slice(start);
    const fenced = /```\n([\s\S]*?)\n```/.exec(section);
    expect(fenced, 'the reference must still carry a fenced block').not.toBeNull();
    // when:  it is compared with the constant the dispatch composer injects
    const referenceBlock = `${fenced?.[1] ?? ''}\n`;
    // then:  the two are the same bytes, so the machine copy cannot drift
    expect(referenceBlock).toBe(KARPATHY_GUIDELINES_BLOCK);
    expect(sha(referenceBlock)).toBe(sha(KARPATHY_GUIDELINES_BLOCK));
  });
});
