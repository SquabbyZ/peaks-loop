/**
 * state-root — the one place this package composes a path from a project root.
 *
 * Every other entry takes an already-resolved `stateRoot`, so a host with a
 * different layout (an app-data directory, a temp tree, another repository's
 * convention) passes its own and this package never has to guess. Only
 * `defaultStateRoot` names the peaks-loop layout.
 *
 * Paths are emitted with forward slashes so a Windows host and a POSIX host
 * produce the same string for the same directory. The lease store joins through
 * the same normalization, so reads and writes always agree.
 */

import { posix as path } from 'node:path';

/** A caller-supplied state root plus the one session segment beneath it. */
export interface SessionScope {
  readonly stateRoot: string;
  readonly sessionId: string;
}

/**
 * The peaks-loop layout: the project root followed by the runtime directory.
 * This is the only function in the package that knows that layout; a host that
 * stores its runtime state elsewhere never calls it.
 */
export function defaultStateRoot(projectRoot: string): string {
  return `${projectRoot.replace(/[\\/]+$/, '')}/.peaks/_runtime`;
}

/**
 * `<stateRoot>/<sessionId>`. Throws when `sessionId` is not a single path
 * segment, because it is the last caller-supplied segment of every
 * session-scoped path this package produces.
 */
export function sessionRuntimeDir({ stateRoot, sessionId }: SessionScope): string {
  if (!isSinglePathSegment(sessionId)) {
    throw new Error(`Invalid session id: ${sessionId} (must be a single path segment)`);
  }
  return path.join(normalizePath(stateRoot), sessionId);
}

export function isSinglePathSegment(sessionId: string): boolean {
  if (sessionId.length === 0) return false;
  if (sessionId === '.' || sessionId === '..') return false;
  if (sessionId.includes('/') || sessionId.includes('\\')) return false;
  if (sessionId.includes('\0')) return false;
  return true;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}
