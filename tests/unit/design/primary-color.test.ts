import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { toRenderableColor } from '../../../src/services/design/css-color.js';
import {
  derivePrimaryColor,
  reportPrimaryColor
} from '../../../src/services/design/primary-color.js';
import type { VisualToken } from '../../../src/services/scan/scan-types.js';

declareDimensions(
  'tests/unit/design/primary-color.test.ts',
  ['behavior', 'render'],
  [
    {
      dim: 'integration',
      reason:
        'pure derivation over an in-memory token list; no filesystem, process or clock boundary'
    },
    {
      dim: 'a11y',
      reason: 'no user-visible text or exit code; the caller owns the recorded gap message'
    }
  ]
);

function token(name: string, value: string): VisualToken {
  return { name, value, source: 'theme.css' };
}

describe('Scenario: behavior — which colour token wins', () => {
  it('when a primary-named token exists, should prefer it over a more frequent colour', () => {
    // given: a white value carried by three tokens and one primary role token
    // when: the primary is derived
    // then: the role token wins even though white is more frequent
    const colors = [
      token('--color-page', '#ffffff'),
      token('--color-surface', '#ffffff'),
      token('--color-card', '#ffffff'),
      token('--color-primary', '#0f62fe')
    ];
    expect(derivePrimaryColor(colors)).toEqual({
      value: '#0f62fe',
      token: 'color-primary',
      origin: 'primary-named'
    });
  });

  it('when primary and brand roles both exist, should prefer primary', () => {
    // given: a brand role and a primary role
    // when: the primary is derived
    // then: the documented primary-over-brand order decides
    const colors = [token('--color-brand', '#abcdef'), token('--color-primary', '#0f62fe')];
    expect(derivePrimaryColor(colors)?.token).toBe('color-primary');
  });

  it('when the role is spelled with -- or as a DTCG dotted path, should pick it either way', () => {
    // given: the same frequent ink colour beside one role token per spelling
    // when: each list is derived
    // then: both spellings name the primary role instead of the frequent colour
    const ink = [
      token('color.ink', '#123456'),
      token('color.canvas', '#123456'),
      token('color.panel', '#123456')
    ];
    expect(derivePrimaryColor([...ink, token('--color-primary', '#0f62fe')])).toEqual({
      value: '#0f62fe',
      token: 'color-primary',
      origin: 'primary-named'
    });
    expect(derivePrimaryColor([...ink, token('color.primary', '#0f62fe')])).toEqual({
      value: '#0f62fe',
      token: 'color.primary',
      origin: 'primary-named'
    });
  });

  it('when a dotted path puts primary last under a brand group, should read the last segment', () => {
    // given: a DTCG path whose last segment is the primary role
    // when: the primary is derived
    // then: the primary-ending path outranks the brand-ending sibling
    const colors = [token('color.brand', '#111111'), token('color.brand.primary', '#0f62fe')];
    expect(derivePrimaryColor(colors)?.token).toBe('color.brand.primary');
  });

  it('when several primary roles exist, should pick the shortest shallowest key', () => {
    // given: two role tokens of the same depth and a longer sidebar variant
    // when: the primary is derived
    // then: the shortest key wins, independent of input order
    const colors = [token('--sidebar-primary', '#111111'), token('--color-primary', '#222222')];
    expect(derivePrimaryColor(colors)?.token).toBe('color-primary');
    expect(derivePrimaryColor([...colors].reverse())?.token).toBe('color-primary');
  });

  it('when no role token exists, should pick the most frequent colour value', () => {
    // given: one value shared by two tokens and another carried once
    // when: the primary is derived
    // then: the shared value wins and the origin says so
    const colors = [
      token('--color-chart', '#336699'),
      token('--color-tiles', '#336699'),
      token('--color-accent', '#0f62fe')
    ];
    expect(derivePrimaryColor(colors)).toEqual({
      value: '#336699',
      token: 'color-chart',
      origin: 'most-frequent'
    });
  });

  it('when a foreground token is the most frequent colour, should not treat it as primary', () => {
    // given: two foreground tokens carrying white and one real surface colour
    // when: the primary is derived
    // then: the foreground tokens are skipped for the surface colour
    const colors = [
      token('--color-primary-foreground', '#ffffff'),
      token('--color-danger-foreground', '#ffffff'),
      token('--color-ink', '#123456')
    ];
    expect(derivePrimaryColor(colors)).toEqual({
      value: '#123456',
      token: 'color-ink',
      origin: 'most-frequent'
    });
  });

  it('when only foreground or non-colour tokens exist, should return null', () => {
    // given: a lone foreground token and a spacing token
    // when: the primary is derived
    // then: nothing is invented
    expect(derivePrimaryColor([token('--color-primary-foreground', '#ffffff')])).toBeNull();
    expect(derivePrimaryColor([token('--spacing-4', '1rem')])).toBeNull();
    expect(derivePrimaryColor([])).toBeNull();
  });

  it('when two colour values tie, should pick deterministically regardless of order', () => {
    // given: two equally frequent colours with equal-length keys
    // when: the primary is derived from both input orders
    // then: the lexicographically smaller token wins both times
    const colors = [token('--color-omega', '#222222'), token('--color-alpha', '#111111')];
    const first = derivePrimaryColor(colors);
    expect(first?.token).toBe('color-alpha');
    expect(derivePrimaryColor([...colors].reverse())).toEqual(first);
  });

  it('when the same value is spelled differently in case, should count it once', () => {
    // given: two spellings of white after two distinct singles
    // when: the primary is derived
    // then: the shared value wins only if case is folded
    const colors = [
      token('--color-a', '#000000'),
      token('--color-b', '#111111'),
      token('--color-c', '#FFF'),
      token('--color-d', '#fff')
    ];
    expect(derivePrimaryColor(colors)).toEqual({
      value: '#FFF',
      token: 'color-c',
      origin: 'most-frequent'
    });
  });

  it('when a name repeats, should keep the first value the way the contract does', () => {
    // given: one name with two values
    // when: the primary is derived
    // then: the first value is the one reported
    const colors = [token('--color-primary', '#111111'), token('--color-primary', '#222222')];
    expect(derivePrimaryColor(colors)?.value).toBe('#111111');
  });

  it('when the role is delimited by a slash, underscore or space, should read the same segments', () => {
    // given: one primary role per delimiter the splitter documents
    // when: each is derived
    // then: every delimiter spells the same role segment
    for (const name of ['color/primary', 'color_primary', 'color primary', 'color.primary']) {
      expect(derivePrimaryColor([token(name, '#0f62fe')]), name).toEqual({
        value: '#0f62fe',
        token: name,
        origin: 'primary-named'
      });
    }
  });

  it('when a key ends with a delimiter, should not turn the empty tail into a role segment', () => {
    // given: a primary-named key with a trailing delimiter beside a brand role
    // when: the primary is derived
    // then: the empty tail is dropped so the primary role keeps rank 0
    const colors = [token('color-primary-', '#111111'), token('--color-brand', '#222222')];
    expect(derivePrimaryColor(colors)).toEqual({
      value: '#111111',
      token: 'color-primary-',
      origin: 'primary-named'
    });
  });

  it('when a role word appears before the last segment, should rank it below a last-segment role', () => {
    // given: a token with primary in the middle and one ending in brand
    // when: the primary is derived
    // then: the last-segment brand role outranks the embedded primary word
    const colors = [token('--color-primary-surface', '#111111'), token('--color-brand', '#222222')];
    expect(derivePrimaryColor(colors)?.token).toBe('color-brand');
  });

  it('when a role word is not the last segment, should still treat it as named', () => {
    // given: a brand group key and an unroled accent colour
    // when: the primary is derived
    // then: the embedded role wins and the origin records that rule
    const colors = [token('--color-brand-surface', '#111111'), token('--color-accent', '#222222')];
    expect(derivePrimaryColor(colors)).toEqual({
      value: '#111111',
      token: 'color-brand-surface',
      origin: 'primary-named'
    });
  });

  it('when candidates share a rank, should sort by depth before length and text', () => {
    // given: a shallow role key beside a deeper but shorter role key
    // when: the primary is derived
    // then: the shallower key wins even though the other is shorter
    const colors = [token('--a-b-primary', '#111111'), token('--color-primary', '#222222')];
    expect(derivePrimaryColor(colors)?.token).toBe('color-primary');
  });

  it('when candidates share a rank and depth, should sort by the shorter key', () => {
    // given: two role keys at the same depth with different lengths
    // when: the primary is derived
    // then: the shorter key wins even though A-Z would prefer the longer one
    const colors = [token('--aa-primary', '#111111'), token('--b-primary', '#222222')];
    expect(derivePrimaryColor(colors)?.token).toBe('b-primary');
  });

  it('when candidates share rank, depth and length, should sort A-Z', () => {
    // given: two same-length role keys in reverse input order
    // when: each input order is derived
    // then: the lexicographically smaller key wins both times
    const colors = [
      token('--color-omega-primary', '#111111'),
      token('--color-alpha-primary', '#222222')
    ];
    expect(derivePrimaryColor(colors)?.token).toBe('color-alpha-primary');
    expect(derivePrimaryColor([...colors].reverse())?.token).toBe('color-alpha-primary');
  });

  it('when values differ only by surrounding whitespace, should count them together', () => {
    // given: the same white value padded and unpadded after two distinct singles
    // when: the primary is derived
    // then: the padded value wins only if whitespace is trimmed, and is reported trimmed
    const colors = [
      token('--color-a', '#000000'),
      token('--color-b', '#111111'),
      token('--color-c', ' #FFF '),
      token('--color-d', '#fff')
    ];
    expect(derivePrimaryColor(colors)).toEqual({
      value: '#FFF',
      token: 'color-c',
      origin: 'most-frequent'
    });
  });
});

describe('Scenario: render — the recorded report and the readable form', () => {
  it('when the derived token is oklch, should render it as a hex designlang accepts', () => {
    // given: the pilot's Tailwind v4 primary token
    // when: the primary is derived and converted
    // then: the provenance stays oklch and the readable form is a hex
    const report = reportPrimaryColor([token('--primary', 'oklch(0.5315 0.0694 156.19)')]);
    expect(report.color).toEqual({
      value: 'oklch(0.5315 0.0694 156.19)',
      token: 'primary',
      origin: 'primary-named'
    });
    expect(report.source).toBe('token primary (primary-named)');
    expect(report.gaps).toEqual([]);
    expect(toRenderableColor('oklch(0.5315 0.0694 156.19)')).toBe('#49785b');
  });

  it('when no colour token exists, should record a named missing gap', () => {
    // given: a token list with no colour
    // when: the report is built
    // then: the colour is null and the gap says why
    const report = reportPrimaryColor([token('--spacing-4', '1rem')]);
    expect(report.color).toBeNull();
    expect(report.source).toBeNull();
    expect(report.gaps.map((gap) => gap.code)).toEqual(['DESIGN_PRIMARY_COLOR_MISSING']);
  });

  it('when the derived token is unreadable to designlang, should record that gap', () => {
    // given: a primary token that references another token
    // when: the report is built
    // then: the colour is still reported and the gap names the format problem
    const report = reportPrimaryColor([token('--color-primary', 'var(--brand)')]);
    expect(report.color?.token).toBe('color-primary');
    expect(report.gaps.map((gap) => gap.code)).toEqual(['DESIGN_PRIMARY_COLOR_UNREADABLE']);
  });

  it('when given hex and rgb notations, should normalise them', () => {
    // given: shorthand, full, alpha hex and rgb notations
    // when: each is converted
    // then: all become a six-digit lowercase hex
    expect(toRenderableColor('#ABC')).toBe('#aabbcc');
    expect(toRenderableColor('#0F62FE')).toBe('#0f62fe');
    expect(toRenderableColor('#0f62feff')).toBe('#0f62fe');
    expect(toRenderableColor('rgb(15, 98, 254)')).toBe('#0f62fe');
    expect(toRenderableColor('rgb(15 98 254 / 50%)')).toBe('#0f62fe');
  });

  it('when given hsl and oklab notations, should convert them', () => {
    // given: the sRGB primary anchors in other notations
    // when: each is converted
    // then: the anchors round-trip to their exact hex
    expect(toRenderableColor('hsl(0, 100%, 50%)')).toBe('#ff0000');
    expect(toRenderableColor('oklab(0.62796 0.22486 0.12585)')).toBe('#ff0000');
    expect(toRenderableColor('oklch(1 0 0)')).toBe('#ffffff');
    expect(toRenderableColor('oklch(0 0 0)')).toBe('#000000');
    expect(toRenderableColor('oklch(0.62796 0.25768 29.23)')).toBe('#ff0000');
    expect(toRenderableColor('oklch(0.86644 0.29483 142.495)')).toBe('#00ff00');
  });

  it('when given a notation designlang cannot read, should return null', () => {
    // given: values that are not a literal hex or rgb
    // when: each is converted
    // then: the answer is null rather than a guessed colour
    expect(toRenderableColor('var(--primary)')).toBeNull();
    expect(toRenderableColor('color-mix(in oklch, var(--primary) 55%, transparent)')).toBeNull();
    expect(toRenderableColor('rebeccapurple')).toBeNull();
    expect(toRenderableColor('222.2 47.4% 11.2%')).toBeNull();
    expect(toRenderableColor('rgb(0, 0)')).toBeNull();
  });

  it('when no colour token exists, should publish the exact missing gap sentence', () => {
    // given: a token list with no colour at all
    // when: the report is built
    // then: the gap carries the exact sentence the caller records
    expect(reportPrimaryColor([]).gaps).toEqual([
      {
        code: 'DESIGN_PRIMARY_COLOR_MISSING',
        message:
          'No colour token was found, so contract.md carries no primary colour and designlang verify-ui stays blocked.'
      }
    ]);
  });

  it('when the primary token is a reference, should publish the exact unreadable gap', () => {
    // given: a primary token whose value is another token reference
    // when: the report is built
    // then: the gap names the token and the literal forms designlang reads
    expect(reportPrimaryColor([token('--color-primary', 'var(--brand)')])).toEqual({
      color: { value: 'var(--brand)', token: 'color-primary', origin: 'primary-named' },
      source: 'token color-primary (primary-named)',
      gaps: [
        {
          code: 'DESIGN_PRIMARY_COLOR_UNREADABLE',
          message:
            'Token color-primary is var(--brand); designlang verify-ui reads only hex or rgb colours.'
        }
      ]
    });
  });
});
