import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Regression test for slice 2026-06-17-tech-doc-api-surface (Slice 2/6).
 *
 * Asserts that the Slice 2 karpathy-enforcement surface is in place:
 *   - the tech-doc template has the 3 mandatory self-check sections
 *     (## Existing API / Component Inventory, ## Simplicity self-check,
 *     ## Reuse / Consolidate plan)
 *   - each section has at least 3 mandatory questions / answers
 *   - rd-runbook Step 1 has the "API surface scan" sub-step
 *   - the gate C enforcer error message references karpathy-guidelines §1 / §2
 *   - Slice 1 prompt-injection layers (the 4 files) are still intact
 *     (cross-slice regression guard).
 *
 * Cross-references:
 *   - PRD: .peaks/_runtime/2026-06-17-session-1baf0a/prd/requests/002-2026-06-17-tech-doc-api-surface.md
 *   - Tech-doc: .peaks/_runtime/2026-06-17-session-1baf0a/rd/tech-doc.md
 *   - Slice 1 PRD: .peaks/_runtime/2026-06-17-session-1baf0a/prd/requests/001-2026-06-17-karpathy-enforcement.md
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

interface TrackedFile {
  readonly name: string;
  readonly path: string;
  readonly content: string;
}

const MANDATORY_TECH_DOC: TrackedFile = {
  name: 'peaks-rd/references/mandatory-tech-doc.md',
  path: resolve(REPO_ROOT, 'skills/peaks-rd/references/mandatory-tech-doc.md'),
  content: readFileSync(
    resolve(REPO_ROOT, 'skills/peaks-rd/references/mandatory-tech-doc.md'),
    'utf8',
  ),
};

const RD_RUNBOOK: TrackedFile = {
  name: 'peaks-rd/references/rd-runbook.md',
  path: resolve(REPO_ROOT, 'skills/peaks-rd/references/rd-runbook.md'),
  content: readFileSync(
    resolve(REPO_ROOT, 'skills/peaks-rd/references/rd-runbook.md'),
    'utf8',
  ),
};

const ENFORCER: TrackedFile = {
  name: 'src/services/audit/enforcers/tech-doc-mandatory-sections.ts',
  path: resolve(REPO_ROOT, 'src/services/audit/enforcers/tech-doc-mandatory-sections.ts'),
  content: readFileSync(
    resolve(REPO_ROOT, 'src/services/audit/enforcers/tech-doc-mandatory-sections.ts'),
    'utf8',
  ),
};

const GATE_FILE: TrackedFile = {
  name: 'src/services/artifacts/request-artifact-service.ts',
  path: resolve(REPO_ROOT, 'src/services/artifacts/request-artifact-service.ts'),
  content: readFileSync(
    resolve(REPO_ROOT, 'src/services/artifacts/request-artifact-service.ts'),
    'utf8',
  ),
};

const SLICE1_RD_SKILL: TrackedFile = {
  name: 'peaks-rd/SKILL.md (Slice 1 regression)',
  path: resolve(REPO_ROOT, 'skills/peaks-rd/SKILL.md'),
  content: readFileSync(resolve(REPO_ROOT, 'skills/peaks-rd/SKILL.md'), 'utf8'),
};

const SLICE1_SOLO_SKILL: TrackedFile = {
  name: 'peaks-solo/SKILL.md (Slice 1 regression)',
  path: resolve(REPO_ROOT, 'skills/peaks-solo/SKILL.md'),
  content: readFileSync(resolve(REPO_ROOT, 'skills/peaks-solo/SKILL.md'), 'utf8'),
};

const MANDATORY_SECTION_TITLES = [
  '## Existing API / Component Inventory',
  '## Simplicity self-check',
  '## Reuse / Consolidate plan',
] as const;

const FOUR_TITLES = [
  'Think Before Coding',
  'Simplicity First',
  'Surgical Changes',
  'Goal-Driven Execution',
] as const;

describe('Tech-doc mandatory sections (Slice 2/6 — karpathy-enforcement)', () => {
  test('AC-1 mandatory-tech-doc.md has all 3 Slice 2 section titles', () => {
    // The template labels each section as `7. **Section Name** — description`
    // (numbered list item with bolded name). The actual tech-doc.md written
    // by RD uses `## Section Name` as h2 header. The enforcer matches the h2
    // form in the actual tech-doc, so we look for the section name substring
    // (without the `## ` markdown prefix) in the template contract.
    const sectionNames = [
      'Existing API / Component Inventory',
      'Simplicity self-check',
      'Reuse / Consolidate plan',
    ] as const;
    for (const name of sectionNames) {
      expect(
        MANDATORY_TECH_DOC.content,
        `mandatory-tech-doc.md must contain section "${name}"`,
      ).toContain(name);
    }
  });

  test('AC-1 each mandatory section has at least 3 numbered questions / answers', () => {
    // Split the file into per-section blocks and verify each one has ≥3 list items.
    // In the template, each section is `N. **Name** — desc` followed by
    // indented numbered sub-items (`   1. ...`).
    const sectionNames = [
      'Existing API / Component Inventory',
      'Simplicity self-check',
      'Reuse / Consolidate plan',
    ] as const;
    const lines = MANDATORY_TECH_DOC.content.split('\n');
    for (const name of sectionNames) {
      const startIdx = lines.findIndex((line) => line.includes(name));
      expect(startIdx, `section "${name}" must exist`).toBeGreaterThanOrEqual(0);
      // Sections 7-9 are the Slice 2 additions, terminated by the
      // "**CSS framework change rules**" heading or end-of-file.
      const stopIdx = lines.findIndex(
        (line, idx) => idx > startIdx && line.startsWith('**CSS framework change rules'),
      );
      const stop = stopIdx >= 0 ? stopIdx : lines.length;
      const block = lines.slice(startIdx, stop);
      // Numbered list items (allow leading whitespace for the nested sub-items).
      const numberedItems = block.filter((line) => /^\s*\d+\.\s/.test(line));
      expect(
        numberedItems.length,
        `section "${name}" must contain at least 3 numbered items (got ${numberedItems.length})`,
      ).toBeGreaterThanOrEqual(3);
    }
  });

  test('AC-2 rd-runbook.md has the "API surface scan" sub-step with Slice 3 CLI reference', () => {
    expect(RD_RUNBOOK.content, 'rd-runbook must contain "API surface scan"').toContain(
      'API surface scan',
    );
    // Slice 2 期间占位文本 "Slice 2/6 placeholder" 已在 Slice 3 落地时移除
    expect(RD_RUNBOOK.content, 'Slice 3 should have removed the Slice 2/6 placeholder').not.toContain(
      'Slice 2/6 placeholder',
    );
    expect(RD_RUNBOOK.content, 'rd-runbook must reference the Slice 3 CLI').toContain(
      'peaks scan api-surface',
    );
  });

  test('AC-3 gate C enforcer file exists and exports the 3 mandatory titles', () => {
    expect(ENFORCER.content.length, 'enforcer file must not be empty').toBeGreaterThan(0);
    for (const title of MANDATORY_SECTION_TITLES) {
      expect(
        ENFORCER.content,
        `enforcer must export the literal title "${title}"`,
      ).toContain(`'${title}'`);
    }
    expect(ENFORCER.content, 'enforcer must export the error code constant').toContain(
      'TECH_DOC_MANDATORY_SECTIONS_MISSING',
    );
  });

  test('AC-3 gate C error message references karpathy-guidelines §1 / §2', () => {
    const errorBuilder = ENFORCER.content;
    expect(
      errorBuilder,
      'error message must reference karpathy-guidelines',
    ).toContain('karpathy-guidelines');
    expect(
      errorBuilder,
      'error message must cite §1 Think Before Coding',
    ).toContain('§1 Think Before Coding');
    expect(
      errorBuilder,
      'error message must cite §2 Simplicity First',
    ).toContain('§2 Simplicity First');
  });

  test('AC-3 request-artifact-service.ts wires the new enforcer into the spec-locked gate', () => {
    expect(
      GATE_FILE.content,
      'request-artifact-service.ts must dynamic-import the new enforcer',
    ).toContain('tech-doc-mandatory-sections.js');
    expect(
      GATE_FILE.content,
      'request-artifact-service.ts must call checkTechDocMandatorySections',
    ).toContain('checkTechDocMandatorySections');
    expect(
      GATE_FILE.content,
      'request-artifact-service.ts must throw PrerequisitesNotSatisfiedError on missing sections',
    ).toContain('PrerequisitesNotSatisfiedError');
  });

  test('AC-5 Slice 1 prompt-injection is preserved (regression guard)', () => {
    expect(SLICE1_RD_SKILL.content, 'Slice 1 Layer A must remain').toContain(
      '## Karpathy enforcement',
    );
    expect(SLICE1_SOLO_SKILL.content, 'Slice 1 Layer D must remain').toContain(
      '## Karpathy guidance',
    );
    for (const title of FOUR_TITLES) {
      expect(
        SLICE1_RD_SKILL.content,
        `Slice 1 Layer A must still mention "${title}"`,
      ).toContain(title);
    }
  });
});
