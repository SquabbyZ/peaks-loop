/**
 * The denial text the worktree-authorization gate prints when no live user
 * grant covers the operation.
 *
 * WHY ITS OWN MODULE. `worktree-authorization-gate.ts` is 701 lines against a
 * 300-line cap and already carries a baseline row, so it may only shrink. The
 * five refusal texts it used to build inline move here and the gate calls
 * these builders — the extract-don't-append move this repository makes instead
 * of growing an over-cap file.
 *
 * WHY THE TEXT ASKS THE READER TO GO TO THE USER. The gate is a `PreToolUse`
 * hook, so its reader is the agent, and the AGENT IS THE PARTY THE PROJECT'S
 * RULE AIMS AT: the authorization this gate consumes is the user's to give. The
 * gate cannot enforce that distinction — see the next paragraph, which is the
 * part an earlier revision of this file got wrong — so the text asks rather
 * than claims, and the denial that told its own reader to run a command it was
 * told it must not run is the defect this function replaces.
 *
 * WHAT THE GATE ACTUALLY CHECKS — AND WHAT IT DOES NOT. A grant recorded for
 * the operation in this session. Nothing else: the gate has no issuer concept,
 * so it cannot and does not discriminate on who wrote the grant. Measured
 * 2026-10-13, end to end, in a scratch project: `git stash drop stash@{0}` is
 * refused (exit 2); the agent then runs
 * `peaks worktree auth grant --operation git-stash-mutating --reason "the agent
 * wrote this itself; no user was involved"` and gets `ok: true`; the SAME call
 * then exits 0 and is allowed. The grant stays operation-scoped (`git worktree
 * add` against the same project is still refused), so the gate does gate — it
 * just cannot tell consent from self-authorization.
 *
 * WHY THIS MATTERS FOR THE TEXT. An earlier revision of this function said "an
 * agent-issued grant is not the consent this gate checks for, so the reader
 * cannot satisfy this refusal itself". That is exactly the defect the function
 * exists to avoid: a message asserting a guarantee the code does not implement,
 * which this module's own header above already falsifies. The text below says
 * what the measurement shows — the gate needs a recorded grant, and nothing
 * distinguishes who issued it — and keeps the ask, because the authorization is
 * the user's to give even though the gate cannot enforce that.
 *
 * `operation` is a plain `string`, not the gate's `OperationType`: the text
 * only interpolates the value, and importing that type back would make the two
 * modules mutually importing. `as const` on `code` and `allow` keeps each
 * returned literal narrow enough to be the gate's deny variant without the
 * import.
 */

/**
 * The remedy paragraph every denial ends with, with the operation baked in.
 *
 * Four facts, in the order a reader needs them: what the gate requires, what it
 * does not check, whose authorization the rule is, and how to record it.
 */
function userSideGrant(operation: string): string {
  return [
    `The gate requires one thing: a grant recorded for the "${operation}" operation in this session's \`.peaks/_runtime/<sessionId>/worktree-auth.json\`.`,
    'Nothing in the gate records or checks WHO issued a grant, so a grant the reader writes itself is accepted — the requirement is a recorded grant, not a verified issuer.',
    "The authorization is the USER's to give: ask them first, then record it with",
    `  peaks worktree auth grant --operation ${operation} --reason "<the words they used>"`,
    '(`--ttl <ms>` and `--multi` are accepted.) A grant with no user behind it satisfies this gate; it does not satisfy the rule the gate exists for, which is why the ask comes first.'
  ].join('\n');
}

export function noAuthorizationDenial(operation: string, sessionId: string) {
  return {
    allow: false as const,
    code: 'WORKTREE_USER_AUTH_REQUIRED' as const,
    reason: `No current-task user authorization for "${operation}" (session=${sessionId}).`,
    remediation: userSideGrant(operation)
  };
}

export function noGrantForOperationDenial(operation: string) {
  return {
    allow: false as const,
    code: 'WORKTREE_USER_AUTH_REQUIRED' as const,
    reason: `No grant for operation "${operation}" in this session.`,
    remediation: userSideGrant(operation)
  };
}

export function requestMismatchDenial(
  operation: string,
  grantRequestId: string | null,
  currentRequestId: string | null
) {
  return {
    allow: false as const,
    code: 'WORKTREE_USER_AUTH_REQUEST_MISMATCH' as const,
    reason:
      `Grant for "${operation}" is scoped to requestId=${grantRequestId} but the current tool ` +
      `call carries requestId=${currentRequestId}.`,
    remediation:
      `Operate under the request the grant is scoped to (requestId=${grantRequestId}), or have ` +
      `the user re-issue the grant unscoped. ${userSideGrant(operation)}`
  };
}

export function expiredGrantsDenial(operation: string) {
  return {
    allow: false as const,
    code: 'WORKTREE_USER_AUTH_EXPIRED' as const,
    reason: `All grants for operation "${operation}" in this session have expired.`,
    remediation: `${userSideGrant(operation)} (The previous grant expired; the default TTL is 5 minutes.)`
  };
}

export function consumedGrantsDenial(operation: string) {
  return {
    allow: false as const,
    code: 'WORKTREE_USER_AUTH_REQUIRED' as const,
    reason: `All unexpired grants for operation "${operation}" in this session are already consumed.`,
    remediation:
      `${userSideGrant(operation)} (The previous grant was single-use and already consumed; a ` +
      `multi-use grant is possible but should be rare.)`
  };
}
