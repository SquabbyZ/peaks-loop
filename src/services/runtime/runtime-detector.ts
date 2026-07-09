/**
 * Runtime detector — slice S2-a of RD-2.
 *
 * Given the current process environment, decide which vendor (if any)
 * is the active AI runtime. Detection order matters: Claude Code is
 * checked first because it is the default runtime for peaks-loop
 * (the project literally runs inside Claude Code). Codex + Copilot
 * are checked second; if none match we report `unknown`.
 *
 * Detectors MUST be cheap (no process spawn, no network). They look
 * at env vars + filesystem sentinels + home-dir shapes only. This
 * keeps `peaks runtime detect` sub-100ms even on cold paths.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type DetectedVendor = 'claude-code' | 'codex' | 'copilot' | 'unknown';

export interface RuntimeDetectorOptions {
  /** Override for env (used by tests). */
  readonly env?: NodeJS.ProcessEnv;
  /** Override for home directory (used by tests). */
  readonly home?: string;
}

export interface DetectionResult {
  readonly vendor: DetectedVendor;
  /** Why this vendor was chosen — useful for diagnostics and tests. */
  readonly reason: string;
}

/** Heuristic: Claude Code sets CLAUDE_CODE_ENTRYPOINT or has a
 *  .claude/skills directory under HOME (peaks-loop installs there). */
function detectClaudeCode(opts: RuntimeDetectorOptions): boolean {
  const env = opts.env ?? process.env;
  if (env.CLAUDE_CODE === '1' || env.CLAUDE_CODE === 'true') return true;
  if (env.CLAUDE_CODE_ENTRYPOINT !== undefined && env.CLAUDE_CODE_ENTRYPOINT.length > 0) return true;
  const home = opts.home ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (home.length > 0 && existsSync(join(home, '.claude'))) return true;
  return false;
}

/** Heuristic: Codex sets CODEX_HOME or has a .codex dir under HOME. */
function detectCodex(opts: RuntimeDetectorOptions): boolean {
  const env = opts.env ?? process.env;
  if (env.CODEX_HOME !== undefined && env.CODEX_HOME.length > 0) return true;
  const home = opts.home ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (home.length > 0 && existsSync(join(home, '.codex'))) return true;
  return false;
}

/** Heuristic: Copilot sets GITHUB_COPILOT or has a .copilot dir. */
function detectCopilot(opts: RuntimeDetectorOptions): boolean {
  const env = opts.env ?? process.env;
  if (env.GITHUB_COPILOT === '1' || env.GITHUB_COPILOT === 'true') return true;
  const home = opts.home ?? process.env.HOME ?? process.env.USERPROFILE ?? '';
  if (home.length > 0 && existsSync(join(home, '.copilot'))) return true;
  return false;
}

/** Detect the active vendor. Order: claude-code → codex → copilot →
 *  unknown. The first match wins. */
export function detectRuntime(opts: RuntimeDetectorOptions = {}): DetectionResult {
  if (detectClaudeCode(opts)) {
    return { vendor: 'claude-code', reason: 'CLAUDE_CODE_ENTRYPOINT / CLAUDE_CODE / ~/.claude matched' };
  }
  if (detectCodex(opts)) {
    return { vendor: 'codex', reason: 'CODEX_HOME / ~/.codex matched' };
  }
  if (detectCopilot(opts)) {
    return { vendor: 'copilot', reason: 'GITHUB_COPILOT / ~/.copilot matched' };
  }
  return { vendor: 'unknown', reason: 'no vendor sentinel detected' };
}