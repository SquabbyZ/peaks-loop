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
  /** The resolved driving skill, or `null` when no skill could be resolved. */
  readonly skill: string | null;
  readonly command: string;
  /** Whether a `peaks-*` lease exists in this peaks session. */
  readonly peaksLeasePresent: boolean;
  /**
   * Whether the caller's identity was resolved. When `true`, `skill === null`
   * means "this caller resolved and has no peaks skill" — which is an allow.
   * When `false`, we could not tell who is driving at all.
   */
  readonly identityResolved: boolean;
}

export interface CodeBanResult {
  readonly denied: boolean;
  readonly reason: string;
}

const DENY_REASON =
  'Code Commit Ban Red Line: peaks-* skills must go through peaks-code / peaks-rd. ' +
  'Use `peaks request transition` instead of `git commit` / `git apply` directly.';

/**
 * S0 Task 4 (Ruling 11). The ban used to be skipped wholesale when the driver
 * could not be resolved — `hook-handle.ts` guarded the evaluation with
 * `if (skill !== null)`, so a resolution failure meant no ban at all. This
 * branch closes that. It is deliberately NARROWER than plain fail-closed: it
 * fires only when a peaks skill is actually present in the session, because
 * `resolveActiveSkillForCaller` returns `null` for any unbound session — and
 * failing closed on that would block `git commit` for every ordinary session
 * in any repo with the gate installed.
 */
const UNRESOLVED_IDENTITY_REASON =
  'Code Commit Ban Red Line: a peaks skill is registered in this session, but the ' +
  'caller could not be identified, so this commit cannot be shown to come from a ' +
  'non-peaks session. Re-run from the bound session, or use ' +
  '`peaks request transition` instead of `git commit` / `git apply`.';

export function isCodeCommit(skill: string | null, command: string): boolean {
  if (skill === null || !skill.startsWith('peaks-')) return false;
  return COMMIT_APPLY_PATTERN.test(command);
}

export function evaluateCodeBan(input: CodeBanInput): CodeBanResult {
  if (isCodeCommit(input.skill, input.command)) {
    return { denied: true, reason: DENY_REASON };
  }
  if (
    input.skill === null &&
    !input.identityResolved &&
    input.peaksLeasePresent &&
    COMMIT_APPLY_PATTERN.test(input.command)
  ) {
    return { denied: true, reason: UNRESOLVED_IDENTITY_REASON };
  }
  return { denied: false, reason: '' };
}
