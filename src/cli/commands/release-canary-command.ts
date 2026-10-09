// src/cli/commands/release-canary-command.ts
//
// `peaks release canary --percent <10|50>` — advance the active release to a
// canary stage. Split out of `release-commands.ts`; the verb name, its options,
// the canary percent vocabulary, the precheck gate and every envelope shape are
// unchanged. `executeCanaryAction` keeps its name and signature (it is the
// function the cross-cutting e2e harness names) and is re-exported by
// `release-commands.ts`.

import type { Command } from 'commander';
import {
  readReleaseState,
  transitionRelease,
  writeReleaseState
} from '../../services/release/release-state.js';
import { runAllLayers, type LayerResult } from '../../services/release/version-precheck-service.js';
import { runChangesetHardGate } from '../../services/changeset/changeset-check-service.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { addJsonOption, printResult, type ProgramIO } from '../cli-helpers.js';
import {
  CANARY_PERCENT_FIRST,
  CANARY_PERCENT_SECOND,
  CANARY_PERCENTS,
  resolveReleaseProjectRoot,
  type ReleaseProjectOptions
} from './release-command-shared.js';

/**
 * The payload an outcome carries. The `error` member is declared so the
 * INVALID_TRANSITION message is read as a `string` rather than as `unknown`
 * off the open index signature.
 */
type CanaryPayload = Readonly<Record<string, unknown>> & { readonly error?: string };

type CanaryOutcome = {
  ok: boolean;
  payload: CanaryPayload;
  status: 'PRECHECK_BLOCKER' | 'INVALID_PERCENT' | 'INVALID_TRANSITION' | 'OK';
  blockerLayer?: { name: string; result: LayerResult };
};

type CanaryOptions = ReleaseProjectOptions & {
  percent: string;
  note?: string;
};

function precheckBlockerOutcome(
  projectRoot: string,
  snapshotAt: string,
  name: string,
  result: LayerResult
): CanaryOutcome {
  return {
    ok: false,
    status: 'PRECHECK_BLOCKER',
    blockerLayer: { name, result },
    payload: {
      projectRoot,
      precheckSnapshotAt: snapshotAt,
      layer: name,
      message: result.message,
      remediation: result.remediation
    }
  };
}

// precheck-guard via direct function call (not via program.parseAsync with a
// mocked service). Returns the result envelope for the caller to print.
export function executeCanaryAction(
  opts: { percent: string; note?: string; project?: string; json?: boolean },
  io: ProgramIO,
  projectRoot: string
): CanaryOutcome {
  // this function is called (step 0 short-circuits with CHANGESET_BLOCKED).
  // Layers C/D default warning → do not block canary; --strict upgrade would
  const precheck = runAllLayers({ projectRoot, strict: false });
  const blockerEntry = Object.entries(precheck.layers).find(([, l]) => l.status === 'blocker');
  if (blockerEntry !== undefined) {
    const [name, result] = blockerEntry;
    return precheckBlockerOutcome(projectRoot, precheck.snapshotAt, name, result);
  }
  const percent = Number.parseInt(opts.percent, 10);
  if (percent !== CANARY_PERCENT_FIRST && percent !== CANARY_PERCENT_SECOND) {
    return {
      ok: false,
      status: 'INVALID_PERCENT',
      payload: { projectRoot, got: opts.percent }
    };
  }
  const state = readReleaseState(projectRoot);
  const targetStage = CANARY_PERCENTS[percent];
  const result = transitionRelease(state, targetStage, opts.note);
  if ('error' in result) {
    return {
      ok: false,
      status: 'INVALID_TRANSITION',
      payload: { projectRoot, error: result.error }
    };
  }
  writeReleaseState(projectRoot, result.state);
  return {
    ok: true,
    status: 'OK',
    payload: {
      projectRoot,
      percent,
      currentStage: targetStage,
      nextAction:
        percent === CANARY_PERCENT_FIRST
          ? 'peaks release canary --percent 50'
          : 'peaks release promote'
    }
  };
}

/** The refusal a staged changeset triggers, before the precheck even runs. */
function changesetBlockedOutcome(
  gate: ReturnType<typeof runChangesetHardGate>,
  projectRoot: string
): ReturnType<typeof fail> {
  return fail(
    'release.canary',
    'CHANGESET_BLOCKED',
    `${gate.stagedFiles.length} staged .changeset/*.md file(s) — refusing canary`,
    {
      projectRoot,
      state: gate.state,
      stagedFiles: [...gate.stagedFiles],
      snapshotAt: gate.snapshotAt
    },
    [
      `Drain pending changesets (coordinating LLM: drain via the standard changeset consumption path), then re-run \`peaks changeset check --project ${projectRoot}\` to confirm clean state.`
    ]
  );
}

/** The precheck refusal, with the layer that blocked and where to read the rest. */
function precheckBlockerEnvelope(
  projectRoot: string,
  result: CanaryOutcome
): ReturnType<typeof fail> {
  const layer = result.blockerLayer;
  return fail(
    'release.canary',
    'PRECHECK_BLOCKER',
    `precheck blocker on layer '${layer?.name ?? 'unknown'}': ${layer?.result.message ?? ''}`,
    result.payload,
    [
      `Run 'peaks release precheck --project ${projectRoot}' for the full 4-layer envelope.`,
      `Run 'peaks release precheck --strict' to also surface warning-layer issues.`,
      `Remediation: ${layer?.result.remediation ?? ''}`
    ]
  );
}

/** The outcome of the canary attempt, printed as the envelope its status selects. */
function printCanaryOutcome(
  io: ProgramIO,
  opts: CanaryOptions,
  projectRoot: string,
  result: CanaryOutcome
): void {
  const asJson = opts.json ?? false;
  if (result.status === 'PRECHECK_BLOCKER') {
    printResult(io, precheckBlockerEnvelope(projectRoot, result), asJson);
    return;
  }
  if (result.status === 'INVALID_PERCENT') {
    printResult(
      io,
      fail(
        'release.canary',
        'INVALID_PERCENT',
        `--percent must be 10 or 50 (got "${opts.percent}")`,
        result.payload,
        []
      ),
      asJson
    );
    return;
  }
  if (result.status === 'INVALID_TRANSITION') {
    printResult(
      io,
      fail(
        'release.canary',
        'INVALID_TRANSITION',
        String(result.payload['error'] ?? ''),
        result.payload,
        []
      ),
      asJson
    );
    return;
  }
  printResult(io, ok('release.canary', result.payload, [], []), asJson);
}

function runReleaseCanary(io: ProgramIO, opts: CanaryOptions): void {
  const projectRoot = resolveReleaseProjectRoot(opts.project);
  const gate = runChangesetHardGate(projectRoot);
  if (gate.state === 'staged-present') {
    process.exitCode = 1;
    printResult(io, changesetBlockedOutcome(gate, projectRoot), opts.json ?? false);
    return;
  }
  printCanaryOutcome(io, opts, projectRoot, executeCanaryAction(opts, io, projectRoot));
}

export function registerReleaseCanaryCommand(release: Command, io: ProgramIO): void {
  addJsonOption(
    release
      .command('canary')
      .description(
        'Advance the active release to a canary stage. Two percent values supported: ' +
          '10 (first canary, requires stage=planned) and 50 (second canary, requires ' +
          'stage=canary-10). Runs `peaks release precheck` first and refuses with ' +
          'PRECHECK_BLOCKER if any blocker layer (rootVsShared or tagCollision) fails.'
      )
      .requiredOption('--percent <10|50>', 'canary percent (10 or 50)')
      .option('--note <text>', 'optional note for the stage transition')
      .option('--project <path>', 'project root (default: cwd)')
  ).action((opts: CanaryOptions) => runReleaseCanary(io, opts));
}
