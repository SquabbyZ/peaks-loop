import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type * as EvidenceTextTypes from '../../../src/services/design/evidence-text.js';

declareDimensions(
  'tests/unit/design/evidence-text.test.ts',
  ['behavior', 'render', 'a11y'],
  [
    {
      dim: 'integration',
      reason: 'sanitising is a pure string transform: no fs, network, process or clock boundary'
    }
  ]
);

type EvidenceTextModule = typeof EvidenceTextTypes;

/**
 * Imported per test after a module reset so the module-level control-sequence
 * regexes initialise INSIDE a test. Under Stryker's per-test coverage a
 * module-scope initialiser executes before any test, so a mutant in it is
 * never scheduled and reads as survived although no test ran.
 */
async function loadEvidenceText(): Promise<EvidenceTextModule> {
  vi.resetModules();
  return import('../../../src/services/design/evidence-text.js');
}

describe('Scenario: behavior — the sanitiser strips control bytes and collapses runs', () => {
  it('when whitespace runs between words, should collapse each run to one space', async () => {
    // given: page text whose words are separated by spaces, tabs and newlines
    // when: the text is sanitised
    // then: every run of whitespace is one space and the ends are trimmed
    const { plainText } = await loadEvidenceText();
    expect(plainText('Sign \t\n  in')).toBe('Sign in');
    expect(plainText('  alpha  beta\t\tgamma\n\ndelta  ')).toBe('alpha beta gamma delta');
  });

  it('when a control byte sits between words, should keep them as separate words', async () => {
    // given: text split by a NUL and text made only of control bytes
    // when: each is sanitised
    // then: a control byte becomes a word boundary and control-only text is empty
    const { plainText } = await loadEvidenceText();
    expect(plainText('access\u0000denied')).toBe('access denied');
    expect(plainText('\u0000\u0007\u001b\u009b')).toBe('');
  });

  it('when normal printable text is sanitised, should return it unchanged', async () => {
    // given: an ASCII title with punctuation, digits and an em dash
    // when: the text is sanitised
    // then: nothing printable is treated as a control byte
    const { plainText } = await loadEvidenceText();
    expect(plainText('Ledgerly — Reconciliation 2026')).toBe('Ledgerly — Reconciliation 2026');
  });

  it('when a whole control sequence is present, should drop the sequence and its tail', async () => {
    // given: a CSI clear-screen, a one-byte C1 CSI and an OSC title sequence
    // when: each is sanitised
    // then: no introducer or printable parameter tail survives
    const { plainText } = await loadEvidenceText();
    expect(plainText('Sign in\u001b[2J')).toBe('Sign in');
    expect(plainText('Sign in\u009b2K')).toBe('Sign in');
    expect(plainText('Sign in\u001b]0;evil\u0007')).toBe('Sign in');
    expect(plainText('Sign in\u001b[2J\u009b2K')).toBe('Sign in');
  });

  it('when text merely contains a bracket, should not treat it as a sequence', async () => {
    // given: a heading with a bracketed label that is not a control sequence
    // when: the text is sanitised
    // then: the bracketed text survives intact
    const { plainText } = await loadEvidenceText();
    expect(plainText('Notes [beta] now')).toBe('Notes [beta] now');
  });
});

describe('Scenario: render — the echoed snippet honours its character bound', () => {
  it('when a value is exactly the bound, should return it unchanged', async () => {
    // given: a value of exactly the documented snippet bound
    // when: it is echoed as a snippet
    // then: the value is not shortened and nothing is appended
    const { EVIDENCE_SNIPPET_MAX, evidenceSnippet } = await loadEvidenceText();
    expect(EVIDENCE_SNIPPET_MAX).toBe(120);
    const exact = 'a'.repeat(120);
    expect(evidenceSnippet(exact)).toBe(exact);
  });

  it('when a value is one past the bound, should cut it to the bound with an ellipsis', async () => {
    // given: a value one character longer than the snippet bound
    // when: it is echoed as a snippet
    // then: the echo is exactly the bound, made of 119 characters and an ellipsis
    const { evidenceSnippet } = await loadEvidenceText();
    const over = 'a'.repeat(121);
    expect(evidenceSnippet(over)).toBe(`${'a'.repeat(119)}…`);
    expect(evidenceSnippet(over)).toHaveLength(120);
  });
});

describe('Scenario: a11y — echoed evidence carries no hidden terminal control', () => {
  it('when a title carries an OSC hyperlink, should echo only its readable text', async () => {
    // given: page text whose OSC sequence would hide a clickable payload
    // when: the snippet is echoed
    // then: neither the introducer nor the payload survives and no control byte remains
    const { evidenceSnippet } = await loadEvidenceText();
    const echoed = evidenceSnippet('\u001b]8;;http://evil.test\u0007Reconciliation');
    expect(echoed).toBe('Reconciliation');
    expect(echoed).not.toMatch(/\p{Cc}/u);
  });
});
