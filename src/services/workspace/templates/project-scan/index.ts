/**
 * Bundled project-scan templates for `peaks workspace init`.
 *
 * Slice 2026-07-15-project-scan-bootstrap (PRD G4b / AC9 / R4):
 *   4 audit/business templates are bundled in the repo at
 *   `src/services/workspace/templates/project-scan/*.md` and copied
 *   verbatim to `<projectRoot>/.peaks/project-scan/` on every
 *   `peaks workspace init` (idempotent skip when the target file
 *   already exists; `--force-project-scan-templates` overrides).
 *
 *   `project-scan.md` is NOT bundled here — it is generated dynamically
 *   by `bootstrapProjectScan` (slice 2026-07-15-project-scan-bootstrap).
 *
 * Template-integrity guarantee:
 *   The vitest test `tests/unit/workspace/templates/template-integrity.test.ts`
 *   asserts byte-for-byte equality between these 4 files and the
 *   canonical sources at `.peaks/project-scan/{4 files}`. Any drift
 *   fails the suite (R4 engineering guard against template drift).
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TEMPLATE_FILES = [
  'business-knowledge.md',
  'security-template.md',
  'perf-template.md',
  'audit-output-schema.md'
] as const;

export type TemplateFileName = (typeof TEMPLATE_FILES)[number];

/**
 * Resolve the absolute path of this directory at runtime. We avoid
 * importing `meta.url` literals so the file is portable across tsx
 * (dev) and built bundles (dist/).
 */
function templatesDir(): string {
  // fileURLToPath works for both `file:///...` and `file:///C:/...`
  const here = fileURLToPath(import.meta.url);
  return dirname(here);
}

/**
 * Read a bundled template by name. Throws when the name is not in
 * TEMPLATE_FILES (TypeScript narrows the union, but runtime callers
 * may pass arbitrary strings).
 */
export async function readTemplate(name: TemplateFileName): Promise<string> {
  const path = join(templatesDir(), name);
  return readFile(path, 'utf8');
}

/**
 * Same as `readTemplate` but throws a descriptive error when the name
 * is not in TEMPLATE_FILES. Used by the bootstrap service where the
 * name comes from a known-typed list and a typo would otherwise fail
 * with an unhelpful ENOENT.
 */
export async function readTemplateStrict(name: string): Promise<string> {
  if (!(TEMPLATE_FILES as readonly string[]).includes(name)) {
    throw new Error(
      `readTemplateStrict: unknown template name "${name}". ` +
        `Allowed: ${TEMPLATE_FILES.join(', ')}`
    );
  }
  return readTemplate(name as TemplateFileName);
}