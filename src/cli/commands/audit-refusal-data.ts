/**
 * The empty/failure `data` payloads the `peaks audit *` runners attach to a
 * refusal envelope.
 *
 * Kept in one module so each runner reads as control flow: every literal here
 * is byte-identical to the inline object it replaced, and every builder is a
 * pure function of its arguments (no module-level mutable state).
 */

import type { ArtifactKind, ArtifactWriteRecord } from '../../services/audit/artifact-writer.js';
import type { ProseRatioResult } from '../../services/audit/prose-ratio-calculator.js';
import type { RedLineAudit } from '../../services/audit/types.js';
import type { AuditGoalData, StaticAuditData } from './audit-command-shared.js';

/** A zeroed scan result, as `peaks audit red-lines` prints it on a refusal. */
export function emptyRedLineAudit(): RedLineAudit {
  return {
    totalRedLines: 0,
    cliBacked: 0,
    partial: 0,
    proseOnly: 0,
    audit: [],
    enforcerFindings: []
  };
}

export function emptyStaticAuditData(): StaticAuditData {
  return {
    audit: emptyRedLineAudit(),
    agentShield: {
      spawned: false,
      installed: false,
      reason: 'flag-disabled',
      findings: []
    }
  };
}

export function emptyProseRatioResult(): ProseRatioResult {
  return {
    totalRedLines: 0,
    cliBacked: 0,
    partial: 0,
    proseOnly: 0,
    discoveredProseOnly: 0,
    informational: 0,
    ratio: 0,
    target: 0.05,
    exceeds: false
  };
}

/**
 * A write record with no file behind it. `kind` is carried through because the
 * `INVALID_KIND` and `INPUT_NOT_FOUND` refusals name a caller-supplied kind;
 * the `--project` refusal holds the neutral `narrative`.
 */
export function emptyArtifactWriteRecord(kind: ArtifactKind): ArtifactWriteRecord {
  return {
    kind,
    slug: '',
    title: '',
    date: '',
    filePath: '',
    memoryDir: '',
    indexPath: '',
    indexSynced: false
  };
}

export function auditGoalFailureData(
  need: string,
  projectRoot: string,
  providerBinding: AuditGoalData['providerBinding'] = 'unresolved',
  missingEnv?: readonly string[]
): AuditGoalData {
  return {
    status: 'audit-failed',
    providerBinding,
    need,
    projectRoot,
    ...(missingEnv === undefined ? {} : { missingEnv })
  };
}
