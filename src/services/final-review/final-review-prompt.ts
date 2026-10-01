// src/services/final-review/final-review-prompt.ts
//
// The prompt-side rendering: evidence blocks, the producer status block,
// the binding verdict rules, and the delivery-reachability statement.
// Hoisted verbatim from final-review-service.ts (C wave 7 file-size
// split). renderEvidenceSection prints the STATUS line from the literal
// 'found' alone — the delivery decision is not made here, so guard C's
// render-only exemption applies to its moved text.

import { MAX_EVIDENCE_BYTES_PER_FILE } from './final-review-evidence-budget.js';
import type { PrePostDiffResult } from './pre-post-diff.js';
import type { UndeliverableDimensionEvidence } from './final-review-delivery.js';
import type { CollectedEvidence } from './final-review-evidence-sources.js';

export function renderEvidenceSection(collected: readonly CollectedEvidence[]): string {
  return collected
    .map((item, index) => {
      const heading = `### [${index + 1}] ${item.source.key} — ${item.source.label}`;
      const supports = `SUPPORTS: ${item.source.supports.join(', ')}`;
      if (item.status === 'found') {
        const status =
          item.includedBytes < item.totalBytes
            ? `FOUND at ${item.relativePath} — TRUNCATED, showing the first ${item.includedBytes} of ${item.totalBytes} bytes`
            : `FOUND at ${item.relativePath} — ${item.totalBytes} bytes`;
        return `${heading}\n${supports}\nSTATUS: ${status}\n<<<EVIDENCE\n${item.content}\n>>>EVIDENCE`;
      }
      if (item.status === 'unreadable') {
        // F4 — NOT "missing". The reviewer is told the file is there and the
        // read failed, which is a different instruction to a human than "this
        // run had no PRD phase": one is a fact about the run, the other is a
        // fact about the machine, and only the second is fixable.
        return `${heading}\n${supports}\nSTATUS: UNREADABLE — no evidence available from ${item.relativePath}: ${item.reason}`;
      }
      return `${heading}\n${supports}\nSTATUS: MISSING (${item.status}) — no evidence available from ${item.relativePath}: ${item.reason}`;
    })
    .join('\n\n');
}

/**
 * The producer's own status, told to the reviewer in as many words.
 *
 * It exists because the artifact's ABSENCE is not self-explanatory: a reviewer
 * shown nothing about `existing-functionality-intact` beyond two design-intent
 * documents cannot tell "the diff was clean" from "no diff was ever computed",
 * and the pre-fix run resolved that ambiguity by quietly returning
 * `inconclusive` forever. Naming the reason is what makes the unavailable case
 * a stated fact instead of an invisible one.
 *
 * Kept short on purpose: it rides inside the same prompt that is byte-capped at
 * `MAX_EVIDENCE_BYTES_TOTAL` + scaffolding.
 *
 * F-BLOCK: this block may only say COMPUTED when the artifact it names was
 * actually inlined. Saying "computed — cite it" one line above a source block
 * reading `STATUS: MISSING (omitted)` told the reviewer to cite evidence it had
 * not been given, and that contradiction is what let a `pass` survive a
 * baseline nobody saw.
 */
export function renderPrePostDiffStatus(
  prePostDiff: PrePostDiffResult,
  delivered: boolean
): string {
  const heading = '## Pre/post baseline diff producer (existing-functionality-intact)';
  if (prePostDiff.status === 'computed' && delivered) {
    return [
      heading,
      `STATUS: COMPUTED — ${prePostDiff.summary}`,
      `Artifact: ${prePostDiff.relativePath} (the next source block). Cite it with evidence kind "pre-post-diff"; it is the structural before/after comparison this dimension's definition asks for.`
    ].join('\n');
  }
  if (prePostDiff.status === 'computed') {
    return [
      heading,
      `STATUS: COMPUTED ON DISK, NOT DELIVERED — the baseline was produced at ${prePostDiff.relativePath}, but its source block could not be inlined into this prompt (the evidence budget omitted it), so it is NOT among the evidence above and you have NOT seen it.`,
      'Report "existing-functionality-intact" as "inconclusive" and name this in its summary. Do NOT report "pass": the service downgrades a "pass" on this dimension whenever the comparison was not delivered, and a comparison you were not shown is not a comparison that came back clean.'
    ].join('\n');
  }
  const consequence = prePostDiff.inGitWorkTree
    ? 'This project IS a git work tree, so a baseline was expected to be computable: the service treats its absence as a tooling failure and downgrades a "pass" on this dimension to "inconclusive" before any human sees it.'
    : 'This project is not a git work tree, so no baseline can be computed at all. The service downgrades a "pass" on this dimension to "inconclusive" here TOO: "this project keeps no baseline" explains why the evidence is absent, and the absence of a comparison is not a comparison that came back clean.';
  return [
    heading,
    `STATUS: UNAVAILABLE — ${prePostDiff.reason}.`,
    `No pre/post baseline diff exists for this run. Report "existing-functionality-intact" as "inconclusive" with confidence "low" and name the reason above in its summary. Do NOT report "pass": a missing baseline is not evidence of no drift. ${consequence}`
  ].join('\n');
}

export const EVIDENCE_RULES = `## Binding rules for the four verdicts
1. A dimension may be "pass" ONLY if at least one source in its SUPPORTS list has STATUS: FOUND above, and that source's content actually supports the verdict. The service re-checks this: a "pass" whose supporting sources are all missing/empty/omitted is downgraded to "inconclusive" before any human sees it.
2. If the evidence a dimension needs is MISSING, EMPTY, or OMITTED, return "inconclusive" with confidence "low". Do not guess "pass".
3. Absence of evidence is not evidence of absence: "no problem found in what I was given" is "inconclusive", never "pass".
4. Cite the bracketed source numbers (e.g. "[1]", "[5]") you relied on in each dimension's "evidence[].description"; use an empty list when the verdict is "inconclusive".
5. "allPass" may be true only when all four verdicts are "pass", and every non-"pass" dimension must be listed in "needsAttention".
6. "existing-functionality-intact" may be "pass" ONLY when the pre/post baseline diff block above shows STATUS: FOUND. A design-intent document (RD tech doc, PRD handoff) states what was INTENDED; it is not a before/after comparison of the test surface or the public API surface, and a "pass" resting on one is downgraded to "inconclusive" by the service before any human sees it.
7. An "inconclusive" verdict cannot be confident: report it with confidence "low" (or "medium" when the reviewer is sure the evidence is merely incomplete). "high" on "inconclusive" is a contradiction and the service clamps it.
8. "functional-completeness" may be "pass" ONLY when the approved-scope contract block (prd-handoff, the source carrying the approved scope and non-goals) is present above with its WHOLE byte count — a STATUS line reading "FOUND at ... — N bytes", not a truncated or an omitted one. A passing test report shows that something was built; only the contract shows that what was built IS the approved scope. The service re-checks this: it downgrades a "pass" on this dimension whenever that contract exists for the run but was not delivered in full.`;

/**
 * H2 — tell the reviewer, in the prompt, that a dimension has no deliverable
 * source at all. Emitted only when there is something to say, so the byte
 * budget is not spent on an empty section every run.
 *
 * It reads like `renderPrePostDiffStatus` on purpose: the reviewer is told the
 * FACT and what to answer with, so a permanently red dimension arrives at the
 * human with its cause attached instead of as an unexplained `inconclusive`.
 */
export function renderDeliveryReachabilityStatus(
  report: readonly UndeliverableDimensionEvidence[]
): string {
  if (report.length === 0) return '';
  // Kept to one line per source and one line per dimension: this block rides
  // inside the same byte-capped prompt as the evidence it describes, and the
  // evidence blocks above already carry each source's path and status.
  const lines = report.map((entry) => {
    const sources = entry.sources
      .map((item) => `${item.key} (${String(item.totalBytes)} bytes)`)
      .join(', ');
    return `  - ${entry.dimension}: NO deliverable source. ${sources} exceeds the per-file cap of ${String(MAX_EVIDENCE_BYTES_PER_FILE)} bytes, and a source is inlined WHOLE or not at all.`;
  });
  return [
    '## Evidence delivery reachability (structural)',
    `The allocator inlines at most ${String(MAX_EVIDENCE_BYTES_PER_FILE)} bytes of any one source, WHOLE or not at all, and a source delivered under the "whole" rule is delivered only when the reviewer received ALL of it. For the dimension(s) below, every source on disk that supports it is larger than that cap, so no source CAN be delivered — not on this run and not on any run, whatever the budget.`,
    ...lines,
    'Report each of them as "inconclusive" with confidence "low" and name this reason in its summary. Do NOT report "pass": the service re-checks it, and a "pass" here is downgraded. This is a STRUCTURAL impossibility, not a judgement you are being asked to make — say so rather than reporting an unexplained "inconclusive".'
  ].join('\n');
}
