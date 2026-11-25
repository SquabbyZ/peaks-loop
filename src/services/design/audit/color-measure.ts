/**
 * Colour measurement (S7): the colour decisions a page's source declares,
 * turned into normalised hex and OKLCH hue/chroma before any verdict.
 *
 * Split from `audit-color.ts` so measurement and judgement stay separate
 * responsibilities, and from `color-notation.ts` / `color-oklch.ts` so the
 * notation rules and the hue maths are readable on their own.
 *
 * Colour is read from class contexts (`className`, `cn()`, `cva()`) and
 * declaration regions only, never from every string literal: the spike's `#014`
 * in a help-text sentence is not a design decision. A declaration region is the
 * inline `style` object of a markup file, or the whole text of a `.css` /
 * `.scss` file (Task 3b reads the stylesheet; Task 4 feeds its `color` /
 * `background-color` declarations through this reader). Palette classes
 * (`bg-emerald-500`) carry their family in their name; neutrals carry none.
 */

import {
  classTokens,
  classValueSpans,
  declarationMatches,
  declarationRegions,
  lineAt,
  utilityBody,
  type AuditSource
} from './audit-finding.js';
import { memoBySource, sourceView } from './source-view.js';
import {
  analyseColourValue,
  hasDarkVariant,
  isLengthUtility,
  requiresColourHint,
  type ColourUse
} from './color-notation.js';
import { oklchFields, paletteHue } from './color-oklch.js';

/** One colour decision a page's source declares, before a verdict is taken. */
export type ColorSample = {
  file: string;
  line: number;
  /** The full source spelling: a utility (`bg-[#c81e1e]`) or a style value. */
  raw: string;
  /** The colour utility's prefix (`bg`) or the inline property (`color`). */
  property: string;
  /** True when the utility carried a `dark:` variant — a dark-theme duplicate. */
  dark: boolean;
  /** `literal` is a readable colour literal; `palette` is a Tailwind name. */
  kind: 'literal' | 'palette' | 'variable';
  /** The literal exactly as written (`oklch(0.82_0.04_155)`); null otherwise. */
  literal: string | null;
  /** Normalised `#rrggbb`; null for a palette name or an unreadable value. */
  hex: string | null;
  /** OKLCH hue in degrees when the colour is chromatic; null otherwise. */
  hue: number | null;
  /** OKLCH chroma for a literal; null for a palette name or a neutral. */
  chroma: number | null;
  /** The variable(s) the value resolves through; null for a literal. */
  variable: string | null;
  /** Why the value is unreadable (`color-mix()`, an unparsable literal). */
  reason: string | null;
};

/** Colour utilities; the longest prefix wins so `border-x-` is not read as `border-`. */
const COLOUR_PREFIXES = [
  'bg',
  'text',
  'border',
  'border-x',
  'border-y',
  'border-t',
  'border-r',
  'border-b',
  'border-l',
  'border-s',
  'border-e',
  'ring',
  'ring-offset',
  'fill',
  'stroke',
  'divide',
  'outline',
  'accent',
  'caret',
  'decoration',
  'placeholder',
  'from',
  'via',
  'to',
  'shadow'
].sort((left, right) => right.length - left.length);

/** A palette utility's body: a family name plus a shade (`red-500/50`). */
const PALETTE_BODY = /^([a-z]+)-\d{2,3}(?:\/\d+)?$/;

/** The colour properties an inline style or CSS rule can declare. */
const COLOUR_PROPERTY =
  'color|background(?:Color|Image)?|border(?:Top|Right|Bottom|Left)?Color' +
  '|outlineColor|textDecorationColor|caretColor|accentColor|fill|stroke|boxShadow';

const COLOR_HINT = /^color:/i;

function colourPrefix(body: string): string | null {
  for (const prefix of COLOUR_PREFIXES) {
    if (body.startsWith(`${prefix}-`)) return prefix;
  }
  return null;
}

/** The coordinates every sample shares, whichever notation produced it. */
type SampleBase = Pick<ColorSample, 'file' | 'line' | 'raw' | 'property' | 'dark'>;

function sampleFor(use: ColourUse, base: SampleBase): ColorSample {
  if (use.kind === 'unreadable') {
    return {
      ...base,
      kind: 'variable',
      literal: null,
      hex: null,
      hue: null,
      chroma: null,
      variable: use.variable,
      reason: use.reason
    };
  }
  return {
    ...base,
    kind: 'literal',
    literal: use.literal,
    hex: use.hex,
    ...oklchFields(use.hex),
    variable: null,
    reason: null
  };
}

function arbitraryClassSamples(base: SampleBase, inner: string): ColorSample[] {
  if (isLengthUtility(inner)) return [];
  const value = inner.replace(COLOR_HINT, '');
  const uses = analyseColourValue(value);
  if (requiresColourHint(base.property, inner) && uses.every((use) => use.kind === 'unreadable')) {
    return [];
  }
  return uses.map((use) => sampleFor(use, base));
}

function classColourSamples(file: string, line: number, token: string): ColorSample[] {
  const body = utilityBody(token);
  const prefix = colourPrefix(body);
  if (prefix === null) return [];
  const value = body.slice(prefix.length + 1);
  const dark = hasDarkVariant(token);
  if (value.startsWith('[')) {
    return arbitraryClassSamples(
      { file, line, raw: token, property: prefix, dark },
      value.slice(1, -1)
    );
  }
  const family = PALETTE_BODY.exec(value)?.[1];
  const hue = family === undefined ? undefined : paletteHue(family);
  if (hue === undefined) return [];
  return [
    {
      file,
      line,
      raw: token,
      property: prefix,
      dark,
      kind: 'palette',
      literal: null,
      hex: null,
      hue,
      chroma: null,
      variable: null,
      reason: null
    }
  ];
}

function measureClassColour(file: string, view: string, starts: readonly number[]): ColorSample[] {
  const samples: ColorSample[] = [];
  for (const span of classValueSpans(view)) {
    for (const { token, start } of classTokens(span)) {
      samples.push(...classColourSamples(file, lineAt(starts, start), token));
    }
  }
  return samples;
}

function measureInlineColour(file: string, view: string, starts: readonly number[]): ColorSample[] {
  const samples: ColorSample[] = [];
  for (const region of declarationRegions(file, view)) {
    for (const declaration of declarationMatches(region, COLOUR_PROPERTY)) {
      const line = lineAt(starts, declaration.start);
      for (const use of analyseColourValue(declaration.value)) {
        samples.push(
          sampleFor(use, {
            file,
            line,
            raw: declaration.value,
            property: declaration.property,
            dark: false
          })
        );
      }
    }
  }
  return samples;
}

/** Every colour one source declares, class contexts first, then styles. */
function measureSource(source: AuditSource): ColorSample[] {
  const view = sourceView(source);
  return [
    ...measureClassColour(source.file, view.comments, view.starts),
    ...measureInlineColour(source.file, view.comments, view.starts)
  ];
}

/** Every colour a page's source declares, class contexts first, then styles. */
export function measureColor(sources: readonly AuditSource[]): ColorSample[] {
  return sources.flatMap((source) => memoBySource(source, 'color', () => measureSource(source)));
}
