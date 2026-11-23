import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { buildTokenContract } from '../../../src/services/design/token-contract.js';

declareDimensions('tests/unit/design/token-contract.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

describe('Scenario: behavior — tokens are grouped by DTCG category', () => {
  it('when tokens cover four categories, should emit four groups with $type', () => {
    // given: one token per category
    // when: the contract is built
    // then: each category carries a typed value
    const file = buildTokenContract([
      { name: '--color-primary', value: 'oklch(0.53 0.07 156)', source: 'theme.css' },
      { name: '--spacing-4', value: '1rem', source: 'theme.css' },
      { name: '--radius-md', value: '0.5rem', source: 'theme.css' },
      { name: '--font-sans', value: "'Public Sans', sans-serif", source: 'theme.css' }
    ]);
    expect(file.$schema).toBe('https://design-tokens.org/schema.json');
    expect(file.color['color-primary']).toEqual({ $value: 'oklch(0.53 0.07 156)', $type: 'color' });
    expect(file.space['spacing-4']).toEqual({ $value: '1rem', $type: 'dimension' });
    expect(file.radius['radius-md']).toEqual({ $value: '0.5rem', $type: 'dimension' });
    expect(file.font['font-sans']).toEqual({
      $value: "'Public Sans', sans-serif",
      $type: 'fontFamily'
    });
  });

  it('when two sources disagree, should keep the first value deterministically', () => {
    // given: the same name with two values
    // when: the contract is built
    // then: the first value wins and no duplicate remains
    const file = buildTokenContract([
      { name: '--color-primary', value: '#111111', source: 'a.css' },
      { name: '--color-primary', value: '#222222', source: 'b.css' }
    ]);
    expect(Object.keys(file.color)).toEqual(['color-primary']);
    expect(file.color['color-primary']?.$value).toBe('#111111');
  });

  it('when there are no tokens, should emit an empty contract', () => {
    // given: no tokens
    // when: the contract is built
    // then: every group is empty
    const file = buildTokenContract([]);
    expect(file.color).toEqual({});
    expect(file.space).toEqual({});
    expect(file.font).toEqual({});
    expect(file.radius).toEqual({});
  });
});
