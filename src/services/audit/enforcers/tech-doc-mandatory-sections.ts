/**
 * tech-doc-mandatory-sections enforcer — Slice 2/6 karpathy-enforcement +
 * Slice 1.2.b slice-dag-dispatcher MVP.
 *
 * Refuses `peaks request transition <rid> spec-locked` if the slice's
 * `rd/tech-doc.md` is missing any of the mandatory section titles.
 *
 * Two sets of mandatory sections (checked as a union):
 *   - Slice 2/6 karpathy-enforcement (3 sections, byte-stable):
 *     - ## Existing API / Component Inventory
 *     - ## Simplicity self-check
 *     - ## Reuse / Consolidate plan
 *   - Slice 1.2.b slice-dag-dispatcher MVP (1 section, added in 2.7.0):
 *     - ## Slice DAG
 *
 * The Slice 2 gate enforces karpathy-guidelines §1 Think Before Coding
 * and §2 Simplicity First at the spec-locked transition. Without those
 * 3 sections, RD would jump into implementation without first
 * enumerating existing reusable API surface, self-checking for
 * over-engineering, or declaring a reuse / consolidate plan — the
 * exact failure modes Slice 1 surfaced.
 *
 * The Slice 1.2.b gate enforces that any slice touching the dispatcher
 * surface publishes its dependency plan as a DAG (nodes + depends-on +
 * contract hash) before spec-locked, so the orchestrator can wire the
 * `peaks sub-agent dispatch --from-dag` primitive against a stable
 * source of truth.
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
 * The 3 mandatory Slice 2/6 karpathy-enforcement section titles. Read by
 * the enforcer and by the regression test. The `as const` keeps the
 * literal types and the readonly array shape for downstream consumers.
 *
 * IMPORTANT: byte-stable — the slice-2 regression test asserts these
 * literals exactly. Do not rename.
 */
export const MANDATORY_SLICE2_SECTIONS = [
  '## Existing API / Component Inventory',
  '## Simplicity self-check',
  '## Reuse / Consolidate plan',
] as const;

/**
 * The 1 mandatory Slice 1.2.b slice-dag-dispatcher MVP section title.
 * Single-element tuple so we can keep the `as const` literal type
 * shape consistent with `MANDATORY_SLICE2_SECTIONS`.
 */
export const MANDATORY_SLICE_DAG_SECTION = ['## Slice DAG'] as const;

/**
 * Full set of mandatory section titles, in the order they appear in the
 * template. Exported for tests that need the union shape; the enforcer
 * reads from `MANDATORY_SLICE2_SECTIONS` + `MANDATORY_SLICE_DAG_SECTION`
 * directly to keep the union intent explicit.
 */
export const ALL_MANDATORY_TECH_DOC_SECTIONS: ReadonlyArray<string> = [
  ...MANDATORY_SLICE2_SECTIONS,
  ...MANDATORY_SLICE_DAG_SECTION,
];

export function checkTechDocMandatorySections(
  input: TechDocMandatorySectionsInput,
): TechDocMandatorySectionsResult {
  const docPath = join(input.projectRoot, '.peaks/_runtime', input.sessionId, 'rd/tech-doc.md');
  if (!existsSync(docPath)) {
    return { exists: false, path: docPath, missing: [...ALL_MANDATORY_TECH_DOC_SECTIONS] };
  }
  let content: string;
  try {
    content = readFileSync(docPath, 'utf8');
  } catch {
    return { exists: false, path: docPath, missing: [...ALL_MANDATORY_TECH_DOC_SECTIONS] };
  }
  const missing = ALL_MANDATORY_TECH_DOC_SECTIONS.filter((section) => !content.includes(section));
  return { exists: true, path: docPath, missing };
}

export const TECH_DOC_MANDATORY_SECTIONS_CODE = 'TECH_DOC_MANDATORY_SECTIONS_MISSING';

export function buildMandatorySectionsErrorMessage(missing: ReadonlyArray<string>): string {
  const slice2Missing = missing.filter((s) => (MANDATORY_SLICE2_SECTIONS as readonly string[]).includes(s));
  const sliceDagMissing = missing.filter((s) => (MANDATORY_SLICE_DAG_SECTION as readonly string[]).includes(s));
  const parts: string[] = [];
  if (slice2Missing.length > 0) {
    parts.push(
      `${slice2Missing.length} Slice 2/6 karpathy-enforcement section(s)` +
        `: ${slice2Missing.map((s) => `"${s}"`).join(', ')} ` +
        `(per karpathy-guidelines §1 Think Before Coding and §2 Simplicity First)`
    );
  }
  if (sliceDagMissing.length > 0) {
    parts.push(
      `${sliceDagMissing.length} Slice 1.2.b slice-dag-dispatcher section(s)` +
        `: ${sliceDagMissing.map((s) => `"${s}"`).join(', ')} ` +
        `(per the Slice DAG mandatory section in mandatory-tech-doc.md §7 — ` +
        `node id + role + depends-on + contractHash are required before spec-locked)`
    );
  }
  return (
    `tech-doc.md is missing ${missing.length} mandatory section(s): ` +
    parts.join('; ') +
    '. ' +
    'See skills/peaks-rd/references/mandatory-tech-doc.md for the section contract ' +
    '(the canonical skill id is `andrej-karpathy-skills:karpathy-guidelines` — ' +
    'reference material only, do not execute upstream).'
  );
}
