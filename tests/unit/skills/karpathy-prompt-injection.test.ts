import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * Regression test for slice 2026-06-17-karpathy-enforcement (Slice 1/6).
 *
 * Asserts that the 4 karpathy-guidelines prompt-injection layers are
 * present and aligned. The full guidelines text lives at
 * `andrej-karpathy-skills:karpathy-guidelines` (skill id). This test
 * pins the 4-layer injection so that future skill refactors cannot
 * silently drop karpathy context from any layer.
 *
 * Layers under test (per Slice 1 PRD §AC-1):
 *   A. peaks-rd/SKILL.md has "## Karpathy enforcement" section
 *      containing all 4 guideline titles.
 *   B. peaks-rd/references/rd-sub-agent-dispatch.md has
 *      "## Karpathy-guidelines context" section containing the full
 *      4-guideline text block.
 *   C. peaks-rd/references/rd-fanout-contracts.md has the
 *      "Karpathy pointer" callout near the 4 sub-agents list.
 *   D. peaks-code/SKILL.md has "## Karpathy guidance" section
 *      referencing the dispatch block.
 *
 * Cross-references:
 *   - PRD: .peaks/_runtime/2026-06-17-session-1baf0a/prd/requests/001-2026-06-17-karpathy-enforcement.md
 *   - Tech-doc: .peaks/_runtime/2026-06-17-session-1baf0a/rd/tech-doc.md
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const HOME = process.env.HOME ?? '';

interface InjectedFile {
  layer: 'A' | 'B' | 'C' | 'D';
  name: string;
  path: string;
  content: string;
}

const INJECTED_FILES: InjectedFile[] = [
  {
    layer: 'A',
    name: 'peaks-rd/SKILL.md',
    path: resolve(REPO_ROOT, 'skills/bee/peaks-rd/SKILL.md'),
    content: ''
  },
  {
    layer: 'B',
    name: 'peaks-rd/references/rd-sub-agent-dispatch.md',
    path: resolve(REPO_ROOT, 'skills/bee/peaks-rd/references/rd-sub-agent-dispatch.md'),
    content: ''
  },
  {
    layer: 'C',
    name: 'peaks-rd/references/rd-fanout-contracts.md',
    path: resolve(REPO_ROOT, 'skills/bee/peaks-rd/references/rd-fanout-contracts.md'),
    content: ''
  },
  {
    layer: 'D',
    name: 'peaks-code/SKILL.md',
    path: resolve(REPO_ROOT, 'skills/peaks-code/SKILL.md'),
    content: ''
  }
];

const GLOBAL_KARPATHY_FILE = {
  name: 'karpathy-guidelines (skill source)',
  path: resolve(HOME, '.claude/skills/andrej-karpathy-src/skills/karpathy-guidelines/SKILL.md'),
  content: ''
};

for (const file of INJECTED_FILES) {
  file.content = readFileSync(file.path, 'utf8');
}

let globalKarpathyAvailable = false;
try {
  GLOBAL_KARPATHY_FILE.content = readFileSync(GLOBAL_KARPATHY_FILE.path, 'utf8');
  globalKarpathyAvailable = true;
} catch {
  // Global karpathy skill is optional; the test focuses on the 4 in-repo layers.
  globalKarpathyAvailable = false;
}

const FOUR_TITLES = [
  'Think Before Coding',
  'Simplicity First',
  'Surgical Changes',
  'Goal-Driven Execution'
] as const;

describe('Karpathy prompt-injection (Slice 1/6 — karpathy-enforcement)', () => {
  test('AC-3 all 4 injected files exist on disk', () => {
    for (const file of INJECTED_FILES) {
      expect(file.content.length, `${file.name} should not be empty`).toBeGreaterThan(0);
    }
  });

  test('AC-1 Layer A: peaks-rd/SKILL.md has "## Karpathy enforcement" with all 4 titles', () => {
    const layerA = INJECTED_FILES.find((f) => f.layer === 'A')!;
    expect(layerA.content, 'Layer A must contain section heading').toContain('## Karpathy enforcement');
    for (const title of FOUR_TITLES) {
      expect(layerA.content, `Layer A must mention "${title}"`).toContain(title);
    }
  });

  test('AC-1 Layer B: rd-sub-agent-dispatch.md has "## Karpathy-guidelines context" with full 4-guideline block', () => {
    const layerB = INJECTED_FILES.find((f) => f.layer === 'B')!;
    expect(layerB.content, 'Layer B must contain section heading').toContain('## Karpathy-guidelines context');
    for (const title of FOUR_TITLES) {
      expect(layerB.content, `Layer B must mention "${title}"`).toContain(title);
    }
    // Verbatim phrases from the karpathy guidelines text (signature markers)
    expect(layerB.content).toContain('Minimum code that solves the problem');
    expect(layerB.content).toContain("Don't assume. Don't hide confusion. Surface tradeoffs");
    expect(layerB.content).toContain('Touch only what you must. Clean up only your own mess');
    expect(layerB.content).toContain('Define success criteria. Loop until verified');
  });

  test('AC-1 Layer C: rd-fanout-contracts.md has karpathy pointer near the 3 sub-agents (v2.12.0 collapse)', () => {
    const layerC = INJECTED_FILES.find((f) => f.layer === 'C')!;
    expect(layerC.content, 'Layer C must mention Karpathy pointer').toContain('Karpathy pointer');
    // v2.12.0: 3-way fan-out (code-reviewer + qa-test-cases-writer + karpathy-reviewer).
    expect(layerC.content, 'Layer C must mention code-reviewer').toContain('Sub-agent 1 — code-reviewer');
    expect(layerC.content, 'Layer C must mention qa-test-cases-writer').toContain('Sub-agent 2 — qa-test-cases-writer');
    expect(layerC.content, 'Layer C must mention karpathy-reviewer').toContain('Sub-agent 3 — karpathy-reviewer');
  });

  test('AC-1 Layer D: peaks-code/SKILL.md has "## Karpathy guidance" referencing dispatch block', () => {
    const layerD = INJECTED_FILES.find((f) => f.layer === 'D')!;
    expect(layerD.content, 'Layer D must contain section heading').toContain('## Karpathy guidance');
    expect(layerD.content, 'Layer D must reference the dispatch block').toContain('Karpathy-guidelines context');
  });

  test('AC-3 all 4 injected files contain the "karpathy-guidelines" literal', () => {
    for (const file of INJECTED_FILES) {
      expect(file.content, `${file.name} must reference karpathy-guidelines`).toContain('karpathy-guidelines');
    }
  });

  test('AC-2 error message alignment (red-line-catalog / pipeline-verify / FileSizeViolationError)', () => {
    const redLineCatalog = readFileSync(
      resolve(REPO_ROOT, 'src/services/audit/red-line-catalog-p2-b.ts'),
      'utf8'
    );
    expect(redLineCatalog).toContain('Karpathy Guidelines §2 Simplicity First');
    expect(redLineCatalog).not.toContain('Karpathy 4 原则 §2.3');

    const pipelineVerify = readFileSync(
      resolve(REPO_ROOT, 'src/services/workflow/pipeline-verify-service.ts'),
      'utf8'
    );
    expect(pipelineVerify).toContain('karpathy-guidelines §1 Think / §2 Simplicity / §3 Surgical / §4 Goal-Driven');

    const requestArtifact = readFileSync(
      resolve(REPO_ROOT, 'src/services/artifacts/request-artifact-service.ts'),
      'utf8'
    );
    // v2.18.3 file-split: the `FileSizeViolationError` class lives in the
    // sibling `request-artifact-state-helpers.ts` module (verbatim move).
    // The karpathy-guidelines message is the public-surface anchor the
    // AC-2 test was protecting; it must appear in EITHER the original
    // module (via the re-export shim's transitive reference) OR the
    // sibling — both are part of the public surface.
    const requestArtifactHelpers = readFileSync(
      resolve(REPO_ROOT, 'src/services/artifacts/request-artifact-state-helpers.ts'),
      'utf8'
    );
    const requestArtifactHasMessage = requestArtifact.includes('consider reusing existing components / existing API data')
      && requestArtifact.includes('karpathy-guidelines §2 Simplicity First');
    const requestArtifactHelpersHasMessage = requestArtifactHelpers.includes('consider reusing existing components / existing API data')
      && requestArtifactHelpers.includes('karpathy-guidelines §2 Simplicity First');
    expect(requestArtifactHasMessage || requestArtifactHelpersHasMessage).toBe(true);
  });

  test('AC-5 no bare <sid> placeholder introduced in injected layers (naming convention preserved)', () => {
    // The two-axis convention requires <sessionId> / <sessionId>, not bare <sid>.
    // The canonical callout at the top of each SKILL.md already documents the
    // <sid> prohibition. Lines that contain any of these markers are EXEMPT
    // because they ARE the negative example:
    //   - "bare `<sid>`"  (with backticks around <sid>, the canonical prose form)
    //   - "NEVER bare"    (the negative-example phrasing)
    //   - "<sid> — ambiguous"
    //   - "zero bare <sid>"
    for (const file of INJECTED_FILES) {
      const lines = file.content.split('\n');
      for (const line of lines) {
        if (line.includes('bare `<sid>`')) continue; // canonical prose negative example
        if (line.includes('NEVER bare')) continue; // canonical negative example
        if (line.includes('zero bare')) continue; // canonical callout
        if (line.includes('<sid> — ambiguous')) continue; // canonical negative example
        expect(line, `${file.name} must not use bare <sid> in new content`).not.toMatch(/[^<]<sid>[^>]/);
      }
    }
  });

  test('global andrej-karpathy-skills source is the canonical reference (when available)', () => {
    if (!globalKarpathyAvailable) {
      return;
    }
    expect(GLOBAL_KARPATHY_FILE.content).toContain('Think Before Coding');
    expect(GLOBAL_KARPATHY_FILE.content).toContain('Simplicity First');
    expect(GLOBAL_KARPATHY_FILE.content).toContain('Surgical Changes');
    expect(GLOBAL_KARPATHY_FILE.content).toContain('Goal-Driven Execution');
  });
});
