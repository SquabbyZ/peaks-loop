// src/services/mcp/surface.ts
//
// The tool surface, DERIVED from the generated read-only whitelist rather than
// restated beside it.
//
// WHY DERIVED. "Every argv a tool can run is whitelisted" is only checkable if
// there is no second list to disagree with. So the tools ARE the whitelist's
// entries grouped by their `tool` field: adding a tool means editing
// `contracts/readonly-surface.json` and regenerating, and a tool whose argv was
// never proven read-only cannot be declared here at all.
//
// `validateSurface` is spec §6's L4 — the startup check. L1 ("the server only
// runs whitelisted argv") is a property of the code; L4 turns "someone put a
// write argv into the surface" from a silent hole into a refusal to start. Its
// unit is the ARGV, not the tool: a composite tool carries several, and checking
// per tool would wave through all but one of them.
//
// JSON SCHEMA, NOT COMMANDER. The parameter constraints below come from the
// whitelist's `params`, which the generator introspected out of the live
// Commander registry when it wrote the artifact (`constraintSource` marks the
// few that were hand-written). One build of latency is the price of not loading
// the whole CLI command registry into a read-only server process; the artifact
// is regenerated in the build and CI fails on a diff, so it cannot drift.

import {
  loadReadOnlyWhitelist,
  type PlaceholderSpec,
  type ReadOnlyWhitelist,
  type ReadOnlyWhitelistEntry
} from '../readonly-surface/readonly-whitelist.js';

/** One JSON Schema property, as far as this surface needs one. */
export interface JsonSchemaProperty {
  readonly type: 'string' | 'integer';
  readonly description?: string;
  readonly pattern?: string;
  readonly enum?: readonly string[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly default?: number;
}

export interface JsonSchema {
  readonly type: 'object';
  readonly properties: Readonly<Record<string, JsonSchemaProperty>>;
  readonly required: readonly string[];
  /** The LLM must not send anything else; an unknown key is a refused call. */
  readonly additionalProperties: false;
}

export interface McpToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  /** The whitelist entries this tool runs, in whitelist order. Kept off the wire. */
  readonly entries: readonly ReadOnlyWhitelistEntry[];
}

/**
 * LLM-facing prose, per tool name. Every tool the whitelist declares must have
 * an entry here or `validateSurface` refuses to start — spec §8.4 rule 2 asks
 * the description to state the precondition, and a tool that silently has none
 * is how an LLM ends up calling it outside a peaks project.
 */
const TOOL_DESCRIPTIONS: Readonly<Record<string, string>> = {
  peaks_status:
    'Where a Peaks-Loop workflow currently is. Read-only. Composes `peaks skill presence --json`, ' +
    '`peaks session list --json` and, when both `rid` and `role` are given, `peaks request show ' +
    '<rid> --role <role> --json --project <project>`. Each CLI result is returned verbatim under ' +
    'its own key; a key is absent when that call was not run. Requires a Peaks-Loop project ' +
    '(a `.peaks/` directory) as the working directory.',
  peaks_memory_search:
    'Search this project’s durable memory for a term, and get back NAMES and short excerpts — ' +
    'never note bodies. Read-only. Use it to answer "has this project settled anything about X?" ' +
    'Requires a Peaks-Loop project (a `.peaks/` directory) as the working directory.'
};

/** Per-parameter prose, by placeholder name. Absent names simply carry no description. */
const PARAM_DESCRIPTIONS: Readonly<Record<string, string>> = {
  rid: 'The id of the request to read.',
  role: 'Role whose artifact to read. One of the declared enum values.',
  project: 'Absolute path of the Peaks-Loop project. Defaults to the server’s working directory.',
  query: 'The term to search project memory for.',
  limit: 'Maximum number of matching notes to return.'
};

/** The JSON Schema shape of one placeholder TYPE, before any per-name prose. */
type UndescribedProperty = Omit<JsonSchemaProperty, 'description'>;

const TYPE_SHAPES: Readonly<
  Record<PlaceholderSpec['type'], (spec: PlaceholderSpec) => UndescribedProperty>
> = {
  slug: (spec) =>
    spec.pattern === undefined ? { type: 'string' } : { type: 'string', pattern: spec.pattern },
  enum: (spec) => ({ type: 'string', enum: spec.values ?? [] }),
  integer: (spec) => ({
    type: 'integer',
    minimum: spec.min ?? 0,
    maximum: spec.max ?? Number.MAX_SAFE_INTEGER,
    ...(spec.default === undefined ? {} : { default: spec.default })
  }),
  token: () => ({ type: 'string' }),
  path: () => ({ type: 'string' })
};

function propertyFor(name: string, spec: PlaceholderSpec): JsonSchemaProperty {
  const description = PARAM_DESCRIPTIONS[name];
  const described = description === undefined ? {} : { description };
  return { ...TYPE_SHAPES[spec.type](spec), ...described };
}

function inputSchemaOf(entries: readonly ReadOnlyWhitelistEntry[]): JsonSchema {
  const properties: Record<string, JsonSchemaProperty> = {};
  for (const entry of entries) {
    for (const [name, spec] of Object.entries(entry.params)) {
      properties[name] = propertyFor(name, spec);
    }
  }
  // Nothing is `required` at the tool level. A tool whose entries all take no
  // parameter is callable with `{}`, and a tool with several entries (three
  // argv behind `peaks_status`) runs the subset whose parameters the caller
  // actually supplied. Requiring the union would make the two parameterless
  // argv unreachable.
  return { type: 'object', properties, required: [], additionalProperties: false };
}

/** Group the whitelist's entries into tools, preserving first-appearance order. */
export function buildToolDefinitions(whitelist: ReadOnlyWhitelist): readonly McpToolDefinition[] {
  const byTool = new Map<string, ReadOnlyWhitelistEntry[]>();
  for (const entry of whitelist.entries) {
    const bucket = byTool.get(entry.tool);
    if (bucket === undefined) {
      byTool.set(entry.tool, [entry]);
    } else {
      bucket.push(entry);
    }
  }
  return [...byTool].map(([name, entries]) => ({
    name,
    description: TOOL_DESCRIPTIONS[name] ?? '',
    inputSchema: inputSchemaOf(entries),
    entries
  }));
}

/** Load the whitelist artifact and build the surface from it. */
export function loadToolDefinitions(): readonly McpToolDefinition[] {
  return buildToolDefinitions(loadReadOnlyWhitelist());
}

/** Why a surface was refused. Named so the server can print it and exit non-zero. */
export class McpSurfaceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpSurfaceError';
  }
}

/** An entry's argv as a comparable template key: literals literal, placeholders `{name}`. */
export function argvTemplateOf(entry: ReadOnlyWhitelistEntry): string {
  return entry.argv
    .map((segment) => (segment.kind === 'literal' ? segment.value : `{${segment.name}}`))
    .join(' ');
}

/**
 * Refuse a whitelist artifact that is not internally coherent.
 *
 * WHO THIS IS FOR. The artifact is generated and CI re-generates it, so the
 * shape below holds on a clean checkout. The failure it exists for is the one
 * that leaves no other trace: the file is edited by hand, or an entry is
 * half-written, and a server starts up happily serving a surface nothing proved.
 * Every rule here is a property the generator establishes and a hand-edit
 * breaks, so a violated rule means "this is not the generated artifact".
 */
export function validateWhitelist(whitelist: ReadOnlyWhitelist): void {
  const seenIds = new Set<string>();
  for (const entry of whitelist.entries) {
    if (seenIds.has(entry.id)) {
      throw new McpSurfaceError(
        `Whitelist entry id '${entry.id}' is declared twice; refusing to start.`
      );
    }
    seenIds.add(entry.id);

    const literals = entry.argv
      .filter((segment) => segment.kind === 'literal')
      .map((segment) => (segment.kind === 'literal' ? segment.value : ''));
    // The command path must open the argv: an entry whose template does not
    // begin with the command it claims to be is an entry about something else.
    const prefix = literals.slice(0, entry.commandPath.length).join(' ');
    if (prefix !== entry.commandPath.join(' ')) {
      throw new McpSurfaceError(
        `Whitelist entry '${entry.id}' declares commandPath '${entry.commandPath.join(' ')}' but its argv starts '${prefix}'; refusing to start.`
      );
    }

    const used = entry.argv.flatMap((segment) => (segment.kind === 'param' ? [segment.name] : []));
    for (const name of used) {
      if (!(name in entry.params)) {
        throw new McpSurfaceError(
          `Whitelist entry '${entry.id}' uses placeholder '${name}' that it does not declare; refusing to start.`
        );
      }
      if (used.filter((candidate) => candidate === name).length !== 1) {
        throw new McpSurfaceError(
          `Whitelist entry '${entry.id}' uses placeholder '${name}' more than once; refusing to start.`
        );
      }
    }
    for (const name of Object.keys(entry.params)) {
      if (!used.includes(name)) {
        throw new McpSurfaceError(
          `Whitelist entry '${entry.id}' declares parameter '${name}' that its argv never uses; refusing to start.`
        );
      }
    }
  }
}

/**
 * L4 (spec §6): refuse to start when the tool surface and the proven whitelist do
 * not describe the same thing.
 *
 * Two properties, each meant to fail loudly rather than degrade:
 *
 *   1. Every argv a tool can run is a whitelisted argv, by template. The surface
 *      is derived from the same artifact today, so on the production path this
 *      reads as "nothing unproven got in" — but it is the boundary that has to
 *      hold the moment a tool is authored rather than derived, and the test
 *      proves it can fail by handing it a surface that names an unproven argv.
 *   2. Every whitelisted entry is reachable from some tool. This one DOES have a
 *      live trigger: an entry added to `readonly-surface.json` whose tool name is
 *      mistyped is proven read-only and then never served.
 */
export function validateSurface(
  whitelist: ReadOnlyWhitelist,
  tools: readonly McpToolDefinition[]
): void {
  validateWhitelist(whitelist);
  if (tools.length === 0) {
    throw new McpSurfaceError('MCP surface declares no tools; refusing to start.');
  }

  const whitelistedTemplates = new Set(whitelist.entries.map((entry) => argvTemplateOf(entry)));
  const servedTemplates = new Set<string>();
  for (const tool of tools) {
    if (tool.description.trim().length === 0) {
      throw new McpSurfaceError(
        `MCP tool '${tool.name}' has no description; refusing to start (spec §8.4 rule 2).`
      );
    }
    for (const entry of tool.entries) {
      const template = argvTemplateOf(entry);
      if (!whitelistedTemplates.has(template)) {
        throw new McpSurfaceError(
          `MCP tool '${tool.name}' carries argv '${template}' that is not in the read-only whitelist; refusing to start.`
        );
      }
      servedTemplates.add(template);
    }
  }
  for (const entry of whitelist.entries) {
    const template = argvTemplateOf(entry);
    if (!servedTemplates.has(template)) {
      throw new McpSurfaceError(
        `Whitelist entry '${entry.id}' ('${template}') is reachable from no MCP tool; refusing to start.`
      );
    }
  }
}
