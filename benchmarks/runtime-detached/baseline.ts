/**
 * Phase A ship gate — the detached-vs-in-process efficiency comparison (spec §5.2).
 *
 * WHY THIS RUNNER SAYS "NOT MEASURED" INSTEAD OF REPORTING A NUMBER. The gate compares
 * an in-process fan-out of N=5 rid slices with the same fan-out dispatched as detached
 * sub-agents, so both arms have to be run on one machine by an E2E harness this
 * repository does not have. A synthesised number would be worse than none: downstream it
 * would be indistinguishable from a measurement.
 *
 * WHAT THE PREVIOUS VERSION DID INSTEAD. It wrote a `_TBD_` stub into
 * `.peaks/memory/2026-08-10-phase-A-baseline.md` — inside the directory holding this
 * repository's tracked knowledge, and reserved by the plan of record for a HUMAN's real
 * measurement — and returned `passesGate: false`, which reads exactly like "measured,
 * and failed". Its entry-point guard compared `import.meta.url` with
 * `file://${argv[1]}`, never equal on Windows, so it printed nothing and exited 0.
 *
 * WHAT WOULD RESOLVE IT, AND WHAT IT WILL NOT DO. A measurement of both arms fed back in
 * through `--measurement <file>`; until then the state is `not-measured` and the exit
 * code is 3. It never writes inside `.peaks/memory/`: the result goes to stdout as JSON
 * and to stderr as a sentence, and to a file only when the caller names one.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The plan of record. §5.2 (lines 1511-1515) holds the four thresholds below. */
export const SPEC_REF =
  'docs/superpowers/plans/2026-08-10-peaks-detached-sub-agent-plan.md §5.2 (lines 1511-1515)';
/** §5.2: orchestrator context saving ≥ 60 %. */
export const CONTEXT_SAVING_TARGET_PCT = 60;
/** §5.2: parallel wall-time saving ≥ 30 %, measured at N=5. */
export const WALL_TIME_SAVING_TARGET_PCT = 30;
/** §5.2: token cost saving ≥ 20 %. */
export const TOKEN_COST_SAVING_TARGET_PCT = 20;
/** §5.2: qa verdict rate ≥ the in-process baseline — a comparison, so it has no percentage. */
export const QA_VERDICT_RATE_TARGET = '>= in-process baseline';
/** §5.2 measures both arms at N=5 rid slices. */
export const FAN_OUT_N = 5;
/** The vendor CLIs the detached arm can dispatch against. */
const REQUIRED_VENDORS = ['claude', 'codex'] as const;
/** The three states the gate can be in. `not-measured` is NOT `measured-and-failed`. */
export type BaselineGateState = 'measured-and-passed' | 'measured-and-failed' | 'not-measured';
/** The gate was evaluated and every §5.2 rail was met. */
export const EXIT_MEASURED_PASSED = 0;
/** The gate was evaluated and at least one §5.2 rail was not met. */
export const EXIT_MEASURED_FAILED = 1;
/** The runner could not start, or could not read what it was asked to read. */
export const EXIT_RUNNER_ERROR = 2;
/** The gate was NOT evaluated — never 0, so a caller cannot read "unresolved" as "passed". */
export const EXIT_NOT_MEASURED = 3;
/** The exit code of each gate state. */
export const EXIT_CODES: Readonly<Record<BaselineGateState, number>> = {
  'measured-and-passed': EXIT_MEASURED_PASSED,
  'measured-and-failed': EXIT_MEASURED_FAILED,
  'not-measured': EXIT_NOT_MEASURED
};

/** One §5.2 rail: `comparison` says how `measured` is judged, `unit` names its unit, and `measured`/`verified` are null while the gate is unmeasured. */
export interface GateThreshold {
  readonly id: string;
  readonly comparison: string;
  readonly target: number | null;
  readonly unit: string;
  readonly specRef: string;
  readonly measured: number | null;
  readonly verified: boolean | null;
}
/** One arm of the §5.2 comparison. */
export interface ArmMeasurement {
  readonly contextTokens: number;
  readonly wallTimeMs: number;
  readonly tokenCost: number;
  readonly qaVerdictRate: number;
}
/** Both arms of the §5.2 comparison, as an E2E run would record them. */
export interface PhaseAMeasurement {
  readonly fanOutN: number;
  readonly inProcess: ArmMeasurement;
  readonly detached: ArmMeasurement;
  readonly measuredAt: string;
}
/** The machine-readable result of one gate evaluation. `passesGate` is null while the gate is unmeasured, so an unresolved gate never reads as a failed one. */
export interface BaselineResult {
  readonly schemaVersion: 1;
  readonly bench: 'phase-a-baseline';
  readonly state: BaselineGateState;
  readonly exitCode: number;
  readonly passesGate: boolean | null;
  readonly specRef: string;
  readonly fanOutN: number;
  readonly thresholds: readonly GateThreshold[];
  /** What the gate needs and does not have; null when the gate was measured. */
  readonly missingCapability: {
    readonly what: string;
    readonly why: string;
    readonly requiredVendors: readonly string[];
    readonly vendorsFound: readonly string[];
    readonly vendorsMissing: readonly string[];
  } | null;
  readonly summary: string;
}
/** What one rail observed, and whether that observation met the rail. */
interface RailObservation {
  readonly measured: number;
  readonly verified: boolean;
}

/**
 * True when THIS module is the program the process was started with.
 *
 * WHY NOT STRING CONCATENATION. `import.meta.url` is a `file://` URL: on Windows it
 * carries THREE slashes and forward slashes (`file:///D:/...`), while a hand-built
 * `'file://' + process.argv[1]` carries TWO slashes and the path's own backslashes —
 * never equal on Windows, so a runner guarded that way prints nothing and exits 0
 * (measured on this repository's own baseline runner before this fix).
 * `pathToFileURL` builds the URL the platform's own rules define; it is a parameter so
 * a test can pin the WINDOWS shape on a non-Windows host.
 */
export function isEntryPoint(
  moduleUrl: string,
  argv1: string | undefined,
  toFileUrl: (path: string) => URL = pathToFileURL
): boolean {
  if (!argv1) return false;
  return moduleUrl === toFileUrl(argv1).href;
}
/** True when a runnable `name` sits on PATH. Read-only: it never executes the candidate. */
export function vendorCliOnPath(name: string): boolean {
  const pathEnv = process.env['PATH'] ?? '';
  const suffixes = process.platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  return pathEnv
    .split(delimiter)
    .filter((dir) => dir.length > 0)
    .some((dir) => suffixes.some((suffix) => existsSync(join(dir, `${name}${suffix}`))));
}
/**
 * True when an absolute path sits inside the memory library.
 *
 * WHY THE MEMORY LIBRARY IS OFF-LIMITS. `.peaks/memory/` holds this repository's
 * tracked knowledge entries, and a runner that writes there overwrites the one file
 * the plan of record reserves for a human's real measurement — on every run.
 */
export function isInsideMemoryLibrary(absolutePath: string): boolean {
  const segments = absolutePath.split(/[\\/]+/);
  return segments.some(
    (segment, index) => segment === '.peaks' && segments[index + 1] === 'memory'
  );
}
/** Percentage by which `after` is smaller than `before`; 0 when `before` is not positive. */
export function savingPct(before: number, after: number): number {
  if (!(before > 0)) return 0;
  return Math.round((1 - after / before) * 10_000) / 100;
}
/** The observation of each rail, derived from a measurement of both arms. */
function observationsFor(measurement: PhaseAMeasurement): Map<string, RailObservation> {
  const before = measurement.inProcess;
  const after = measurement.detached;
  const contextPct = savingPct(before.contextTokens, after.contextTokens);
  const wallTimePct = savingPct(before.wallTimeMs, after.wallTimeMs);
  const tokenCostPct = savingPct(before.tokenCost, after.tokenCost);
  const qaRate = after.qaVerdictRate;
  const rows: ReadonlyArray<readonly [string, number, boolean]> = [
    ['orchestrator-context-saving', contextPct, contextPct >= CONTEXT_SAVING_TARGET_PCT],
    ['parallel-wall-time-saving', wallTimePct, wallTimePct >= WALL_TIME_SAVING_TARGET_PCT],
    ['token-cost-saving', tokenCostPct, tokenCostPct >= TOKEN_COST_SAVING_TARGET_PCT],
    ['qa-verdict-rate', qaRate, qaRate >= before.qaVerdictRate]
  ];
  const observed = new Map<string, RailObservation>();
  for (const [id, measured, verified] of rows) observed.set(id, { measured, verified });
  return observed;
} /** The four §5.2 rails, with the observation filled in — or left empty when unmeasured. */
export function phaseAThresholds(measurement: PhaseAMeasurement | null): GateThreshold[] {
  const observed = measurement === null ? null : observationsFor(measurement);
  const rails = [
    { id: 'orchestrator-context-saving', target: CONTEXT_SAVING_TARGET_PCT, unit: '%' },
    { id: 'parallel-wall-time-saving', target: WALL_TIME_SAVING_TARGET_PCT, unit: '%' },
    { id: 'token-cost-saving', target: TOKEN_COST_SAVING_TARGET_PCT, unit: '%' },
    { id: 'qa-verdict-rate', target: null, unit: 'verdict rate' }
  ];
  return rails.map((rail) => {
    const observation = observed === null ? null : (observed.get(rail.id) ?? null);
    return {
      id: rail.id,
      comparison: rail.target === null ? QA_VERDICT_RATE_TARGET : `>= ${rail.target}`,
      target: rail.target,
      unit: rail.unit,
      specRef: SPEC_REF,
      measured: observation?.measured ?? null,
      verified: observation?.verified ?? null
    };
  });
}

/**
 * Evaluate the §5.2 gate.
 *
 * With no measurement the gate is NOT evaluated: the state is `not-measured`,
 * `passesGate` is null rather than false, and the missing capability is named. With a
 * measurement the four rails are compared and the state says whether they were met.
 */
export function runBaseline(measurement: PhaseAMeasurement | null = null): BaselineResult {
  if (measurement === null) {
    const vendorsFound = REQUIRED_VENDORS.filter((vendor) => vendorCliOnPath(vendor));
    const vendorsMissing = REQUIRED_VENDORS.filter((vendor) => !vendorsFound.includes(vendor));
    return {
      schemaVersion: 1,
      bench: 'phase-a-baseline',
      state: 'not-measured',
      exitCode: EXIT_NOT_MEASURED,
      passesGate: null,
      specRef: SPEC_REF,
      fanOutN: FAN_OUT_N,
      thresholds: phaseAThresholds(null),
      missingCapability: {
        what: 'an E2E harness that runs BOTH arms of the §5.2 comparison — the same N rid slices in-process and dispatched as detached sub-agents — and records orchestrator context, wall time, token cost and QA verdict rate from one pair of instruments',
        why: 'the gate is a COMPARISON, so both arms have to be measured on the same machine; this repository has no such harness, and the four numbers must not be synthesised',
        requiredVendors: [...REQUIRED_VENDORS],
        vendorsFound,
        vendorsMissing
      },
      summary:
        `Phase A ship gate: NOT MEASURED (exit ${EXIT_NOT_MEASURED}). The §5.2 comparison — a ` +
        `detached fan-out of ${FAN_OUT_N} rid slices against an in-process fan-out of the same ` +
        `${FAN_OUT_N} — needs an E2E harness that runs both arms, and this repository has none. ` +
        `The four §5.2 targets are UNVERIFIED, not failed. Vendor CLIs on PATH: ` +
        `${vendorsFound.join(', ') || 'none'}; absent: ${vendorsMissing.join(', ') || 'none'}.`
    };
  }
  const thresholds = phaseAThresholds(measurement);
  const unmet = thresholds.filter((rail) => rail.verified !== true);
  const passesGate = unmet.length === 0;
  const state: BaselineGateState = passesGate ? 'measured-and-passed' : 'measured-and-failed';
  return {
    schemaVersion: 1,
    bench: 'phase-a-baseline',
    state,
    exitCode: EXIT_CODES[state],
    passesGate,
    specRef: SPEC_REF,
    fanOutN: measurement.fanOutN,
    thresholds,
    missingCapability: null,
    summary: passesGate
      ? `Phase A ship gate: MEASURED and PASSED (all ${thresholds.length} §5.2 rails met, N=${measurement.fanOutN}).`
      : `Phase A ship gate: MEASURED and FAILED — ${unmet.length} of ${thresholds.length} §5.2 rails unmet: ${unmet.map((rail) => rail.id).join(', ')}.`
  };
}
function parseOption(argv: readonly string[], name: string): string | null {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? '';
    if (arg === name) return argv[index + 1] ?? null;
    if (arg.startsWith(`${name}=`)) return arg.slice(name.length + 1);
  }
  return null;
}
/** The runner's command line: one measurement to read, one result file to write. */
export function main(argv: readonly string[]): number {
  const cwd = process.cwd();
  const measurementPath = parseOption(argv, '--measurement');
  const outPath = parseOption(argv, '--out');
  let measurement: PhaseAMeasurement | null = null;
  if (measurementPath !== null) {
    const absolute = resolve(cwd, measurementPath);
    try {
      measurement = JSON.parse(readFileSync(absolute, 'utf8')) as PhaseAMeasurement;
    } catch (err) {
      console.error(`phase-a baseline: cannot read ${absolute}: ${String(err)}`);
      return EXIT_RUNNER_ERROR;
    }
  }
  const result = runBaseline(measurement);
  const json = JSON.stringify(result);
  if (outPath !== null) {
    const absolute = resolve(cwd, outPath);
    if (isInsideMemoryLibrary(absolute)) {
      console.error(`phase-a baseline: refusing to write inside the memory library (${absolute}).`);
      return EXIT_RUNNER_ERROR;
    }
    try {
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, `${json}\n`, 'utf8');
    } catch (err) {
      console.error(`phase-a baseline: cannot write ${absolute}: ${String(err)}`);
      return EXIT_RUNNER_ERROR;
    }
  }
  console.log(json);
  console.error(result.summary);
  return result.exitCode;
}

if (isEntryPoint(import.meta.url, process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
