/**
 * The rendered observation the route-identity check judges, read from ONE
 * `designlang extract --json` payload.
 *
 * Each field is mapped from the exact place designlang 13.4.1 exposes it (the
 * S6 spike measured the field table):
 *
 * - `title`            <- `meta.title`
 * - `headings`         <- `voice.sampleHeadings` (semantic-section headings only)
 * - `buttonPatterns`   <- `voice.buttonPatterns[].value` (lowercased button/link copy)
 * - `sampleText`       <- `componentAnatomy[].variants[].sampleText` (when present)
 * - `renderedInputs`   <- `components.inputs.count` (input|textarea|select)
 *
 * A field the payload does not carry is left ABSENT — no default and no guess.
 * `meta.url` is never read: it echoes the REQUESTED URL, not the final one
 * (measured on the pilot; see `route-identity.ts`).
 */
import type { RouteObservation } from './route-identity.js';

/**
 * The identity payload as the route stage consumes it: one observation, whose
 * title and headings are the only fields it matches markers against. The raw
 * title is not carried separately — a duplicate with no reader is a field a
 * later edit can silently drift from the one the stage reads.
 */
export type IdentityDocument = {
  /** The route check's view of the payload; absent fields are not guessed. */
  observation: RouteObservation;
};

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    : [];
}

/** `voice.buttonPatterns` is a list of `{ value }` records, not bare strings. */
function buttonValues(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const text = stringOf(recordOf(entry).value);
    return text === null ? [] : [text];
  });
}

/** Flatten `componentAnatomy[].variants[].sampleText`; absent shapes add nothing. */
function anatomySampleText(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((component) => {
    const variants = recordOf(component).variants;
    if (!Array.isArray(variants)) return [];
    return variants.flatMap((variant) => stringsOf(recordOf(variant).sampleText));
  });
}

/** `components.inputs.count`, only when it is a finite number. */
function inputCountOf(value: unknown): number | null {
  const count = recordOf(recordOf(value).inputs).count;
  return typeof count === 'number' && Number.isFinite(count) ? count : null;
}

/** Map one parsed `extract --json` payload to the probe's identity document. */
export function readRenderedIdentity(payload: Record<string, unknown>): IdentityDocument {
  const title = stringOf(recordOf(payload.meta).title);
  const headings = stringsOf(recordOf(payload.voice).sampleHeadings);
  const buttonPatterns = buttonValues(recordOf(payload.voice).buttonPatterns);
  const sampleText = anatomySampleText(payload.componentAnatomy);
  const renderedInputs = inputCountOf(payload.components);
  return {
    observation: {
      ...(title === null ? {} : { title }),
      ...(headings.length === 0 ? {} : { headings }),
      ...(buttonPatterns.length === 0 ? {} : { buttonPatterns }),
      ...(sampleText.length === 0 ? {} : { sampleText }),
      ...(renderedInputs === null ? {} : { renderedInputs })
    }
  };
}
