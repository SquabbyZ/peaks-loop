/**
 * Rendering and writing of the security audit artifact. Split out of
 * `security-audit-service.ts`, which was over the per-file cap; the service now
 * depends on this module rather than carrying the markdown itself.
 */

import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { REQUEST_ID_PATTERN } from '../artifacts/request-artifact-service.js';
import type { SecurityAuditEnvelope, SecurityAuditVerdict } from './security-audit-service.js';

/**
 * Render a SecurityAuditEnvelope to the canonical audit artifact body
 * (markdown). Produce a markdown body with all required sections, ready to
 * write to `.peaks/_runtime/<sid>/audit/security-<rid>.md`.
 */
export function renderSecurityAuditArtifact(
  env: SecurityAuditEnvelope,
  opts: { rid: string; handoffHash: string; generatedAt: string }
): { body: string; violationsCount: number; verdict: SecurityAuditVerdict } {
  const counts: Record<string, number> = {};
  for (const v of env.violations) {
    counts[v.severity] = (counts[v.severity] ?? 0) + 1;
  }
  const criticalCount = counts['CRITICAL'] ?? 0;

  const findingsBullets =
    env.violations.length === 0
      ? '- (none)'
      : env.violations
          .map((v) => `- [${v.severity}] ${v.dimension} @ ${v.file}:${v.line} — ${v.hint}`)
          .join('\n');

  const requiredFixes = buildRequiredFixes(env);

  const body = [
    '## Summary',
    '',
    env.summary,
    '',
    '## Threat model coverage',
    '',
    `audited at: ${opts.generatedAt}`,
    `verdict: ${env.verdict}`,
    `handoffHash: ${opts.handoffHash}`,
    '',
    '## Findings',
    '',
    findingsBullets,
    '',
    requiredFixes,
    '## Verdict',
    '',
    `verdict: ${env.verdict}`,
    `CRITICAL: ${criticalCount}`,
    ''
  ]
    .filter((s) => s.length > 0)
    .join('\n');

  return {
    body,
    violationsCount: env.violations.length,
    verdict: env.verdict
  };
}

function buildRequiredFixes(env: SecurityAuditEnvelope): string {
  const requiredFixes =
    env.violations.length === 0
      ? ''
      : [
          '## Required fixes',
          '',
          ...env.violations.map((v) => `- [${v.severity}] ${v.file}:${v.line} — ${v.hint}`),
          ''
        ].join('\n');
  return requiredFixes;
}

/**
 * Write the rendered audit artifact to
 * `.peaks/_runtime/<sid>/audit/security-<rid>.md`.
 *
 * Atomic write (tmp + rename) to avoid partial writes on crash.
 * Returns the absolute path on success.
 */
export function writeSecurityAuditArtifact(
  projectRoot: string,
  sessionId: string,
  rid: string,
  body: string
): string {
  // The rid is a filename below, and the write is tmp+rename, so an
  // unvalidated rid can OVERWRITE an arbitrary `.md` rather than merely create
  // one. Guarded here (not only at the CLI boundary) so no caller can skip it.
  if (!REQUEST_ID_PATTERN.test(rid)) {
    throw new Error(
      `Invalid request id: ${rid} (expected letters, digits, dots, underscores, or dashes)`
    );
  }
  const targetDir = join(projectRoot, '.peaks', '_runtime', sessionId, 'audit');
  mkdirSync(targetDir, { recursive: true });
  const targetPath = join(targetDir, `security-${rid}.md`);
  // tmp + rename for atomicity
  const tmpPath = `${targetPath}.tmp`;
  writeFileSync(tmpPath, body, 'utf8');
  // Sync rename: on Windows, fs.renameSync overwrites if target exists (Node 22+)
  renameSync(tmpPath, targetPath);
  return targetPath;
}
