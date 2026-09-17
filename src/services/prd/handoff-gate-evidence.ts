// src/services/prd/handoff-gate-evidence.ts
//
// AC-5 of slice 2026-09-17-4-0-51-cleanup: the handoff's frontmatter
// carries a `gateEvidence: string[]` field naming the gate names whose
// `gateEvidence` is asserted by this handoff. Pre-S2, the field was
// written into the frontmatter (by `initHandoff`) but NO consumer in
// `src/` ever READ it back — the field was prose, not data.
//
// This module is the SOLE reader for that field. It is a stand-alone
// reader (not a member of `handoff-service.ts`) so that the
// `HandoffFrontmatter` type stays a pure-data shape and this consumer
// can be added independently without disturbing every existing
// parse-and-validate path.
//
// Returns:
//   - `string[]`  — the gate names declared in the frontmatter
//   - `null`      — the file is missing, the frontmatter is malformed,
//                   the field is absent, or the field is not an array
//                   of strings. Callers MUST treat null as "no claim"
//                   and not as a failure.
//
// The reader is intentionally permissive (returns null instead of
// throwing) because a malformed frontmatter is the caller's signal to
// surface the failure to the operator, not the reader's signal to
// throw inside the gate pipeline.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { parse as parseYaml } from 'yaml';

interface FrontmatterParseResult {
  readonly gateEvidence: readonly unknown[] | null;
}

function parseGateEvidenceFrontmatter(raw: string): FrontmatterParseResult {
  // Frontmatter is the `---`-fenced YAML block at the top of the file.
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { gateEvidence: null };
  const yamlBody = match[1] ?? '';
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlBody);
  } catch {
    return { gateEvidence: null };
  }
  if (parsed === null || typeof parsed !== 'object') return { gateEvidence: null };
  const gateEvidence = (parsed as Record<string, unknown>)['gateEvidence'];
  if (!Array.isArray(gateEvidence)) return { gateEvidence: null };
  return { gateEvidence };
}

export async function readHandoffGateEvidence(
  filePath: string
): Promise<readonly string[] | null> {
  if (!existsSync(filePath)) return null;
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
  try {
    const { gateEvidence } = parseGateEvidenceFrontmatter(raw);
    if (gateEvidence === null) return null;
    // Filter to strings only — a non-string element (number/boolean/
    // null) is treated as "not a gate name" rather than as an error.
    const strings = gateEvidence.filter(
      (item): item is string => typeof item === 'string'
    );
    return strings.length > 0 ? strings : null;
  } catch {
    return null;
  }
}
