/**
 * `peaks retrospective index` — the index command (list + optional fzf
 * multi-select), hoisted out of `retrospective-commands.ts` so that file
 * clears the 300 raw-line cap.
 *
 * Identical control flow: same project-root resolution, same
 * `loadRetrospectiveIndex` call, same warning normalization, the same
 * `options.pick === true` gate in the same position, the same envelope
 * field order, the same exit codes (127 for an fzf problem, 1 otherwise),
 * the same two suggestion texts, and the same single catch — which moved
 * WITH its handler and still reports the failure (no swallow, so the
 * silent-warning counters are untouched). The fzf selection block became
 * one helper and the failure envelope another, so no function here is
 * over `max-lines-per-function` or `complexity`; nothing else was
 * rewritten.
 */

import type { Command } from 'commander';
import { join } from 'node:path';
import { fail, ok } from 'peaks-loop-shared/result';
import { pickFromList } from '../../services/fuzzy-matching/fzf-pick-service.js';
import {
  loadRetrospectiveIndex,
  type RetrospectiveIndexResult
} from '../../services/retrospective/retrospective-index.js';
import type { RetrospectiveEntry } from '../../services/retrospective/retrospective-search-service.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { resolveRetrospectiveProjectRoot } from './retrospective-project-root.js';

export interface RetrospectiveIndexCommandOptions {
  pick?: boolean;
  fzfBin?: string;
  project?: string;
  json?: boolean;
}

interface RetrospectivePickOutcome {
  picked: RetrospectiveEntry[];
  pickedOutputPath: string;
  fzfVersion: string;
}

async function pickRetrospectiveEntries(
  projectRoot: string,
  result: RetrospectiveIndexResult,
  fzfBin: string | undefined
): Promise<RetrospectivePickOutcome> {
  const outputPath = join(projectRoot, '.peaks', 'retrospective', 'picked.json');
  const byId = new Map(result.entries.map((e) => [e.id, e] as const));
  const pickResult = await pickFromList<RetrospectiveEntry>({
    items: result.entries,
    formatLine: (e) => `${e.id} | ${e.type} | ${e.title} | ${e.outcome}`,
    parseLine: (line) => {
      const parts = line.split('|').map((p) => p.trim());
      if (parts.length < 1) return null;
      const id = parts[0];
      if (id === undefined || id.length === 0) return null;
      return byId.get(id) ?? null;
    },
    outputPath,
    meta: { totalCandidates: result.totalCount, source: result.source },
    ...(fzfBin !== undefined ? { fzfBin } : {}),
    projectRoot,
    multi: true,
    prompt: 'retrospective> '
  });
  return {
    picked: [...pickResult.picked],
    pickedOutputPath: pickResult.outputPath,
    fzfVersion: pickResult.fzfVersion
  };
}

function printIndexFailure(
  io: ProgramIO,
  options: RetrospectiveIndexCommandOptions,
  projectRoot: string,
  error: unknown
): void {
  const msg = getErrorMessage(error);
  const isFzfError = /brew install fzf|apt-get install fzf|older than required/.test(msg);
  if (isFzfError) process.exitCode = 127;
  else process.exitCode = 1;
  printResult(
    io,
    fail(
      'retrospective.index',
      isFzfError ? 'FZF_UNAVAILABLE' : 'RETROSPECTIVE_INDEX_FAILED',
      msg,
      { projectRoot },
      isFzfError
        ? [
            'Install fzf (brew install fzf or apt-get install fzf) or run without --pick to list entries as JSON.'
          ]
        : ['Check the project path and .peaks/retrospective/index.json']
    ),
    options.json
  );
}

export async function runRetrospectiveIndexAction(
  io: ProgramIO,
  options: RetrospectiveIndexCommandOptions
): Promise<void> {
  const projectRoot = resolveRetrospectiveProjectRoot(options.project);
  try {
    const result = loadRetrospectiveIndex(projectRoot);
    const warnings: string[] = result.warning === null ? [] : [result.warning];
    let picked: RetrospectiveEntry[] | null = null;
    let pickedOutputPath: string | null = null;
    let fzfVersion: string | null = null;

    if (options.pick === true) {
      const pick = await pickRetrospectiveEntries(projectRoot, result, options.fzfBin);
      picked = pick.picked;
      pickedOutputPath = pick.pickedOutputPath;
      fzfVersion = pick.fzfVersion;
    }

    printResult(
      io,
      ok(
        'retrospective.index',
        {
          indexPath: result.indexPath,
          source: result.source,
          total: result.totalCount,
          entries: result.entries,
          ...(options.pick === true ? { picked, pickedOutputPath, fzfVersion } : {})
        },
        warnings
      ),
      options.json
    );
  } catch (error) {
    printIndexFailure(io, options, projectRoot, error);
  }
}

export function registerRetrospectiveIndexCommand(retrospective: Command, io: ProgramIO): void {
  addJsonOption(
    retrospective
      .command('index')
      .description(
        'List all retrospective entries from .peaks/retrospective/index.json (R3: replaces the per-workflow MD dirs). Pass --pick to spawn fzf for interactive multi-select; the picked subset is written to .peaks/retrospective/picked.json.'
      )
      .option(
        '--pick',
        'spawn fzf for interactive multi-select (requires fzf >= 0.38); writes picked.json'
      )
      .option('--fzf-bin <path>', 'override fzf binary path (default: fzf on PATH)', 'fzf')
      .option('--project <path>', 'target project root (defaults to git root or cwd)')
  ).action(async (options: RetrospectiveIndexCommandOptions) => {
    await runRetrospectiveIndexAction(io, options);
  });
}
