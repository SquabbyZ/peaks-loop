// tests/unit/hooks/code-gate-comment-truth.test.ts
//
// A comment that asserts a safety property the code does not have is a
// defect of its own: the reader believes it, and the belief outlives the
// code. Three headers in this slice asserted something the code had
// stopped doing — that the shell script is the canonical source of the
// rule, that it encodes the decision function, and that the project root
// comes from the script's own directory.
//
// The cases below are a drift guard: each one names the claim the code now
// makes, and refuses the claim it no longer makes. They read the files as
// text, so they cost nothing and fail loudly when a header drifts back.
//
// Dimensions covered:
//   - behavior:   the text a header carries

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/hooks/code-gate-comment-truth.test.ts',
  ['behavior'],
  [
    {
      dim: 'render',
      reason: 'the assertion is about the SOURCE TEXT of a header, not about rendered output'
    },
    {
      dim: 'integration',
      reason: 'no boundary is crossed: the headers are read from the repository'
    },
    {
      dim: 'a11y',
      reason: 'the text under test is a source comment, not a message a person reads at run time'
    }
  ]
);

/** This repository's root — where the headers under test live. */
const ROOT = resolve(__dirname, '..', '..', '..');

/** The text of one source file. */
function source(...parts: string[]): string {
  return readFileSync(join(ROOT, ...parts), 'utf8');
}

describe('behavior — the headers say what the code does', () => {
  it('when the decision module header is read, should name the Node implementation the one implementation', () => {
    // given: the module that holds the decision
    // when: its header is read
    // then: it names ITSELF the one implementation — the shell sibling is a
    //   wrapper with a narrower fallback, not the canonical source
    const header = source('src', 'services', 'hooks', 'pre-tool-code-gate.ts');

    expect(header).toContain('ONE implementation');
    expect(header).not.toContain('canonical source');
  });

  it('when the command header is read, should not say the shell script encodes the decision', () => {
    // given: the command the shell sibling delegates to
    // when: its header is read
    // then: it does not claim the shell script ENCODES the decision — the
    //   shell script calls this command
    const header = source('src', 'cli', 'commands', 'code-gate-command.ts');

    expect(header).not.toContain('the shell script encodes');
  });

  it('when the shell header is read, should name the working directory as the project root source', () => {
    // given: the shell script, whose project root comes from $PWD
    // when: its header is read
    // then: it does not claim the root comes from the SCRIPT's own
    //   directory — the two are different directories
    const header = source('src', 'services', 'hooks', 'pre-tool-code-gate.sh');

    expect(header).not.toMatch(/this script's own directory that carries a peaks workspace/);
    expect(header).not.toMatch(/peaks workspace above this script's own directory/);
    expect(header).toContain('WORKING DIRECTORY ($PWD)');
  });
});
