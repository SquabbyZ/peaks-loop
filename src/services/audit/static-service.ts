/**
 * Static audit service — `peaks audit static`.
 *
 * Slice 3 of 4.0.0-beta.10 dropped the ECC AgentShield subprocess
 * integration entirely. The pre-Slice-3 implementation probed
 * `npx ecc-agentshield --version` and shelled out to
 * `npx ecc-agentshield scan --json --target <path>` on every audit
 * call, but the upstream `affaan-m/everything-claude-code` v2.0.0
 * release ships no `ecc-agentshield` binary — the repo is
 * `agents/*.md` flat files plus SKILL.md descriptors.
 *
 * The new contract: `peaks audit static` runs the peaks-loop lint
 * layer only. There is no subprocess probe, no `installed` flag,
 * no agent-shield reason code. The `agentShield` field is preserved
 * on the result type as a frozen "always disabled" stub so any
 * downstream consumer keeps compiling, but the merged findings list
 * is always the peaks-loop findings list (no ECC findings).
 *
 * The subprocess-runner seam (`SubprocessRunner`, `defaultSubprocessRunner`)
 * is preserved as an EXPORTED TYPE so legacy tests can still
 * mock it; the runner itself is never invoked from production code.
 */

import { runRedLinesAudit } from './red-lines-service.js';
import { loadPreferences } from '../preferences/preferences-service.js';
import { computeProseRatio, type ProseRatioResult } from './prose-ratio-calculator.js';
import type { EnforcerFinding, RedLineAudit } from './types.js';

export interface StaticAuditInput {
  readonly projectRoot: string;
  /** Slice 3: retained for backward-compat; no longer wired. */
  readonly enableAgentShield?: boolean | undefined;
  /** Slice 3: retained as a type seam; never invoked in production. */
  readonly subprocessRunner?: SubprocessRunner | undefined;
}

export interface StaticAuditResult {
  readonly audit: RedLineAudit;
  readonly agentShield: AgentShieldState;
  readonly warnings: readonly string[];
  readonly proseRatio: ProseRatioResult;
}

/**
 * Frozen stub. Slice 3 collapsed the agent-shield reason set to a
 * single value (`'disabled-and-ecc-missing'`) because the
 * subprocess integration was removed; we preserve the other
 * reason literals as TYPE-LEVEL members so any test or
 * downstream consumer that pattern-matches on `'flag-enabled-but-ecc-missing'`
 * keeps type-checking, but the runtime value is always the
 * single collapsed state.
 */
export interface AgentShieldState {
  readonly spawned: false;
  readonly installed: false;
  readonly reason:
    | 'enabled-and-installed'
    | 'disabled-by-preference'
    | 'flag-disabled'
    | 'flag-enabled-but-ecc-missing'
    | 'disabled-and-ecc-missing';
  readonly findings: readonly EnforcerFinding[];
}

/**
 * Subprocess runner interface — preserved as a TYPE for legacy
 * test code. Production no longer invokes it; the audit always
 * runs peaks-loop-only findings.
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

export function runStaticAudit(input: StaticAuditInput): StaticAuditResult {
  // Slice 3: agent-shield integration removed. The CLI flag and
  // preference are still read for backward-compat (a user with a
  // stale preferences.json that sets `agentShieldEnabled: true`
  // does not get a hard error) but neither spawns a subprocess.
  loadPreferences(input.projectRoot);

  // Always run the peaks-loop lint layer; no ECC findings merged.
  const peaksResult = runRedLinesAudit({ projectRoot: input.projectRoot });
  const mergedAudit: RedLineAudit = {
    ...peaksResult.audit,
    enforcerFindings: [...peaksResult.audit.enforcerFindings],
  };

  const state: AgentShieldState = {
    spawned: false,
    installed: false,
    reason: 'disabled-and-ecc-missing',
    findings: [],
  };

  const proseRatio = computeProseRatio(mergedAudit.audit);

  return {
    audit: mergedAudit,
    agentShield: state,
    warnings: [],
    proseRatio,
  };
}
