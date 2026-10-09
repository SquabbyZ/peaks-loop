// The `peaks code context-now` envelope: the harness reading (window sync +
// witness), the mode-resolved decision, and the `data` / `warnings` /
// `nextActions` builders. Split out of `code-context-now-command.ts` when
// compressing its long function pushed that file past the 300-line cap; every
// body below is the original one, moved verbatim.
import { resolveAutoCompactProfile } from '../../services/mode/mode-status-service.js';
import { syncHarnessWindowForProject } from '../../services/context/auto-compact-reader.js';
import type { ContextPercentProbe } from '../../services/context/auto-compact-types.js';
import {
  describeHarnessWindowSync,
  harnessWindowSyncWarning
} from '../../services/context/harness-window-config.js';
import {
  describeHarnessWitness,
  readAndCompareHarnessWitness
} from '../../services/context/harness-context-witness.js';
import { contextNowActionFor, contextNowBandLabels } from './code-context-now-mapping.js';

/**
 * The harness half of the probe: the window sync, its warning, the witness read
 * and its notice. Lifted verbatim from the action body — it reads only its
 * parameters.
 */
export function readContextNowHarness(
  canonicalProjectRoot: string,
  sessionId: string,
  outerSessionId: string | null | undefined,
  probe: ContextPercentProbe
) {
  // the window this probe just divided by into the harness's own settings,
  // so "85%" here and the harness's own trigger are one point on one
  // scale. Idempotent (no write when the value is already in force) and a
  // no-op when the probe carried no token window — peaks-loop never
  // invents a number it did not measure.
  const harnessWindow = syncHarnessWindowForProject({
    projectRoot: canonicalProjectRoot,
    env: process.env,
    tokens: probe.capacityTokens ?? null
  });
  // The machine half of 要告知. A refused write is not automatically a
  // non-event: the file may pin a window that disagrees with the one this
  // probe just divided by, and then the ratio above describes a trigger
  // the harness is not going to fire. `nextActions` carries the full
  // sentence; this one line rides `warnings` so a JSON consumer cannot
  // miss it either.
  const harnessWindowWarning = harnessWindowSyncWarning(harnessWindow);
  // own number for the same quantity, captured by the statusline. This is
  // OBSERVATION ONLY — it never feeds `verdict` / `action` / any threshold
  // below. A wrong reading here must not be able to fire a compact.
  const harnessWitness = readAndCompareHarnessWitness({
    // The same promoted root as the harness-window write above, for the
    // same reason: the statusline resolves its root from the harness
    // payload (absolute), so a `--project .` from a hook would otherwise
    // look for the witness somewhere else and report `absent` forever.
    projectRoot: canonicalProjectRoot,
    sessionId,
    peaksRatio: probe.ratio,
    peaksTokens: probe.rawTokens ?? null,
    peaksWindowTokens: probe.capacityTokens ?? null,
    outerSessionId: outerSessionId ?? null
  });
  const witnessNotice = describeHarnessWitness(harnessWitness);
  return { harnessWindow, harnessWindowWarning, harnessWitness, witnessNotice };
}

type ContextNowHarness = ReturnType<typeof readContextNowHarness>;

/**
 * Slice H4 (rid=h4-context-now-mode-blind): ONE table, ONE mode
 * resolver. The hard-coded ladder that used to live in the action read no mode
 * at all, so on a 24h run (`partial` = 0.65/0.70/0.85) it answered `soft-warn`
 * + `next: null` across [0.70, 0.85) — the band in which
 * `peaks code auto-compact` had already decided to compact.
 */
export function resolveContextNowDecision(
  canonicalProjectRoot: string,
  ratio: number,
  isJobMode: boolean
) {
  const compactMode = resolveAutoCompactProfile(canonicalProjectRoot);
  const decided = contextNowActionFor(ratio, compactMode);
  const action = decided.action;
  const next = decided.next;
  const verdict =
    action === 'red-line' ? 'red-line' : action === 'auto-compact-now' ? 'pre-compact' : action;
  const bands = contextNowBandLabels(compactMode);
  // in behaviour ABOVE 0.50 — both auto-fire at ≥0.85 and both red-line at
  // ≥0.95". That was false: `partial` fires at 0.70, red-lines at 0.85.
  // The lines now come from the table for the mode in force.
  const gateModeNotice = isJobMode
    ? `Job mode (job-shape.json isJob=true): the same ≥${bands.preCompactRatio} / ≥${bands.redLineRatio} thresholds apply, and the decision is recorded in job-shape.json.`
    : `Single-rid mode: the same ≥${bands.preCompactRatio} / ≥${bands.redLineRatio} thresholds apply — ≥${bands.preCompactRatio} is MANDATORY auto-compact, not advisory.`;
  return { action, next, verdict, bands, gateModeNotice };
}

type ContextNowDecision = ReturnType<typeof resolveContextNowDecision>;

/** The envelope's `data` record, lifted verbatim out of the action body. */
export function buildContextNowData(args: {
  probe: ContextPercentProbe;
  ratioPct: string;
  isJobMode: boolean;
  promptSizeBytes: number | undefined;
  decision: ContextNowDecision;
  harness: ContextNowHarness;
}) {
  const { probe, decision, harness } = args;
  return {
    ratio: probe.ratio,
    ratioPct: `${args.ratioPct}%`,
    verdict: decision.verdict,
    action: decision.action,
    next: decision.next,
    jobMode: args.isJobMode,
    source: probe.source,
    ide: probe.ide,
    capacityBytes: probe.capacityBytes,
    rawBytes: probe.rawBytes ?? null,
    rawTokens: probe.rawTokens ?? null,
    capacityTokens: probe.capacityTokens ?? null,
    // capacityTokens (env-override | config | model-heuristic |
    // default) — null for byte/percent sources, which have no window.
    capacitySource: probe.capacitySource ?? null,
    bytesPrompt: args.promptSizeBytes ?? null,
    capturedAt: probe.capturedAt,
    // window sync did on this probe. Reported rather than silent — the
    // harness tells a user who overrides the window only via
    // `/autocompact`, so peaks-loop must be the one that says it.
    harnessWindow: harness.harnessWindow,
    harnessWitness: harness.harnessWitness
  };
}

/** The envelope's `warnings` array, lifted verbatim out of the action body. */
export function buildContextNowWarnings(harness: ContextNowHarness): string[] {
  return [
    ...(harness.harnessWindowWarning === null ? [] : [harness.harnessWindowWarning]),
    // AC3: the disagreement rides `warnings` — it is a fact about the
    // state, not an instruction — and it is one-way. Never an
    // AskUserQuestion (see .peaks/memory/auto-compact-threshold-policy.md).
    ...(harness.witnessNotice === null ? [] : [harness.witnessNotice])
  ];
}

/** The envelope's `nextActions` array, lifted verbatim out of the action body. */
export function buildContextNowNextActions(
  decision: ContextNowDecision,
  harness: ContextNowHarness
): string[] {
  const { action, next, bands, gateModeNotice } = decision;
  return [
    action === 'red-line'
      ? `RED LINE: ≥ ${bands.redLine}%. Next: \`${next}\` — peaks-loop asks the harness to compact and KEEPS WORKING (dispatch is not blocked); re-probe to confirm it landed.`
      : action === 'auto-compact-now'
        ? `MANDATORY auto-compact (≥${bands.preCompact}%, every mode). Code MUST call \`${next}\` WITHOUT confirmation.`
        : action === 'soft-warn'
          ? `Soft warn (${bands.softWarn}–${bands.preCompact}%). Continue working; the next \`peaks code auto-compact\` will re-check.`
          : `Below ${bands.softWarn}%. No action required.`,
    gateModeNotice,
    // Single wording, shared with `peaks code auto-compact` — see
    // `describeHarnessWindowSync`.
    describeHarnessWindowSync(harness.harnessWindow),
    // AC3: the one-way hint that accompanies the `warnings` entry. Both
    // channels carry the SAME fact in the shape each is read for
    // (machine-readable warning vs human/LLM advice) — see
    // `harnessWindowSyncWarning` / `describeHarnessWindowSync` above for
    // the same split, and note this one never asks a question.
    ...(harness.witnessNotice === null
      ? []
      : ['Re-probe with `peaks code context-now` to confirm; this is reported, not blocking.'])
  ];
}
