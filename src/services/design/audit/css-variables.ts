/**
 * CSS custom-property table (S7 Task 3b).
 *
 * The spike measured that the pilot's spacing, type and radius ladders resolve
 * only through runtime density variables (`--spacing ∈ {4, 4.8, 3.6, 4.48}px`).
 * Judging a literal against one preset would manufacture false findings, so the
 * rule here is deliberately strict:
 *
 *   `var(--name)` resolves only when every definition of `--name` agrees on ONE
 *   value; otherwise it is state-dependent, and the report lists every value
 *   with the selector that defines it. States are named, never averaged.
 *
 * The state a resolution was scored under travels with the result, so a report
 * can say "16px under [data-theme='dark']" instead of implying one number holds
 * in every state.
 */

/** One `--name: value` declaration, with the block that defines it. */
export type CssVariableDefinition = {
  name: string;
  value: string;
  /** The selector verbatim (`:root`, `[data-density="compact"]`, …). */
  selector: string;
  /** The selector when it names a runtime state; null for a root definition. */
  state: string | null;
  file: string;
  /** 1-based line of the definition. */
  line: number;
};

/** `--name → every definition in the read file set`, in source order. */
export type CssVariableTable = ReadonlyMap<string, readonly CssVariableDefinition[]>;

/** What a `var(--name)` reference resolves to, before any value interpretation. */
export type VariableResolution =
  | { kind: 'resolved'; value: string; state: string | null }
  | { kind: 'state-dependent'; definitions: readonly CssVariableDefinition[] }
  | { kind: 'unknown' };

/** What a caller's parser made of a resolved value. */
export type VariableOutcome<T> =
  | { kind: 'resolved'; value: T; via: string; state: string | null }
  | { kind: 'state-dependent'; variable: string; detail: string }
  | { kind: 'unreadable'; variable: string; detail: string };

const VARIABLE_REFERENCE = /^var\(\s*(--[\w-]+)\s*(?:,[\s\S]*)?\)$/;

/** Group definitions by variable name, keeping source order. */
export function buildVariableTable(
  definitions: readonly CssVariableDefinition[]
): CssVariableTable {
  const table = new Map<string, CssVariableDefinition[]>();
  for (const definition of definitions) {
    const list = table.get(definition.name) ?? [];
    list.push(definition);
    table.set(definition.name, list);
  }
  return table;
}

/** The distinct values a variable is defined with, in definition order. */
function distinctValues(definitions: readonly CssVariableDefinition[]): string[] {
  const values: string[] = [];
  for (const definition of definitions) {
    if (!values.includes(definition.value)) values.push(definition.value);
  }
  return values;
}

/** The one state a resolution applies to, or null when it holds for several. */
function scoredState(definitions: readonly CssVariableDefinition[]): string | null {
  const states = [...new Set(definitions.map((definition) => definition.state))];
  return states.length === 1 ? (states[0] ?? null) : null;
}

/**
 * The resolution rule: one distinct value resolves (naming its state when there
 * is one); several distinct values are state-dependent and are never averaged.
 */
export function resolveVariable(
  table: CssVariableTable | undefined,
  name: string
): VariableResolution {
  const definitions = table?.get(name);
  if (definitions === undefined || definitions.length === 0) return { kind: 'unknown' };
  const values = distinctValues(definitions);
  if (values.length !== 1) return { kind: 'state-dependent', definitions };
  return {
    kind: 'resolved',
    value: values[0] ?? '',
    state: scoredState(definitions)
  };
}

/** `4px @[data-density="compact"] (theme.css:2); …` — every state, named. */
export function describeDefinitions(definitions: readonly CssVariableDefinition[]): string {
  return definitions
    .map(
      (definition) =>
        `${definition.value} @${definition.selector} (${definition.file}:${definition.line})`
    )
    .join('; ');
}

/** The distinct state selectors the read file set defines, sorted. */
export function stateNames(table: CssVariableTable): string[] {
  const names = new Set<string>();
  for (const definitions of table.values()) {
    for (const definition of definitions) {
      if (definition.state !== null) names.add(definition.state);
    }
  }
  return [...names].sort((left, right) => left.localeCompare(right));
}

/** `--name → its distinct values`, the shape the report prints. */
export function variableValues(table: CssVariableTable): Map<string, string[]> {
  const values = new Map<string, string[]>();
  for (const [name, definitions] of table) values.set(name, distinctValues(definitions));
  return values;
}

/**
 * Resolve one `var()` reference through the table and interpret the value with
 * `parse`. A state-dependent variable, a missing definition, or a value the
 * caller cannot interpret all keep their variable name: the caller reports the
 * value as `unmeasured`, never as a violation.
 */
export function resolveThrough<T>(
  table: CssVariableTable | undefined,
  name: string,
  parse: (value: string) => T | null
): VariableOutcome<T> {
  const resolution = resolveVariable(table, name);
  if (resolution.kind === 'unknown') {
    return { kind: 'unreadable', variable: name, detail: `no definition for ${name}` };
  }
  if (resolution.kind === 'state-dependent') {
    return {
      kind: 'state-dependent',
      variable: name,
      detail: describeDefinitions(resolution.definitions)
    };
  }
  const value = parse(resolution.value);
  if (value === null) {
    return {
      kind: 'unreadable',
      variable: name,
      detail: `${name} = ${resolution.value} cannot be read`
    };
  }
  return {
    kind: 'resolved',
    value,
    via: `${name} = ${resolution.value}`,
    state: resolution.state
  };
}

/** The variable name when a value is exactly one `var()` reference, else null. */
export function variableReference(value: string): string | null {
  return VARIABLE_REFERENCE.exec(value.trim())?.[1] ?? null;
}

/** A Tailwind arbitrary wrapper (`p-[…]`, `text-[…]`) with its inner value. */
const UTILITY_WRAPPER = /^[\w:-]*\[([\s\S]*)\]$/;

/**
 * The variable a value resolves through ONLY when the value is one `var()`
 * reference, either bare (`var(--x)`) or as a utility's whole arbitrary value
 * (`p-[var(--x)]`). A `calc(var(--x) * 2)` or a multi-value declaration is
 * null: mixing a resolved variable with anything else stays unmeasured.
 */
export function wholeVariableReference(raw: string): string | null {
  const trimmed = raw.trim();
  const inner = UTILITY_WRAPPER.exec(trimmed)?.[1] ?? trimmed;
  return variableReference(inner.trim());
}
