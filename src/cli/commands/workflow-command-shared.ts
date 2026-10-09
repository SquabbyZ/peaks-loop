// src/cli/commands/workflow-command-shared.ts
//
// What every `peaks workflow *` lifecycle verb shares: the option vocabulary,
// the caller/project/session derivation and the generated-id radix. Split out of
// `workflow-lifecycle-commands.ts`; the derivation tiers, the literal
// `unknown-sid` and every option name are unchanged.

import { getErrorMessage, fail } from 'peaks-loop-shared/result';
import { resolveCallerId } from '../../services/session/resolve-caller-id.js';
import { findProjectRoot } from '../../services/config/config-safety.js';
import { getCurrentSessionId } from '../../services/skills/skill-presence-service.js';

export interface WorkflowInitOptions {
  readonly skill?: string;
  readonly parentWorkflow?: string;
  readonly workflowId?: string;
  readonly project?: string;
  readonly sessionId?: string;
  readonly json?: boolean;
}

export interface WorkflowGraphShowOptions {
  readonly workflow?: string;
  readonly project?: string;
  readonly sessionId?: string;
  readonly json?: boolean;
}

export interface WorkflowGraphListOptions {
  readonly project?: string;
  readonly sessionId?: string;
  readonly json?: boolean;
}

export interface WorkflowNodePrepareOptions {
  readonly workflow?: string;
  readonly node?: string;
  readonly kind?: string;
  readonly label?: string;
  readonly dependsOn?: string;
  readonly project?: string;
  readonly sessionId?: string;
  readonly json?: boolean;
}

export interface WorkflowNodeAckOptions {
  readonly workflow?: string;
  readonly node?: string;
  readonly project?: string;
  readonly sessionId?: string;
  readonly json?: boolean;
}

export interface WorkflowNodeMarkLostOptions {
  readonly workflow?: string;
  readonly node?: string;
  readonly reason?: string;
  readonly project?: string;
  readonly sessionId?: string;
  readonly json?: boolean;
}

export interface WorkflowTerminalizeOptions {
  readonly workflow?: string;
  readonly reason?: string;
  readonly project?: string;
  readonly sessionId?: string;
  readonly requireConsumed?: boolean;
  readonly json?: boolean;
}

/**
 * Base 36, so a `Date.now()` suffix stays short enough to read in a transcript.
 * Named rather than inlined because two verbs generate ids this way.
 */
export const GENERATED_ID_RADIX = 36;

export function deriveCallerId(): string {
  try {
    return resolveCallerId({});
  } catch (err) {
    // The thrown value is the `fail` envelope, not an `Error`: the callers'
    // catch reads `.code` off it. Left as-is — changing the thrown type would
    // change the envelope those callers render.
    throw fail(
      'workflow.init',
      'PEAKS_CALLER_NOT_RESOLVED',
      getErrorMessage(err),
      { callerId: null } as never,
      ['Resolve the IDE session identity before running workflow commands.']
    );
  }
}

export function deriveProjectRoot(options: { project?: string }): string {
  return options.project ?? process.cwd();
}

/**
 * The literal that means "no session could be resolved". Kept as a named
 * constant because three call sites now have to ASK whether resolution
 * failed rather than consume the value as if it were an id.
 */
export const UNKNOWN_SESSION_ID = 'unknown-sid';

/**
 * Resolve the session id for every `workflow *` command.
 *
 * Tier order (matches the idiom every other command family in this CLI
 * already uses — see `job-commands.ts:85`, `container-commands.ts:138`):
 *
 *   1. `--session-id <sid>`             — explicit wins
 *   2. `PEAKS_SESSION_ID` env var       — scripted / sub-process callers
 *   3. `getCurrentSessionId(projectRoot)` — this caller's OWN binding
 *      (`callers/<callerId>.json`) falling back to the project-global
 *      `.peaks/_runtime/session.json`, the same resolver `peaks session
 *      info --active` and `peaks session checkpoint` use
 *   4. `unknown-sid`                    — nothing is bound
 *
 * Tier 3 was MISSING until 2026-09-15 (S6), and its absence is the whole
 * defect: `workflow init` resolved on tiers 1–2 only, so with no flag and no
 * env var it wrote the graph into `.peaks/_runtime/unknown-sid/graphs/`
 * regardless of what the binding file said. `peaks workflow node prepare`
 * then ran under the CORRECT session dir and reported `PEAKS_GRAPH_NOT_FOUND`
 * — the graph it was asking for had been written one bucket over. The bucket
 * accumulated artifacts from at least 4 distinct caller ids between 2026-09-01
 * and 2026-09-15, i.e. it had never worked for anyone.
 *
 * The same prior-art sweep (`.peaks/memory/archived/2026-06-26-unknown-sid-root-cause.md`)
 * converted six inline `?? 'unknown-sid'` sites to this 4-tier chain;
 * `workflow-lifecycle-commands.ts` was missed. This is that site.
 *
 * The project root passed to tier 3 goes through the same `findProjectRoot`
 * walk `session info` uses, so a command run from a SUBDIRECTORY of the
 * project resolves the project's binding instead of `cwd`'s (which has none).
 */
export function deriveSessionId(options: { sessionId?: string; project?: string }): string {
  if (typeof options.sessionId === 'string' && options.sessionId.length > 0)
    return options.sessionId;
  const fromEnv = process.env.PEAKS_SESSION_ID;
  if (typeof fromEnv === 'string' && fromEnv.length > 0) return fromEnv;
  return (
    getCurrentSessionId(
      findProjectRoot(options.project ?? process.cwd()) ?? options.project ?? process.cwd()
    ) ?? UNKNOWN_SESSION_ID
  );
}
