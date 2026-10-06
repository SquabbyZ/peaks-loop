// tests/unit/services/context/dispatch-codegraph-unavailable-reason.test.ts
//
// 4-dimension unit test for the codegraph-unavailable tripwire in
// `src/services/context/build-dispatch-system-prompt.ts` (rid
// 2026-10-06-codegraph-degradation-tripwire).
//
// THE DEFECT THIS PINS. `buildCodegraphPreflightBlock` has always reported WHY
// the index could not be read — its `{ available: false, note }` arm carries the
// upstream stderr summary. The dispatch site collapsed that pair to a bare
// `null` (`preflight.available ? preflight.block : null`), and the composer then
// rendered one hard-coded constant. So every RD dispatch that ran with a broken
// codegraph injected
//
//   ## Codegraph structure
//
//   codegraph unavailable — proceeding on project-scan only.
//
// — a line whose only difference from "index read fine" is the word
// "unavailable", carrying no cause. Measured live cause on this machine:
// `unable to open database file` (the wasm backend cannot open the WAL-mode
// `.codegraph/codegraph.db`), which never reached a single dispatch record.
//
// WHY THE ARMS ARE WRITTEN THIS WAY, AND WHY THEY USE ONLY THE PRE-EXISTING
// `codegraphBlock` FIELD. The reason travels in the SAME value as the block —
// the preflight's `note` is what the dispatch site now passes — so a test that
// had to name a second "reason" field would be testing plumbing the fix does not
// have. Keeping to the one field also keeps every arm below able to go RED as an
// ASSERTION against the un-fixed composer rather than as a missing-export load
// error, which is a weaker instrument.
//
//   - Arm A is the tripwire: the preflight note must reach the prompt AS a
//     `## Codegraph structure` unavailable block that quotes it. An assertion of
//     "the note text is non-empty" would be GREEN against this defect, which is
//     the failure shape this repo keeps recording, so the arms assert WHICH text
//     is present and WHICH sentence is absent.
//   - Arm B is the positive control: with no reason at all the fallback must
//     still render, and it must SAY the reason was not obtained. Without the
//     control, arm A could be satisfied by deleting the fallback path entirely.
//   - Arm C is the discrimination arm: "no reason exists" and "a reason exists"
//     must not render the same bytes, or the instrument cannot tell a lost
//     reason from an absent one — which IS the defect, one layer up.
//
// Dimensions covered:
//   - behavior: reason quoted / fallback rendered / the two are distinct
//   - a11y:     the rendered text is the only thing the RD sub-agent reads
//   - integration: omitted — the real preflight run and the dispatch seam are
//                  `codegraph-preflight-dispatch-seam.test.ts`'s subject
//   - render:      omitted — the composer returns one string; its shape is
//                  asserted as text under behavior

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/context/dispatch-codegraph-unavailable-reason.test.ts',
  ['behavior', 'a11y'],
  [
    {
      dim: 'integration',
      reason:
        'the real preflight run and the dispatch seam live in codegraph-preflight-dispatch-seam.test.ts'
    },
    {
      dim: 'render',
      reason: 'the composer returns one string; its shape is asserted as text under behavior'
    }
  ]
);

import {
  buildDispatchSystemPrompt,
  type DispatchPromptInput
} from '~/src/services/context/build-dispatch-system-prompt';

/** The upstream summary the preflight reports — the WAL store's real failure. */
const WAL_NOTE = 'codegraph files failed (exit 1): unable to open database file';
/** The fallback sentence that must appear ONLY when no reason was obtained. */
const NO_REASON_SENTENCE = 'No failure reason was obtained';
/** Opens the reason-bearing variant; must never appear in the fallback. */
const REASON_SENTENCE = 'Reason reported by the codegraph preflight:';

function baseInput(): DispatchPromptInput {
  return { taskTitle: 'rd', taskBody: 'plan the slice', memoryBlock: { available: false } };
}

describe('Scenario: behavior — the unavailable codegraph block carries its reason', () => {
  it('when the preflight reported a note, should render it as an unavailable block quoting the cause', () => {
    // given: a dispatch carrying the preflight's own failure note in codegraphBlock
    const input = { ...baseInput(), codegraphBlock: WAL_NOTE };
    // when: the composer is invoked
    const out = buildDispatchSystemPrompt(input);
    // then: the block is the unavailable one and it quotes the upstream cause
    expect(out).toContain('## Codegraph structure');
    expect(out).toContain('codegraph unavailable');
    expect(out).toContain('unable to open database file');
    expect(out).toContain(REASON_SENTENCE);
  });

  it('when no reason was obtained, should render the fallback that says the reason is missing', () => {
    // given: a dispatch where the codegraph was attempted and nothing was learned
    const input = { ...baseInput(), codegraphBlock: null };
    // when: the composer is invoked
    const out = buildDispatchSystemPrompt(input);
    // then: the fallback renders, states the reason is missing, and claims no cause
    expect(out).toContain('## Codegraph structure');
    expect(out).toContain('codegraph unavailable');
    expect(out).toContain(NO_REASON_SENTENCE);
    expect(out).not.toContain(REASON_SENTENCE);
  });

  it('when a reason is reported versus absent, should render two distinguishable blocks', () => {
    // given: the same dispatch rendered with the preflight note and without one
    const reported = buildDispatchSystemPrompt({ ...baseInput(), codegraphBlock: WAL_NOTE });
    const absent = buildDispatchSystemPrompt({ ...baseInput(), codegraphBlock: null });
    // when: the two rendered prompts are compared
    // then: a lost reason is not the same bytes as an absent one
    expect(reported).not.toBe(absent);
    expect(reported).not.toContain(NO_REASON_SENTENCE);
    expect(absent).not.toContain('unable to open database file');
  });

  it('when a structure block is provided, should still render it verbatim', () => {
    // given: the live index block, which opens with the heading
    const input = {
      ...baseInput(),
      codegraphBlock: '## Codegraph structure\n\n- `src/services/context/` — 12 files\n'
    };
    // when: the composer is invoked
    const out = buildDispatchSystemPrompt(input);
    // then: the success block is untouched by the unavailable path
    expect(out).toContain('`src/services/context/` — 12 files');
    expect(out).not.toContain('codegraph unavailable');
    expect(out).not.toContain(REASON_SENTENCE);
  });

  it('when the codegraph preflight was never requested, should keep the legacy prompt byte-identical', () => {
    // given: a legacy dispatch that never opts into the codegraph pre-read
    const input = baseInput();
    // when: the composer is invoked
    const out = buildDispatchSystemPrompt(input);
    // then: no codegraph header, no fallback, no reason text is injected
    expect(out).not.toContain('## Codegraph structure');
    expect(out).not.toContain('codegraph unavailable');
    expect(out).not.toContain(NO_REASON_SENTENCE);
  });
});

describe('Scenario: a11y — the quoted reason is what the RD sub-agent reads', () => {
  it('when the upstream note spans lines, should keep the cause inside the block as one line', () => {
    // given: a note whose upstream summary spans two lines
    const input = {
      ...baseInput(),
      codegraphBlock: 'codegraph files failed (exit 1):\n  unable to open database file'
    };
    // when: the composer is invoked
    const out = buildDispatchSystemPrompt(input);
    // then: the cause is readable and did not forge a new markdown heading
    expect(out).toContain('unable to open database file');
    expect(out).not.toContain('\n  unable to open database file');
  });
});
