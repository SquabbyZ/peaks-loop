/**
 * v2.13.2 AC-4 — prd/handoff-<rid>.md auto-regen on prd:handed-off.
 *
 * When `peaks request transition --role prd --state handed-off` succeeds
 * and this slice's capsule is missing, this helper writes a sha256-locked
 * handoff (schemaVersion: 2) using the request artifact body as the
 * handoff body. If the capsule already exists, it's NOT overwritten —
 * the existing handoff is canonical (it may carry a richer body that
 * peaks-prd produced in an earlier session).
 *
 * Slice `2026-09-14-prd-capsule-rid-scoping`: the path carries the rid, so
 * "already exists" is now asked per SLICE. The pre-rid-scoping bare name is
 * deliberately NOT consulted — writing there would recreate the
 * one-slot-per-session collision for the next slice in the session.
 *
 * Karpathy §3 (Surgical Changes): this file only owns the auto-regen
 * path. The other 11 transitions are untouched.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { showRequestArtifact, type RequestArtifactRole } from '../artifacts/request-artifact-service.js';
import { serializeHandoffFrontmatter } from './handoff-frontmatter.js';
import { handoffRelativePath, sha256OfBody } from './handoff-service.js';
import type { HandoffFrontmatter } from './handoff-types.js';
import { normalizePath } from '../../shared/path-utils.js';

export type HandoffAutoRegenResult =
  | { status: 'created'; path: string; sha256: string }
  | { status: 'skipped-exists'; path: string }
  | { status: 'failed'; reason: string };

/**
 * Auto-regen the prd/handoff.md under `.peaks/_runtime/<sid>/prd/`.
 * Returns the outcome; never throws.
 */
export async function autoRegenPrdHandoff(opts: {
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly requestId: string;
  readonly role: RequestArtifactRole;
}): Promise<HandoffAutoRegenResult> {
  if (opts.role !== 'prd') {
    return { status: 'failed', reason: 'role must be prd' };
  }
  const handoffPath = join(opts.projectRoot, handoffRelativePath(opts.sessionId, opts.requestId));
  if (existsSync(handoffPath)) {
    return { status: 'skipped-exists', path: handoffPath };
  }
  const artifact = await showRequestArtifact({
    projectRoot: opts.projectRoot,
    role: 'prd',
    requestId: opts.requestId,
    sessionId: opts.sessionId
  });
  if (artifact === null || typeof artifact.content !== 'string') {
    return { status: 'failed', reason: 'request artifact body not found' };
  }
  const body = artifact.content;
  const sha256 = sha256OfBody(body);
  // v2.13.3 AC-4 — align with `AUDIT_REQUIRES_HANDOFF` prereq which
  // pins `mustContain: ['schemaVersion: 2', 'sha256:']`. Primary field is
  // `sha256`; `handoffHash` is kept as a literal alias for the readers that
  // still use the old key.
  //
  // Slice `2026-09-14-handoff-writer-gate-divergence`: this block used to be
  // hand-rolled here while `handoff-service.serializeHandoff` rendered the
  // SAME contract a second, incompatible way. Both now go through
  // `serializeHandoffFrontmatter`, so the two producers cannot drift again.
  const frontmatter: HandoffFrontmatter = {
    requestId: opts.requestId,
    sessionId: opts.sessionId,
    schemaVersion: '2',
    handoffHash: sha256,
    writtenAt: new Date().toISOString(),
    goals: [],
    acceptanceCriteria: [],
    preservedBehavior: [],
    handoffPath: normalizePath(handoffPath.replace(opts.projectRoot, '')).replace(/^\//, '')
  };
  const content = `${serializeHandoffFrontmatter(frontmatter)}${body}`;
  mkdirSync(dirname(handoffPath), { recursive: true });
  writeFileSync(handoffPath, content, 'utf8');
  const recomputed = createHash('sha256').update(body, 'utf8').digest('hex');
  if (recomputed !== sha256) {
    return { status: 'failed', reason: 'sha256 mismatch after write' };
  }
  return { status: 'created', path: handoffPath, sha256 };
}