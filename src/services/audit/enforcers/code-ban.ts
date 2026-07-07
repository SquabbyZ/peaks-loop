/**
 * Code-commit-ban enforcer — PreToolUse Bash guard.
 *
 * Per L2 redesign §5.4. Deny `git commit` or `git apply` invocations from
 * a peaks-* skill. The Code Commit Ban Red Line says peaks-code / peaks-rd
 * are orchestrators, not implementers; the actual `git commit` step must
 * go through `peaks request transition`, which itself enforces spec-locked
 * + tech-doc-presence.
 *
 * Trust red line (per `gate-enforcement-hook.md`): if the registry or
 * manifest read fails, the hook must fail-OPEN (warn + allow). The LLM is
 * never bricked by a peaks bug.
 */

const COMMIT_APPLY_PATTERN = /^\s*git\s+(commit|apply)\b/;

export interface CodeBanInput {
  readonly skill: string;
  readonly command: string;
}

export interface CodeBanResult {
  readonly denied: boolean;
  readonly reason: string;
}

const DENY_REASON =
  'Code Commit Ban Red Line: peaks-* skills must go through peaks-code / peaks-rd. ' +
  'Use `peaks request transition` instead of `git commit` / `git apply` directly.';

export function isCodeCommit(skill: string, command: string): boolean {
  if (!skill.startsWith('peaks-')) return false;
  return COMMIT_APPLY_PATTERN.test(command);
}

export function evaluateCodeBan(input: CodeBanInput): CodeBanResult {
  if (isCodeCommit(input.skill, input.command)) {
    return { denied: true, reason: DENY_REASON };
  }
  return { denied: false, reason: '' };
}