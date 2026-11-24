import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { renderDesignContractMarkdown } from '../../../src/services/design/contract-render.js';

/**
 * designlang ships no type declarations for its `slop` entry. The require is
 * read for ONE purpose: proving the rendered value is in the vocabulary its
 * brand parser accepts.
 */
const require = createRequire(import.meta.url);
const { toHex } = require('designlang/slop') as { toHex: (value: string) => string | null };

declareDimensions(
  'tests/unit/design/contract-render.test.ts',
  ['render', 'behavior'],
  [
    {
      dim: 'integration',
      reason: 'the renderer is a pure string function; init owns the filesystem boundary'
    },
    {
      dim: 'a11y',
      reason:
        'the file is read by a tool and by humans, but no exit code or error text is produced here'
    }
  ]
);

const COUNTS = { color: 4, space: 1, font: 1, radius: 1 };

describe('Scenario: render — the primary colour in contract.md', () => {
  it('when a readable primary exists, should open with the front matter designlang reads', () => {
    // given: a primary token whose value is already a hex
    // when: the contract is rendered
    // then: YAML front matter carries the colour and designlang can read it
    const markdown = renderDesignContractMarkdown({
      appRelPath: 'web',
      tokenCounts: COUNTS,
      primary: { token: 'color-primary', value: '#0f62fe' }
    });
    expect(markdown.startsWith('---\ncolors:\n  primary: "#0f62fe"\n---\n')).toBe(true);
    expect(toHex('#0f62fe')).toBe('#0f62fe');
  });

  it('when a readable primary exists, should name the token and its usage in the Color section', () => {
    // given: a primary token whose value is already a hex
    // when: the contract is rendered
    // then: the prose carries the token name and a usage line
    const markdown = renderDesignContractMarkdown({
      appRelPath: 'web',
      tokenCounts: COUNTS,
      primary: { token: 'color-primary', value: '#0f62fe' }
    });
    expect(markdown).toContain('Primary colour: `#0f62fe` (token `color-primary`)');
    expect(markdown).toContain('use token `color-primary`, never a raw colour literal');
    expect(markdown).toContain('## Color');
  });

  it('when the token value is a functional notation, should render the hex and keep the literal', () => {
    // given: the pilot's oklch primary token
    // when: the contract is rendered
    // then: the front matter carries a hex and the prose keeps the source literal
    const markdown = renderDesignContractMarkdown({
      appRelPath: 'web',
      tokenCounts: COUNTS,
      primary: { token: 'primary', value: 'oklch(0.5315 0.0694 156.19)' }
    });
    expect(markdown.startsWith('---\ncolors:\n  primary: "#49785b"\n---\n')).toBe(true);
    expect(markdown).toContain('oklch(0.5315 0.0694 156.19)');
    expect(markdown).toContain('token `primary`');
  });

  it('when the token value is unreadable, should omit the front matter and say why', () => {
    // given: a primary token that references another token
    // when: the contract is rendered
    // then: no invented colour is written and the gap is stated in prose
    const markdown = renderDesignContractMarkdown({
      appRelPath: 'web',
      tokenCounts: COUNTS,
      primary: { token: 'color-primary', value: 'var(--brand)' }
    });
    expect(markdown.startsWith('---')).toBe(false);
    expect(markdown).toContain('Primary colour: `var(--brand)` (token `color-primary`)');
    expect(markdown).toContain('brand check stays blocked');
  });

  it('when no primary was derived, should omit the front matter and record the gap', () => {
    // given: a project with no colour token
    // when: the contract is rendered
    // then: no placeholder colour is written and the absence is stated
    const markdown = renderDesignContractMarkdown({
      appRelPath: '',
      tokenCounts: COUNTS,
      primary: null
    });
    expect(markdown.startsWith('---')).toBe(false);
    expect(markdown).toContain('No colour token was found');
    expect(markdown).not.toContain('primary: "');
  });
});
