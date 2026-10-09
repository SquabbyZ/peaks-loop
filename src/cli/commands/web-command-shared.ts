// src/cli/commands/web-command-shared.ts
//
// What every `peaks web …` verb shares: the session binding lookup, the
// `NO_SESSION` refusal, and the two readers that coerce a daemon-supplied value
// to the shape the envelope promises. The first two were split out of
// `web-lifecycle-commands.ts`; `text` / `count` came with the `web-commands.ts`
// split, where they had a copy each in the payload and failure modules.

import { fail } from 'peaks-loop-shared/result';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';

/** A daemon-supplied value that is expected to be a string, or `''`. */
export function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** A daemon-supplied value that is expected to be a count, or `0`. */
export function count(value: unknown): number {
  return typeof value === 'number' ? value : 0;
}

/** Resolve this project's session, or report `NO_SESSION` exactly once. */
export function resolveSession(): { projectRoot: string; sessionId: string } | null {
  const projectRoot = resolveCanonicalProjectRoot(process.cwd());
  const sessionId = getCurrentSessionId(projectRoot);
  return sessionId === null ? null : { projectRoot, sessionId };
}

/** The shared `NO_SESSION` envelope for both lifecycle verbs. */
export function noSession(command: string): ReturnType<typeof fail> {
  return fail(command, 'NO_SESSION', 'No peaks session is bound to this project root', {}, [
    'Bind a session first (the LLM runs `peaks workspace init` on your behalf)'
  ]);
}
