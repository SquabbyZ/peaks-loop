/**
 * Slice 2026-09-10-dispatch-token-and-swarm §4 — session capsule reader.
 *
 * The orchestrator publishes already-known background ONCE per session
 * through the existing G8.4 channel:
 *
 *   peaks sub-agent share \
 *     --batch session-capsule \
 *     --key orchestrator.capsule \
 *     --value '{"rootCauses":[...],"decisions":[...],"fileMap":{...}}'
 *
 * Dispatch prompts then carry a one-line `shared-read` pointer instead of
 * re-explaining that background in every task spec.
 *
 * QUALITY GUARD: the capsule is ADVISORY BACKGROUND ONLY. Nothing a
 * sub-agent must ACT on may live only in the capsule — the task spec is
 * authoritative and wins on conflict. The precedence sentence is rendered
 * by `renderCapsulePointer` in build-dispatch-system-prompt.ts and is not
 * optional when the pointer is emitted.
 *
 * This module only READS. Publishing is the orchestrator's job through the
 * already-shipped `peaks sub-agent share` primitive — no new write path.
 */
import { readSharedChannel, type SharedChannelEntry } from 'peaks-loop-shared-channel';

/** Reserved batch id for the session capsule (matches the channel path pattern). */
export const SESSION_CAPSULE_BATCH_ID = 'session-capsule';

/** Reserved key inside that channel. */
export const SESSION_CAPSULE_KEY = 'orchestrator.capsule';

export interface SessionCapsuleRef {
  readonly batchId: string;
  readonly key: string;
  /** Byte size of the published value (for the pointer line). */
  readonly bytes: number;
  /** ISO8601 timestamp of the last write. */
  readonly updatedAt: string;
}

/**
 * Read the session capsule, if one was published. Returns `null` when the
 * channel is absent, empty, or unreadable — the dispatch prompt then
 * renders neither the pointer nor the precedence line (byte-identical to
 * the pre-slice shape).
 */
export function readSessionCapsule(opts: {
  projectRoot: string;
  sid: string;
  rid: string;
}): SessionCapsuleRef | null {
  try {
    const channel = readSharedChannel({
      projectRoot: opts.projectRoot,
      sid: opts.sid,
      rid: opts.rid,
      batchId: SESSION_CAPSULE_BATCH_ID
    });
    const entry: SharedChannelEntry | undefined = channel.entries[SESSION_CAPSULE_KEY];
    if (entry === undefined) return null;
    return {
      batchId: SESSION_CAPSULE_BATCH_ID,
      key: SESSION_CAPSULE_KEY,
      bytes: entry.valueSize,
      updatedAt: entry.at
    };
  } catch {
    return null; // fail-soft: a missing capsule never blocks a dispatch
  }
}
