/**
 * login-gate enforcer (L2.2 P1) — verifies destructive / auth-required
 * paths require explicit user confirmation.
 *
 * Two red lines:
 *   - rl-login-gate-001: destructive paths (uninstall, drop, force-push) must
 *     require user confirmation
 *   - rl-login-gate-002: protected paths (auth-required) must check session
 *
 * This is a static-check enforcer: the actual runtime gate is in
 * `peaks mode-enforcement` (the requireUserConfirmation function). The
 * catalog entry points to this file; the audit flags it as cli-backed
 * when the integration is wired (L2.2 ships the wiring).
 */

const DESTRUCTIVE_PATH_PATTERNS: readonly RegExp[] = [
  /uninstall/i,
  /\bdrop\b/i,
  /force-push/i,
  /--force\b/,
  /--hard\b/,
  /rm\s+-rf?\b/,
];

const PROTECTED_PATH_PATTERNS: readonly RegExp[] = [
  /auth/i,
  /login/i,
  /session/i,
];

export interface LoginGateInput {
  readonly command: string;
}

export interface LoginGateResult {
  readonly destructive: boolean;
  readonly protected: boolean;
  readonly matchedPattern: string | null;
}

export function checkLoginGate(input: LoginGateInput): LoginGateResult {
  for (const pattern of DESTRUCTIVE_PATH_PATTERNS) {
    if (pattern.test(input.command)) {
      return { destructive: true, protected: false, matchedPattern: pattern.source };
    }
  }
  for (const pattern of PROTECTED_PATH_PATTERNS) {
    if (pattern.test(input.command)) {
      return { destructive: false, protected: true, matchedPattern: pattern.source };
    }
  }
  return { destructive: false, protected: false, matchedPattern: null };
}
