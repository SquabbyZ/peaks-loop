/**
 * Custom-component resolution for the S7 a11y detector (Task 6c).
 *
 * The pilot's real defect was invisible to the element rule: a page wrote
 * `<StatusBadge onClick={…}>`, and the `<span>` that receives the click lives
 * in the pilot's `status-badge` component. The detector only matched literal
 * `div` / `span` / `li`, so a custom component receiving `onClick` was never
 * seen even when its render root was a bare span.
 *
 * This reader answers one question per usage — "what does this component
 * render at its root?" — by finding the component's own definition in the
 * import closure and reading the element of its first value-returning
 * `return`/arrow. It is a source heuristic and says so: a definition it cannot
 * find yields `root: null`, which the detector reports as `unmeasured`, never
 * as a pass.
 */

import type { AuditSource } from './audit-finding.js';
import { attributeOf, hasAttributeOf, scanElements, type MarkupElement } from './markup-scan.js';
import { memoBySource, sourceView } from './source-view.js';

/** The element a component renders at its root, when the source shows it. */
export type ComponentRoot = { file: string; line: number; element: MarkupElement };

/** One component definition found in the read set. */
export type ComponentDefinition = { name: string; file: string; root: ComponentRoot | null };

/** One `<Custom onClick={…}>` usage in a source. */
export type ComponentUsage = { file: string; line: number; name: string; element: MarkupElement };

/** Attributes that carry a click handler, across React / Vue spellings. */
export const CLICK_ATTRIBUTES = ['onClick', 'onclick', '@click'];

/** Elements that carry no native interaction semantics. */
export const NON_INTERACTIVE = new Set(['div', 'span', 'li']);

/** Elements whose focus and activation behaviour is native. */
export const NATIVE_INTERACTIVE = new Set([
  'button',
  'a',
  'input',
  'select',
  'textarea',
  'summary',
  'details',
  'option',
  'label'
]);

/** `function Name(` and `const Name = (…) =>` component declarations. */
const DEFINITION =
  /(?:(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Z][\w$]*)\s*\()|(?:(?:export\s+)?const\s+([A-Z][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\s*)?\([^)]*\)\s*=>)/g;

/** The `return` / arrow before which an element is the component's render root. */
const ROOT_PREFIX = /(?:\breturn|=>)\s*\(?\s*$/;

/** True when a tag names a component rather than a DOM element. */
export function isComponentTag(element: MarkupElement): boolean {
  return /^[A-Z]/.test(element.tag);
}

/** How far before an element a `return (`/`=> (` still belongs to it. */
const ROOT_LOOKBEHIND = 60;

/** One file's element scan, shared by every definition in it. */
type RootScan = {
  file: string;
  view: string;
  elements: readonly MarkupElement[];
  from: number;
  to: number;
};

/** The component's render root: the first element after a `return (`/`=> (`. */
function rootOf(scan: RootScan): ComponentRoot | null {
  for (const element of scan.elements) {
    if (element.start < scan.from || element.start >= scan.to) continue;
    const before = scan.view.slice(
      Math.max(scan.from, element.start - ROOT_LOOKBEHIND),
      element.start
    );
    if (ROOT_PREFIX.test(before)) return { file: scan.file, line: element.line, element };
  }
  return null;
}

/** Every component definition one source declares. */
function definitionsOfSource(source: AuditSource): ComponentDefinition[] {
  const found: ComponentDefinition[] = [];
  const view = sourceView(source);
  const elements = scanElements(view.comments, view.starts);
  const matches = [...view.comments.matchAll(DEFINITION)];
  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const name = match?.[1] ?? match?.[2];
    if (name === undefined || found.some((entry) => entry.name === name)) continue;
    const from = (match?.index ?? 0) + (match?.[0].length ?? 0);
    const to = matches[index + 1]?.index ?? view.comments.length;
    found.push({
      name,
      file: source.file,
      root: rootOf({ file: source.file, view: view.comments, elements, from, to })
    });
  }
  return found;
}

/**
 * Every component definition across the sources. The first definition of a name
 * wins: a re-export or a second declaration is not the render contract the
 * first page import resolves to. Per-source results are memoised, so a shared
 * component is scanned once per run rather than once per importing page.
 */
export function componentDefinitions(
  sources: readonly AuditSource[]
): Map<string, ComponentDefinition> {
  const definitions = new Map<string, ComponentDefinition>();
  for (const source of sources) {
    const found = memoBySource(source, 'component-defs', () => definitionsOfSource(source));
    for (const definition of found) {
      if (!definitions.has(definition.name)) definitions.set(definition.name, definition);
    }
  }
  return definitions;
}

/** Every `<Custom onClick={…}>` usage one source declares. */
function usagesOfSource(source: AuditSource): ComponentUsage[] {
  const usages: ComponentUsage[] = [];
  const view = sourceView(source);
  for (const element of scanElements(view.comments, view.starts)) {
    if (!isComponentTag(element)) continue;
    if (!hasAttributeOf(element, CLICK_ATTRIBUTES)) continue;
    usages.push({ file: source.file, line: element.line, name: element.tag, element });
  }
  return usages;
}

/** Every `<Custom onClick={…}>` usage across the sources. */
export function componentUsages(sources: readonly AuditSource[]): ComponentUsage[] {
  return sources.flatMap((source) =>
    memoBySource(source, 'component-usages', () => usagesOfSource(source))
  );
}

/** True when the element is a non-interactive root with no keyboard wiring. */
export function isUnwiredRoot(element: MarkupElement): boolean {
  if (!NON_INTERACTIVE.has(element.lowerTag)) return false;
  if (attributeOf(element, ['role']) !== null) return false;
  return attributeOf(element, ['tabIndex', 'tabindex']) === null;
}
