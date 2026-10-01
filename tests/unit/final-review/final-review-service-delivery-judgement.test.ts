// tests/unit/final-review/final-review-service-delivery-judgement.test.ts
//
// H2 reachability statements, 1.3 content-delivery judgement and the F2
// drift-reading block, split verbatim out of `final-review-service.test.ts`
// (C wave 7 file-size work).

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_EVIDENCE_BYTES_PER_FILE,
  prepareFinalReview,
} from '~/src/services/final-review/final-review-service';
import {
  RID,
  SESSION_ID,
  allVerdicts,
  captureRunner,
  git,
  makeGitProject,
  makeProject,
  reviewJson,
  writeAllEvidence,
  writeAuditGoal,
  writeRealSizedEvidence,
  writeUnderProject,
} from './final-review-service-helpers.js';
import {
  HEAVY_SUBPROCESS_TEST_TIMEOUT_MS,
  SUBPROCESS_TEST_TIMEOUT_MS
} from '../_setup/subprocess-timeouts.js';

// ---------------------------------------------------------------------------
// H2 — an always-red gate that does not say why.
//
// Measured (stub LLM against a real session's artifacts, real prompt captured):
// only 4 of the 10 sources reached the prompt and 3 survived the `whole` rule,
// so `problem-resolution` and `no-new-bugs` had exactly ONE deliverable source
// between them — `qa/test-reports/<rid>.md`, 9,492 bytes — against a per-file
// cap of 10,240. 748 bytes of margin, on a file that is rewritten every round
// and only grows. The moment it crosses 10,240 both dimensions go red
// permanently, and `assertFloorReservationAffordable()` cannot see it: that
// assertion only checks the constant-level relation (`4 x cap <= total`), never
// whether an ACTUAL source fits the cap it must live under. So the handoff read
// as "the reviewer was unsure" when the truth was "no evidence for these two
// dimensions can EVER reach the reviewer".
//
// The tests below assert both halves of the fix: the impossibility is STATED
// (prompt + envelope + needsAttention), and it is stated only when it is real —
// a source that merely lost the budget today must not be tarred with it, or the
// report becomes the next always-red signal to be tuned out.
// ---------------------------------------------------------------------------
describe('prepareFinalReview — an undeliverable dimension is stated, never silent (H2)', () => {
  /** One byte over the cap: the smallest file the `whole` rule can never deliver. */
  const OVER_CAP = MAX_EVIDENCE_BYTES_PER_FILE + 1;

  /**
   * The reachability section's own lines, or '' when the service emitted none.
   * The bullet lines are matched with their leading `- `, which appears nowhere
   * else in the prompt.
   */
  function reachabilityBullets(prompt: string): string {
    const at = prompt.indexOf('## Evidence delivery reachability');
    return at === -1 ? '' : prompt.slice(at);
  }

  it('names the byte arithmetic in the prompt and the envelope instead of going quietly red', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    // The ONLY source on disk, and it is one byte over the per-file cap — so
    // under the `whole` delivery rule it can never be delivered, on this run or
    // on any other, whatever the total budget is raised to.
    writeUnderProject(root, ['qa', 'test-reports', `${RID}.md`], 'X'.repeat(OVER_CAP));

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const prompt = calls[0]?.userPrompt ?? '';
    // (1) The ARTIFACT the reviewer is given states the fact...
    expect(prompt).toContain('## Evidence delivery reachability (structural)');
    expect(prompt).toContain('qa-test-report');
    expect(prompt).toContain(`${OVER_CAP} bytes`);
    expect(prompt).toContain(`per-file cap of ${MAX_EVIDENCE_BYTES_PER_FILE} bytes`);
    expect(prompt).toContain('WHOLE or not at all');
    expect(reachabilityBullets(prompt)).toContain('- problem-resolution: NO deliverable source.');
    expect(reachabilityBullets(prompt)).toContain('- no-new-bugs: NO deliverable source.');

    // (2) ...and the ENVELOPE repeats it on each dimension it is true of, so the
    // human is told WHY it is red rather than left to read it as uncertainty.
    for (const dimension of [
      'functional-completeness',
      'problem-resolution',
      'no-new-bugs'
    ] as const) {
      const entry = out.dimensions.find((d) => d.dimension === dimension);
      expect(entry?.verdict).toBe('inconclusive');
      expect(entry?.summary).toContain('delivery-reachability');
      expect(entry?.summary).toContain(String(OVER_CAP));
      expect(entry?.summary).toContain(`cap of ${MAX_EVIDENCE_BYTES_PER_FILE} bytes`);
      // Named in `needsAttention` — the field the CLI envelope prints — and it
      // clears `allPass` like any other non-`pass` verdict does.
      expect(out.needsAttention).toContain(dimension);
    }
    expect(out.allPass).toBe(false);
  });

  it('reports only the dimensions that really have nothing deliverable left', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeUnderProject(root, ['qa', 'test-reports', `${RID}.md`], 'X'.repeat(OVER_CAP));
    // A second, small source for ONE of the three dimensions the oversize
    // report backs. It arrives whole, so `problem-resolution` is judged on
    // delivered evidence and must not be reported — the gate is targeted, not a
    // blanket over every dimension named by an oversize file.
    writeUnderProject(root, ['rd', 'bug-analysis.md'], '# bug analysis\n\noriginal repro\n');

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const section = reachabilityBullets(calls[0]?.userPrompt ?? '');
    expect(section).toContain('- functional-completeness: NO deliverable source.');
    expect(section).toContain('- no-new-bugs: NO deliverable source.');
    expect(section).not.toContain('- problem-resolution:');
    const resolved = out.dimensions.find((d) => d.dimension === 'problem-resolution');
    expect(resolved?.verdict).toBe('pass');
    expect(resolved?.summary).not.toContain('delivery-reachability');
  });

  it('does not cry undeliverable over a source that only lost the budget today', async () => {
    // Every source is EXACTLY the per-file cap, so all nine are structurally
    // DELIVERABLE and what starves them is the reservation: four units fit
    // 40,960 bytes and five do not. `existing-functionality-intact`'s two
    // sources are both in the part that does not fit, so that dimension is red
    // on this run — for a reason the allocator already states per source, and
    // which a larger budget or a smaller document would fix. Calling that
    // "undeliverable forever" would be a false claim, and a report that cries
    // wolf is the noise the floor was built to remove.
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeAllEvidence(root, '', MAX_EVIDENCE_BYTES_PER_FILE);

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const prompt = calls[0]?.userPrompt ?? '';
    expect(prompt).not.toContain('## Evidence delivery reachability');
    // The starvation is still stated, by the layer that owns it.
    expect(prompt).toContain('bytes of the budget are reserved for dimension(s)');
    const intact = out.dimensions.find((d) => d.dimension === 'existing-functionality-intact');
    expect(intact?.verdict).toBe('inconclusive');
    expect(intact?.summary).not.toContain('delivery-reachability');
  });

  it('says nothing when no source was ever written (there is no delivery to fail)', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);

    const { runner, calls } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    await prepareFinalReview(RID, { projectRoot: root, sessionId: SESSION_ID, llmRunner: runner });

    // A run with no QA phase has no report to lose — the same reasoning the
    // scope-contract gate uses for `missing`. Nothing is claimed about a
    // document that was never written.
    expect(calls[0]?.userPrompt ?? '').not.toContain('## Evidence delivery reachability');
  });
});

describe('prepareFinalReview — delivery is a content judgement (1.3)', () => {
  it(
    'does not count a truncated document as delivered evidence for its dimension',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // The QA round-5 probe, reproduced: ONE source, 20,545 bytes, whose first
      // 10,240 bytes are front matter with no findings in them. Pre-fix the
      // service answered "functional-completeness has evidence" from the source
      // merely being INLINED, so all four verdicts came back `pass`/`high` — the
      // service could not tell "the model read the findings" from "the model read
      // the table of contents".
      const root = makeGitProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      writeUnderProject(
        root,
        ['qa', 'test-reports', `${RID}.md`],
        `# front matter\n\n${'table of contents '.repeat(700)}\n`
      );

      const { runner } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      const out = await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });

      // The dimension's only supporting source was inlined as a head slice, so the
      // dimension has no DELIVERED evidence and the pass cannot stand. The three
      // dimensions that source backs are all downgraded for the same reason; the
      // 4th is delivered its baseline and keeps its pass.
      for (const dimension of [
        'functional-completeness',
        'problem-resolution',
        'no-new-bugs'
      ] as const) {
        const entry = out.dimensions.find((d) => d.dimension === dimension);
        expect(entry?.verdict).toBe('inconclusive');
        expect(entry?.confidence).toBe('low');
        expect(entry?.summary).toContain('evidence-gate');
      }
      expect(out.allPass).toBe(false);
      expect([...out.needsAttention].sort()).toEqual([
        'functional-completeness',
        'no-new-bugs',
        'problem-resolution'
      ]);
    }
  );

  it(
    'counts a source that arrived WHOLE as delivered evidence',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // The other half of the same judgement, so the rule cannot be satisfied by
      // making everything red: 9,492 bytes is under the per-file cap, so the
      // source arrives whole and the dimension it backs is judgeable.
      const root = makeGitProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      writeRealSizedEvidence(root);

      const { runner } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      const out = await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });

      const report = out.dimensions.find((d) => d.dimension === 'no-new-bugs');
      expect(report?.verdict).toBe('pass');
      expect(report?.summary).not.toContain('evidence-gate');
    }
  );
});

describe('prepareFinalReview — a delivered drift conclusion is read (F2)', () => {
  /**
   * A real structural removal on the compared surface: the file exists at the
   * base ref and the working tree no longer exports it — which is the one
   * change class `pre-post-diff.ts` exists to detect, and the one QA used.
   */
  function makeDriftedGitProject(): string {
    const root = makeGitProject();
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'src', 'surface.ts'),
      'export const kept = 1;\nexport const dropped = 2;\n',
      'utf8'
    );
    git(root, ['add', 'src/surface.ts']);
    git(root, ['commit', '-q', '-m', 'add surface']);
    // A second commit, so the resolved base (`HEAD~1`, there is no remote) is
    // the state that still HAS both exports: the removal has to be measured
    // against that, not against a revision where the file did not exist yet.
    writeFileSync(join(root, 'README.md'), '# fixture\n\nthird line\n', 'utf8');
    git(root, ['add', 'README.md']);
    git(root, ['commit', '-q', '-m', 'third']);
    writeFileSync(join(root, 'src', 'surface.ts'), 'export const kept = 1;\n', 'utf8');
    return root;
  }

  it(
    'forces a detected structural drift into needsAttention, however the model answered',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const root = makeDriftedGitProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      writeRealSizedEvidence(root);

      const { runner, calls } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      const out = await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });

      // The precondition, so the test cannot pass vacuously: the delivered
      // comparison really does report a removal.
      expect(calls[0]?.userPrompt ?? '').toContain('STRUCTURAL DRIFT DETECTED');
      expect(calls[0]?.userPrompt ?? '').toContain('1 export name(s)');

      const dimension = out.dimensions.find((d) => d.dimension === 'existing-functionality-intact');
      // The verdict is NOT forced to `fail` — an authorized removal is the
      // reviewer's and the human's call. What is refused is SILENCE.
      expect(dimension?.verdict).toBe('pass');
      expect(dimension?.summary).toContain('pre-post-diff-drift-gate');
      expect(out.needsAttention).toContain('existing-functionality-intact');
      // A handoff with a machine-detected drift in it is not a clean one.
      expect(out.allPass).toBe(false);
    }
  );

  it('does not claim a conclusion was unreadable when no baseline was delivered at all', async () => {
    // The trap `null` exists to avoid: a project with no baseline has delivered
    // NO conclusion, which is a different fact from "delivered a conclusion I
    // could not classify" — and only the second is this gate's business. The
    // delivery gate already left its own marker here.
    const root = makeProject(); // deliberately NOT a git work tree
    writeAuditGoal(root, ['AC1: the widget renders']);
    writeRealSizedEvidence(root);

    const { runner } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const dimension = out.dimensions.find((d) => d.dimension === 'existing-functionality-intact');
    expect(dimension?.summary).toContain('pre-post-diff-gate');
    expect(dimension?.summary).not.toContain('drift-gate');
    expect(dimension?.summary).not.toContain('never actually read');
  });

  it(
    'says nothing extra when the delivered comparison reports no drift',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const root = makeGitProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      writeRealSizedEvidence(root);

      const { runner, calls } = captureRunner(
        reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
      );
      const out = await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });

      expect(calls[0]?.userPrompt ?? '').toContain('NO STRUCTURAL DRIFT');
      expect(out.needsAttention).toEqual([]);
      expect(out.allPass).toBe(true);
      for (const dimension of out.dimensions) {
        expect(dimension.summary).not.toContain('drift-gate');
      }
    }
  );
});
