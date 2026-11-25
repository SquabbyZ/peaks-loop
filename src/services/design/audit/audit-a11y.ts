/**
 * Accessibility detector (S7 Task 5, made able to fire by Task 6c).
 *
 * Three structural failures a source scan can prove, all hard because they stop
 * a keyboard or assistive-technology user outright:
 *   - a click handler on a non-interactive element (`div` / `span` / `li`) with
 *     no `role` and no `tabIndex` — the element is invisible to the keyboard;
 *   - a CUSTOM component receiving `onClick` whose definition renders a
 *     non-interactive root with no `role` / `tabIndex` (the pilot's
 *     `StatusBadge` span, reached only through an `@/…` alias);
 *   - a custom interactive element with no `focus-visible` style ON THE FILE
 *     THAT RENDERS IT.
 *
 * THE FOCUS RULE USED TO BE GLOBALLY SATISFIED. One `.billing-condition-row
 * :focus-within` in a project stylesheet made every page pass, so the rule
 * could not fire anywhere. It now reads only the file that renders the
 * interactive element; when that file cannot be identified (a component whose
 * definition is outside the read set) the dimension reports `unmeasured` with
 * the reason instead of inventing a pass.
 */

import { type AuditFinding, type AuditInput, type AuditSource } from './audit-finding.js';
import {
  CLICK_ATTRIBUTES,
  NATIVE_INTERACTIVE,
  NON_INTERACTIVE,
  componentDefinitions,
  componentUsages,
  isComponentTag,
  isUnwiredRoot,
  type ComponentUsage
} from './a11y-components.js';
import {
  attributeOf,
  hasAttributeOf,
  markupSources,
  scanElements,
  type MarkupElement
} from './markup-scan.js';
import { memoBySource, sourceView } from './source-view.js';

const ROLE_ATTRIBUTES = ['role'];
const TAB_ATTRIBUTES = ['tabIndex', 'tabindex'];

/** A focus style may live in a utility class or a stylesheet pseudo-class. */
const FOCUS_STYLE = /(?:focus-visible|focusVisible|:focus\b|focus:)/;

type Position = { file: string; line: number };

function dedupeSources(sources: readonly AuditSource[]): AuditSource[] {
  const seen = new Set<string>();
  const unique: AuditSource[] = [];
  for (const source of sources) {
    if (seen.has(source.file)) continue;
    seen.add(source.file);
    unique.push(source);
  }
  return unique;
}

/** A clickable element that is not native and hides its name from the keyboard. */
function clickFinding(file: string, element: MarkupElement): AuditFinding {
  return {
    dimension: 'a11y',
    severity: 'hard',
    file,
    line: element.line,
    value: `<${element.tag} onClick>`,
    expected: 'role + tabIndex',
    humanText: `第 ${element.line} 行的 <${element.tag}> 绑定了点击事件，但没有 role 也没有 tabIndex，键盘用户无法操作。`,
    techText: `${file}:${element.line} <${element.tag} onClick> missing role/tabIndex`
  };
}

/** A custom component whose click lands on an unwired non-interactive root. */
function componentClickFinding(usage: ComponentUsage, definitionFile: string): AuditFinding {
  return {
    dimension: 'a11y',
    severity: 'hard',
    file: usage.file,
    line: usage.line,
    value: `<${usage.name} onClick>`,
    expected: 'role + tabIndex on the rendered element',
    humanText: `第 ${usage.line} 行给 <${usage.name}> 绑定了点击事件，而它渲染的是一个没有 role、没有 tabIndex 的非交互元素（${definitionFile}），键盘用户无法操作。`,
    techText: `${usage.file}:${usage.line} <${usage.name} onClick> renders non-interactive root without role/tabIndex (${definitionFile})`
  };
}

/** A custom interactive element whose focus ring is not declared where it renders. */
function focusFinding(position: Position): AuditFinding {
  return {
    dimension: 'a11y',
    severity: 'hard',
    file: position.file,
    line: position.line,
    value: 'focus-visible',
    expected: 'focus-visible style',
    humanText: `第 ${position.line} 行的自定义交互元素所在的文件没有 focus-visible 样式，键盘用户看不到焦点落在哪里。`,
    techText: `${position.file}:${position.line} interactive-without-focus-visible (missing focus-visible style in the rendering file)`
  };
}

/** The focus question could not be judged: the renderer is outside the read set. */
function focusUnmeasuredFinding(usage: ComponentUsage): AuditFinding {
  return {
    dimension: 'a11y',
    severity: 'unmeasured',
    file: usage.file,
    line: usage.line,
    value: '<component onClick>',
    expected: 'focus-visible style',
    humanText: `无法判断 <${usage.name}> 的焦点样式：它在第 ${usage.line} 行接收点击，但它的定义不在本次读取的导入闭包里。`,
    techText: `${usage.file}:${usage.line} <${usage.name} onClick> focus-visible unmeasured (component definition not read)`
  };
}

/** `role="button"` on an element that is not a native control. */
function isCustomButton(element: MarkupElement): boolean {
  if (NATIVE_INTERACTIVE.has(element.lowerTag)) return false;
  const role = attributeOf(element, ROLE_ATTRIBUTES)?.value?.trim().toLowerCase();
  return role === 'button';
}

/** True when the element is a custom control that relies on the keyboard. */
function isCustomInteractive(element: MarkupElement): boolean {
  if (NATIVE_INTERACTIVE.has(element.lowerTag)) return false;
  return hasAttributeOf(element, CLICK_ATTRIBUTES) || isCustomButton(element);
}

/**
 * The custom interactive DOM elements a markup source renders. A component tag
 * is not one: what it renders is judged through its definition in
 * `focusVerdict`, so a `<IconButton onClick>` cannot be failed on the page that
 * merely uses it.
 */
function interactivePositions(source: AuditSource): Position[] {
  return memoBySource(source, 'a11y-interactive', () => {
    const view = sourceView(source);
    return scanElements(view.comments, view.starts)
      .filter((element) => !isComponentTag(element) && isCustomInteractive(element))
      .map((element) => ({ file: source.file, line: element.line }));
  });
}

/** Click findings for one file's literal non-interactive elements. */
function sourceElementFindings(source: AuditSource): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const view = sourceView(source);
  for (const element of scanElements(view.comments, view.starts)) {
    if (!NON_INTERACTIVE.has(element.lowerTag)) continue;
    if (!hasAttributeOf(element, CLICK_ATTRIBUTES)) continue;
    if (hasAttributeOf(element, ROLE_ATTRIBUTES)) continue;
    if (hasAttributeOf(element, TAB_ATTRIBUTES)) continue;
    findings.push(clickFinding(source.file, element));
  }
  return findings;
}

/** Click findings for the literal non-interactive elements of a file set. */
function elementFindings(sources: readonly AuditSource[]): AuditFinding[] {
  return sources.flatMap((source) =>
    memoBySource(source, 'a11y-elements', () => sourceElementFindings(source))
  );
}

/** Click findings for custom components whose rendered root cannot be used. */
function componentFindings(
  pageSources: readonly AuditSource[],
  definitions: ReturnType<typeof componentDefinitions>
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  for (const usage of componentUsages(pageSources)) {
    const definition = definitions.get(usage.name);
    if (definition === undefined || definition.root === null) continue;
    if (!isUnwiredRoot(definition.root.element)) continue;
    const where = `${definition.file}:${definition.root.line} <${definition.root.element.tag}>`;
    findings.push(componentClickFinding(usage, where));
  }
  return findings;
}

/**
 * The focus verdict. Every custom interactive element must find a focus style
 * in the file that renders it; a component whose definition was not read is
 * `unmeasured`, naming the reason. The project's stylesheets no longer count.
 */
function focusVerdict(
  input: AuditInput,
  scanned: readonly AuditSource[],
  definitions: ReturnType<typeof componentDefinitions>
): AuditFinding[] {
  const byFile = new Map(scanned.map((source) => [source.file, source]));
  const positions = scanned.flatMap((source) => interactivePositions(source));
  const usages = componentUsages(markupSources(input.sources));
  const unsatisfied: Position[] = positions.filter((position) => {
    const owner = byFile.get(position.file);
    return owner === undefined || !FOCUS_STYLE.test(sourceView(owner).comments);
  });
  const unknown: ComponentUsage[] = [];
  for (const usage of usages) {
    const definition = definitions.get(usage.name);
    if (definition === undefined || definition.root === null) {
      unknown.push(usage);
      continue;
    }
    const owner = byFile.get(definition.file);
    if (owner === undefined || !FOCUS_STYLE.test(sourceView(owner).comments)) {
      unsatisfied.push({ file: definition.file, line: definition.root.line });
    }
  }
  const findings: AuditFinding[] = [];
  const first = unsatisfied[0];
  if (first !== undefined) findings.push(focusFinding(first));
  const unnamed = unknown[0];
  if (unnamed !== undefined) findings.push(focusUnmeasuredFinding(unnamed));
  return findings;
}

/** Every accessibility finding for a page and the modules it imports. */
export function auditA11y(input: AuditInput): AuditFinding[] {
  return auditA11yDimension(input).findings;
}

/** The a11y verdict plus whether any markup page was available to judge. */
export type A11yDimensionAudit = { findings: AuditFinding[]; judged: boolean };

/** Every accessibility finding, and whether a markup page was judged at all. */
export function auditA11yDimension(input: AuditInput): A11yDimensionAudit {
  const pageSources = markupSources(input.sources);
  if (pageSources.length === 0) return { findings: [], judged: false };
  const imports = markupSources(input.imports ?? []);
  const scanned = dedupeSources([...pageSources, ...imports]);
  const definitions = componentDefinitions(scanned);
  const findings = [
    ...elementFindings(scanned),
    ...componentFindings(pageSources, definitions),
    ...focusVerdict(input, scanned, definitions)
  ];
  const seen = new Set<string>();
  const unique = findings.filter((finding) => {
    const key = `${finding.file}:${finding.line}:${finding.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { findings: unique, judged: true };
}
