/**
 * v2.15.0 follow-up — G14: smoke regression CLI.
 *
 *   - `peaks smoke define`           — bulk-define critical paths (JSON or --paths)
 *   - `peaks smoke run`             — record a run; for now this is a
 *                                     dry-summary (no real Playwright)
 *   - `peaks smoke run-and-repair`  — same as run, but emit a "needs
 *                                     repair" warning when paths fail
 *   - `peaks smoke add-path`        — add a single critical path
 *                                     (used by `peaks impact must-check`
 *                                     piping or manual registration)
 *
 * The actual Playwright execution is out of scope for this slice.
 * The state model + 4 commands + repair-loop signal are what
 * 2.15.0 follow-up needs.
 */

import type { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { findProjectRoot } from '../../services/config/config-safety.js';
import {
  addCriticalPath,
  CRITICAL_PATH_SOURCES,
  EMPTY_SMOKE_STATE,
  isCriticalPathSource,
  makeCriticalPathId,
  readSmokeState,
  recordRun,
  summarizeState,
  writeSmokeState,
  type CriticalPath,
  type CriticalPathSource,
  type CriticalPathStatus
} from '../../services/smoke/smoke-paths-state.js';
import { fail, ok } from 'peaks-loop-shared/result';

import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';

const RUN_STATUSES: readonly CriticalPathStatus[] = ['pending', 'pass', 'fail'];

export function registerSmokeCommands(program: Command, io: ProgramIO): void {
  const smoke = program
    .command('smoke')
    .description('v2.15.0 follow-up G14: lightweight regression critical-paths management (5-10 min, no full E2E).');

  // 1. define
  addJsonOption(
    smoke
      .command('define')
      .description(
        'Define the project\'s critical paths (the 5-10 paths to verify before shipping). ' +
          'Two modes: (1) --paths <comma-separated names> registers all as source=manual, ' +
          '(2) --from-file <json> imports paths from a JSON file. ' +
          'Persists to `.peaks/smoke-paths.json`.'
      )
      .option('--paths <list>', 'comma-separated path names (registers all as source=manual)')
      .option('--from-file <file>', 'JSON file with [{name, source?, category?}, ...]')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { paths?: string; fromFile?: string; project?: string; json?: boolean }) => {
    if (!opts.paths && !opts.fromFile) {
      printResult(io, fail('smoke.define', 'INVALID_INPUT', 'provide --paths or --from-file', {}, []), opts.json ?? false);
      return;
    }
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const now = new Date();
    let newPaths: CriticalPath[] = [];
    if (opts.paths) {
      const names = opts.paths.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      newPaths = names.map((name) => ({
        id: makeCriticalPathId(name),
        name,
        source: 'manual' as const,
        registeredAt: now.toISOString(),
        status: 'pending' as const,
        history: []
      }));
    } else if (opts.fromFile) {
      try {
        const filePath = resolvePath(opts.fromFile);
        const raw = JSON.parse(readFileSync(filePath, 'utf8')) as Array<{ name: string; source?: string; category?: string }>;
        newPaths = raw.map((item) => {
          const source: CriticalPathSource = item.source && isCriticalPathSource(item.source) ? item.source : 'manual';
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
      } catch (err) {
        printResult(io, fail('smoke.define', 'INVALID_FILE', `failed to load --from-file: ${(err as Error).message}`, { projectRoot }, []), opts.json ?? false);
        return;
      }
    }
    const state = readSmokeState(projectRoot);
    let next = state;
    for (const p of newPaths) next = addCriticalPath(next, p);
    writeSmokeState(projectRoot, next);
    printResult(io, ok('smoke.define', {
      projectRoot,
      registered: newPaths.length,
      total: next.paths.length
    }, [], [
      'Run `peaks smoke run` to record the next regression run.'
    ]), opts.json ?? false);
  });

  // 2. run
  addJsonOption(
    smoke
      .command('run')
      .description(
        'Record a smoke regression run. Without --record, this is a dry summary. ' +
          'With --record and --status-id pairs (id1:pass,id2:fail), it records ' +
          'the run result and persists updated state. ' +
          'Real Playwright integration is out of scope for this slice.'
      )
      .option('--record <pairs>', 'comma-separated id:status pairs (e.g. "login:pass,logout:fail")')
      .option('--notes <text>', 'optional run notes applied to all recorded paths')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { record?: string; notes?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const startMs = Date.now();
    let state = readSmokeState(projectRoot);
    if (opts.record) {
      const pairs = opts.record.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      for (const pair of pairs) {
        const [id, status] = pair.split(':');
        if (!id || !status) {
          printResult(io, fail('smoke.run', 'INVALID_RECORD', `bad pair "${pair}" (expected id:status)`, { projectRoot }, []), opts.json ?? false);
          return;
        }
        if (!RUN_STATUSES.includes(status as CriticalPathStatus)) {
          printResult(io, fail('smoke.run', 'INVALID_STATUS', `bad status "${status}" (expected pending|pass|fail)`, { projectRoot }, []), opts.json ?? false);
          return;
        }
        state = recordRun(state, id.trim(), status as CriticalPathStatus, opts.notes);
      }
      writeSmokeState(projectRoot, state);
    }
    const summary = summarizeState(state);
    const durationMs = Date.now() - startMs;
    printResult(io, ok('smoke.run', {
      projectRoot,
      summary: { ...summary, durationMs }
    }, summary.failedPaths > 0
      ? [`${summary.failedPaths} path(s) failed — consider \`peaks smoke run-and-repair\``]
      : []), opts.json ?? false);
  });

  // 3. run-and-repair
  addJsonOption(
    smoke
      .command('run-and-repair')
      .description(
        'Same as `smoke run --record`, but emits a "needs repair" warning when any path fails. ' +
          'Returns exit code 0 always (the CLI does not block on smoke failure; the user ' +
          'decides whether to enter the repair loop). Real repair execution is the user\'s ' +
          'call (run peaks-rd / re-implement / re-test).'
      )
      .option('--record <pairs>', 'comma-separated id:status pairs (e.g. "login:pass,logout:fail")')
      .option('--notes <text>', 'optional run notes')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: { record?: string; notes?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    let state = readSmokeState(projectRoot);
    if (opts.record) {
      const pairs = opts.record.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
      for (const pair of pairs) {
        const [id, status] = pair.split(':');
        if (!id || !status) continue;
        if (!RUN_STATUSES.includes(status as CriticalPathStatus)) continue;
        state = recordRun(state, id.trim(), status as CriticalPathStatus, opts.notes);
      }
      writeSmokeState(projectRoot, state);
    }
    const summary = summarizeState(state);
    const needsRepair = summary.failedPaths > 0;
    printResult(io, ok('smoke.run-and-repair', {
      projectRoot,
      needsRepair,
      summary
    }, needsRepair
      ? [
          `Repair needed for ${summary.failedPaths} path(s):`,
          ...summary.failedDetails.map((d) => `  - ${d.name}${d.lastRunNote ? ` (note: ${d.lastRunNote})` : ''}`),
          'Re-run the failing paths, or enter peaks-rd repair-loop.'
        ]
      : ['All paths pass.']), opts.json ?? false);
  });

  // 4. add-path
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
  ).action((opts: { name: string; source?: string; category?: string; project?: string; json?: boolean }) => {
    const projectRoot = opts.project ?? findProjectRoot(process.cwd()) ?? process.cwd();
    const source: CriticalPathSource = opts.source && isCriticalPathSource(opts.source) ? opts.source : 'manual';
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
    printResult(io, ok('smoke.add-path', {
      projectRoot,
      added: { id, name: opts.name, source },
      total: next.paths.length
    }, [], [
      `Run \`peaks smoke run --record ${id}:pass\` after verifying this path.`
    ]), opts.json ?? false);
  });
}

// Expose the empty state symbol so other modules (e.g. impact-commands)
// can pipe must-check items into smoke state without circular imports.
export { EMPTY_SMOKE_STATE };
