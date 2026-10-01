// tests/unit/final-review/final-review-service-evidence-budget.test.ts
//
// D2 evidence-budget fairness and the F-BLOCK delivery gate, split verbatim
// out of `final-review-service.test.ts` (C wave 7 file-size work).

import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  MAX_EVIDENCE_BYTES_PER_FILE,
  MAX_EVIDENCE_BYTES_TOTAL,
  prepareFinalReview,
} from '~/src/services/final-review/final-review-service';
import {
  RID,
  SESSION_ID,
  REQUIRED,
  allVerdicts,
  captureRunner,
  dimensionsCovered,
  makeGitProject,
  makeProject,
  parseRenderedSources,
  reviewJson,
  writeAllEvidence,
  writeAuditGoal,
  type Verdict,
} from './final-review-service-helpers.js';
import {
  HEAVY_SUBPROCESS_TEST_TIMEOUT_MS,
  SUBPROCESS_TEST_TIMEOUT_MS
} from '../_setup/subprocess-timeouts.js';

// ---------------------------------------------------------------------------
// D2 — the EVIDENCE budget was first-come-first-served.
//
// Layer 1 above gave the reviewer on-disk evidence; this layer makes sure every
// dimension actually receives some. The allocator spent the cap strictly in
// source order, and with a full-size evidence set the first four sources
// consumed it to the byte (4 x 8,192 = 32,768 of the then-32 KiB cap) — leaving
// sources 5-9 OMITTED. `existing-functionality-intact` is supplied ONLY by
// `rd/tech-doc.md` (7th), `prd/handoff.md` (9th) and the appended
// `final-review-pre-post-diff` (10th), so that dimension came back with zero
// evidence on every run and was structurally locked to `inconclusive`. The gate
// could never go green; a gate that can never go green is one operators learn
// to ignore.
//
// All three tests FAIL against the pre-fix allocator:
//   - test 1: `existing-functionality-intact` gets no FOUND source, so its
//     `pass` is downgraded (the gate's own honesty rule) and `allPass` is false;
//   - test 2: the last source in the order is OMITTED, so the dimension whose
//     only remaining evidence it is has nothing at all;
//   - test 3: the 5th source is FOUND pre-fix (it is only omitted because of the
//     reservation now), and no reason mentioning a reservation exists.
//
// F-BLOCK then attached the delivery rule to the same fixtures: with every
// source oversized, the appended pre/post-diff block is still the first one the
// budget drops, and a dropped baseline means `existing-functionality-intact` is
// `inconclusive` however complete the other nine sources are. That these
// fixtures can no longer reach `allPass` at all is not a regression — it is the
// honest reading of a run whose baseline was never shown to the reviewer, and
// the F-BLOCK describe below pins both non-delivery and delivery.
// ---------------------------------------------------------------------------
describe('prepareFinalReview — evidence budget (D2: no dimension is starved)', () => {
  it(
    'gives all four dimensions evidence when the sources saturate the budget',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // A git fixture so the 4th dimension's `pre-post-diff` source exists at all
      // (see `makeGitProject`); it is allocated LAST and is one of the sources F1
      // gives a floor to.
      const root = makeGitProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      // Every fixed source is EXACTLY the per-file cap, so each one is a WHOLE
      // document — which is the delivery rule for a source whose producer
      // publishes no conclusion literal — while the ten of them together are far
      // past the total budget. That is the configuration the reservation exists
      // for: four units fit and six do not, and the four that fit have to be the
      // ones whose dimensions could not be judged without them.
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
      const rendered = parseRenderedSources(prompt);
      const covered = dimensionsCovered(prompt);
      for (const dimension of REQUIRED) {
        expect([...covered]).toContain(dimension);
      }

      // The two sources the DELIVERY GATES rest on, named explicitly. Pre-F1 they
      // were the two the budget omitted on every saturated run; the floor is what
      // makes them reachable, and reachability is the whole point — a gate whose
      // source never fits is a gate that is always red.
      expect(rendered.find((s) => s.key === 'prd-handoff')?.status).toBe('found');
      expect(rendered.find((s) => s.key === 'final-review-pre-post-diff')?.status).toBe('found');
      // ...and the source F1 took the floor AWAY from is the one that loses now:
      // `rd-tech-doc.md` supports the 4th dimension, which prompt rule 6 declares
      // it insufficient for (a design-intent document is not a before/after
      // comparison), so it is the legitimate casualty.
      expect(rendered.find((s) => s.key === 'rd-tech-doc')?.status).toBe('omitted');
      expect(prompt).toContain('MISSING (omitted)');

      // Delivery was restored for all four dimensions, so a clean 4/4 survives —
      // "achievability", not "green": the reviewer's own verdicts still have to
      // be backed by what arrived, and everything that arrived arrived whole.
      expect(out.allPass).toBe(true);
      expect(out.needsAttention).toEqual([]);
      expect(out.dimensions.find((d) => d.dimension === 'functional-completeness')?.verdict).toBe(
        'pass'
      );
      expect(
        out.dimensions.find((d) => d.dimension === 'existing-functionality-intact')?.verdict
      ).toBe('pass');

      // The reservation is a floor, not a quota: the first source still gets the
      // full per-file cap before any floor is drawn on.
      expect(rendered[0]?.includedBytes).toBe(MAX_EVIDENCE_BYTES_PER_FILE);
    }
  );

  it(
    'reaches a dimension whose only evidence is the very last source in the order',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const root = makeGitProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      writeAllEvidence(root, '', MAX_EVIDENCE_BYTES_PER_FILE);
      // Drop the EARLIER of the sources that can back
      // `existing-functionality-intact`, so its only remaining chances are the
      // 9th and LAST two sources. First-come-first-served reaches neither.
      rmSync(join(root, '.peaks', '_runtime', SESSION_ID, 'rd', 'tech-doc.md'));

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
      // All ten blocks are still rendered — nine fixed sources plus the
      // pre/post-diff artifact — and a missing file is stated, not skipped.
      expect(rendered).toHaveLength(10);
      expect(rendered.find((s) => s.key === 'rd-tech-doc')?.status).toBe('missing');

      // The 8th and 9th sources are this dimension's last chances, and the floors
      // reach them: reserving the source a GATE depends on is what keeps the
      // dimension from being blind, which is exactly what F1 fixed.
      const handoff = rendered.find((s) => s.key === 'prd-handoff');
      const ppd = rendered.find((s) => s.key === 'final-review-pre-post-diff');
      expect(handoff?.status).toBe('found');
      expect(handoff?.includedBytes).toBeGreaterThan(0);
      expect(ppd?.status).toBe('found');
      expect(ppd?.includedBytes).toBeGreaterThan(0);

      for (const dimension of REQUIRED) {
        expect([...dimensionsCovered(prompt)]).toContain(dimension);
      }

      // ...so the dimension keeps a `pass` the reviewer did back with evidence:
      // the comparison it names is among the blocks, delivered whole, and the
      // fixture's own baseline reports no drift.
      const dimension = out.dimensions.find((d) => d.dimension === 'existing-functionality-intact');
      expect(dimension?.verdict).toBe('pass');
      expect(dimension?.summary).not.toContain('pre-post-diff-gate');
      expect(out.allPass).toBe(true);
      expect(out.needsAttention).toEqual([]);
    }
  );

  it('states the reservation as the reason when a source is held back by it', async () => {
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);
    // Every fixed source is the full per-file cap, so the four units the four
    // dimensions need are the whole budget and the rest cannot fit.
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

    // Which sources are held back is the allocator's business; the property
    // under test is that a source held back BY THE RESERVATION says so. Losing
    // a redundant source is acceptable; losing it SILENTLY is not — the block
    // names the reservation as the reason, so it is never confused with a
    // missing file or an empty one.
    const omitted = rendered.filter((source) => source.status === 'omitted');
    expect(omitted.length).toBeGreaterThan(0);
    expect(prompt).toContain('bytes of the budget are reserved for dimension(s)');
    // The reservation names the dimensions it is holding the bytes FOR, so an
    // operator can see which gate the spent budget belongs to.
    expect(prompt).toMatch(/reserved for dimension\(s\) [^\n]*existing-functionality-intact/);
    expect(prompt).toMatch(/reserved for dimension\(s\) [^\n]*functional-completeness/);
    expect(prompt).toContain('MISSING (omitted)');

    // And the reservation costs the cap nothing: the budget is still spent, not
    // stranded, and never overspent.
    const inlined = rendered.reduce((sum, source) => sum + source.includedBytes, 0);
    expect(inlined).toBe(MAX_EVIDENCE_BYTES_TOTAL);
  });
});

// ---------------------------------------------------------------------------
// F-BLOCK — the gate keyed on "the baseline was computed", not on "the reviewer
// was given it", and those two facts separate exactly when the budget omits the
// block. The observed output (QA probe, reproduced below) was self-contradicting
// in adjacent lines:
//
//   ### [10] final-review-pre-post-diff … STATUS: MISSING (omitted)
//   producer block: STATUS: COMPUTED — …
//   EFI: {"v":"pass","c":"high", evidence 含 service 附上的 kind:"pre-post-diff"}
//   allPass: true | needsAttention: []
//
// The model never saw the baseline and was handed a `pass`; the service even
// attached the artifact as evidence; and the pass was propped up by
// `prd/handoff.md`, a design-intent document — the very mismatch
// `pre-post-diff.ts` complains about in its own header. `computed` was being
// used as a proxy for `delivered`.
//
// Both tests below FAIL against the pre-fix service: the first asserts the
// downgrade that did not happen, the second asserts the annotation that the
// early return swallowed.
// ---------------------------------------------------------------------------
describe('prepareFinalReview — the pre/post-diff gate keys on DELIVERY (F-BLOCK)', () => {
  it(
    'delivers the baseline the gate rests on, so the gate is not the only defence',
    { timeout: HEAVY_SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // The QA probe's shape: a real git work tree (so a baseline IS computed)
      // with every source at the per-file cap, i.e. a run that saturates the
      // budget. Pre-F1 the appended block was the FIRST thing the budget dropped
      // on exactly this fixture, every run, and the delivery gate had to catch it
      // afterwards. F1 reserves the block's unit for the dimension whose contract
      // names it, so the bytes are there and the gate never has to fire.
      const root = makeGitProject();
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
      const ppd = parseRenderedSources(prompt).find((s) => s.key === 'final-review-pre-post-diff');
      expect(ppd?.status).toBe('found');
      // Whole, and the conclusion came with it: the artifact opens with its
      // `VERDICT:` line, which is the `conclusion` delivery rule for this source.
      expect(ppd?.includedBytes).toBeGreaterThan(0);
      expect(prompt).toContain('VERDICT: ');
      // The producer block and the source block agree, which was the whole
      // F-BLOCK point — and now they agree because the block WAS delivered.
      expect(prompt).toContain('STATUS: COMPUTED —');
      expect(prompt).not.toContain('STATUS: COMPUTED ON DISK, NOT DELIVERED');

      const dimension = out.dimensions.find((d) => d.dimension === 'existing-functionality-intact');
      expect(dimension?.verdict).toBe('pass');
      expect(dimension?.summary).not.toContain('pre-post-diff-gate');
      // The artifact the verdict rests on IS attached, because the reviewer had
      // it: the attachment follows the same delivery judgement as the gate.
      expect((dimension?.evidence ?? []).filter((i) => i.kind === 'pre-post-diff')).toHaveLength(1);

      // Neither delivery gate fires on this run, and nothing else moves.
      for (const other of out.dimensions) {
        expect(other.verdict).toBe('pass');
        expect(other.summary).not.toContain('gate');
      }
      expect(out.allPass).toBe(true);
      expect(out.needsAttention).toEqual([]);
    }
  );

  it('leaves its marker when the evidence gate already downgraded the same dimension', async () => {
    // No evidence at all AND no computable baseline: both gates fire on the
    // same dimension. The pre-fix gate returned early on "already non-pass", so
    // only the evidence gate left a trace and the envelope could not tell that
    // this gate had run.
    const root = makeProject();
    writeAuditGoal(root, ['AC1: the widget renders']);

    const { runner } = captureRunner(
      reviewJson(allVerdicts('pass'), { allPass: true, needsAttention: [] })
    );
    const out = await prepareFinalReview(RID, {
      projectRoot: root,
      sessionId: SESSION_ID,
      llmRunner: runner
    });

    const dimension = out.dimensions.find((d) => d.dimension === 'existing-functionality-intact');
    expect(dimension?.verdict).toBe('inconclusive');
    expect(dimension?.summary).toContain('evidence-gate');
    expect(dimension?.summary).toContain('pre-post-diff-gate');
    expect(dimension?.summary).toContain('is already non-"pass" and is left unchanged');
  });

  it(
    'does not let an "inconclusive" verdict keep "high" confidence (F-NIT)',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const root = makeGitProject();
      writeAuditGoal(root, ['AC1: the widget renders']);
      writeAllEvidence(root);

      // The reviewer itself returns the contradiction the schema allows but the
      // meaning does not: "high" confidence that it could not tell.
      const verdicts = { ...allVerdicts('pass'), 'no-new-bugs': 'inconclusive' as Verdict };
      const { runner } = captureRunner(reviewJson(verdicts, { allPass: true, needsAttention: [] }));
      const out = await prepareFinalReview(RID, {
        projectRoot: root,
        sessionId: SESSION_ID,
        llmRunner: runner
      });

      const noNewBugs = out.dimensions.find((d) => d.dimension === 'no-new-bugs');
      expect(noNewBugs?.verdict).toBe('inconclusive');
      expect(noNewBugs?.confidence).toBe('medium');
      expect(noNewBugs?.summary).toContain('confidence-gate');
      // A verdict that says something real keeps its confidence.
      expect(
        out.dimensions.find((d) => d.dimension === 'functional-completeness')?.confidence
      ).toBe('high');
      expect(out.allPass).toBe(false);
      expect(out.needsAttention).toEqual(['no-new-bugs']);
    }
  );
});
