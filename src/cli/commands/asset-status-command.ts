// src/cli/commands/asset-status-command.ts
//
// `peaks asset status` — loop + bee lifecycle state plus the crystallization
// events that reference them. Split out of `asset-commands.ts`; the verb name,
// its options and the envelope shape are unchanged.

import type { Command } from 'commander';
import type { CrystallizationService } from '../../services/crystallization/index.js';
import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import {
  createCrystallizationService,
  openAssetDb,
  resolveAssetProjectRoot
} from './asset-command-shared.js';

type StatusOptions = {
  loop?: string;
  bee?: string;
  project?: string;
  json?: boolean;
};

type EventRecord = ReturnType<CrystallizationService['read']>;
type StateDb = ReturnType<typeof openAssetDb>;

/** The events a `--loop` filter selects, deduplicated by id; all of them otherwise. */
function collectEvents(svc: CrystallizationService, loop: string | undefined): EventRecord[] {
  if (!loop) {
    return svc.list();
  }
  const events = [
    ...svc.list({ created_loop_release_id: loop }),
    ...svc.list({ updated_loop_release_id: loop })
  ];
  // Deduplicate by id.
  const seen = new Set<string>();
  return events.filter((e) => {
    const key = e?.id ?? '';
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Companion query: loop lifecycle counts. We compute from the DB so the CLI is
 * the single source of truth.
 */
function collectLoopCounts(db: StateDb): Record<string, number> {
  const rows = db
    .prepare('SELECT lifecycle_status, COUNT(*) AS n FROM loop_release GROUP BY lifecycle_status')
    .all() as Array<{ lifecycle_status: string; n: number }>;
  return rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.lifecycle_status] = r.n;
    return acc;
  }, {});
}

/** Companion query: bee lifecycle counts, narrowed by `--bee` when given. */
function collectBeeCounts(
  db: StateDb,
  bee: string | undefined
): Array<{ bee_name: string; n: number }> {
  const rows = db
    .prepare(
      'SELECT bee_name, COUNT(*) AS n FROM bee_release GROUP BY bee_name ORDER BY bee_name ASC'
    )
    .all() as Array<{ bee_name: string; n: number }>;
  return rows.filter((r) => bee === undefined || r.bee_name === bee);
}

function statusData(
  options: StatusOptions,
  events: EventRecord[],
  loopCounts: Record<string, number>,
  beeCounts: Array<{ bee_name: string; n: number }>
): Record<string, unknown> {
  return {
    filters: {
      ...(options.loop !== undefined ? { loop: options.loop } : {}),
      ...(options.bee !== undefined ? { bee: options.bee } : {})
    },
    crystallization_events: events.length,
    events: events.map((e) => ({
      id: e?.id,
      trigger: e?.trigger,
      lifecycle_status: e?.lifecycle_status,
      created_loop_release_id: e?.created_loop_release_id,
      created_bee_release_id: e?.created_bee_release_id,
      updated_loop_release_id: e?.updated_loop_release_id,
      updated_bee_release_id: e?.updated_bee_release_id,
      created_at: e?.created_at
    })),
    loop_release_counts_by_lifecycle: loopCounts,
    bee_release_counts_by_name: beeCounts,
    nextActions: [
      options.loop
        ? `Run \`peaks loop show --loop ${options.loop}\` for the loop detail view.`
        : "Pass --loop <id> to drill into a specific loop's crystallization history."
    ]
  };
}

async function runAssetStatus(io: ProgramIO, options: StatusOptions): Promise<void> {
  try {
    const db = openAssetDb(resolveAssetProjectRoot(options.project));
    try {
      const svc = createCrystallizationService(db);
      const events = collectEvents(svc, options.loop);
      const loopCounts = collectLoopCounts(db);
      const beeCounts = collectBeeCounts(db, options.bee);
      printResult(
        io,
        ok('asset.status', statusData(options, events, loopCounts, beeCounts), [], []),
        options.json
      );
    } finally {
      db.close();
    }
  } catch (err) {
    printResult(
      io,
      fail(
        'asset.status',
        'ASSET_STATUS_FAILED',
        getErrorMessage(err),
        { loop: options.loop, bee: options.bee },
        ['Verify the loop / bee identifiers.']
      ),
      options.json
    );
    process.exitCode = 1;
  }
}

export function registerAssetStatusCommand(asset: Command, io: ProgramIO): void {
  addJsonOption(
    asset
      .command('status')
      .description(
        'M5: list loop + bee lifecycle state. With --loop, returns the loop + all linked bee_releases + all crystallization events referencing them.'
      )
      .option('--loop <id>', 'filter by loop_release id')
      .option('--bee <name>', 'filter by bee_name')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((options: StatusOptions) => runAssetStatus(io, options));
}
