/**
 * The cross-session presence read.
 *
 * WHAT IT SOLVES. The canonical presence read used to look at ONE session
 * tree — the tree the caller is bound to — and answered "inactive"
 * whenever that tree had no in-flight lease. A peaks run whose lease
 * landed in a different tree was therefore invisible: `peaks skill
 * presence --json` reported `{"active": false}` while a live lease sat on
 * disk. The caller-id resolution failing (an IDE adapter that claims a
 * harness the host runtime is not) made that the NORMAL case, not the
 * corner case.
 *
 * WHAT IT DOES. It enumerates every session tree of the project, marks
 * the bound tree against the others, and hands the candidate set to the
 * pure selection rules in `presence-lease-selection.ts`.
 *
 * WHY IT IS ITS OWN MODULE. `skill-presence-service.ts` was already over
 * the repository's 300-raw-line cap, and that cap is a ratchet: a file
 * over it may be touched, but never grown. The read half moved here.
 */

import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { findProjectRoot } from '../config/config-safety.js';
import { getSessionId } from '../session/session-manager.js';
import { listPresenceLeases } from './presence-lease-service.js';
import {
  explainInactivePresence,
  selectActivePresenceLease,
  type PresenceInactiveDiagnostic,
  type PresenceLeaseCandidate,
  type PresenceLeaseScope,
  type PresenceLeaseSelection
} from './presence-lease-selection.js';

/**
 * The project root the presence read runs against: the caller's override
 * when it gave one, otherwise the project the cwd belongs to.
 */
export function resolveProjectRoot(override?: string): string {
  if (override) return resolve(override);
  return findProjectRoot(process.cwd()) ?? process.cwd();
}

/**
 * The session tree this caller is bound to, or `null` when nothing is
 * bound. Never throws: an unresolvable caller id must not blind the
 * presence read.
 */
export function resolveBoundSessionId(projectRoot: string): string | null {
  let sessionId: string | null = null;
  try {
    sessionId = getSessionId(projectRoot);
  } catch {
    // The caller id could not be resolved. That must NOT blind the
    // presence read: the cross-session fallback works without a bound
    // tree, so the read continues with no bound tree.
    sessionId = null;
  }
  return sessionId;
}

/**
 * Every presence lease of the project, from every session tree.
 *
 * The session trees are enumerated from the RUNTIME ROOT, not through
 * `listSessions`: that helper only recognises the dated-hex session id
 * shape (`2026-10-23-session-5e40e0`), so a tree whose id has any other
 * shape would be invisible to the presence read. What actually matters
 * here is "a directory under `.peaks/_runtime/` that holds a `leases/`
 * directory" — the directories without one (`callers`, `change`,
 * `_audit`) contribute nothing.
 *
 * The `scope` marks the tree the caller is bound to (`bound`) against
 * every other tree (`other`) — the bound tree keeps its precedence when
 * it holds an eligible lease.
 */
export function collectPresenceLeaseCandidates(
  projectRoot: string,
  boundSessionId: string | null
): PresenceLeaseCandidate[] {
  const candidates: PresenceLeaseCandidate[] = [];
  const runtimeRoot = join(projectRoot, '.peaks', '_runtime');
  let entries: string[] = [];
  try {
    entries = readdirSync(runtimeRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    // A project with no runtime root has no session trees, and one that
    // cannot be read has none this read can see. Either way the honest
    // answer is "no leases", not an exception.
    entries = [];
  }
  for (const sessionId of entries) {
    const scope: PresenceLeaseScope = sessionId === boundSessionId ? 'bound' : 'other';
    for (const lease of listPresenceLeases(projectRoot, sessionId)) {
      candidates.push({ lease, sessionId, scope });
    }
  }
  return candidates;
}

/**
 * The lease that represents "who is driving peaks right now", across
 * EVERY session tree of the project.
 *
 * The bound tree keeps its precedence: when it holds an eligible lease,
 * only its own leases are considered. When it holds none — the caller id
 * could not be resolved, the binding points at a tree without leases,
 * the session rotated — the other trees' leases are considered instead.
 */
export function resolvePresenceLease(projectRoot: string): PresenceLeaseSelection | null {
  const boundSessionId = resolveBoundSessionId(projectRoot);
  const candidates = collectPresenceLeaseCandidates(projectRoot, boundSessionId);
  return selectActivePresenceLease(candidates, Date.now());
}

/**
 * Why the read found nothing active — the diagnostic behind
 * `peaks skill presence --json --check-stale` on the inactive path.
 */
export function diagnosePresence(projectRoot: string): PresenceInactiveDiagnostic {
  const boundSessionId = resolveBoundSessionId(projectRoot);
  const candidates = collectPresenceLeaseCandidates(projectRoot, boundSessionId);
  return explainInactivePresence(candidates, Date.now());
}
