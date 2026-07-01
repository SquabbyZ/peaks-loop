/**
 * Static audit service — `peaks audit static`.
 *
 * Slice #6 L2.3 P2-a: soft-optional ECC AgentShield integration.
 *
 * Per spec §5.3, the audit framework integrates with ECC AgentShield
 * (102 lint rules) on a soft-optional basis. When ECC is installed
 * AND `agentShieldEnabled: true`, the audit subprocess spawns the
 * ECC scanner and merges its findings; when either is missing, the
 * audit completes with peaks-loop-only findings.
 *
 * The subprocess is **observability enhancement**, not a structural
 * gate — every soft-fail path returns a well-formed audit report.
 */

import { spawnSync } from 'node:child_process';
import { runRedLinesAudit } from './red-lines-service.js';
import { loadPreferences } from '../preferences/preferences-service.js';
import { computeProseRatio, type ProseRatioResult } from './prose-ratio-calculator.js';
import type { EnforcerFinding, RedLineAudit } from './types.js';

export interface StaticAuditInput {
  readonly projectRoot: string;
  /** Override the preference for a single call. Default: read from preferences. */
  readonly enableAgentShield?: boolean | undefined;
  /**
   * Optional subprocess runner injection point. Used by tests
   * to mock `npx ecc-agentshield`. Production callers should
   * leave this undefined; the default uses `child_process.spawnSync`.
   */
  readonly subprocessRunner?: SubprocessRunner | undefined;
}

export interface StaticAuditResult {
  readonly audit: RedLineAudit;
  readonly agentShield: AgentShieldState;
  readonly warnings: readonly string[];
  /** v2.14.0 Slice C: prose-only ratio with informational exclusion (per A3.1). */
  readonly proseRatio: ProseRatioResult;
}

export interface AgentShieldState {
  /** Whether the agent-shield subprocess was spawned. */
  readonly spawned: boolean;
  /** Whether ECC AgentShield is installed (regardless of whether it was spawned). */
  readonly installed: boolean;
  /** Why the subprocess was or was not spawned. */
  readonly reason:
    | 'enabled-and-installed'
    | 'disabled-by-preference'
    | 'flag-disabled'
    | 'flag-enabled-but-ecc-missing'
    | 'disabled-and-ecc-missing';
  /** The merged ECC findings (empty if not spawned). */
  readonly findings: readonly EnforcerFinding[];
}

const ECC_DETECT_TIMEOUT_MS = 5000;
const ECC_SCAN_TIMEOUT_MS = 30000;

/**
 * Subprocess runner interface — the only seam tests need to
 * mock the `npx ecc-agentshield` subprocess. Production callers
 * leave `subprocessRunner` undefined; the default delegates to
 * `child_process.spawnSync` (synchronous, captures stdout).
 */
export interface SubprocessRunner {
  run(command: string, args: readonly string[], timeoutMs: number): SubprocessResult;
}

export interface SubprocessResult {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: Error;
}

const defaultSubprocessRunner: SubprocessRunner = {
  run(command, args, timeoutMs) {
    try {
      const r = spawnSync(command, args, {
        timeout: timeoutMs,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
      });
      return {
        status: r.status,
        stdout: r.stdout ?? '',
        stderr: r.stderr ?? '',
      };
    } catch (err) {
      return {
        status: null,
        stdout: '',
        stderr: '',
        error: err as Error,
      };
    }
  },
};

function isEccInstalled(runner: SubprocessRunner): boolean {
  const result = runner.run('npx', ['ecc-agentshield', '--version'], ECC_DETECT_TIMEOUT_MS);
  if (result.error) return false;
  return result.status === 0;
}

interface EccScanOutput {
  readonly ok?: boolean;
  readonly findings?: readonly EccFinding[];
}

interface EccFinding {
  readonly ruleId?: string;
  readonly rule?: string;
  readonly severity?: 'pass' | 'warn' | 'fail';
  readonly file?: string;
  readonly detail?: string;
}

function runEccScan(projectRoot: string, runner: SubprocessRunner): readonly EnforcerFinding[] {
  try {
    // Per spec §7.2 line 828: the canonical ECC subprocess call uses
    // `--target <path>`, NOT `--project`. The peaks-loop CLI flag
    // (`peaks audit static --project <path>`) follows peaks-loop
    // convention; the inner ecc-agentshield call follows the
    // upstream ECC contract.
    const result = runner.run(
      'npx',
      ['ecc-agentshield', 'scan', '--json', '--target', projectRoot],
      ECC_SCAN_TIMEOUT_MS,
    );
    if (result.error || result.status !== 0) return [];
    const stdout = result.stdout;
    let parsed: EccScanOutput;
    try {
      parsed = JSON.parse(stdout) as EccScanOutput;
    } catch {
      return [];
    }
    if (!parsed.findings) return [];
    return parsed.findings.map((f, idx) => ({
      enforcerId: `ecc-agentshield:${f.ruleId ?? `unknown-${idx}`}`,
      rule: f.rule ?? 'ECC AgentShield rule',
      severity: f.severity ?? 'warn',
      file: f.file ?? '(unknown)',
      detail: f.detail ?? '',
    }));
  } catch {
    return [];
  }
}

export function runStaticAudit(input: StaticAuditInput): StaticAuditResult {
  // Read the project-local preferences; the CLI flag overrides.
  const prefs = loadPreferences(input.projectRoot);
  const prefEnabled = prefs.agentShieldEnabled;
  const flagEnabled = input.enableAgentShield;
  const runner = input.subprocessRunner ?? defaultSubprocessRunner;

  // Resolve the effective "should spawn" decision.
  // flagEnabled (CLI override) > preference > false
  const shouldSpawn = flagEnabled ?? prefEnabled;

  // Detect ECC.
  const installed = isEccInstalled(runner);

  const warnings: string[] = [];

  let state: AgentShieldState;
  if (!shouldSpawn) {
    // Disabled path — no subprocess, no warnings.
    const reason: AgentShieldState['reason'] = flagEnabled === false
      ? 'flag-disabled'
      : 'disabled-by-preference';
    state = { spawned: false, installed, reason, findings: [] };
  } else if (!installed) {
    // Enabled but ECC missing — soft-fail with a warning.
    warnings.push(
      'agentShieldEnabled is true but `npx ecc-agentshield --version` failed. ' +
        'Run `npx ecc-agentshield --help` to install. Audit ran with peaks-loop findings only.'
    );
    state = { spawned: false, installed: false, reason: 'flag-enabled-but-ecc-missing', findings: [] };
  } else {
    // Enabled and installed — spawn the subprocess.
    const findings = runEccScan(input.projectRoot, runner);
    state = { spawned: true, installed: true, reason: 'enabled-and-installed', findings };
  }

  // Always run the peaks-loop lint layer; merge ECC findings.
  const peaksResult = runRedLinesAudit({ projectRoot: input.projectRoot });
  const mergedAudit: RedLineAudit = {
    ...peaksResult.audit,
    enforcerFindings: [...peaksResult.audit.enforcerFindings, ...state.findings],
  };

  // v2.14.0 Slice C: compute prose-only ratio with informational
  // exclusion. Surfaced in the JSON envelope so CI can gate on it.
  const proseRatio = computeProseRatio(mergedAudit.audit);

  return {
    audit: mergedAudit,
    agentShield: state,
    warnings,
    proseRatio,
  };
}
