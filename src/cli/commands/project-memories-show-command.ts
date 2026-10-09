// src/cli/commands/project-memories-show-command.ts
//
// `peaks project memories:show <name>` — one memory body, compact by default.
// Split out of `project-commands.ts`; the verb name, its options, the stale
// threshold rules (R3/R4) and every envelope key are unchanged.

import type { Command } from 'commander';
import { readProjectMemoryBody } from '../../services/memory/project-memory-service.js';
import {
  applyStalePolicy,
  DEFAULT_STALE_DAYS,
  type StalePolicyResult
} from '../../shared/stale-policy.js';
import { formatMdCompact } from '../../shared/format-md-compact.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';

type ProjectMemoriesShowOptions = {
  project: string;
  pretty?: boolean;
  includeStale?: boolean;
  staleDays?: number;
  json?: boolean;
};

type ProjectMemory = NonNullable<ReturnType<typeof readProjectMemoryBody>>;
type MemoryStalePolicy = StalePolicyResult<{ name: string; updatedAt: string | null }>;

/** R4: the stale decision is computed at CLI load time only; the `.md` is never modified. */
function memoryStalePolicy(
  memory: ProjectMemory,
  thresholdDays: number,
  includeStale: boolean
): MemoryStalePolicy {
  return applyStalePolicy([{ name: memory.name, updatedAt: memory.updatedAt }], {
    thresholdDays,
    includeStale
  });
}

/** `--stale-days <n>` must be a finite positive number; anything else keeps the 30-day default. */
function staleThresholdDays(options: ProjectMemoriesShowOptions): number {
  const days = options.staleDays;
  return days !== undefined && Number.isFinite(days) && days > 0 ? days : DEFAULT_STALE_DAYS;
}

/**
 * The age the `MEMORY_STALE` refusal reports. The first policy call dropped the
 * entry, so it cannot report the age — this second one keeps it (`includeStale`)
 * purely to read `ageDays` back out.
 */
function staleRefusalAgeDays(
  memory: ProjectMemory,
  thresholdDays: number,
  droppedCount: number
): number {
  return droppedCount > 0
    ? (memoryStalePolicy(memory, thresholdDays, true).entries[0]?.ageDays ?? 0)
    : 0;
}

/** The `ok` payload: the default `compact` body unless `--pretty` overrides it. */
function memoriesShowData(
  memory: ProjectMemory,
  entry: MemoryStalePolicy['entries'][number] | undefined,
  options: ProjectMemoriesShowOptions
): Record<string, unknown> {
  const format: 'compact' | 'pretty' = options.pretty === true ? 'pretty' : 'compact';
  const body = format === 'pretty' ? memory.body : formatMdCompact(memory.body);
  return {
    name: memory.name,
    title: memory.title,
    kind: memory.kind,
    sourcePath: memory.filePath,
    updatedAt: memory.updatedAt,
    ageDays: entry?.ageDays ?? 0,
    stale: entry?.stale ?? false,
    body,
    format,
    bodyBytes: Buffer.byteLength(body, 'utf8')
  };
}

function memoryNotFound(name: string, project: string): ReturnType<typeof fail> {
  return fail(
    'project.memories:show',
    'MEMORY_NOT_FOUND',
    `memory ${name} not found in .peaks/memory`,
    { name, projectRoot: project },
    ['Run `peaks project memories --json` to see available names']
  );
}

function staleMemoryRefusal(
  name: string,
  project: string,
  ageDays: number,
  thresholdDays: number
): ReturnType<typeof fail> {
  return fail(
    'project.memories:show',
    'MEMORY_STALE',
    `memory ${name} is stale (age ${ageDays} days > ${thresholdDays} day threshold); pass --include-stale to override`,
    { name, ageDays, thresholdDays },
    ['Pass --include-stale to load stale memories; pass --stale-days <N> to override the threshold']
  );
}

function runProjectMemoriesShow(
  io: ProgramIO,
  name: string,
  options: ProjectMemoriesShowOptions
): void {
  try {
    const memory = readProjectMemoryBody(options.project, name);
    if (memory === null) {
      printResult(io, memoryNotFound(name, options.project), options.json);
      process.exitCode = 1;
      return;
    }

    const thresholdDays = staleThresholdDays(options);
    const policy = memoryStalePolicy(memory, thresholdDays, options.includeStale === true);
    if (policy.entries.length === 0) {
      const ageDays = staleRefusalAgeDays(memory, thresholdDays, policy.droppedCount);
      printResult(
        io,
        staleMemoryRefusal(name, options.project, ageDays, thresholdDays),
        options.json
      );
      process.exitCode = 1;
      return;
    }
    printResult(
      io,
      ok('project.memories:show', memoriesShowData(memory, policy.entries[0], options)),
      options.json
    );
  } catch (error) {
    printResult(
      io,
      fail(
        'project.memories:show',
        'PROJECT_MEMORY_SHOW_FAILED',
        getErrorMessage(error),
        { name, projectRoot: options.project },
        ['Check the project path and .peaks/memory directory']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerProjectMemoriesShowCommand(project: Command, io: ProgramIO): void {
  addJsonOption(
    project
      .command('memories:show <name>')
      .description(
        'Show one project memory body by name. Default format is `compact` (LLM-primary); pass --pretty for the disk verbatim. Stale entries (default ≥30 days) are excluded; pass --include-stale or --stale-days <N> to override.'
      )
      .requiredOption('--project <path>', 'target project root')
      .option('--pretty', 'return the on-disk body verbatim; overrides the compact default')
      .option('--include-stale', 'include stale entries (the default excludes them)')
      .option(
        '--stale-days <n>',
        'override the 30-day stale threshold (must be > 0)',
        (value: string) => Number(value)
      )
  ).action((name: string, options: ProjectMemoriesShowOptions) =>
    runProjectMemoriesShow(io, name, options)
  );
}
