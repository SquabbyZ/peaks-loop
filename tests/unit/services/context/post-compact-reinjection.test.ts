/**
 * T1/T3 of rid `2026-09-13-a2-post-compact-reinject`.
 *
 * The re-injection card is the OTHER half of the auto-compact contract: the
 * harness performs the compaction, and something has to put the engineering
 * state back into the context the compaction just emptied.
 *
 * What these cases can and cannot prove.
 *
 * They CAN prove, for any budget:
 *   - the card is never wider than the budget (the truncation rule is a
 *     function, so the property is checked over a matrix of budgets);
 *   - what survives when the budget is tight is decided by RANK, and the rule
 *     is the same for every budget (no "fit what fits");
 *   - every source that can be missing produces an omitted block, never a
 *     throw and never an empty-looking success.
 *
 * They CANNOT prove that the card reaches the model after a REAL compaction —
 * there is no way to trigger a harness compaction from inside a unit test, and
 * the harness's own capture of hook stdout is not observable from here. That
 * residual is named in the RD report rather than papered over.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  AGENT_RUNTIME_RULES,
  POST_COMPACT_REINJECTION_BYTE_BUDGET,
  REINJECTION_BLOCK_RANKS,
  buildPostCompactReinjectionCard,
  renderReinjectionCard,
  type ReinjectionBlock
} from '~/src/services/context/post-compact-reinjection';

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function block(rank: number, heading: string, bodyBytes: number): ReinjectionBlock {
  return { rank, heading, label: heading.toLowerCase(), lines: ['x'.repeat(bodyBytes)] };
}

describe('behavior — post-compact re-injection card stays inside its budget', () => {
  const tmpRoots: string[] = [];

  afterEach(() => {
    for (const root of tmpRoots) {
      try {
        if (existsSync(root)) rmSync(root, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
    tmpRoots.length = 0;
  });

  function makeTempProjectRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'peaks-reinject-'));
    tmpRoots.push(root);
    return root;
  }

  it('when a budget is given, should never emit a card wider than it, for every budget', () => {
    // given: a fixed set of blocks whose total is far larger than the small
    //        budgets below, so the truncation path is definitely exercised
    const blocks: ReinjectionBlock[] = [
      block(0, 'TITLE', 40),
      block(1, 'POINTERS', 200),
      block(2, 'RULES', 300),
      block(3, 'NEXT', 100)
    ];
    // when: the card is rendered at every budget from 0 to the full size
    for (let budget = 0; budget <= 900; budget += 7) {
      const card = renderReinjectionCard({ blocks, budgetBytes: budget });
      // then: the budget is an upper bound that is never exceeded — by a byte
      expect(byteLength(card.text), `budget ${budget}`).toBeLessThanOrEqual(budget);
      // ...and it is reported honestly rather than as "it all fit"
      expect(card.budgetBytes).toBe(budget);
      expect(card.bytes).toBe(byteLength(card.text));
      if (budget === 0) expect(card.text).toBe('');
      if (card.text.length > 0) expect(card.emittedRanks.length).toBeGreaterThan(0);
    }
  });

  it('when the budget is tight, should drop by RANK and never split a block', () => {
    // given: four blocks that each fit alone but not together. The byte costs
    //        are spelled out so the two budgets below can be checked by hand:
    //        TITLE 5+1+2+40 = 48, POINTERS 8+1+2+400 = 411,
    //        RULES 5+1+2+400 = 408, NEXT 4+1+2+400 = 407, separator = 2.
    //        Title + POINTERS = 48 + 2 + 411 = 461; adding RULES = 871.
    const blocks: ReinjectionBlock[] = [
      block(0, 'TITLE', 40),
      block(1, 'POINTERS', 400),
      block(2, 'RULES', 400),
      block(3, 'NEXT', 400)
    ];
    // when: 800 admits title + POINTERS but not RULES; 60 admits only the title
    const titleAndOne = renderReinjectionCard({ blocks, budgetBytes: 800 });
    const titleOnly = renderReinjectionCard({ blocks, budgetBytes: 60 });
    // then: the higher rank wins, and the lower ranks are reported as dropped
    expect(titleAndOne.emittedRanks).toEqual([0, 1]);
    expect(titleAndOne.droppedRanks).toEqual([2, 3]);
    expect(titleOnly.emittedRanks).toEqual([0]);
    expect(titleOnly.droppedRanks).toEqual([1, 2, 3]);
    // ...and a dropped block leaves no fragment of itself behind: the RULES
    // heading is absent as a HEADING LINE, not present with a truncated body.
    // The match is anchored, because the dropped ranks are also NAMED on the
    // one-line omitted marker — which is the positive control below.
    expect(titleAndOne.text).not.toMatch(/(^|\n)RULES\n/);
    expect(titleOnly.text).not.toMatch(/(^|\n)POINTERS\n/);
    expect(titleAndOne.text).toMatch(/omitted \(budget 800B\): rules, next/);
    // ...and the marker is ALL-OR-NOTHING: at a budget too small to hold it,
    // no marker is emitted at all rather than a truncated one, so nothing in
    // the card is ever cut mid-string and the byte accounting stays exact.
    // The drop is still reported — through `droppedRanks`, not through text.
    expect(titleOnly.text).not.toContain('omitted');
    expect(titleOnly.droppedRanks).toEqual([1, 2, 3]);
  });

  it('when a low-rank block is oversized, should still emit the smaller lower-priority ones', () => {
    // The rule is greedy by rank-and-skip, not stop-at-first-miss. This is the
    // case that tells them apart, and the reason the greedy rule was chosen:
    // an oversized CURRENT WORK block must not evict the hard-constraint rules
    // that sit below it.
    // given: a huge rank-3 block between two small ones
    const blocks: ReinjectionBlock[] = [
      block(0, 'TITLE', 40),
      block(3, 'CURRENT WORK', 5000),
      block(4, 'NEXT', 60)
    ];
    // when: the budget cannot hold the huge block
    const card = renderReinjectionCard({ blocks, budgetBytes: 400 });
    // then: the huge block is dropped and the block after it is still emitted
    expect(card.droppedRanks).toEqual([3]);
    expect(card.emittedRanks).toEqual([0, 4]);
    expect(card.text).toContain('NEXT');
  });

  it('when blocks are rendered, should order them by rank regardless of input order', () => {
    // given: the blocks handed over out of order
    const blocks: ReinjectionBlock[] = [block(2, 'RULES', 30), block(0, 'TITLE', 20), block(1, 'POINTERS', 30)];
    // when: the card is rendered with room for all of them
    const card = renderReinjectionCard({ blocks, budgetBytes: 1000 });
    // then: the emitted order is the rank order, not the caller's order
    expect(card.emittedRanks).toEqual([0, 1, 2]);
    expect(card.text.indexOf('TITLE')).toBeLessThan(card.text.indexOf('POINTERS'));
    expect(card.text.indexOf('POINTERS')).toBeLessThan(card.text.indexOf('RULES'));
  });

  it('when the default budget is used, should be the declared constant', () => {
    // The number is the design, so it is pinned by name: a silent widening of
    // the re-injection (the failure mode this whole budget exists to prevent —
    // re-filling the context the compaction just freed) has to fail a test.
    expect(POST_COMPACT_REINJECTION_BYTE_BUDGET).toBe(3072);
    const card = renderReinjectionCard({ blocks: [block(0, 'TITLE', 10)] });
    expect(card.budgetBytes).toBe(POST_COMPACT_REINJECTION_BYTE_BUDGET);
  });

  it('when the rules block is rendered, should carry the runtime rules that compaction destroys', () => {
    // given: the repo-owned rule list (not parsed from any prompt — see the
    //        service header for why)
    // then: each of the runtime facts this session has already lost once is
    //       present, and the list stays a list of one-liners
    expect(AGENT_RUNTIME_RULES.length).toBeGreaterThan(0);
    const joined = AGENT_RUNTIME_RULES.join('\n');
    expect(joined).toContain('--import tsx');
    expect(joined).toContain('pnpm exec tsx');
    expect(joined).toContain('PEAKS_FULL_TEST=1');
    expect(joined).toContain('PIPESTATUS');
    expect(joined).toContain('settings.local.json');
    expect(joined).toContain('dispatch record');
    for (const rule of AGENT_RUNTIME_RULES) {
      expect(rule).not.toContain('\n');
    }
  });
});

describe('behavior — post-compact re-injection reads only what exists', () => {
  const tmpRoots: string[] = [];

  afterEach(() => {
    for (const root of tmpRoots) {
      try {
        if (existsSync(root)) rmSync(root, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
    tmpRoots.length = 0;
  });

  function makeTempProjectRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'peaks-reinject-fs-'));
    tmpRoots.push(root);
    return root;
  }

  it('when the project has no session at all, should return a card and never throw', () => {
    // given: an empty directory with no `.peaks` tree, no binding, no job
    const root = makeTempProjectRoot();
    // when: the card is built
    const card = buildPostCompactReinjectionCard({ projectRoot: root });
    // then: it succeeds with the pointer/rule blocks and reports what it
    //       could not resolve — a hook that throws here makes session start
    //       fragile, which is the one thing it must never do
    expect(card.ok).toBe(true);
    expect(card.text.length).toBeGreaterThan(0);
    expect(card.text).toContain('--import tsx');
    expect(card.sessionId).toBeNull();
    expect(card.unresolved.length).toBeGreaterThan(0);
  });

  it('when a session tree exists, should point at it instead of inlining it', () => {
    // given: a bound session whose runtime tree carries a job + a request
    const root = makeTempProjectRoot();
    const sid = '2026-09-12-session-reinjt';
    const sess = join(root, '.peaks', '_runtime', sid);
    mkdirSync(join(sess, 'job', 'j-demo-1'), { recursive: true });
    mkdirSync(join(sess, 'rd', 'requests'), { recursive: true });
    writeFileSync(
      join(sess, 'job', 'j-demo-1', 'progress.json'),
      JSON.stringify({
        schemaVersion: 1,
        jobId: 'j-demo-1',
        done: 2,
        total: 5,
        currentSlice: 'a2-post-compact-reinject',
        lastCommitSha: null,
        updatedAt: '2026-09-13T06:00:00.000Z'
      }),
      'utf8'
    );
    writeFileSync(join(sess, 'rd', 'requests', '2026-09-13-a2-post-compact-reinject.md'), 'x', 'utf8');
    writeFileSync(
      join(sess, 'job-shape.json'),
      JSON.stringify({
        sessionId: sid,
        promptHash: 'a'.repeat(16),
        decision: {
          isJob: true,
          rationale: 'multi-slice work',
          suggestedJobId: 'j-demo-1',
          suggestedStrategy: 'rotating',
          confidence: 'high',
          decidedAt: '2026-09-13T05:00:00.000Z'
        },
        schemaVersion: 1
      }),
      'utf8'
    );
    // when: the card is built
    const card = buildPostCompactReinjectionCard({ projectRoot: root, sessionId: sid });
    // then: the card NAMES where to read and the progress numbers, and does
    //       NOT inline the request body or the job state file
    expect(card.ok).toBe(true);
    expect(card.sessionId).toBe(sid);
    expect(card.text).toContain(`.peaks/_runtime/${sid}`);
    expect(card.text).toContain('j-demo-1');
    expect(card.text).toContain('2/5');
    expect(card.text).toContain('rd/requests/2026-09-13-a2-post-compact-reinject.md');
    expect(card.text).not.toContain('multi-slice work');
    // ...and the whole thing still fits the budget
    expect(byteLength(card.text)).toBeLessThanOrEqual(POST_COMPACT_REINJECTION_BYTE_BUDGET);
  });

  it('when a source is corrupt, should omit its block instead of failing the card', () => {
    // given: a session whose job-state files are unparseable
    const root = makeTempProjectRoot();
    const sid = '2026-09-12-session-broken';
    const sess = join(root, '.peaks', '_runtime', sid);
    mkdirSync(join(sess, 'job', 'j-x'), { recursive: true });
    writeFileSync(join(sess, 'job-shape.json'), '{not json', 'utf8');
    writeFileSync(join(sess, 'job', 'j-x', 'progress.json'), 'also not json', 'utf8');
    // when: the card is built
    const card = buildPostCompactReinjectionCard({ projectRoot: root, sessionId: sid });
    // then: the card still renders, the identity block is still there, and the
    //       unreadable parts are reported rather than rendered as empty facts
    expect(card.ok).toBe(true);
    expect(card.sessionId).toBe(sid);
    expect(card.text).toContain(sid);
    expect(card.unresolved.length).toBeGreaterThan(0);
  });

  it('when the block ranks are declared, should be the single ordered contract', () => {
    // then: every rank the renderer can emit is declared once, in order —
    //       the drop rule reads this list, so an unlisted rank would be a
    //       block that can never be prioritized
    expect([...REINJECTION_BLOCK_RANKS]).toEqual([...REINJECTION_BLOCK_RANKS].slice().sort((a, b) => a - b));
    expect(new Set(REINJECTION_BLOCK_RANKS).size).toBe(REINJECTION_BLOCK_RANKS.length);
    expect(REINJECTION_BLOCK_RANKS.length).toBeGreaterThan(0);
  });
});
