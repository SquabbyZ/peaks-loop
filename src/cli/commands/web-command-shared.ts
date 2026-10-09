// src/cli/commands/web-command-shared.ts
//
// What every `peaks web status|stop|install|login` verb shares: the session
// binding lookup and the `NO_SESSION` refusal. Split out of
// `web-lifecycle-commands.ts`; both are unchanged.

import { fail } from 'peaks-loop-shared/result';
import { resolveCanonicalProjectRoot } from '../../services/config/config-service.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';

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
