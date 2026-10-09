// src/cli/commands/asset-dispose-command.ts
//
// `peaks asset dispose` — trace-only / retain / destroy. Split out of
// `asset-commands.ts`; the verb name, its options, the envelope shape and
// every error code are unchanged.

import type { Command } from 'commander';
import type { CrystallizationService } from '../../services/crystallization/index.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  DISPOSE_MODES,
  createCrystallizationService,
  openAssetDb,
  resolveAssetProjectRoot,
  type DisposeMode
} from './asset-command-shared.js';

type DisposeOptions = {
  crystallizationEvent: string;
  mode: string;
  project?: string;
  json?: boolean;
};

/** A stored crystallization event, as the service returns it. */
type EventRecord = NonNullable<ReturnType<CrystallizationService['read']>>;
type UpdatedRecord = ReturnType<CrystallizationService['updateStatus']>;
type StateDb = ReturnType<typeof openAssetDb>;

function printInvalidDisposeMode(io: ProgramIO, options: DisposeOptions): void {
  printResult(
    io,
    fail(
      'asset.dispose',
      'ASSET_INVALID_MODE',
      `--mode must be one of: ${DISPOSE_MODES.join('|')}`,
      { mode: options.mode },
      ['Pass --mode trace_only / retain / destroy.']
    ),
    options.json
  );
  process.exitCode = 1;
}

function printDisposeEventNotFound(io: ProgramIO, options: DisposeOptions): void {
  printResult(
    io,
    fail(
      'asset.dispose',
      'ASSET_EVENT_NOT_FOUND',
      `crystallization event '${options.crystallizationEvent}' not found`,
      { eventId: options.crystallizationEvent },
      ['Verify the event id.']
    ),
    options.json
  );
  process.exitCode = 1;
}

/** `retain` → no DB change; the user wants to keep the event as evidence. */
function printDisposeRetained(
  io: ProgramIO,
  existing: EventRecord,
  mode: DisposeMode,
  json: boolean | undefined
): void {
  printResult(
    io,
    ok(
      'asset.dispose',
      {
        crystallization_event_id: existing.id,
        mode,
        lifecycle_status: existing.lifecycle_status,
        note: 'no DB change; event retained as-is'
      },
      [],
      ['Run `peaks asset status --loop <id>` to inspect the lifecycle state of the linked assets.']
    ),
    json
  );
}

/**
 * `destroy` → retire the created/updated loop_release rows as well. We do NOT
 * delete rows — retirement is a status flip (spec §5.6).
 */
function retireLinkedLoops(db: StateDb, updated: NonNullable<UpdatedRecord>): void {
  const retireLoop = db.prepare(
    "UPDATE loop_release SET lifecycle_status = 'retired' WHERE id IN (?, ?)"
  );
  const ids = [
    updated.created_loop_release_id ?? null,
    updated.updated_loop_release_id ?? null
  ].filter((x): x is string => x !== null);
  for (const id of ids) {
    retireLoop.run(id, id);
  }
}

function printDisposeResult(
  io: ProgramIO,
  outcome: { existing: EventRecord; mode: DisposeMode; updated: UpdatedRecord | null },
  json: boolean | undefined
): void {
  printResult(
    io,
    ok(
      'asset.dispose',
      {
        crystallization_event_id: outcome.existing.id,
        mode: outcome.mode,
        lifecycle_status: outcome.updated?.lifecycle_status ?? 'retired',
        retired_assets:
          outcome.mode === 'destroy' ? 'loop_release retired (no rows deleted)' : 'none',
        nextActions: ['Run `peaks asset status` to confirm the lifecycle transition.']
      },
      [],
      []
    ),
    json
  );
}

function printDisposeFailure(io: ProgramIO, err: unknown, options: DisposeOptions): void {
  printResult(
    io,
    fail(
      'asset.dispose',
      'ASSET_DISPOSE_FAILED',
      getErrorMessage(err),
      { eventId: options.crystallizationEvent },
      ['Verify the event id and --mode flag.']
    ),
    options.json
  );
  process.exitCode = 1;
}

async function runAssetDispose(io: ProgramIO, options: DisposeOptions): Promise<void> {
  try {
    if (!(DISPOSE_MODES as readonly string[]).includes(options.mode)) {
      printInvalidDisposeMode(io, options);
      return;
    }
    const mode = options.mode as DisposeMode;
    const db = openAssetDb(resolveAssetProjectRoot(options.project));
    try {
      const svc = createCrystallizationService(db);
      const existing = svc.read(options.crystallizationEvent);
      if (!existing) {
        printDisposeEventNotFound(io, options);
        return;
      }
      // trace_only → retire the event row; the source traces are
      // untouched (workflow traces are immutable per spec §4.3).
      // retain → no DB change; the user wants to keep the event
      // as historical evidence.
      // destroy → retire the event + retire the created/updated
      // assets (no asset delete; retirement only).
      if (mode === 'retain') {
        printDisposeRetained(io, existing, mode, options.json);
        return;
      }
      const updated = svc.updateStatus(existing.id, 'retired');
      if (mode === 'destroy' && updated) {
        retireLinkedLoops(db, updated);
      }
      printDisposeResult(io, { existing, mode, updated }, options.json);
    } finally {
      db.close();
    }
  } catch (err) {
    printDisposeFailure(io, err, options);
  }
}

export function registerAssetDisposeCommand(asset: Command, io: ProgramIO): void {
  addJsonOption(
    asset
      .command('dispose')
      .description(
        'M5: dispose a crystallization event. mode=trace_only retires the event but keeps the trace; mode=retain keeps both; mode=destroy retires the event and marks the created/updated assets retired.'
      )
      .requiredOption(
        '--crystallization-event <id>',
        'the crystallization event id (returned by `peaks asset crystallize`)'
      )
      .requiredOption(
        '--mode <mode>',
        `dispose mode (one of: ${DISPOSE_MODES.join('|')}; default: trace_only)`,
        'trace_only'
      )
      .option('--project <path>', 'project root (default: cwd)')
  ).action((options: DisposeOptions) => runAssetDispose(io, options));
}
