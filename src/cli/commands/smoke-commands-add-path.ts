/**
 * `peaks smoke add-path` — register a single critical path.
 *
 * Extracted VERBATIM from `smoke-commands.ts` (job strict-remediation-abc,
 * slice c1-eslint-family-sweep, leaf c4w1-cli-b). The source-normalisation
 * (`opts.source && isCriticalPathSource(...)` → 'manual'), the optional
 * `category` field spread, the `readSmokeState → addCriticalPath →
 * writeSmokeState` sequence and the added-payload shape
 * (`{ id, name, source }`) with the follow-up hint line are the code that was
 * already there. Nothing here swallows anything.
 */
import type { Command } from 'commander';

import { ok } from 'peaks-loop-shared/result';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  addCriticalPath,
  CRITICAL_PATH_SOURCES,
  isCriticalPathSource,
  makeCriticalPathId,
  readSmokeState,
  writeSmokeState,
  type CriticalPath,
  type CriticalPathSource
} from '../../services/smoke/smoke-paths-state.js';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

type SmokeAddPathOptions = {
  name: string;
  source?: string;
  category?: string;
  project?: string;
  json?: boolean;
};

export function registerSmokeAddPath(smoke: Command, io: ProgramIO): void {
  addJsonOption(
    smoke
      .command('add-path')
      .description(
        'Add a single critical path. Typically used by `peaks impact must-check` piping, ' +
          'or by manual registration after a hotfix. The --source flag identifies where the ' +
          'path came from (default: manual).'
      )
      .requiredOption('--name <text>', 'path name (also used to derive the id)')
      .option('--source <name>', `path source (${CRITICAL_PATH_SOURCES.join(' | ')})`, 'manual')
      .option('--category <text>', 'optional category tag')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: SmokeAddPathOptions) => {
    runSmokeAddPathAction(io, opts);
  });
}

function runSmokeAddPathAction(io: ProgramIO, opts: SmokeAddPathOptions): void {
  const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
  const source: CriticalPathSource =
    opts.source && isCriticalPathSource(opts.source) ? opts.source : 'manual';
  const id = makeCriticalPathId(opts.name);
  const path: CriticalPath = {
    id,
    name: opts.name,
    source,
    registeredAt: new Date().toISOString(),
    ...(opts.category !== undefined ? { category: opts.category } : {}),
    status: 'pending',
    history: []
  };
  const state = readSmokeState(projectRoot);
  const next = addCriticalPath(state, path);
  writeSmokeState(projectRoot, next);
  printResult(
    io,
    ok(
      'smoke.add-path',
      {
        projectRoot,
        added: { id, name: opts.name, source },
        total: next.paths.length
      },
      [],
      [`Run \`peaks smoke run --record ${id}:pass\` after verifying this path.`]
    ),
    opts.json ?? false
  );
}
