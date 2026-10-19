// The session-scoped `qa/.initiated` marker, written from two callers:
// `createRequestArtifact` (its success path, after the request file is on disk)
// and `peaks request mark-qa-initiated` (the in-order path for a QA role that
// wrote its artifact first). Keeping one writer means the two paths cannot
// drift on content, permissions, or idempotence.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { guardRuntimeSegment, runtimeRoot } from '../../shared/runtime-root.js';

export type MarkQaInitiatedOptions = {
  projectRoot: string;
  sessionId: string;
};

export type MarkQaInitiatedResult = {
  /** Absolute path of the marker. */
  path: string;
  /** `true` only on the call that created the file; `false` when it already existed. */
  created: boolean;
};

/**
 * Create `.peaks/_runtime/<sessionId>/qa/.initiated` if it is absent.
 *
 * Idempotent by construction: the create is a single `O_EXCL` write (`flag:
 * 'wx'`), so an existing marker — including one carrying bytes — is never
 * truncated, and a concurrent caller sees `EEXIST` rather than a second write.
 * The marker's content is the empty string, matching the shape `request init`
 * has always produced.
 *
 * This function touches nothing under `qa/requests/`: the request artifact is
 * the caller's, and this verb exists so it never has to be deleted or rewritten
 * to reach the marker.
 */
export async function markQaInitiated(
  options: MarkQaInitiatedOptions
): Promise<MarkQaInitiatedResult> {
  const qaDir = runtimeRoot(options.projectRoot).join(
    guardRuntimeSegment(options.sessionId, 'session id'),
    guardRuntimeSegment('qa', 'role')
  );
  const path = join(qaDir, '.initiated');
  await mkdir(qaDir, { recursive: true });
  try {
    await writeFile(path, '', { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return { path, created: false };
    }
    throw error;
  }
  return { path, created: true };
}
