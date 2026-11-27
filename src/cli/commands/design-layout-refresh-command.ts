/**
 * `peaks design layout refresh` — re-measure only the entries a spacing-token
 * change reaches. Pages are named by the caller; the token reverse index adds
 * every dependent route the caller did not name, addressed from a base URL. A
 * route with no addressable page is reported, never guessed, and an entry whose
 * measured document did not move is left byte-identical on disk.
 */
import { resolve } from 'node:path';

import { ok } from 'peaks-loop-shared/result';

import { readEntry } from '../../services/design/layout/layout-graph-query.js';
import {
  graphRoot,
  writeBatch,
  type BatchItem
} from '../../services/design/layout/layout-graph-store.js';
import {
  recordedDesignRoot,
  recordDesignRoot
} from '../../services/design/layout/layout-graph-root-record.js';
import {
  batchTargets,
  type RefreshTarget
} from '../../services/design/layout/layout-graph-incremental.js';
import { keyText } from '../../services/design/layout/layout-graph-paths.js';
import {
  captureLayoutPage,
  type LayoutPageResult
} from '../../services/design/layout/layout-geometry.js';
import {
  readSpacingTokensStrict,
  type SpacingToken
} from '../../services/design/layout/layout-tokens.js';
import type { LayoutEntry } from '../../services/design/layout/layout-graph.js';
import { getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { buildOne, type Built } from './design-layout-build-command.js';
import {
  movedKeysOf,
  pageRefusal,
  planRefresh,
  type RefreshPlan
} from './design-layout-refresh-plan.js';
import {
  designRootOf,
  EXIT_REFUSED,
  failWith,
  viewportList,
  type CaptureFn,
  type DesignLayoutRefreshOptions
} from './design-layout-shared.js';

type Captured = { target: RefreshTarget; built: Built };
type FailureRow = { key: string; reason: string };

type CapturePass = { write: Captured[]; unchanged: string[]; failed: FailureRow[] };

type RefreshOutcome = {
  updated: string[];
  unchanged: string[];
  failed: FailureRow[];
  batches: number;
  /** Why the design root could not be recorded, or null when it was. */
  rootWarning: string | null;
};

/** A captured page is written when a cited token moved or its measured document did. */
function needsWrite(projectRoot: string, entry: LayoutEntry, moved: boolean): boolean {
  if (moved) return true;
  const stored = readEntry(projectRoot, entry);
  return !stored.ok || stored.entry.fingerprint !== entry.fingerprint;
}

type CaptureContext = {
  options: DesignLayoutRefreshOptions;
  projectRoot: string;
  tokens: readonly SpacingToken[];
  moved: ReadonlySet<string>;
  capture: CaptureFn;
};

async function captureOne(
  target: RefreshTarget,
  context: CaptureContext
): Promise<Captured | FailureRow> {
  let page: LayoutPageResult;
  try {
    page = await context.capture({
      route: target.route,
      url: target.url,
      viewport: target.viewport
    });
  } catch (error) {
    return { key: keyText(target), reason: getErrorMessage(error) };
  }
  const built = buildOne(
    {
      project: context.options.project,
      route: target.route,
      url: target.url,
      state: target.state
    },
    target.viewport,
    context.tokens,
    page
  );
  if (!built.ok) return { key: keyText(target), reason: `${built.code}: ${built.reason}` };
  return { target, built: built.built };
}

function isCaptured(value: Captured | FailureRow): value is Captured {
  return 'built' in value;
}

async function capturePass(
  targets: readonly RefreshTarget[],
  context: CaptureContext
): Promise<CapturePass> {
  const pass: CapturePass = { write: [], unchanged: [], failed: [] };
  for (const target of targets) {
    const result = await captureOne(target, context);
    if (!isCaptured(result)) {
      pass.failed.push(result);
      continue;
    }
    const key = keyText(result.target);
    if (needsWrite(context.projectRoot, result.built.entry, context.moved.has(key))) {
      pass.write.push(result);
    } else {
      pass.unchanged.push(key);
    }
  }
  return pass;
}

function itemOf(captured: Captured): BatchItem {
  return { entry: captured.built.entry, capture: captured.built.geometry };
}

/** Write one bounded batch; a refusal is reported per entry and writes nothing. */
function writeBatchOf(
  projectRoot: string,
  batch: readonly RefreshTarget[],
  byKey: ReadonlyMap<string, Captured>,
  outcome: RefreshOutcome
): void {
  const items = batch
    .map((target) => byKey.get(keyText(target)))
    .filter((item): item is Captured => item !== undefined);
  if (items.length === 0) return;
  const written = writeBatch(projectRoot, items.map(itemOf));
  if (written.ok) {
    for (const item of items) outcome.updated.push(keyText(item.target));
    return;
  }
  for (const item of items) {
    outcome.failed.push({ key: keyText(item.target), reason: written.reason });
  }
}

type RefreshInput = {
  projectRoot: string;
  designRoot: string;
  options: DesignLayoutRefreshOptions;
  plan: RefreshPlan;
  capture: CaptureFn;
  tokens: readonly SpacingToken[];
};

async function refreshPages(input: RefreshInput): Promise<RefreshOutcome> {
  const { projectRoot, designRoot, options, plan, capture, tokens } = input;
  const context: CaptureContext = {
    options,
    projectRoot,
    tokens,
    moved: movedKeysOf(plan),
    capture
  };
  const pass = await capturePass([...plan.explicit, ...plan.derived], context);
  const recorded = recordDesignRoot(projectRoot, designRoot);
  const outcome: RefreshOutcome = {
    updated: [],
    unchanged: pass.unchanged,
    failed: pass.failed,
    batches: 0,
    rootWarning: recorded.ok ? null : recorded.reason
  };
  const byKey = new Map(pass.write.map((item) => [keyText(item.target), item]));
  const split = batchTargets(pass.write.map((item) => item.target));
  outcome.batches = split.batches.length;
  for (const batch of split.batches) writeBatchOf(projectRoot, batch, byKey, outcome);
  return outcome;
}

function refreshWarnings(plan: RefreshPlan, outcome: RefreshOutcome): string[] {
  return [
    ...outcome.failed.map((row) => `${row.key} could not be refreshed (${row.reason})`),
    ...plan.notAddressed.map(
      (row) =>
        `${row.key} cites a changed spacing token but has no addressable page (${row.reason})`
    ),
    ...(outcome.rootWarning === null ? [] : [outcome.rootWarning])
  ];
}

type ReportView = {
  options: DesignLayoutRefreshOptions;
  graphRootPath: string;
  plan: RefreshPlan;
  outcome: RefreshOutcome;
};

function printRefresh(io: ProgramIO, view: ReportView): void {
  const { options, plan, outcome } = view;
  const unchanged = [...new Set([...plan.affected.unchanged.map(keyText), ...outcome.unchanged])];
  const complete =
    plan.affected.mode !== 'full' &&
    outcome.batches <= 1 &&
    plan.notAddressed.length === 0 &&
    outcome.failed.length === 0;
  printResult(
    io,
    ok(
      'design.layout.refresh',
      {
        root: view.graphRootPath,
        mode: plan.affected.mode,
        changedTokens: plan.affected.changedTokens,
        affected: plan.affected.affected.map(keyText),
        updated: outcome.updated,
        unchanged,
        notAddressed: plan.notAddressed,
        failed: outcome.failed,
        batches: outcome.batches,
        full: complete,
        baseUrl: options.baseUrl ?? null
      },
      refreshWarnings(plan, outcome)
    ),
    options.json === true
  );
}

export async function runDesignLayoutRefresh(
  options: DesignLayoutRefreshOptions,
  io: ProgramIO,
  capture: CaptureFn = captureLayoutPage
): Promise<void> {
  const command = 'design.layout.refresh';
  const viewports = viewportList(options.viewport);
  if (viewports === null) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_VIEWPORT_INVALID',
      message: 'viewport must be WxH',
      exit: EXIT_REFUSED
    });
    return;
  }
  const refusal = pageRefusal(options);
  if (refusal !== null) {
    failWith(io, command, options.json, refusal);
    return;
  }
  const projectRoot = resolve(options.project);
  const designRoot =
    options.app === undefined ? recordedDesignRoot(projectRoot) : designRootOf(options);
  const tokens = readSpacingTokensStrict(designRoot);
  if (!tokens.ok) {
    failWith(io, command, options.json, {
      code: 'DESIGN_LAYOUT_TOKENS_INVALID',
      message: tokens.reason,
      exit: EXIT_REFUSED
    });
    return;
  }
  const plan = planRefresh(options, projectRoot, viewports, tokens.tokens);
  const outcome = await refreshPages({
    projectRoot,
    designRoot,
    options,
    plan,
    capture,
    tokens: tokens.tokens
  });
  printRefresh(io, { options, graphRootPath: graphRoot(projectRoot), plan, outcome });
}
