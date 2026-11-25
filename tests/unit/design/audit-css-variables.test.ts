import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { parseCss } from '../../../src/services/design/audit/css-blocks.js';
import {
  buildVariableTable,
  describeDefinitions,
  resolveThrough,
  resolveVariable,
  stateNames,
  variableReference,
  variableValues,
  wholeVariableReference,
  type CssVariableDefinition
} from '../../../src/services/design/audit/css-variables.js';

declareDimensions('tests/unit/design/audit-css-variables.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

type DefinitionOptions = {
  selector?: string;
  state?: string | null;
  file?: string;
  line?: number;
};

function definition(
  name: string,
  value: string,
  options: DefinitionOptions = {}
): CssVariableDefinition {
  return {
    name,
    value,
    selector: options.selector ?? ':root',
    state: options.state ?? null,
    file: options.file ?? 'theme.css',
    line: options.line ?? 1
  };
}

/** The 1-based line of the first line containing `needle`; fails loudly if absent. */
function lineOf(text: string, needle: string): number {
  const index = text.split('\n').findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`needle not found: ${needle}`);
  return index + 1;
}

describe('Scenario: render — the report helpers print every state by name', () => {
  it('when two definitions exist, should describe each value with its selector and line', () => {
    // given: one root definition and one density definition of the same variable
    // when: the definitions are described
    // then: both appear in order, joined by a semicolon, each with file and line
    const definitions = [
      definition('--spacing', '16px', { line: 2 }),
      definition('--spacing', '13px', {
        selector: "[data-density='compact']",
        state: "[data-density='compact']",
        line: 7
      })
    ];
    expect(describeDefinitions(definitions)).toBe(
      "16px @:root (theme.css:2); 13px @[data-density='compact'] (theme.css:7)"
    );
  });

  it('when a variable has repeated values, should list each distinct value once', () => {
    // given: --space defined as 16px twice and 12px once
    // when: the values map is built
    // then: 16px appears once, in definition order, before 12px
    const table = buildVariableTable([
      definition('--space', '16px'),
      definition('--space', '12px'),
      definition('--space', '16px')
    ]);
    expect(variableValues(table).get('--space')).toEqual(['16px', '12px']);
  });

  it('when states are defined out of alphabetical order, should sort and drop the root', () => {
    // given: root, z-state and a-state definitions
    // when: the state names are read
    // then: only the two states remain, sorted alphabetically
    const table = buildVariableTable([
      definition('--space', '16px'),
      definition('--space', '18px', { selector: '[data-z]', state: '[data-z]' }),
      definition('--space', '14px', { selector: '[data-a]', state: '[data-a]' })
    ]);
    expect(stateNames(table)).toEqual(['[data-a]', '[data-z]']);
  });
});

describe('Scenario: behavior — one value resolves, several values stay state-dependent', () => {
  it('when the table is absent, should report the variable as unknown', () => {
    // given: no stylesheet table was read
    // when: the variable is resolved
    // then: the resolution is unknown instead of throwing
    expect(resolveVariable(undefined, '--space')).toEqual({ kind: 'unknown' });
  });

  it('when the table defines no entry for the name, should report it as unknown', () => {
    // given: a table defining one name, and an empty table
    // when: a present, a missing and an empty-table name are resolved
    // then: only the present one resolves; the other two are unknown
    const table = buildVariableTable([definition('--space', '16px')]);
    expect(resolveVariable(table, '--space')).toMatchObject({ kind: 'resolved', value: '16px' });
    expect(resolveVariable(undefined, '--space')).toEqual({ kind: 'unknown' });
    expect(resolveVariable(table, '--missing')).toEqual({ kind: 'unknown' });
    expect(resolveVariable(buildVariableTable([]), '--space')).toEqual({ kind: 'unknown' });
  });

  it('when one state defines the variable, should resolve it and name the state', () => {
    // given: --spacing defined once under [data-density="compact"]
    // when: it is resolved
    // then: the value resolves and the scored state is the selector
    const resolution = resolveVariable(
      buildVariableTable([
        definition('--spacing', '16px', {
          selector: '[data-density="compact"]',
          state: '[data-density="compact"]'
        })
      ]),
      '--spacing'
    );
    expect(resolution).toMatchObject({ kind: 'resolved', value: '16px' });
    if (resolution.kind !== 'resolved') return;
    expect(resolution.state).toBe('[data-density="compact"]');
  });

  it('when one root definition exists, should resolve it with a null state', () => {
    // given: --space-md defined once at :root
    // when: it is resolved
    // then: the value resolves and the state is null, not undefined
    const resolution = resolveVariable(
      buildVariableTable([definition('--space-md', '16px')]),
      '--space-md'
    );
    expect(resolution).toMatchObject({ kind: 'resolved', value: '16px' });
    if (resolution.kind !== 'resolved') return;
    expect(resolution.state).toBeNull();
  });

  it('when two selectors agree on one value, should still resolve it', () => {
    // given: --space defined as 16px under two distinct state selectors
    // when: it is resolved
    // then: one distinct value resolves and the ambiguous state stays null
    const resolution = resolveVariable(
      buildVariableTable([
        definition('--space', '16px', { selector: '[data-a]', state: '[data-a]' }),
        definition('--space', '16px', { selector: '[data-b]', state: '[data-b]' })
      ]),
      '--space'
    );
    expect(resolution).toMatchObject({ kind: 'resolved', value: '16px' });
    if (resolution.kind !== 'resolved') return;
    expect(resolution.state).toBeNull();
  });

  it('when two selectors disagree on the value, should stay state-dependent', () => {
    // given: --spacing defined as 16px and 13px under two states
    // when: it is resolved
    // then: the definitions are returned in order and never averaged
    const definitions = [
      definition('--spacing', '16px', { selector: '[data-a]', state: '[data-a]' }),
      definition('--spacing', '13px', { selector: '[data-b]', state: '[data-b]' })
    ];
    const resolution = resolveVariable(buildVariableTable(definitions), '--spacing');
    expect(resolution.kind).toBe('state-dependent');
    if (resolution.kind !== 'state-dependent') return;
    expect(resolution.definitions).toEqual(definitions);
  });
});

describe('Scenario: behavior — resolveThrough keeps an unreadable value unmeasured', () => {
  const table = buildVariableTable([definition('--space-md', '16px')]);

  it('when the variable is unknown, should name the missing definition', () => {
    // given: no definition for --missing
    // when: it is resolved through a parser
    // then: the outcome is unreadable and names the variable and the reason
    expect(resolveThrough(table, '--missing', () => 1)).toEqual({
      kind: 'unreadable',
      variable: '--missing',
      detail: 'no definition for --missing'
    });
  });

  it('when the variable is state-dependent, should carry every definition', () => {
    // given: --gap defined with two values under two states
    // when: it is resolved through a parser
    // then: the outcome is state-dependent and lists each value and selector
    const states = buildVariableTable([
      definition('--gap', '8px', { selector: '[data-a]', state: '[data-a]' }),
      definition('--gap', '12px', { selector: '[data-b]', state: '[data-b]' })
    ]);
    expect(resolveThrough(states, '--gap', () => 1)).toEqual({
      kind: 'state-dependent',
      variable: '--gap',
      detail: '8px @[data-a] (theme.css:1); 12px @[data-b] (theme.css:1)'
    });
  });

  it('when the parser cannot read the value, should report it unreadable', () => {
    // given: --space-md = 16px and a parser that understands nothing
    // when: it is resolved through that parser
    // then: the value stays unmeasured and the detail names the raw value
    expect(resolveThrough(table, '--space-md', () => null)).toEqual({
      kind: 'unreadable',
      variable: '--space-md',
      detail: '--space-md = 16px cannot be read'
    });
  });

  it('when the parser reads the value, should return it with its provenance', () => {
    // given: --space-md = 16px and a parser that reads pixels
    // when: it is resolved through that parser
    // then: the value, the via line and the null state all travel forward
    const outcome = resolveThrough(table, '--space-md', (value) => Number.parseInt(value, 10));
    expect(outcome).toEqual({
      kind: 'resolved',
      value: 16,
      via: '--space-md = 16px',
      state: null
    });
  });

  it('when a state-defined variable resolves, should carry its state forward', () => {
    // given: --text-body = 16px under [data-theme="light"]
    // when: it is resolved through a parser
    // then: the state names the selector the value was scored under
    const themed = buildVariableTable([
      definition('--text-body', '16px', {
        selector: '[data-theme="light"]',
        state: '[data-theme="light"]'
      })
    ]);
    const outcome = resolveThrough(themed, '--text-body', () => 16);
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind !== 'resolved') return;
    expect(outcome.state).toBe('[data-theme="light"]');
  });
});

describe('Scenario: behavior — only one whole var() reference resolves', () => {
  it('when a value is exactly var() with a fallback, should return the variable name', () => {
    // given: four spellings of one reference: bare, spaced, fallback, multiline fallback
    // when: each is read
    // then: all name the variable and nothing else resolves
    const spellings: Array<[string, string]> = [
      ['var(--space-md)', '--space-md'],
      ['  var(--space-md)  ', '--space-md'],
      ['var( --space-md )', '--space-md'],
      ['var(--space-md, 16px)', '--space-md'],
      ['var(--space-md,\n  16px)', '--space-md'],
      ['var(--space_2)', '--space_2']
    ];
    for (const [value, expected] of spellings) {
      expect(variableReference(value)).toBe(expected);
    }
  });

  it('when a value mixes the variable with anything else, should resolve nothing', () => {
    // given: a calc, a trailing literal, a prefix, an unterminated call, junk, uppercase, punctuation
    // when: each is read
    // then: every one of them is null
    const rejected = [
      'calc(var(--space-md) * 2)',
      'var(--space-md) 2px',
      'var(--space-md)px',
      'xvar(--space-md)',
      'var(--space-md',
      'VAR(--space-md)',
      'var(--!!)',
      '16px'
    ];
    for (const value of rejected) expect(variableReference(value)).toBeNull();
  });

  it('when a utility wraps one var(), should resolve its whole arbitrary value', () => {
    // given: utility spellings with and without surrounding whitespace
    // when: each is read
    // then: all name the variable
    const resolved: Array<[string, string]> = [
      ['var(--x)', '--x'],
      ['p-[var(--x)]', '--x'],
      ['spacing-[var(--x)]', '--x'],
      ['[var(--x)]', '--x'],
      ['  p-[var(--x)]  ', '--x']
    ];
    for (const [value, expected] of resolved) {
      expect(wholeVariableReference(value)).toBe(expected);
    }
  });

  it('when a utility wraps more than one value, should stay unmeasured', () => {
    // given: a calc wrapper, a literal wrapper, trailing text and a leading expression
    // when: each is read
    // then: none is a single reference
    const rejected = [
      'p-[calc(var(--x))]',
      'p-[16px]',
      'p-[var(--x)] text-sm',
      'calc(1px) p-[var(--x)]',
      'p-[var(--x),var(--y)]'
    ];
    for (const value of rejected) expect(wholeVariableReference(value)).toBeNull();
  });
});

describe('Scenario: integration — parsed CSS keeps the source line it prints', () => {
  it('when a stylesheet defines two states, should describe them at their real lines', () => {
    // given: a stylesheet with a root value and a density override
    // when: it is parsed and its definitions are described
    // then: each description cites the line the fixture actually holds
    const text =
      ':root {\n  --spacing: 16px;\n}\n\n[data-density="compact"] {\n  --spacing: 13px;\n}\n';
    const variables = buildVariableTable(parseCss('theme.css', text).variables);
    expect(describeDefinitions(variables.get('--spacing') ?? [])).toBe(
      `16px @:root (theme.css:${lineOf(text, '16px')}); ` +
        `13px @[data-density="compact"] (theme.css:${lineOf(text, '13px')})`
    );
    expect(stateNames(variables)).toEqual(['[data-density="compact"]']);
  });
});

describe('Scenario: a11y — the message names the variable and the reason', () => {
  it('when a resolution fails, should phrase the reason a reader can act on', () => {
    // given: one unknown variable and one unreadable value
    // when: both are resolved through a parser
    // then: each detail names the variable and why no number was produced
    const table = buildVariableTable([definition('--gap', 'auto')]);
    const missing = resolveThrough(table, '--absent', () => 1);
    const unreadable = resolveThrough(table, '--gap', () => null);
    expect(missing).toEqual({
      kind: 'unreadable',
      variable: '--absent',
      detail: 'no definition for --absent'
    });
    expect(unreadable).toEqual({
      kind: 'unreadable',
      variable: '--gap',
      detail: '--gap = auto cannot be read'
    });
  });
});
