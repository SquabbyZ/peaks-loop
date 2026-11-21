// The PERCENT half of `peaks compact harness-window`'s reporting — split out of
// `compact-harness-window-reports.ts` so that file stays under the file-size cap
// once every report has to show both knobs of the pair.
//
// The rule this module exists to keep: the command manages TWO keys, so every
// report and every sentence must be honest about both. A window-only report
// could not distinguish a rolled-back project from a fresh one, and a
// `--reenable` that said nothing about the percent left its later absence
// unexplained.
import {
  readHarnessPercentState,
  resolveHarnessCompactThresholdLocation,
  type HarnessPercentState
} from '../../services/context/harness-compact-threshold-config.js';

/** The percent half as an envelope reports it, or null when unmanaged here. */
export interface HarnessPercentReport {
  readonly key: string;
  readonly percent: number | null;
  /**
   * A BOUNDED description of an unparseable file value (see `boundedRawNote`) —
   * never the raw string. MED-2: this report is printed as JSON and its
   * sentences reach logs, and the value under this key is user-writable, so a
   * secret mis-parked there must not travel. `null` when the slot is empty.
   */
  readonly rawNote: string | null;
  readonly ownership: HarnessPercentState['ownership'];
  /** The file the value was read from — the same one the window half names. */
  readonly settingsPath: string;
}

/**
 * Read the percent half for a project, or null when the active adapter declares
 * no percent knob (an IDE with no such setting; peaks does not manage it there
 * and says so rather than inventing a key).
 */
export function readPercentReport(project: string): HarnessPercentReport | null {
  const threshold = resolveHarnessCompactThresholdLocation({
    projectRoot: project,
    env: process.env
  });
  if (threshold === null) return null;
  const state = readHarnessPercentState(threshold.settingsPath, threshold.percentEnvVar);
  return {
    key: state.key,
    percent: state.percent,
    // The service layer bounds the value at its source (MED-2); carry the note.
    rawNote: state.rawNote ?? null,
    ownership: state.ownership,
    settingsPath: threshold.settingsPath
  };
}

/**
 * The percent half in words — ONE clause, so a report says what the percent key
 * is and who owns it even when the answer is "peaks does not manage it here".
 */
export function describePercentHalf(percent: HarnessPercentReport | null): string {
  if (percent === null) {
    return 'peaks does not manage the percent here: the active IDE adapter declares no auto-compact percent key.';
  }
  switch (percent.ownership) {
    case 'peaks':
      return `The percent ${percent.key}=${String(percent.percent)} is peaks-loop's own write; it may update it.`;
    case 'peaks-corrupt':
      return `The percent ${percent.key} holds ${percent.rawNote ?? 'an unreadable value'}, which is not a percentage — a corruption of peaks-loop's own write. \`peaks compact harness-window --reset\` clears it.`;
    case 'human':
      return percent.percent !== null
        ? `The percent ${percent.key}=${String(percent.percent)} is not peaks-loop's own write, so peaks-loop will not overwrite it.`
        : `The percent ${percent.key} holds ${percent.rawNote ?? 'an unreadable value'} and is not peaks-loop's own write, so peaks-loop will not overwrite it.`;
    case 'stale-marker':
      return `The percent ${percent.key} is unset but a provenance marker survives; \`peaks compact harness-window --reset\` cleans it up.`;
    default:
      return `The percent ${percent.key} is not set.`;
  }
}

/**
 * What `--reenable` did to the percent — the companion clause of its window
 * sentence.
 *
 * `--reenable` only clears the opt-out: it removes nothing and writes no
 * values. After a `--reset` the file therefore holds no window AND no percent,
 * and the next probe fills the window only. Left unsaid (the measured N4
 * defect), a percent the user expected back stays absent with nothing on screen
 * explaining it — and a later init then reports `not-peaks-owned` about a value
 * that is not even there.
 */
export function describeReenabledPercent(percent: HarnessPercentReport | null): string {
  if (percent === null) {
    return ' The active IDE adapter declares no auto-compact percent key, so peaks-loop does not manage a percent here.';
  }
  if (percent.ownership === 'none') {
    return ` The percent key ${percent.key} is not set, and peaks-loop does not restore a value it removed: the next \`peaks code context-now\` probe writes the window, and the percent stays unset unless a later init or probe has a measured value to write.`;
  }
  if (percent.ownership === 'peaks') {
    return ` The percent key ${percent.key}=${String(percent.percent)} is peaks-loop's own write and stands; a later probe may update it.`;
  }
  return ` The percent key ${percent.key} holds ${percent.rawNote ?? 'an unreadable value'}, which peaks-loop does not manage; it is left exactly as it is.`;
}
