/**
 * Colour notation (S7): turning a class token or declaration value into the
 * colour literals and variables it spells.
 *
 * Two gaps the spike measured are repaired here:
 *
 *   - a `rgba()` joined to an identifier (`shadow-[0_2px_16px_rgba(…)]`) was
 *     invisible to a `\b`-anchored rule, because `_` and `r` are both word
 *     characters — this reader anchors on the function name alone;
 *   - Tailwind's underscore spelling (`oklch(0.82_0.04_155)`) is normalised to
 *     spaces before conversion, so the notation parses.
 *
 * A value that is only a `var()` reference, or a `color-mix()` chain, is
 * returned as unreadable with its variable names, never guessed. A `text-[…]`
 * value behind a variable is ambiguous between a font size and a colour and is
 * left to the type detector; `text-[color:var(--x)]` names it a colour.
 */

import { toRenderableColor } from '../css-color.js';

/** One colour value a class token or declaration spells, before normalisation. */
export type ColourUse =
  | { kind: 'literal'; literal: string; hex: string }
  | { kind: 'unreadable'; variable: string | null; reason: string | null };

const UNDERSCORE = /_/g;
const HEX_LITERAL = /#[0-9a-f]{3,8}(?![0-9a-z])/gi;
// One nesting level is enough for `rgb(var(--x) / 0.5)`; a deeper call reads
// as an unparsable literal, which is recorded as unmeasured rather than guessed.
const FUNCTION_LITERAL = /(?:rgba?|hsla?|oklch|oklab)\([^()]*(?:\([^()]*\)[^()]*)*\)/gi;
const VARIABLE_CALL = /var\(\s*(--[\w-]+)/g;
const COLOR_MIX = /color-mix\(/i;
const LENGTH_HINT = /^length:/i;
const COLOR_HINT = /^color:/i;

/** True when the utility's arbitrary value declares a font size, not a colour. */
export function isLengthUtility(inner: string): boolean {
  return LENGTH_HINT.test(inner);
}

/** A `text-[…]` variable is ambiguous between a font size and a colour. */
export function requiresColourHint(prefix: string, inner: string): boolean {
  return prefix === 'text' && !COLOR_HINT.test(inner);
}

/** True when a top-level variant segment of the utility is `dark`. */
export function hasDarkVariant(token: string): boolean {
  let depth = 0;
  let segmentStart = 0;
  for (let index = 0; index < token.length; index += 1) {
    const char = token[index];
    if (char === '[') depth += 1;
    else if (char === ']') depth = Math.max(0, depth - 1);
    else if (char === ':' && depth === 0) {
      if (token.slice(segmentStart, index) === 'dark') return true;
      segmentStart = index + 1;
    }
  }
  return false;
}

function variablesIn(text: string): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(VARIABLE_CALL)) {
    const name = match[1] ?? '';
    if (name !== '') names.add(name);
  }
  return [...names];
}

function literalUses(text: string): ColourUse[] {
  const uses: ColourUse[] = [];
  for (const pattern of [FUNCTION_LITERAL, HEX_LITERAL]) {
    for (const match of text.matchAll(pattern)) {
      uses.push({
        kind: 'literal',
        literal: match[0],
        hex: toRenderableColor(match[0].replace(UNDERSCORE, ' ')) ?? ''
      });
    }
  }
  return uses;
}

/**
 * Every colour a value spells, or an unreadable record naming why. A value with
 * no colour at all (`bg-[url(…)]`, `bg-none`) yields none.
 */
export function analyseColourValue(text: string): ColourUse[] {
  const variables = variablesIn(text);
  if (COLOR_MIX.test(text)) {
    return [
      {
        kind: 'unreadable',
        variable: variables.length > 0 ? variables.join(', ') : null,
        reason: 'color-mix()'
      }
    ];
  }
  const literals = literalUses(text);
  if (literals.length > 0) {
    return literals.map((use): ColourUse => {
      if (use.kind === 'literal' && use.hex !== '') return use;
      return {
        kind: 'unreadable',
        variable: variables[0] ?? null,
        reason: 'unreadable colour notation'
      };
    });
  }
  return variables.length > 0
    ? [{ kind: 'unreadable', variable: variables.join(', '), reason: null }]
    : [];
}
