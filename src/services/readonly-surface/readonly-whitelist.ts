/**
 * The read-only argv whitelist, as DATA.
 *
 * WHY THIS IS A LOADER AND NOT AN IMPORT. The generated whitelist is read by two
 * consumers that must survive the removal of the MCP module (spec §1): the
 * pre-tool interceptor and, later, the MCP server. If either `import`ed the
 * generated artifact it would become a static edge between them, and deleting
 * the MCP module would break the gate. So the artifact stays a `.json` file and
 * every reader goes through the filesystem. `tests/unit/standards/no-mcp-source-import.test.ts`
 * pins that no module may `import` it.
 *
 * The shape is `{ schemaVersion, source, readOnlyDefinition, entries[] }`. Each
 * entry is a full argv template (flags included) plus typed placeholders - the
 * key is the WHOLE argv, never the top-level verb, because each named command
 * family mixes read and write subcommands.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { repoRoot } from 'peaks-loop-shared/paths';

/** Where the generator writes the artifact, relative to the package root. */
export const READONLY_WHITELIST_RELATIVE_PATH = 'contracts/readonly-argv-whitelist.json';

const PlaceholderBindingSchema = z.object({
  /** `option` when the value is the argument of a flag, `positional` otherwise. */
  kind: z.enum(['option', 'positional']),
  /** The flag token (`--role`) or the positional name (`request-id`). */
  token: z.string().min(1),
  required: z.boolean()
});

const PlaceholderSpecSchema = z.object({
  type: z.enum(['slug', 'enum', 'token', 'integer', 'path']),
  pattern: z.string().min(1).optional(),
  values: z.array(z.string().min(1)).min(1).optional(),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
  default: z.number().int().optional(),
  /**
   * Where the placeholder lives and whether the REGISTRY makes it mandatory.
   * A placeholder present in the template is always supplied a value; this
   * field carries the introspected fact, not the template's demand.
   */
  binding: PlaceholderBindingSchema,
  /** `introspected` when the registry supplied the constraint, else `handwritten`. */
  constraintSource: z.enum(['introspected', 'handwritten'])
});

const ArgvSegmentSchema = z.union([
  z.object({ kind: z.literal('literal'), value: z.string().min(1) }),
  z.object({ kind: z.literal('param'), name: z.string().min(1) })
]);

const EntrySchema = z.object({
  id: z.string().min(1),
  tool: z.string().min(1),
  commandPath: z.array(z.string().min(1)).min(1),
  argv: z.array(ArgvSegmentSchema).min(1),
  params: z.record(z.string(), PlaceholderSpecSchema),
  introspection: z.object({
    optionTokens: z.array(z.string().min(1)),
    positionalCount: z.number().int().gte(0)
  })
});

const WhitelistSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.string().min(1),
  readOnlyDefinition: z.string().min(1),
  entries: z.array(EntrySchema).min(1)
});

export type PlaceholderSpec = z.infer<typeof PlaceholderSpecSchema>;
export type ReadOnlyWhitelistEntry = z.infer<typeof EntrySchema>;
export type ReadOnlyWhitelist = z.infer<typeof WhitelistSchema>;

/** Absolute path of the generated artifact for a package root. */
export function resolveReadOnlyWhitelistPath(root: string = repoRoot): string {
  return join(root, READONLY_WHITELIST_RELATIVE_PATH);
}

/** Parse + validate the artifact text. Throws a zod error when the shape drifts. */
export function parseReadOnlyWhitelist(text: string): ReadOnlyWhitelist {
  return WhitelistSchema.parse(JSON.parse(text));
}

/** Read + validate the artifact. The only supported way to obtain it. */
export function loadReadOnlyWhitelist(root: string = repoRoot): ReadOnlyWhitelist {
  return parseReadOnlyWhitelist(readFileSync(resolveReadOnlyWhitelistPath(root), 'utf8'));
}

/** The param names an entry expects, in argv order. */
export function paramNamesOf(entry: ReadOnlyWhitelistEntry): string[] {
  return entry.argv.flatMap((segment) => (segment.kind === 'param' ? [segment.name] : []));
}

/**
 * The tool names the surface declares, in first-appearance order.
 *
 * This is the pre-tool interceptor's view of "what may be called", and it is
 * computed HERE rather than in the MCP module on purpose: the interceptor must
 * keep working when `src/services/mcp/` is deleted (spec §1), so it cannot reach
 * into it for the answer. Grouping the entries by their `tool` field is the whole
 * computation, and both readers do it from the same DATA.
 */
export function toolIdsOf(whitelist: ReadOnlyWhitelist): string[] {
  return [...new Set(whitelist.entries.map((entry) => entry.tool))];
}

/**
 * Match a CONCRETE argv against the entries. A param slot consumes exactly one
 * token, so `--apply` in a param slot still MATCHES here - refusing it is the
 * validator's job (`argv-guard.ts`), not the matcher's. Keeping the two separate
 * is what stops a rejected value from silently re-routing to another entry.
 */
export function matchReadOnlyEntry(
  whitelist: ReadOnlyWhitelist,
  argv: readonly string[]
): ReadOnlyWhitelistEntry | undefined {
  return whitelist.entries.find((entry) => {
    if (entry.argv.length !== argv.length) return false;
    return entry.argv.every((segment, index) =>
      segment.kind === 'literal' ? segment.value === argv[index] : true
    );
  });
}
