/**
 * Handoff frontmatter — parser.
 *
 * Spec: docs/superpowers/plans/2026-06-25-slice-topology-multipass.md
 *       Phase 1, Task 4.
 *
 * Reads a markdown handoff file from disk and splits it into:
 *   - `frontmatter`: structured `HandoffFrontmatter` (parsed from YAML)
 *   - `body`:        the trailing prose
 *
 * Backward compat: legacy handoffs without a `---` frontmatter block are
 * returned with `schema_version: '0'` and `status: 'unknown'` so older
 * artifacts remain readable without any migration step.
 *
 * Required-field enforcement: any `HandoffFrontmatter` with schema_version
 * `'1'` MUST carry all six required fields. Missing fields raise
 * `IncompleteHandoffError` rather than silently substituting defaults.
 */

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { HandoffFrontmatter, HandoffStatus } from './handoff-types.js';

export class IncompleteHandoffError extends Error {
  readonly code = 'INCOMPLETE_HANDOFF' as const;
  constructor(message: string) {
    super(message);
    this.name = 'IncompleteHandoffError';
  }
}

const REQUIRED_FIELDS = [
  'rid',
  'slice_id',
  'agent_id',
  'schema_version',
  'status',
  'created_at'
] as const;

type RequiredField = (typeof REQUIRED_FIELDS)[number];

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

export interface ParsedHandoff {
  readonly frontmatter: HandoffFrontmatter;
  readonly body: string;
}

export function parseHandoff(filePath: string): ParsedHandoff {
  const content = readFileSync(filePath, 'utf8');
  const match = FRONTMATTER_RE.exec(content);

  if (!match) {
    return legacyDefaults(content);
  }

  const [, yamlContent, body] = match;
  const parsed = parseYaml(yamlContent ?? '') as Partial<HandoffFrontmatter> | null | undefined;

  if (parsed === null || parsed === undefined) {
    return legacyDefaults(content);
  }

  const missing = REQUIRED_FIELDS.filter(
    (f) => (parsed as Record<RequiredField, unknown>)[f] === undefined
  );
  if (missing.length > 0) {
    throw new IncompleteHandoffError(
      `Missing required frontmatter fields: ${missing.join(', ')}`
    );
  }

  return {
    frontmatter: parsed as HandoffFrontmatter,
    body: body ?? ''
  };
}

function legacyDefaults(content: string): ParsedHandoff {
  return {
    frontmatter: {
      rid: 'unknown',
      slice_id: 'unknown',
      agent_id: 'unknown',
      schema_version: '0',
      status: 'unknown' as HandoffStatus,
      created_at: new Date(0).toISOString()
    },
    body: content
  };
}
