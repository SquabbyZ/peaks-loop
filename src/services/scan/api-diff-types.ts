/**
 * S1 / rid=api-diff-report — shared types for `peaks scan api-diff <doc>`
 * (design `docs/superpowers/specs/2026-09-12-frontend-acl-contract-design.md`
 * §2.1/§2.3).
 *
 * GOVERNING PRINCIPLE (QA repair): exactness requires BOTH sides to be fully
 * known. Any uncertainty on the recorded side SUPPRESSES the exact claim — it
 * is not merely annotated. `confidence: 'exact'` is reserved for lines where
 * both sides were parsed AND the recorded interface was fully readable.
 */

import { resolve, sep } from 'node:path';

/** The honest boundary of the feature. Printed in the output, not just documented. */
export const NOT_DETECTABLE: readonly string[] = [
  'a field whose type is unchanged but whose meaning changed',
  'a removed endpoint that nothing calls',
  'drift where this document is stale: types cannot check doc against server'
];

export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/** Rendered type text for the side of a one-sided field, i.e. the field is not there at all. */
export const ABSENT = '(absent)';

export type Method = (typeof HTTP_METHODS)[number];

/**
 * Which half of an operation a recorded interface describes, derived from the
 * suffix its name carries. A location is only ever diffed against an interface
 * of the matching role — one shared member map compared against every location
 * is what produced a Request interface being consumed at a response location.
 */
export type InterfaceRole = 'request' | 'response' | 'unknown';

export type DocOperation = {
  method: Method;
  path: string;
  operationId?: string;
  /** Ordered `location -> leaf field name -> normalized type text`. */
  locations: Map<string, Map<string, string>>;
  /**
   * `location -> why the DOC reader could not fully account for it`. The same
   * inverted rule the recorded side gets: a partial field set is
   * indistinguishable from a complete one, so an unreadable construct suppresses
   * the location's exact lines instead of being presented as complete.
   */
  locationIssues: Map<string, string>;
};

export type ParsedDocument = {
  openapi: string;
  title?: string;
  operations: DocOperation[];
};

export type RecordedInterface = {
  name: string;
  file: string;
  members: Map<string, string>;
  /** Non-null when the extractor could not read the full member set — suppresses every exact line for this interface. */
  incompleteReason: string | null;
};

export type RecordedEndpoint = { method: Method; path: string };

export type EndpointEntry = {
  confidence: 'exact';
  kind: 'added' | 'removed';
  method: Method;
  path: string;
};

export type FieldSide = { field: string; type: string };

export type FieldEntry = {
  confidence: 'exact';
  kind: 'changed';
  via: 'type-changed' | 'renamed' | 'added-in-document' | 'removed-from-document';
  method: Method;
  path: string;
  location: string;
  before: FieldSide;
  after: FieldSide;
};

export type CandidateMention = {
  confidence: 'candidate';
  name: string;
  hits: readonly { file: string; line: number }[];
};

export type ApiDiffReport = {
  document: { file: string; openapi: string; title: string | null; operationCount: number };
  exact: { endpoints: readonly EndpointEntry[]; fields: readonly FieldEntry[] };
  candidates: readonly CandidateMention[];
  sources: {
    mockPlan: string | null;
    interfaceFiles: readonly string[];
    handoff: string | null;
    recordedEndpoints: number;
  };
  notes: readonly string[];
  notDetectable: readonly string[];
};

/** Raised for a non-OpenAPI-3.x input so the CLI can exit non-zero with no diff output. */
export class ApiDiffInputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'ApiDiffInputError';
    this.code = code;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Project-relative, forward-slashed path for display.
 *
 * Compares path SEGMENTS, not raw `startsWith`: with a naive prefix test a root
 * of `D:/x` also "contains" `D:/x-archive/docs/api.json`, which then rendered as
 * the misleading `archive/docs/api.json`.
 */
export function toDisplayPath(projectRoot: string, file: string): string {
  const rootParts = resolve(projectRoot).split(sep);
  const fileParts = resolve(file).split(sep);
  const inside = fileParts.length > rootParts.length
    && rootParts.every((part, index) => part === fileParts[index]);
  return (inside ? fileParts.slice(rootParts.length) : fileParts).join('/');
}
