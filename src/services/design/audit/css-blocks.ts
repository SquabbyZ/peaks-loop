/**
 * CSS block reader (S7 Task 3b): the declarations and custom properties the
 * audit needs, each with the selector it lives under and its source line.
 *
 * `.css` is deliberately NOT a G1-scannable extension, so this reader is
 * audit-only. It does not judge anything: it turns one stylesheet's text into
 * the two facts the audit was blind to — the spacing/type/colour declarations a
 * legacy page writes in plain CSS, and the `--name: value` definitions that
 * decide whether `var(--name)` resolves or depends on a runtime state.
 *
 * A block's SELECTOR is kept verbatim (`[data-density="compact"]`), and a
 * declaration's `state` is the nearest enclosing selector that itself defines
 * custom properties and is not a root selector — that selector is the runtime
 * state the value belongs to. A declaration under a root/at-rule block has no
 * state (`null`).
 */

import { stripViews } from '../source-scan/strip-comments.js';
import { lineAt, lineStarts } from './audit-finding.js';
import type { CssVariableDefinition } from './css-variables.js';

/** One declaration the audit judges, with its selector and source position. */
export type CssDeclaration = {
  /** App-relative path, `/`-separated, as the caller supplied it. */
  file: string;
  /** 1-based line of the declaration's property. */
  line: number;
  /** Lower-cased CSS property (`padding`, `font-size`, `box-shadow`, …). */
  property: string;
  /** The value exactly as written, trimmed (`var(--spacing)`, `13px`, …). */
  value: string;
  /** The innermost non-at-rule selector the declaration lives under. */
  selector: string;
  /** The selector that defines variables around it, or null for the base. */
  state: string | null;
};

/** Everything one stylesheet contributes: declarations, variables, imports. */
export type ParsedCss = {
  declarations: CssDeclaration[];
  variables: CssVariableDefinition[];
  /** Relative `@import` / `@use` / `@forward` specifiers, for the closure. */
  imports: string[];
};

type RawStatement = { property: string; value: string; start: number };

type RawBlock = {
  selector: string;
  parent: number | null;
  statements: RawStatement[];
};

/**
 * The properties the audit needs. `padding*` / `margin*` / `gap*` cover every
 * long-hand (`padding-inline-start`, `row-gap`, …) without enumerating them.
 */
const AUDIT_PROPERTY =
  /^(?:padding(?:-[a-z-]+)?|margin(?:-[a-z-]+)?|gap(?:-[a-z-]+)?|row-gap|column-gap|font-size|font-weight|color|background-color|border-radius|box-shadow)$/;

/** `@import "x"`, `@import url("x")`, `@use 'x' as y`, `@forward 'x'`. */
const IMPORT_RULE = /@(?:import|use|forward)\s+(?:url\(\s*)?(["'])([^"']+)\1/gi;

/** Selectors whose custom properties are the base of the scale, not a state. */
const ROOT_PARTS = new Set([':root', 'html', ':host', 'html:root', ':host:root']);

/** True when every comma-separated part of a selector names the document root. */
function isRootSelector(selector: string): boolean {
  const parts = selector
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');
  return parts.length > 0 && parts.every((part) => ROOT_PARTS.has(part));
}

/** A rule selector, or null for an empty / at-rule block (`@media`, …). */
function effectiveSelector(selector: string): string | null {
  const trimmed = selector.trim();
  return trimmed === '' || trimmed.startsWith('@') ? null : trimmed;
}

/** The parsing state one `property: value` statement is recorded against. */
type RecordContext = {
  view: string;
  blocks: RawBlock[];
  from: number;
  to: number;
  blockIndex: number | undefined;
};

/** Append a `property: value` statement to the block currently open. */
function recordStatement(context: RecordContext): void {
  const block = context.blockIndex === undefined ? undefined : context.blocks[context.blockIndex];
  if (block === undefined) return;
  const statement = context.view.slice(context.from, context.to);
  const colon = statement.indexOf(':');
  if (colon <= 0) return;
  const property = statement.slice(0, colon).trim().toLowerCase();
  if (property === '' || property.startsWith('@')) return;
  const value = statement.slice(colon + 1).trim();
  if (value === '') return;
  const leading = statement.length - statement.trimStart().length;
  block.statements.push({ property, value, start: context.from + leading });
}

/** Split a comment-stripped stylesheet into a shallow block tree. */
function readBlocks(view: string): RawBlock[] {
  const blocks: RawBlock[] = [];
  const stack: number[] = [];
  let statementStart = 0;
  for (let index = 0; index < view.length; index += 1) {
    const char = view[index];
    if (char === '{') {
      blocks.push({
        selector: view.slice(statementStart, index).trim(),
        parent: stack[stack.length - 1] ?? null,
        statements: []
      });
      stack.push(blocks.length - 1);
      statementStart = index + 1;
    } else if (char === '}') {
      // A last declaration may omit its trailing semicolon.
      recordStatement({
        view,
        blocks,
        from: statementStart,
        to: index,
        blockIndex: stack[stack.length - 1]
      });
      stack.pop();
      statementStart = index + 1;
    } else if (char === ';') {
      recordStatement({
        view,
        blocks,
        from: statementStart,
        to: index,
        blockIndex: stack[stack.length - 1]
      });
      statementStart = index + 1;
    }
  }
  return blocks;
}

/** The nearest selector and the nearest variable-defining state around a block. */
function enclosingContext(
  blocks: readonly RawBlock[],
  definesVariables: readonly boolean[],
  index: number
): { selector: string; state: string | null } {
  let selector = '';
  let state: string | null = null;
  let current: number | null = index;
  while (current !== null) {
    const block: RawBlock | undefined = blocks[current];
    if (block === undefined) break;
    const name = effectiveSelector(block.selector);
    if (selector === '' && name !== null) selector = name;
    if (state === null && name !== null && definesVariables[current] === true) {
      if (!isRootSelector(name)) state = name;
    }
    current = block.parent;
  }
  return { selector, state };
}

/** The selector a variable definition is made under (at-rules fall back to raw). */
function definitionSelector(block: RawBlock): string {
  return effectiveSelector(block.selector) ?? block.selector.trim();
}

/** Append one block's variable definitions and audit declarations. */
function collectBlock(input: {
  file: string;
  block: RawBlock;
  context: { selector: string; state: string | null };
  starts: readonly number[];
  declarations: CssDeclaration[];
  variables: CssVariableDefinition[];
}): void {
  const selector = definitionSelector(input.block);
  for (const statement of input.block.statements) {
    const line = lineAt(input.starts, statement.start);
    if (statement.property.startsWith('--')) {
      input.variables.push({
        name: statement.property,
        value: statement.value,
        selector,
        state: isRootSelector(selector) ? null : selector,
        file: input.file,
        line
      });
    } else if (AUDIT_PROPERTY.test(statement.property)) {
      input.declarations.push({
        file: input.file,
        line,
        property: statement.property,
        value: statement.value,
        selector: input.context.selector,
        state: input.context.state
      });
    }
  }
}

/** Unique relative import specifiers, in source order. */
function collectImports(view: string): string[] {
  const imports: string[] = [];
  for (const match of view.matchAll(IMPORT_RULE)) {
    const specifier = match[2] ?? '';
    if (specifier !== '' && !imports.includes(specifier)) imports.push(specifier);
  }
  return imports;
}

/** Read one stylesheet into declarations, variable definitions and imports. */
export function parseCss(file: string, source: string): ParsedCss {
  const view = stripViews(source).comments;
  const starts = lineStarts(source);
  const blocks = readBlocks(view);
  const definesVariables = blocks.map((block) =>
    block.statements.some((statement) => statement.property.startsWith('--'))
  );
  const declarations: CssDeclaration[] = [];
  const variables: CssVariableDefinition[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block === undefined) continue;
    collectBlock({
      file,
      block,
      context: enclosingContext(blocks, definesVariables, index),
      starts,
      declarations,
      variables
    });
  }
  return { declarations, variables, imports: collectImports(view) };
}
