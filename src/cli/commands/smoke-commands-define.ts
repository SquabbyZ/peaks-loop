/**
 * `peaks smoke define` — bulk-register critical paths from a list or a JSON file.
 *
 * Extracted VERBATIM from `smoke-commands.ts` (job strict-remediation-abc,
 * slice c1-eslint-family-sweep, leaf c4w1-cli-b) so the registration file
 * clears the 300-line cap and the `max-lines-per-function` / `complexity`
 * findings that sat on the commander action arrow fell with it. The description
 * text, option surface, predicate order (INVALID_INPUT first, then paths-list
 * branch, then from-file branch with its try/catch → INVALID_FILE), the
 * `{ projectRoot, registered, total }` ok-payload and the hint line
 * `Run \`peaks smoke run\` to record the next regression run.` are the code that
 * was already there. Nothing here swallows anything; the try/catch still owns
 * only the read+JSON.parse of the from-file branch and still returns from the
 * caller's action with the INVALID_FILE envelope.
 */
import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { fail, ok } from 'peaks-loop-shared/result';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  addCriticalPath,
  isCriticalPathSource,
  makeCriticalPathId,
  readSmokeState,
  writeSmokeState,
  type CriticalPath,
  type CriticalPathSource
} from '../../services/smoke/smoke-paths-state.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

type SmokeDefineOptions = {
  paths?: string;
  fromFile?: string;
  project?: string;
  json?: boolean;
};

export function registerSmokeDefine(smoke: Command, io: ProgramIO): void {
  addJsonOption(
    smoke
      .command('define')
      .description(
        "Define the project's critical paths (the 5-10 paths to verify before shipping). " +
          'Two modes: (1) --paths <comma-separated names> registers all as source=manual, ' +
          '(2) --from-file <json> imports paths from a JSON file. ' +
          'Persists to `.peaks/smoke-paths.json`.'
      )
      .option('--paths <list>', 'comma-separated path names (registers all as source=manual)')
      .option('--from-file <file>', 'JSON file with [{name, source?, category?}, ...]')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: SmokeDefineOptions) => {
    runSmokeDefineAction(io, opts);
  });
}

function resolveProjectRoot(project: string | undefined): string {
  return project ?? findProjectRoot(process.cwd()) ?? process.cwd();
}

function buildPathsFromList(raw: string, now: Date): CriticalPath[] {
  const names = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return names.map((name) => ({
    id: makeCriticalPathId(name),
    name,
    source: 'manual' as const,
    registeredAt: now.toISOString(),
    status: 'pending' as const,
    history: []
  }));
}

function buildPathsFromFile(fromFile: string, now: Date): CriticalPath[] {
  const filePath = resolvePath(fromFile);
  const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Array<{
    name: string;
    source?: string;
    category?: string;
  }>;
  return raw.map((item) => {
    const source: CriticalPathSource =
      item.source && isCriticalPathSource(item.source) ? item.source : 'manual';
    return {
      id: makeCriticalPathId(item.name),
      name: item.name,
      source,
      registeredAt: now.toISOString(),
      ...(item.category !== undefined ? { category: item.category } : {}),
      status: 'pending' as const,
      history: []
    };
  });
}

function printInvalidInput(io: ProgramIO, json: boolean): void {
  printResult(
    io,
    fail('smoke.define', 'INVALID_INPUT', 'provide --paths or --from-file', {}, []),
    json
  );
}

function printInvalidFile(io: ProgramIO, json: boolean, projectRoot: string, err: unknown): void {
  printResult(
    io,
    fail(
      'smoke.define',
      'INVALID_FILE',
      `failed to load --from-file: ${(err as Error).message}`,
      { projectRoot },
      []
    ),
    json
  );
}

function printDefined(
  io: ProgramIO,
  json: boolean,
  payload: { projectRoot: string; registered: number; total: number }
): void {
  printResult(
    io,
    ok(
      'smoke.define',
      {
        projectRoot: payload.projectRoot,
        registered: payload.registered,
        total: payload.total
      },
      [],
      ['Run `peaks smoke run` to record the next regression run.']
    ),
    json
  );
}

function runSmokeDefineAction(io: ProgramIO, opts: SmokeDefineOptions): void {
  const json = opts.json ?? false;
  if (!opts.paths && !opts.fromFile) {
    printInvalidInput(io, json);
    return;
  }
  const projectRoot = resolveProjectRoot(opts.project);
  const now = new Date();
  let newPaths: CriticalPath[] = [];
  if (opts.paths) {
    newPaths = buildPathsFromList(opts.paths, now);
  } else if (opts.fromFile) {
    try {
      newPaths = buildPathsFromFile(opts.fromFile, now);
    } catch (err) {
      printInvalidFile(io, json, projectRoot, err);
      return;
    }
  }
  const state = readSmokeState(projectRoot);
  let next = state;
  for (const p of newPaths) next = addCriticalPath(next, p);
  writeSmokeState(projectRoot, next);
  printDefined(io, json, {
    projectRoot,
    registered: newPaths.length,
    total: next.paths.length
  });
}
