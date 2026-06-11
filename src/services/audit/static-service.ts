/**
 * Static audit service — `peaks audit static`.
 *
 * Slice #6 L2.3 P2-a: soft-optional ECC AgentShield integration.
 *
 * Per spec §5.3, the audit framework integrates with ECC AgentShield
 * (102 lint rules) on a soft-optional basis. When ECC is installed
 * AND `agentShieldEnabled: true`, the audit subprocess spawns the
 * ECC scanner and merges its findings; when either is missing, the
 * audit completes with peaks-cli-only findings.
 *
 * The subprocess is **observability enhancement**, not a structural
 * gate — every soft-fail path returns a well-formed audit report.
 */

import { spawnSync } from 'node:child_process';
import { runRedLinesAudit } from './red-lines-service.js';
import { loadPreferences } from '../preferences/preferences-service.js';
import type { EnforcerFinding, RedLineAudit } from './types.js';

export interface StaticAuditInput {
  readonly projectRoot: string;
  /** Override the preference for a single call. Default: read from preferences. */
  readonly enableAgentShield?: boolean | undefined;
}

export interface StaticAuditResult {
  readonly audit: RedLineAudit;
  readonly agentShield: AgentShieldState;
  readonly warnings: readonly string[];
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

function isEccInstalled(): boolean {
  try {
    const result = spawnSync('npx', ['ecc-agentshield', '--version'], {
      timeout: ECC_DETECT_TIMEOUT_MS,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
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

function runEccScan(projectRoot: string): readonly EnforcerFinding[] {
  try {
    const result = spawnSync(
      'npx',
      ['ecc-agentshield', 'scan', '--json', '--project', projectRoot],
      {
        timeout: ECC_SCAN_TIMEOUT_MS,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 16 * 1024 * 1024,
      }
    );
    if (result.status !== 0) return [];
    const stdout = result.stdout ?? '';
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

  // Resolve the effective "should spawn" decision.
  // flagEnabled (CLI override) > preference > false
  const shouldSpawn = flagEnabled ?? prefEnabled;

  // Detect ECC.
  const installed = isEccInstalled();

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
        'Run `npx ecc-agentshield --help` to install. Audit ran with peaks-cli findings only.'
    );
    state = { spawned: false, installed: false, reason: 'flag-enabled-but-ecc-missing', findings: [] };
  } else {
    // Enabled and installed — spawn the subprocess.
    const findings = runEccScan(input.projectRoot);
    state = { spawned: true, installed: true, reason: 'enabled-and-installed', findings };
  }

  // Always run the peaks-cli lint layer; merge ECC findings.
  const peaksResult = runRedLinesAudit({ projectRoot: input.projectRoot });
  const mergedAudit: RedLineAudit = {
    ...peaksResult.audit,
    enforcerFindings: [...peaksResult.audit.enforcerFindings, ...state.findings],
  };

  return {
    audit: mergedAudit,
    agentShield: state,
    warnings,
  };
}
