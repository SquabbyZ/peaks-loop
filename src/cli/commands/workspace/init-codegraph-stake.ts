// Split out of `workspace/init-command.ts`: the
// best-effort `codegraph init` stake that runs after a successful workspace
// init. Never fails the init — every failure lands in the envelope's warnings.
import { mkdirSync } from 'node:fs';
import {
  createCodegraphInvocation,
  defaultCodegraphInitGuard,
  executeCodegraphInvocation,
  writeCodegraphMarker
} from '../../../services/codegraph/codegraph-service.js';
import { getErrorMessage } from '../../cli-helpers.js';
import type { CodegraphAutoStakeOutcome } from './init-options.js';

/**
 * Upstream `codegraph init` creates `.codegraph/`; mkdir is a no-op in the real
 * path and lets the marker write succeed. Best-effort.
 */
async function stakeFreshCodegraph(
  nextActions: string[],
  warnings: string[],
  projectRoot: string,
  codegraphDir: string
): Promise<CodegraphAutoStakeOutcome | null> {
  const initResult = await executeCodegraphInvocation(
    createCodegraphInvocation({ subcommand: 'init', project: projectRoot })
  );
  if (initResult.exitCode !== 0) {
    warnings.push(
      `codegraph auto-stake init failed (exit ${String(initResult.exitCode)}). ` +
        'Run `peaks codegraph init --project <path>` manually to enable codegraph.'
    );
    return null;
  }
  mkdirSync(codegraphDir, { recursive: true });
  writeCodegraphMarker(codegraphDir);
  nextActions.push(
    `Auto-staked a peaks-loop-managed ${codegraphDir}/ (upstream init + marker). ` +
      'Run `peaks codegraph index --project <path>` next to build the SQLite-backed index.'
  );
  return { status: 'fresh' };
}

/**
 * Run a REAL upstream `codegraph init` (not just mkdir + marker) so the schema
 * actually has a `codegraph.db`, which is what post-slice auto-refresh and the
 * pre-dispatch preflight gate on. `codegraph init` (WITHOUT `--index`) is fast
 * (~1 s) and offline-safe — it only `Parser.init()`s WASM grammars that resolve
 * from node_modules; the slow/offline concern applies to `index` (full build),
 * not `init`.
 */
export async function stakeCodegraphForInit(
  nextActions: string[],
  warnings: string[],
  projectRoot: string
): Promise<CodegraphAutoStakeOutcome | null> {
  let outcome: CodegraphAutoStakeOutcome | null = null;
  try {
    const guard = defaultCodegraphInitGuard(projectRoot);
    if (guard.status === 'fresh') {
      // 'fresh' here also covers the dangling state (marker present but
      // no codegraph.db) — running init self-heals both.
      outcome = await stakeFreshCodegraph(nextActions, warnings, projectRoot, guard.codegraphDir);
    } else if (guard.status === 'noop-already-peaks-loop') {
      outcome = { status: 'noop' };
    } else {
      outcome = { status: 'conflict' };
      warnings.push(
        `${guard.codegraphDir} already exists with a non-peaks-loop schema; ` +
          'refusing to auto-init codegraph. Run `peaks codegraph init --project <path>` after moving the foreign directory.'
      );
    }
  } catch (err) {
    warnings.push(`codegraph auto-stake failed: ${getErrorMessage(err)}`);
  }
  return outcome;
}
