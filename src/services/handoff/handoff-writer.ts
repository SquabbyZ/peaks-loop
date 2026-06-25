/**
 * Handoff frontmatter — writer.
 *
 * Spec: docs/superpowers/plans/2026-06-25-slice-topology-multipass.md
 *       Phase 1, Task 4.
 *
 * Serializes a `HandoffFrontmatter` plus a body string into a single
 * markdown file with the canonical layout:
 *
 *   ---
 *   rid: "..."
 *   slice_id: "..."
 *   ...
 *   ---
 *
 *   <body verbatim>
 *
 * The output of `writeHandoff` is round-trip compatible with
 * `parseHandoff` — writing then parsing recovers the same frontmatter
 * fields and body.
 */

import { writeFileSync } from 'node:fs';
import { stringify as stringifyYaml } from 'yaml';
import type { HandoffFrontmatter } from './handoff-types.js';

const FRONTMATTER_OPEN = '---\n';
const FRONTMATTER_CLOSE = '\n---\n\n';

export function writeHandoff(
  filePath: string,
  frontmatter: HandoffFrontmatter,
  body: string
): void {
  const yamlStr = stringifyYaml(frontmatter as Record<string, unknown>).trimEnd();
  const content = `${FRONTMATTER_OPEN}${yamlStr}${FRONTMATTER_CLOSE}${body}`;
  writeFileSync(filePath, content, 'utf8');
}
