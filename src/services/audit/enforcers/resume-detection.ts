/**
 * resume-detection enforcer (L2.2 P1) — verifies a slice can be resumed
 * before the LLM continues work on it.
 *
 * Two red lines:
 *   - rl-resume-detection-001: session-binding file must exist
 *   - rl-resume-detection-002: existing rd request state must be in
 *     {spec-locked, implemented, qa-handoff} (resumable states)
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ResumeDetectionInput {
  readonly projectRoot: string;
  readonly sessionId: string;
}

export interface ResumeDetectionResult {
  readonly sessionBindingExists: boolean;
  readonly sessionBindingPath: string;
  readonly requestState: string | null;
  readonly requestStatePath: string;
  readonly canResume: boolean;
}

const RESUMABLE_STATES: ReadonlySet<string> = new Set(['spec-locked', 'implemented', 'qa-handoff']);

export function checkResume(input: ResumeDetectionInput): ResumeDetectionResult {
  const sessionBindingPath = join(input.projectRoot, '.peaks/_runtime', input.sessionId, 'session.json');
  const sessionBindingExists = existsSync(sessionBindingPath);

  // The rd request artifact lives under .peaks/_runtime/<sid>/rd/requests/<rid>.md
  // (canonical session layout per `src-services-session-canonical-workspace-resolver.md`).
  // We look at the most-recent rd request to detect state. The full request-artifact
  // service is the authoritative source; this is a lightweight check for the audit
  // scanner.
  const rdDir = join(input.projectRoot, '.peaks/_runtime', input.sessionId, 'rd/requests');
  let requestState: string | null = null;
  let requestStatePath = '';
  if (existsSync(rdDir)) {
    try {
      const files = require('node:fs').readdirSync(rdDir) as string[];
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const path = join(rdDir, file);
        const content = readFileSync(path, 'utf8');
        const match = /state:\s*([a-z0-9-]+)/i.exec(content);
        if (match !== null) {
          requestState = match[1] ?? null;
          requestStatePath = path;
          break;
        }
      }
    } catch {
      // ignore read errors
    }
  }

  const canResume = sessionBindingExists && requestState !== null && RESUMABLE_STATES.has(requestState);

  return {
    sessionBindingExists,
    sessionBindingPath,
    requestState,
    requestStatePath,
    canResume,
  };
}
