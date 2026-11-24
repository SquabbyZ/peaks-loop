/**
 * Same-route visual fidelity for `peaks design check` (G3a).
 *
 * `designlang fidelity <baseline> --clone <candidate>` compares two LIVE URLs
 * and writes `fidelity.json`. Its exit code is overloaded (1 means "below
 * --min" AND "engine/URL failure"), so the verdict is read from the artifact:
 * a parsed `overall` number is the score path, anything else is blocked. Both
 * URLs must answer HTTP 200 first (two dead routes score 100), `--min` is
 * validated here because `--min abc` makes designlang exit 0 on an F page, and
 * two spellings of one URL are refused because a page compared with itself
 * always scores 100. The child runs through `process.execPath` under the shared
 * timeout/tree-kill.
 */
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { getSessionDir, isSinglePathSegment } from '../session/getSessionDir.js';
import { readEngineContract } from './design-engine-deps.js';
import { resolveEngine, type EngineAvailability } from './engine-status.js';
import { type DesignlangRunResult, runDesignlang } from './designlang.js';
import { type ParsedReport, readFidelityReport, REPORT_FILE } from './fidelity-report.js';
import { isTrustedDesignUrl } from './url-trust.js';
import { normalizedUrl, redactUrl } from './url-redact.js';

/** The hard G3a threshold (spec §7.4). */
export const FIDELITY_MIN_DEFAULT = 90;

/** Budget for one fidelity run; a hanging page alone cost 97 s in the spike. */
const FIDELITY_TIMEOUT_MS = 180_000;

/** Per-URL reachability budget. */
const PROBE_TIMEOUT_MS = 5_000;

/** Only a fully rendered page is evidence; a 404 pair scores a perfect 100. */
const HTTP_OK = 200;

const MIN_SCORE = 0;
const MAX_SCORE = 100;
const STDERR_TAIL = 400;

export type FidelityRunResult =
  | ({ ok: true } & ParsedReport & { reportPath: string })
  | {
      ok: false;
      code:
        | 'DESIGN_URL_UNTRUSTED'
        | 'DESIGN_FIDELITY_URL_UNREACHABLE'
        | 'DESIGN_FIDELITY_NO_EVIDENCE'
        | 'DESIGN_FIDELITY_SELF_COMPARE'
        | 'DESIGN_ENGINE_UNAVAILABLE';
      message: string;
    };

/** Everything one spawn needs; a test replaces this to record the argv. */
export type FidelitySpawnInput = {
  entryPath: string;
  args: readonly string[];
  timeoutMs: number;
  outDir: string;
};
/** The injected side effects of one fidelity run. */
export type FidelityDeps = {
  availability: EngineAvailability;
  isTrusted: (url: string) => boolean;
  /** The HTTP status of a GET, or null when the URL did not answer. */
  probeStatus: (url: string) => Promise<number | null>;
  run: (input: FidelitySpawnInput) => Promise<DesignlangRunResult>;
};
export type RunFidelityInput = {
  projectRoot: string;
  /** The resolved frontend app root; the contract and trust read follow it. */
  appRoot: string;
  sessionId: string;
  baselineUrl: string;
  candidateUrl: string;
  min?: number;
  timeoutMs?: number;
  deps?: FidelityDeps;
};
/** True when `min` is a score designlang can compare against without coercion. */
export function isValidFidelityMin(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_SCORE && value <= MAX_SCORE;
}
/** A bare GET status; redirects are NOT followed, so only a real 200 passes. */
async function probeHttpStatus(url: string, timeoutMs = PROBE_TIMEOUT_MS): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let status: number | null = null;
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal
    });
    const cancelled = response.body?.cancel();
    if (cancelled !== undefined) await cancelled.catch(() => undefined);
    status = response.status;
  } catch {
    status = null;
  } finally {
    clearTimeout(timer);
  }
  return status;
}
/**
 * The real dependencies. An unreadable engine.json has no recorded public URL,
 * so the trust boundary then admits loopback only — never a silent widening.
 * `appRoot` is the RESOLVED contract root: in an app-under-a-subdirectory repo
 * the contract lives at `web/design/`, not at the repository root.
 */
export function buildFidelityDeps(appRoot: string): FidelityDeps {
  const availability = resolveEngine();
  const read = readEngineContract(join(appRoot, 'design'));
  return {
    availability,
    isTrusted: (url) => read.ok && isTrustedDesignUrl(url, read.contract),
    probeStatus: probeHttpStatus,
    run: (input) =>
      runDesignlang({ entryPath: input.entryPath, args: input.args, timeoutMs: input.timeoutMs })
  };
}
function blocked(
  code: Extract<FidelityRunResult, { ok: false }>['code'],
  message: string
): FidelityRunResult {
  return { ok: false, code, message };
}
/** The CLI vector the spike measured; `--system-chrome` only for a system browser. */
function buildFidelityArgs(input: {
  baselineUrl: string;
  candidateUrl: string;
  min: number;
  outDir: string;
  systemChrome: boolean;
}): string[] {
  const args = [
    'fidelity',
    input.baselineUrl,
    '--clone',
    input.candidateUrl,
    '--min',
    String(input.min),
    '-o',
    input.outDir
  ];
  if (input.systemChrome) args.push('--system-chrome');
  return args;
}

let runSequence = 0;
/** A fresh run directory, so a stale report from an earlier run cannot be read. */
function fidelityOutDir(projectRoot: string, sessionId: string): string | null {
  if (!isSinglePathSegment(sessionId)) return null;
  runSequence += 1;
  const run = `run-${String(Date.now())}-${String(process.pid)}-${String(runSequence)}`;
  return join(getSessionDir(projectRoot, sessionId), 'design', 'fidelity', run);
}
/** Require HTTP 200 from every URL; the engine itself never looks at status. */
async function requireHttp200(
  deps: FidelityDeps,
  urls: readonly string[]
): Promise<FidelityRunResult | null> {
  for (const url of urls) {
    const status = await deps.probeStatus(url);
    if (status !== HTTP_OK) {
      const answer = status === null ? 'did not answer' : `answered HTTP ${String(status)}`;
      return blocked(
        'DESIGN_FIDELITY_URL_UNREACHABLE',
        `The fidelity URL ${redactUrl(url)} ${answer}; both the baseline and the candidate must ` +
          'answer HTTP 200 before designlang runs.'
      );
    }
  }
  return null;
}
type FidelityPlan = { entryPath: string; deps: FidelityDeps; min: number };
type Planned = { ok: true; plan: FidelityPlan } | { ok: false; result: FidelityRunResult };

function refuse(code: Extract<FidelityRunResult, { ok: false }>['code'], message: string): Planned {
  return { ok: false, result: blocked(code, message) };
}
/** A baseline and a candidate that normalise to one URL cannot be a comparison. */
function sameUrlRefusal(input: RunFidelityInput): FidelityRunResult | null {
  const baseline = normalizedUrl(input.baselineUrl);
  if (baseline === null || baseline !== normalizedUrl(input.candidateUrl)) return null;
  return blocked(
    'DESIGN_FIDELITY_SELF_COMPARE',
    `The fidelity baseline and candidate normalise to the same URL (${redactUrl(baseline)}); ` +
      'a page compared with itself always scores 100. Pass the base-revision render as the ' +
      'baseline or record it in the baseline store.'
  );
}
/** Validate the threshold, self-compare, trust boundary, engine and reachability before a spawn. */
async function planFidelity(input: RunFidelityInput): Promise<Planned> {
  const min = input.min ?? FIDELITY_MIN_DEFAULT;
  if (!isValidFidelityMin(min)) {
    return refuse(
      'DESIGN_FIDELITY_NO_EVIDENCE',
      `fidelity --min must be an integer ${String(MIN_SCORE)}..${String(MAX_SCORE)}; refusing ` +
        `${String(min)} because designlang treats a non-numeric --min as no threshold.`
    );
  }
  const selfCompare = sameUrlRefusal(input);
  if (selfCompare !== null) return { ok: false, result: selfCompare };
  const deps = input.deps ?? buildFidelityDeps(input.appRoot);
  const untrusted = [input.baselineUrl, input.candidateUrl].find((url) => !deps.isTrusted(url));
  if (untrusted !== undefined) {
    return refuse(
      'DESIGN_URL_UNTRUSTED',
      `Refusing untrusted fidelity URL ${redactUrl(untrusted)}: use a loopback host or record it ` +
        'as render.url.'
    );
  }
  const entryPath = deps.availability.entryPath;
  if (!deps.availability.available || entryPath === null) {
    const codes = deps.availability.codes.join(', ') || 'DESIGN_ENGINE_UNAVAILABLE';
    return refuse(
      'DESIGN_ENGINE_UNAVAILABLE',
      `designlang is unavailable (${codes}); the fidelity comparison cannot run.`
    );
  }
  const unreachable = await requireHttp200(deps, [input.baselineUrl, input.candidateUrl]);
  if (unreachable !== null) return { ok: false, result: unreachable };
  return { ok: true, plan: { entryPath, deps, min } };
}

/** Spawn the engine and read its report; the artifact decides, never the exit code. */
async function runPlanned(input: RunFidelityInput, plan: FidelityPlan): Promise<FidelityRunResult> {
  const outDir = fidelityOutDir(input.projectRoot, input.sessionId);
  if (outDir === null) {
    return blocked(
      'DESIGN_FIDELITY_NO_EVIDENCE',
      `Invalid session id ${input.sessionId}: the fidelity output must stay inside one runtime dir.`
    );
  }
  await mkdir(outDir, { recursive: true });
  const result = await plan.deps.run({
    entryPath: plan.entryPath,
    args: buildFidelityArgs({
      baselineUrl: input.baselineUrl,
      candidateUrl: input.candidateUrl,
      min: plan.min,
      outDir,
      systemChrome: plan.deps.availability.browserKind === 'system-chrome'
    }),
    timeoutMs: input.timeoutMs ?? FIDELITY_TIMEOUT_MS,
    outDir
  });
  const reportPath = join(outDir, REPORT_FILE);
  const read = await readFidelityReport(reportPath);
  if (read.ok) return { ok: true, ...read.report, reportPath };
  const timeout = result.timedOut ? ', timed out' : '';
  const stderr = result.stderr.trim();
  const tail = stderr === '' ? '' : `: ${stderr.slice(-STDERR_TAIL)}`;
  return blocked(
    'DESIGN_FIDELITY_NO_EVIDENCE',
    `designlang fidelity exited ${String(result.exitCode)}${timeout} without a usable report ` +
      `(${read.detail})${tail}`
  );
}

/**
 * Run one fidelity comparison and return the score it recorded.
 *
 * The threshold is applied by the caller; this function never turns a missing
 * report into a score, and never trusts an exit code on its own.
 */
export async function runFidelity(input: RunFidelityInput): Promise<FidelityRunResult> {
  const planned = await planFidelity(input);
  if (!planned.ok) return planned.result;
  return runPlanned(input, planned.plan);
}
