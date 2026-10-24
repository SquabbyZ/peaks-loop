// tests/unit/standards/standards-constitution-pointer.test.ts
//
// The `@AGENTS.md` pointer rules, in isolation.
//
// WHY A FILE OF ITS OWN. The pointer is a SYNTAX CONTRACT with Claude Code,
// not prose: it is imported only when the path stands on a line of its own,
// unbackticked and unquoted, and only once — a second occurrence loads the
// body twice. Every mistake here is SILENT. The file still reads fine, the
// managed block still says "Constitution: AGENTS.md", and the import simply
// does not happen. So the two decisions that matter — "does this file already
// carry the pointer?" and "does this file still carry the block we would
// write?" — are pinned here, apart from the writer that acts on them.
//
// The four dimensions are all covered: `behavior` (the two decisions),
// `render` (the shape of the pointer line in a file), `integration` (the
// renderer and the rules module agreeing on ONE spelling), and `a11y` (the
// text a human reads when a file is left for review).

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { renderManagedStandardsIndex } from '~/src/services/standards/standards-render-common';
import {
  CLAUDE_MD_POINTER_LINE,
  hasPointerLine,
  managedBlockMatches,
  planPointer,
  pointerReviewSuggestion
} from '~/src/services/standards/standards-pointer';
import { renderClaudeMdPointer } from '~/src/services/standards/standards-render-agents';

declareDimensions(
  'tests/unit/standards/standards-constitution-pointer.test.ts',
  ['render', 'behavior', 'integration', 'a11y'],
  []
);

const MANAGED_BLOCK = renderManagedStandardsIndex('typescript', '.peaks/standards');

/** How many lines of a text are exactly the pointer line. */
function pointerLineCount(text: string): number {
  return text.split('\n').filter((line) => line.trim() === CLAUDE_MD_POINTER_LINE).length;
}

describe('Scenario: behavior — is the pointer already there?', () => {
  it('when a file carries the pointer on its own line, should report it as present', () => {
    // given: a file whose pointer stands alone on a line
    // when: the file is asked whether it already carries the pointer
    // then: it is present, and the plan adds nothing
    const content = `# House rules\n\n${CLAUDE_MD_POINTER_LINE}\n\nAlways ask first.\n`;
    const present = hasPointerLine(content);
    expect(present).toBe(true);
    expect(planPointer(content, CLAUDE_MD_POINTER_LINE)).toEqual({
      needed: false,
      line: ''
    });
  });

  it('when prose merely mentions the pointer, should not count it as the pointer', () => {
    // given: a file that names the pointer inside prose — backticked, quoted
    //        and mid-sentence, which is what a hand-written file looks like
    // when: the file is asked whether it already carries the pointer
    // then: none of the prose counts, so the pointer is still missing
    const content =
      '# House rules\n\n' +
      'The rules live in `@AGENTS.md` for reference.\n' +
      'Ask Claude to read "@AGENTS.md" before editing.\n' +
      'See @AGENTS.md for the constitution.\n';
    const present = hasPointerLine(content);
    expect(present).toBe(false);
    expect(planPointer(content, CLAUDE_MD_POINTER_LINE)).toEqual({
      needed: true,
      line: CLAUDE_MD_POINTER_LINE
    });
  });

  it('when the body file needs no pointer, should never plan one', () => {
    // given: a body file — AGENTS.md needs no import, and a body that
    //        pointed at itself would be circular
    // when: the plan is asked about the pointer
    // then: no pointer is planned
    const content = '# Project Instructions\n';
    const plan = planPointer(content, null);
    expect(plan).toEqual({ needed: false, line: '' });
  });
});

describe('Scenario: behavior — does the file still carry the block we would write?', () => {
  it('when the file carries the managed block, should recognise it', () => {
    // given: a file whose tail is exactly the managed block
    // when: the tail is compared with the block this writer would write
    // then: it matches — the file is up to date
    const tail = MANAGED_BLOCK;
    const matches = managedBlockMatches(tail, MANAGED_BLOCK, CLAUDE_MD_POINTER_LINE);
    expect(matches).toBe(true);
  });

  it('when the file carries the block followed by the pointer line, should recognise it', () => {
    // given: a file whose tail is the managed block and then the pointer line
    // when: the tail is compared with the block this writer would write
    // then: it matches — the pointer after the block is this writer's own shape
    const tail = `${MANAGED_BLOCK}\n${CLAUDE_MD_POINTER_LINE}\n`;
    const matches = managedBlockMatches(tail, MANAGED_BLOCK, CLAUDE_MD_POINTER_LINE);
    expect(matches).toBe(true);
  });

  it('when the managed block differs, should refuse the file for a human', () => {
    // given: a file whose managed block says something else
    // when: the tail is compared with the block this writer would write
    // then: it does not match — the writer must not touch it
    const tail =
      '<!-- peaks-standards:index:start -->\nSOMETHING ELSE\n<!-- peaks-standards:index:end -->\n';
    const matches = managedBlockMatches(tail, MANAGED_BLOCK, CLAUDE_MD_POINTER_LINE);
    expect(matches).toBe(false);
  });

  it('when the user wrote something after the managed block, should refuse the file', () => {
    // given: a file whose managed block is followed by the user's own text
    // when: the tail is compared with the block this writer would write
    // then: it does not match — the user's text is never overwritten
    const tail = `${MANAGED_BLOCK}\nThe house rules win.\n`;
    const matches = managedBlockMatches(tail, MANAGED_BLOCK, CLAUDE_MD_POINTER_LINE);
    expect(matches).toBe(false);
  });
});

describe('Scenario: render — the pointer line on disk', () => {
  it('when the pointer file is rendered, should print the import line exactly once', () => {
    // given: the rendered CLAUDE.md pointer
    // when: the rendered text is read
    // then: the import line stands alone, exactly once — a second import
    //       would load the body twice
    const rendered = renderClaudeMdPointer();
    expect(pointerLineCount(rendered)).toBe(1);
    expect(rendered.split('\n').some((line) => line.trim() === CLAUDE_MD_POINTER_LINE)).toBe(true);
  });

  it('when the rules module is asked for the line, should answer with the same spelling', () => {
    // given: the pointer line the rules module exports
    // when: it is compared with the line the renderer prints
    // then: there is ONE spelling of the import, not two
    const exported = CLAUDE_MD_POINTER_LINE;
    const rendered = renderClaudeMdPointer();
    expect(exported).toBe('@AGENTS.md');
    expect(rendered).toContain(exported);
  });
});

describe('Scenario: integration — the module the writer reaches for', () => {
  it('when the writer asks the rules module about a pointer, should get a decision it can act on', () => {
    // given: a file without a pointer
    // when: the writer asks for the pointer's contribution to the plan
    // then: the plan names the exact line to write
    const content = '# House rules\n';
    const plan = planPointer(content, CLAUDE_MD_POINTER_LINE);
    expect(plan.needed).toBe(true);
    expect(plan.line).toBe(CLAUDE_MD_POINTER_LINE);
  });
});

describe('Scenario: a11y — the text a human reads', () => {
  it('when a file is left for review, should say which file and which line is missing', () => {
    // given: a file that is left for a human to look at
    // when: the review suggestion is written
    // then: it names the file and the missing pointer line, in words
    const relativePath = 'CLAUDE.md';
    const suggestion = pointerReviewSuggestion(relativePath);
    expect(suggestion).toContain('CLAUDE.md');
    expect(suggestion).toContain(CLAUDE_MD_POINTER_LINE);
    expect(suggestion).toContain('Claude Code');
  });
});
