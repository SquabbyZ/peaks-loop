/**
 * The schema introspector (spec §3 row 2): turns the hand-authored surface
 * declaration into the generated whitelist artifact by READING the live Commander
 * registry - never by restating it.
 *
 * Everything the registry can answer is taken from it:
 *   - does the command path exist,
 *   - does each `--flag` in the template exist on that command,
 *   - is that flag mandatory, and does it take a value,
 *   - which positionals does the command declare, and are they required.
 * A template that disagrees with the registry is a BUILD FAILURE, not a warning:
 * that is the whole point of generating the artifact instead of typing it.
 *
 * What the registry CANNOT answer is the constraint on a placeholder's value
 * (`^[a-z0-9-]+$` for a request id). Those constraints come from the surface file
 * and are marked `constraintSource: 'handwritten'`, so the one place drift can
 * enter is visible in the artifact. When a command later declares `.choices()`,
 * the same field flips to `introspected` with no artifact edit.
 *
 * DETERMINISM (AC-2): no timestamps, no `Date`, no unordered iteration. Record
 * keys follow argv order and entries follow the surface file's order, so two
 * consecutive runs are byte-identical.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Command, Option } from 'commander';
import { z } from 'zod';

import { repoRoot } from 'peaks-loop-shared/paths';

import {
  READONLY_WHITELIST_RELATIVE_PATH,
  type PlaceholderSpec,
  type ReadOnlyWhitelist,
  type ReadOnlyWhitelistEntry
} from './readonly-whitelist.js';

/** The hand-authored input, relative to the package root. */
export const READONLY_SURFACE_RELATIVE_PATH = 'contracts/readonly-surface.json';

/** The schema version of the artifact this module emits. */
export const READONLY_WHITELIST_SCHEMA_VERSION = 1;

const SurfaceParamSchema = z.object({
  type: z.enum(['slug', 'enum', 'token', 'integer', 'path']),
  pattern: z.string().min(1).optional(),
  values: z.array(z.string().min(1)).min(1).optional(),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
  default: z.number().int().optional()
});

const SurfaceEntrySchema = z.object({
  id: z.string().min(1),
  commandPath: z.array(z.string().min(1)).min(1),
  argv: z.array(z.string().min(1)).min(1),
  params: z.record(z.string(), SurfaceParamSchema)
});

export const ReadOnlySurfaceSchema = z.object({
  schemaVersion: z.literal(1),
  readOnlyDefinition: z.string().min(1),
  note: z.array(z.string()).default([]),
  tools: z.array(z.object({ tool: z.string().min(1), entries: z.array(SurfaceEntrySchema).min(1) }))
});

export type ReadOnlySurface = z.infer<typeof ReadOnlySurfaceSchema>;
export type ReadOnlySurfaceEntry = z.infer<typeof SurfaceEntrySchema>;
type SurfaceParam = z.infer<typeof SurfaceParamSchema>;

/** `<name>` marks a placeholder token in a surface `argv` element. */
const PLACEHOLDER_TOKEN = /^<([a-z][a-z0-9-]*)>$/;

class SurfaceDriftError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SurfaceDriftError';
  }
}

function resolveCommand(program: Command, path: readonly string[]): Command {
  let current: Command | undefined = program;
  for (const name of path) {
    current = current.commands.find((candidate) => candidate.name() === name);
    if (current === undefined) {
      throw new SurfaceDriftError(`No command registered at path: ${path.join(' ')}`);
    }
  }
  return current;
}

function hasOption(command: Command, token: string): boolean {
  return command.options.some((option) => option.long === token || option.short === token);
}

function optionTakingValue(command: Command, token: string): Option | undefined {
  return command.options.find((option) => {
    if (option.long !== token && option.short !== token) return false;
    return /[<[].+[>\]]/.test(option.flags);
  });
}

/** Placeholders the registry supplies a constraint for are marked as such. */
function constraintSourceOf(
  declared: SurfaceParam,
  option: Option | undefined
): 'introspected' | 'handwritten' {
  if (declared.type === 'enum' && option?.argChoices !== undefined) return 'introspected';
  if (option?.defaultValue !== undefined && declared.default !== undefined) return 'introspected';
  return 'handwritten';
}

/** The constraint fields the surface declares, copied without inventing absent ones. */
function constraintsOf(
  declared: SurfaceParam
): Omit<PlaceholderSpec, 'binding' | 'constraintSource'> {
  return {
    type: declared.type,
    ...(declared.pattern === undefined ? {} : { pattern: declared.pattern }),
    ...(declared.values === undefined ? {} : { values: declared.values }),
    ...(declared.min === undefined ? {} : { min: declared.min }),
    ...(declared.max === undefined ? {} : { max: declared.max }),
    ...(declared.default === undefined ? {} : { default: declared.default })
  };
}

/** One entry's positional cursor: which registered argument the next slot takes. */
interface Cursor {
  positionalIndex: number;
  readonly positionalNames: string[];
}

/** Everything one placeholder slot needs to be bound. */
interface PlaceholderSlot {
  readonly entryId: string;
  readonly name: string;
  readonly declared: SurfaceParam | undefined;
  readonly command: Command;
  readonly previousToken: string | undefined;
  readonly cursor: Cursor;
}

/**
 * Bind one placeholder either to the value-taking flag before it or to the next
 * positional the command declares. Membership in the template is what makes a
 * value required; `binding.required` carries the REGISTRY's opinion, which is a
 * different fact (`--limit` is not mandatory, yet the template pins it).
 */
function bindPlaceholder(slot: PlaceholderSlot): PlaceholderSpec {
  const { entryId, name, declared, command, previousToken, cursor } = slot;
  if (declared === undefined) {
    throw new SurfaceDriftError(`Entry ${entryId}: placeholder <${name}> has no params spec`);
  }
  const boundOption =
    previousToken === undefined ? undefined : optionTakingValue(command, previousToken);
  if (boundOption !== undefined && previousToken !== undefined) {
    return {
      ...constraintsOf(declared),
      binding: { kind: 'option', token: previousToken, required: boundOption.mandatory },
      constraintSource: constraintSourceOf(declared, boundOption)
    };
  }
  const registered = command.registeredArguments[cursor.positionalIndex];
  if (registered === undefined) {
    throw new SurfaceDriftError(
      `Entry ${entryId}: <${name}> is positional ${cursor.positionalIndex + 1} but the command declares ${command.registeredArguments.length}`
    );
  }
  cursor.positionalIndex += 1;
  cursor.positionalNames.push(registered.name());
  return {
    ...constraintsOf(declared),
    binding: { kind: 'positional', token: registered.name(), required: registered.required },
    constraintSource: 'handwritten'
  };
}

/** The non-flag words a template opens with, which must be the command path. */
function leadingLiteralsOf(argv: ReadOnlyWhitelistEntry['argv']): string[] {
  return argv.flatMap((segment) =>
    segment.kind === 'literal' && !segment.value.startsWith('-') ? [segment.value] : []
  );
}

function assertTemplateDrivesCommand(
  surface: ReadOnlySurfaceEntry,
  command: Command,
  argv: ReadOnlyWhitelistEntry['argv'],
  cursor: Cursor
): void {
  const leading = leadingLiteralsOf(argv);
  if (leading.join('\u0000') !== surface.commandPath.join('\u0000')) {
    throw new SurfaceDriftError(
      `Entry ${surface.id}: argv opens with [${leading.join(', ')}] but commandPath is [${surface.commandPath.join(', ')}]`
    );
  }
  if (cursor.positionalIndex !== command.registeredArguments.length) {
    throw new SurfaceDriftError(
      `Entry ${surface.id}: template fills ${cursor.positionalIndex} positional(s); ${surface.commandPath.join(' ')} declares ${command.registeredArguments.length}`
    );
  }
}

function buildEntry(program: Command, tool: string, surface: ReadOnlySurfaceEntry) {
  const command = resolveCommand(program, surface.commandPath);
  const optionTokens: string[] = [];
  const argv: ReadOnlyWhitelistEntry['argv'] = [];
  const params: ReadOnlyWhitelistEntry['params'] = {};
  const cursor: Cursor = { positionalIndex: 0, positionalNames: [] };

  for (let index = 0; index < surface.argv.length; index += 1) {
    const token = surface.argv[index];
    if (token === undefined) continue;
    const placeholder = PLACEHOLDER_TOKEN.exec(token);
    const name = placeholder?.[1];
    if (placeholder !== null && name !== undefined) {
      params[name] = bindPlaceholder({
        entryId: surface.id,
        name,
        declared: surface.params[name],
        command,
        previousToken: index > 0 ? surface.argv[index - 1] : undefined,
        cursor
      });
      argv.push({ kind: 'param', name });
      continue;
    }
    if (token.startsWith('-')) {
      if (!hasOption(command, token)) {
        throw new SurfaceDriftError(
          `Entry ${surface.id}: no such option ${token} on ${surface.commandPath.join(' ')}`
        );
      }
      optionTokens.push(token);
    }
    argv.push({ kind: 'literal', value: token });
  }

  assertTemplateDrivesCommand(surface, command, argv, cursor);
  return {
    id: surface.id,
    tool,
    commandPath: [...surface.commandPath],
    argv,
    params,
    introspection: { optionTokens, positionalCount: cursor.positionalNames.length }
  };
}

/** Build the artifact object from a surface declaration and a live program. */
export function generateReadOnlyWhitelist(
  surface: ReadOnlySurface,
  program: Command
): ReadOnlyWhitelist {
  const entries = surface.tools.flatMap((group) =>
    group.entries.map((entry) => buildEntry(program, group.tool, entry))
  );
  const ids = new Set(entries.map((entry) => entry.id));
  if (ids.size !== entries.length) {
    throw new SurfaceDriftError('Entry ids must be unique across the whole surface');
  }
  return {
    schemaVersion: READONLY_WHITELIST_SCHEMA_VERSION,
    source: READONLY_SURFACE_RELATIVE_PATH,
    readOnlyDefinition: surface.readOnlyDefinition,
    entries
  };
}

/** Byte-stable serialization: two runs over the same input MUST match. */
export function serializeReadOnlyWhitelist(whitelist: ReadOnlyWhitelist): string {
  return `${JSON.stringify(whitelist, null, 2)}\n`;
}

/** Read + validate the hand-authored surface declaration. */
export function loadReadOnlySurface(root: string = repoRoot): ReadOnlySurface {
  const text = readFileSync(join(root, READONLY_SURFACE_RELATIVE_PATH), 'utf8');
  return ReadOnlySurfaceSchema.parse(JSON.parse(text));
}

/** Absolute path of the generated artifact. */
export function readonlyWhitelistPath(root: string = repoRoot): string {
  return join(root, READONLY_WHITELIST_RELATIVE_PATH);
}
