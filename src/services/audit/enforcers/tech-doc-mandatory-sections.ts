/**
 * tech-doc-mandatory-sections enforcer — Slice 2/6 karpathy-enforcement.
 *
 * Refuses `peaks request transition <rid> spec-locked` if the slice's
 * `rd/tech-doc.md` is missing any of the 3 mandatory section titles:
 *
 *   - ## Existing API / Component Inventory
 *   - ## Simplicity self-check
 *   - ## Reuse / Consolidate plan
 *
 * This gate enforces karpathy-guidelines §1 Think Before Coding and
 * §2 Simplicity First at the spec-locked transition. Without these
 * sections, RD would jump into implementation without first
 * enumerating existing reusable API surface, self-checking for
 * over-engineering, or declaring a reuse / consolidate plan — the
 * exact failure modes Slice 1 surfaced.
 *
 * The error message references the canonical karpathy-guidelines
 * skill (used as reference material only — do not execute upstream,
 * do not run upstream installer, do not install upstream resources)
 * and points to the section contract in
 * `skills/peaks-rd/references/mandatory-tech-doc.md`.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TechDocMandatorySectionsInput {
  readonly projectRoot: string;
  readonly sessionId: string;
}

export interface TechDocMandatorySectionsResult {
  readonly exists: boolean;
  readonly path: string;
  readonly missing: ReadonlyArray<string>;
}

/**
 * The 3 mandatory section titles. Read by the enforcer and by the
 * regression test. The `as const` keeps the literal types and the
 * readonly array shape for downstream consumers.
 */
export const MANDATORY_SLICE2_SECTIONS = [
  '## Existing API / Component Inventory',
  '## Simplicity self-check',
  '## Reuse / Consolidate plan',
] as const;

export function checkTechDocMandatorySections(
  input: TechDocMandatorySectionsInput,
): TechDocMandatorySectionsResult {
  const docPath = join(input.projectRoot, '.peaks/_runtime', input.sessionId, 'rd/tech-doc.md');
  if (!existsSync(docPath)) {
    return { exists: false, path: docPath, missing: [...MANDATORY_SLICE2_SECTIONS] };
  }
  let content: string;
  try {
    content = readFileSync(docPath, 'utf8');
  } catch {
    return { exists: false, path: docPath, missing: [...MANDATORY_SLICE2_SECTIONS] };
  }
  const missing = MANDATORY_SLICE2_SECTIONS.filter((section) => !content.includes(section));
  return { exists: true, path: docPath, missing };
}

export const TECH_DOC_MANDATORY_SECTIONS_CODE = 'TECH_DOC_MANDATORY_SECTIONS_MISSING';

export function buildMandatorySectionsErrorMessage(missing: ReadonlyArray<string>): string {
  return (
    `tech-doc.md is missing ${missing.length} mandatory section(s) (Slice 2/6 — ` +
    'template-self-check-lift): ' +
    missing.map((s) => `"${s}"`).join(', ') + '. ' +
    'Per karpathy-guidelines §1 Think Before Coding and §2 Simplicity First, ' +
    'the tech-doc MUST contain these 3 sections before spec-locked. ' +
    'See skills/peaks-rd/references/mandatory-tech-doc.md for the section contract ' +
    '(the canonical skill id is `andrej-karpathy-skills:karpathy-guidelines` — ' +
    'reference material only, do not execute upstream).'
  );
}
