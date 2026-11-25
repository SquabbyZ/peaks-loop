/**
 * Primary-action measurement for the S7 audit (Task 5).
 *
 * Two detectors ask a related question — surface asks "is the primary button
 * written more than one way?" and hierarchy asks "does the page show more than
 * one primary action?" — so the recognition of a primary style lives here once.
 *
 * A token is primary only when it names an INTENT (`bg-`, `text-`, `border-`,
 * `ring-`, …) AND a semantic family (`primary`, `brand`, `accent`), or when it
 * is one of the conventional button spellings (`btn-primary`,
 * `button--primary`, `is-primary`). A raw brand hex (`bg-blue-600`) is
 * deliberately NOT recognised: the source cannot know which chromatic step the
 * project treats as primary, and guessing would turn every accent colour into
 * a false finding.
 *
 * BUTTON SEMANTICS ARE PART OF THE RULE (Task 6c). The pilot's calibration
 * found that a `text-primary` link, a `data-selected:border-primary` card state
 * and a `text-primary` spinner icon were all counted as "primary buttons" —
 * 0/3 true positives. A primary token now counts only on an element that IS a
 * button: a `<button>`, an element with `role="button"`, or a class carrying
 * `bg-primary` together with padding and a radius. The evidence that made it
 * count travels with the sample, so the report can say why.
 */

import { classTokens, classValueSpans, utilityBody, type SourceSpan } from './audit-finding.js';
import {
  attributeOf,
  classSpanOf,
  isMarkupFile,
  scanElements,
  type MarkupElement
} from './markup-scan.js';
import { sourceView } from './source-view.js';

/** Why an element was counted as carrying a primary action. */
export type ButtonEvidence = 'button' | 'role=button' | 'bg-primary+padding+radius';

/** One class string that carries the primary style. */
export type PrimaryClassSample = {
  file: string;
  line: number;
  /** The space-normalised literal the primary token was written in. */
  text: string;
  /** Absolute source index of the class-value span (for ordering). */
  start: number;
  /** What made the element count as a button. */
  evidence: ButtonEvidence;
};

/** One element styled as the primary action. */
export type PrimaryAction = {
  file: string;
  line: number;
  tag: string;
  /** What made the element count as a button. */
  evidence: ButtonEvidence;
};

/** An intent-prefixed utility (`bg-`, `text-`, `ring-`, …). */
const INTENT_PREFIX = /^(?:bg|text|border|ring|from|to|via|fill|stroke|outline|decoration)(?:-|$)/;

/** The families the audit treats as a primary intent. */
const PRIMARY_SEGMENTS = new Set(['primary', 'brand', 'accent']);

/** Conventional button spellings that name no utility prefix. */
const PRIMARY_NAME = /^(?:is-)?primary$|^(?:btn|button)-{1,2}primary$/;

/**
 * True when a class token carries the primary style. Responsive / state
 * variants are stripped first (`dark:bg-primary` names the same style).
 */
export function isPrimaryToken(token: string): boolean {
  const lower = token.replace(/^!/, '').toLowerCase();
  const bare = lower.includes(':') ? lower.slice(lower.lastIndexOf(':') + 1) : lower;
  if (PRIMARY_NAME.test(bare)) return true;
  if (!INTENT_PREFIX.test(bare)) return false;
  return bare.split(/[./-]/).some((segment) => PRIMARY_SEGMENTS.has(segment));
}

function cleanToken(token: string): string {
  return token.replace(/^["'`]+/, '').replace(/[,;]+$/, '');
}

/** A token's own body with variants and importance removed. */
function bareToken(token: string): string {
  return utilityBody(cleanToken(token).replace(/^!/, '').toLowerCase());
}

/** The quoted literal inside a class-context span that carries a primary token. */
function primaryLiteral(spanText: string): string {
  const parts = spanText.split(/["'`]/);
  const hit = parts.find((part) =>
    part.split(/\s+/).some((token) => isPrimaryToken(cleanToken(token)))
  );
  return (hit ?? spanText).replace(/[,;]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * What makes an element with a primary token an actual BUTTON, or null when it
 * is a link, a state token or an icon and therefore not a primary action.
 */
export function buttonEvidenceOf(element: MarkupElement, span: SourceSpan): ButtonEvidence | null {
  const bodies = classTokens(span).map((entry) => bareToken(entry.token));
  if (!bodies.some((body) => isPrimaryToken(body))) return null;
  if (element.lowerTag === 'button') return 'button';
  if (attributeOf(element, ['role'])?.value?.trim().toLowerCase() === 'button')
    return 'role=button';
  const hasBackground = bodies.some((body) => body.startsWith('bg-') && isPrimaryToken(body));
  const hasPadding = bodies.some((body) => /^p(?:[xytrblse])?-/.test(body));
  const hasRadius = bodies.some((body) => /^rounded(?:-|$)/.test(body));
  return hasBackground && hasPadding && hasRadius ? 'bg-primary+padding+radius' : null;
}

/** Every class string carrying the primary style on a real button. */
export function primaryClassSamples(
  sources: readonly { file: string; source: string }[]
): PrimaryClassSample[] {
  const samples: PrimaryClassSample[] = [];
  for (const source of sources) {
    if (!isMarkupFile(source.file)) continue;
    const view = sourceView(source);
    const spans = classValueSpans(view.comments);
    for (const element of scanElements(view.comments, view.starts)) {
      const span = classSpanOf(element, spans);
      if (span === null) continue;
      const evidence = buttonEvidenceOf(element, span);
      if (evidence === null) continue;
      samples.push({
        file: source.file,
        line: element.line,
        text: primaryLiteral(span.text),
        start: span.start,
        evidence
      });
    }
  }
  return samples;
}

/** The distinct primary class strings a page writes, first-seen order. */
export function distinctPrimaryStrings(samples: readonly PrimaryClassSample[]): string[] {
  return [...new Set(samples.map((sample) => sample.text))];
}

/**
 * The elements styled as a primary action. One element with several primary
 * tokens counts once: the question is how many buttons the person sees, not how
 * many classes each carries.
 */
export function primaryActions(
  sources: readonly { file: string; source: string }[]
): PrimaryAction[] {
  const actions: PrimaryAction[] = [];
  for (const source of sources) {
    if (!isMarkupFile(source.file)) continue;
    const view = sourceView(source);
    const elements = scanElements(view.comments, view.starts);
    const spans = classValueSpans(view.comments);
    for (const element of elements) {
      const span = classSpanOf(element, spans);
      if (span === null) continue;
      const evidence = buttonEvidenceOf(element, span);
      if (evidence === null) continue;
      actions.push({ file: source.file, line: element.line, tag: element.tag, evidence });
    }
  }
  return actions;
}
