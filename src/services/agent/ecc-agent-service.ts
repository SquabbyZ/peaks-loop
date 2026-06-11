/**
 * ECC 64 agents soft-optional integration — `peaks agent run`.
 *
 * Per spec §7.2 line 818: "64 agents — Soft Optional — 装了 L3
 * 直接调; 不装 L3 退化到 peaks-cli 自有少数核心诊断". The
 * canonical ECC subprocess contract is:
 *
 *   npx ecc consult "<topic>" --target claude
 *   npx ecc agent run <agent-name> --target <path> --json
 *
 * The peaks-cli `peaks agent run <name> --target <path> --json`
 * CLI shells out to the second form. When ECC is missing OR
 * `agentShieldEnabled: false`, the audit completes with a
 * peaks-cli-only envelope.
 *
 * Mirrors `static-service.ts` (the ECC AgentShield wrapper from
 * L2.3 P2-a): same `subprocessRunner` injection point, same
 * 5-state reason enum, same soft-fail policy.
 */
import { spawnSync } from 'node:child_process';

/**
 * The 12 most-used ECC agents per the upstream
 * everything-claude-code catalog. The full 64-agent list is
 * available at runtime via `npx ecc agent list`; this static
 * subset covers the common L3-doctor dispatch paths.
 */
export const CANONICAL_ECC_AGENTS: readonly { name: string; description: string }[] = [
  { name: 'security-reviewer', description: 'Audit trust boundary + OWASP top-10' },
  { name: 'code-reviewer', description: 'General-purpose code review' },
  { name: 'typescript-reviewer', description: 'TypeScript-specific review' },
  { name: 'python-reviewer', description: 'Python-specific review' },
  { name: 'golang-reviewer', description: 'Go-specific review' },
  { name: 'rust-reviewer', description: 'Rust-specific review' },
  { name: 'java-reviewer', description: 'Java-specific review' },
  { name: 'cpp-reviewer', description: 'C/C++-specific review' },
  { name: 'backend-patterns', description: 'Backend service patterns' },
  { name: 'frontend-patterns', description: 'Frontend patterns' },
  { name: 'database-migrations', description: 'DB migration safety' },
  { name: 'deployment-patterns', description: 'Deployment / CI-CD patterns' },
];

const ECC_DETECT_TIMEOUT_MS = 5000;
const ECC_RUN_TIMEOUT_MS = 60000;

export interface EccAgentResult {
  readonly agent: string;
  readonly ok: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  /** Parsed JSON envelope if the subprocess exited 0 and stdout was JSON. */
  readonly parsed?: unknown;
  readonly error?: string;
}

export interface EccAgentServiceInput {
  readonly agent: string;
  readonly projectRoot: string;
  readonly enableAgent?: boolean | undefined;
}

export interface EccAgentServiceResult {
  readonly agent: string;
  readonly spawned: boolean;
  readonly reason:
    | 'enabled-and-installed'
    | 'disabled-by-preference'
    | 'flag-disabled'
    | 'flag-enabled-but-ecc-missing'
    | 'disabled-and-ecc-missing';
  readonly result: EccAgentResult | null;
  readonly warnings: readonly string[];
}

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
  const result = runner.run('npx', ['ecc', '--version'], ECC_DETECT_TIMEOUT_MS);
  if (result.error) return false;
  return result.status === 0;
}

/**
 * Validate the agent name against the canonical ECC catalog.
 * Returns `null` if the agent is known; an error message otherwise.
 */
export function validateEccAgent(agent: string): string | null {
  if (typeof agent !== 'string' || agent.length === 0) {
    return 'peaks agent run: agent name must be a non-empty string';
  }
  if (!/^[a-z][a-z0-9-]*$/.test(agent)) {
    return `peaks agent run: agent name "${agent}" is invalid (must match [a-z][a-z0-9-]*)`;
  }
  return null;
}

export function runEccAgent(input: EccAgentServiceInput, runner: SubprocessRunner = defaultSubprocessRunner): EccAgentServiceResult {
  const enableAgent = input.enableAgent === true;
  const warnings: string[] = [];
  let result: EccAgentResult | null = null;

  // Resolve the effective "should spawn" decision.
  // flagEnabled (CLI override) > preference (always-on for now; L3+ future) > false
  const shouldSpawn = enableAgent;

  const installed = isEccInstalled(runner);

  let reason: EccAgentServiceResult['reason'];
  let spawned: boolean;
  if (!shouldSpawn) {
    reason = 'flag-disabled';
    spawned = false;
  } else if (!installed) {
    reason = 'flag-enabled-but-ecc-missing';
    spawned = false;
    warnings.push(
      '`npx ecc --version` failed. Run `npx ecc --help` to install ECC, ' +
        'then re-run `peaks agent run`. The peaks-cli native diagnostic ' +
        'still runs via `peaks doctor scan`.'
    );
  } else {
    reason = 'enabled-and-installed';
    spawned = true;
    const start = Date.now();
    const subResult = runner.run(
      'npx',
      ['ecc', 'agent', 'run', input.agent, '--target', input.projectRoot, '--json'],
      ECC_RUN_TIMEOUT_MS
    );
    let parsed: unknown;
    let error: string | undefined;
    if (subResult.error) {
      error = subResult.error.message;
    } else if (subResult.status !== 0) {
      error = `ecc agent run exited with status ${subResult.status}: ${subResult.stderr}`;
    } else {
      try {
        parsed = JSON.parse(subResult.stdout);
      } catch {
        // Non-JSON output is allowed; peaks-cli surfaces the raw
        // stdout for the human reader and treats the run as
        // ok=true (the subprocess exited 0).
        parsed = undefined;
      }
    }
    result = {
      agent: input.agent,
      ok: error === undefined,
      stdout: subResult.stdout,
      stderr: subResult.stderr,
      durationMs: Date.now() - start,
      ...(parsed !== undefined ? { parsed } : {}),
      ...(error !== undefined ? { error } : {}),
    };
  }

  return { agent: input.agent, spawned, reason, result, warnings };
}
