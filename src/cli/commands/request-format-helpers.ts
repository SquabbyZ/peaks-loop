/**
 * Format / parse helpers extracted from `request-commands.ts`
 * (slice 2026-09-06-split-batch-b) so the command file stays under the
 * 800-line cap. Behaviour-preserving verbatim move.
 */

import { InvalidArgumentError } from 'commander';
import {
  allowedStatesForRole,
  isRequestType,
  VALID_REQUEST_TYPES,
  type RequestArtifactRole,
  type RequestArtifactState,
  type RequestType,
} from '../../services/artifacts/request-artifact-service.js';
import { formatMdCompact } from '../../shared/format-md-compact.js';

/**
 * Per-artifact default format. Only PRD and tech-doc are user-review
 * surfaces; all other RD/QA/TXT artifacts default to compact. The
 * `--pretty` / `--compact` flags override uniformly. See tech-doc
 * §1.3.
 */
const DEFAULT_FORMAT_BY_ARTIFACT: Record<string, 'compact' | 'pretty'> = {
  prd: 'pretty',
  'tech-doc': 'pretty',
  'code-review': 'compact',
  'security-review': 'compact',
  'perf-baseline': 'compact',
  'bug-analysis': 'compact',
  'test-cases': 'compact',
  'test-reports': 'compact',
  'security-findings': 'compact',
  'performance-findings': 'compact',
  handoff: 'compact'
};

export function resolveDefaultFormat(artifactName: string): 'compact' | 'pretty' {
  return DEFAULT_FORMAT_BY_ARTIFACT[artifactName] ?? 'compact';
}

export function applyPerArtifactFormat(
  envelope: unknown,
  override: 'pretty' | 'compact' | null
): unknown {
  if (override === null || envelope === null || typeof envelope !== 'object') return envelope;
  // The service returns `{ id, sessionId, role, body, ... }` for a
  // single-artifact show. The per-artifact `body` field is the only
  // thing that changes; we attach a `format` field to surface the
  // choice to the caller. Slice 023 (R3) AC6 / AC7.
  const obj = envelope as Record<string, unknown>;
  if (typeof obj.body === 'string') {
    return {
      ...obj,
      body: override === 'compact' ? formatMdCompact(obj.body) : obj.body,
      format: override
    };
  }
  return envelope;
}

/**
 * Map a request-artifact envelope to a `DEFAULT_FORMAT_BY_ARTIFACT` key.
 * The service returns the path of the artifact in `path`; the role +
 * filename stem gives us the artifact name. Falls back to the role
 * itself when no `path` field is present.
 */
export function inferArtifactName(envelope: unknown, role: string): string {
  if (envelope === null || typeof envelope !== 'object') return role;
  const obj = envelope as Record<string, unknown>;
  const pathField = typeof obj.path === 'string' ? obj.path : '';
  // Path looks like `.peaks/_runtime/<sid>/<role>/requests/<file>.md`.
  // The role is the second-to-last directory; the file stem is the
  // last segment. For RD role, the artifact is one of {code-review,
  // security-review, perf-baseline, bug-analysis, tech-doc}; the file
  // stem usually carries the artifact name (e.g. `tech-doc.md`,
  // `code-review-002.md`). We strip the trailing `-<digits>` suffix
  // when present.
  const stem = pathField.split(/[\\/]/).pop()?.replace(/\.md$/, '') ?? '';
  if (stem.length > 0) {
    // Try the stem verbatim first.
    if (DEFAULT_FORMAT_BY_ARTIFACT[stem] !== undefined) return stem;
    // Strip a trailing -<digits> (e.g. code-review-002 -> code-review).
    const trimmed = stem.replace(/-\d+$/, '');
    if (DEFAULT_FORMAT_BY_ARTIFACT[trimmed] !== undefined) return trimmed;
    // Last-ditch: match by prefix.
    for (const key of Object.keys(DEFAULT_FORMAT_BY_ARTIFACT)) {
      if (stem.startsWith(key)) return key;
    }
  }
  return role;
}

export const VALID_ROLES: ReadonlyArray<RequestArtifactRole> = ['prd', 'ui', 'rd', 'qa', 'sc'];

export function parseRole(value: string): RequestArtifactRole {
  if (!VALID_ROLES.includes(value as RequestArtifactRole)) {
    throw new InvalidArgumentError(`must be one of ${VALID_ROLES.join(', ')}`);
  }
  return value as RequestArtifactRole;
}

export function parseStateForRole(role: RequestArtifactRole, value: string): RequestArtifactState {
  const allowed = allowedStatesForRole(role);
  if (!(allowed as ReadonlyArray<string>).includes(value)) {
    throw new InvalidArgumentError(`must be one of ${allowed.join(', ')} for role ${role}`);
  }
  return value as RequestArtifactState;
}

export function parseRequestType(value: string): RequestType {
  if (!isRequestType(value)) {
    throw new InvalidArgumentError(`must be one of ${VALID_REQUEST_TYPES.join(', ')}`);
  }
  return value;
}
