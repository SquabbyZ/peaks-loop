/**
 * Loop Engineering Readiness linter — unit tests (M6 / spec §7.5 + §8.4).
 *
 * Covers the 6 cases required by M6:
 *   1. pass
 *   2. fail no-reference
 *   3. fail cli-verb-bypass
 *   4. fail json-surface
 *   5. fail manifest-hand-authoring
 *   6. multiple-findings aggregated
 *
 * Plus two sanity tests:
 *   7. peaks-maker's committed SKILL.md passes the lint (end-to-end)
 *   8. empty / missing input fails with skill-md-empty
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  lintSkillLoopEngineeringReadiness,
  ALLOWED_CLI_VERBS,
  JSON_HAND_AUTHORING_PHRASES,
  LOOP_ENGINEERING_GUIDELINE_PATHS,
} from '../../../src/services/standards/loop-engineering-readiness-lint.js';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');

function buildSkillMd(body: string): string {
  // A minimal frontmatter is required by the loader in real CLI
  // use, but the readiness lint does not parse frontmatter; it
  // operates on the full text. We still include a frontmatter
  // block so the text looks like a realistic SKILL.md.
  return [
    '---',
    'name: peaks-fake-skill',
    'description: fixture skill used by the readiness lint unit tests',
    '---',
    '',
    '# Peaks-Fake-Skill',
    '',
    body,
  ].join('\n');
}

describe('lintSkillLoopEngineeringReadiness (M6)', () => {
  it('1) passes for a SKILL.md that references the guideline file and uses only allowlisted verbs', () => {
    const text = buildSkillMd(
      [
        'A fixture skill that participates in Loop Engineering.',
        '',
        'Reference: .peaks/standards/loop-engineering-guidelines.md',
        '',
        'This skill runs `peaks asset crystallize` on the user\'s behalf.',
        'It also runs `peaks evolution propose` and `peaks evolution evaluate`.',
      ].join('\n'),
    );
    const result = lintSkillLoopEngineeringReadiness(text);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      // helpful failure trace
      // eslint-disable-next-line no-console
      console.error(result.findings);
    }
  });

  it('2) fails when the SKILL.md does not reference the guideline file', () => {
    const text = buildSkillMd('No reference to the shared guideline file at all.');
    const result = lintSkillLoopEngineeringReadiness(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const hasMissingRef = result.findings.some((f) =>
        f.startsWith('missing-guideline-reference:'),
      );
      expect(hasMissingRef).toBe(true);
    }
  });

  it('3) fails when the SKILL.md introduces a CLI verb the user is meant to type', () => {
    const text = buildSkillMd(
      [
        'Reference: .peaks/standards/loop-engineering-guidelines.md',
        '',
        'Run `peaks custom-evolve my-bee` to evolve your bee directly.',
      ].join('\n'),
    );
    const result = lintSkillLoopEngineeringReadiness(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const hasBypass = result.findings.some((f) =>
        f.startsWith('cli-verb-bypass:') && f.includes('peaks custom-evolve'),
      );
      expect(hasBypass).toBe(true);
    }
  });

  it('4) fails when the SKILL.md introduces a JSON hand-authoring surface', () => {
    const text = buildSkillMd(
      [
        'Reference: .peaks/standards/loop-engineering-guidelines.md',
        '',
        'To configure the skill, edit the json manifest for each release.',
      ].join('\n'),
    );
    const result = lintSkillLoopEngineeringReadiness(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const hasJson = result.findings.some((f) =>
        f.startsWith('json-hand-authoring:'),
      );
      expect(hasJson).toBe(true);
    }
  });

  it('5) fails when the SKILL.md introduces a manifest hand-authoring surface', () => {
    const text = buildSkillMd(
      [
        'Reference: .peaks/standards/loop-engineering-guidelines.md',
        '',
        'Edit the manifest and bump version yourself before publishing.',
      ].join('\n'),
    );
    const result = lintSkillLoopEngineeringReadiness(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const hasManifest = result.findings.some((f) =>
        f.startsWith('json-hand-authoring:'),
      );
      expect(hasManifest).toBe(true);
    }
  });

  it('6) aggregates multiple findings in a single lint call', () => {
    const text = buildSkillMd(
      [
        // no guideline reference -> finding #1
        // forbidden verb -> finding #2
        'Run `peaks my-thing` to do my thing.',
        // json hand-authoring -> finding #3
        'Edit the json manifest yourself to configure.',
      ].join('\n'),
    );
    const result = lintSkillLoopEngineeringReadiness(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.findings.length).toBeGreaterThanOrEqual(3);
      const codes = result.findings.map((f) => f.split(':')[0]);
      expect(codes).toContain('missing-guideline-reference');
      expect(codes).toContain('cli-verb-bypass');
      expect(codes).toContain('json-hand-authoring');
    }
  });

  it('passes the committed peaks-maker SKILL.md end-to-end (real-world sanity)', () => {
    const path = resolve(REPO_ROOT, 'src', 'skills', 'peaks-maker', 'SKILL.md');
    const text = readFileSync(path, 'utf-8');
    const result = lintSkillLoopEngineeringReadiness(text);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      // helpful failure trace
      // eslint-disable-next-line no-console
      console.error(result.findings);
    }
  });

  it('fails with skill-md-empty on empty input', () => {
    const result = lintSkillLoopEngineeringReadiness('');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.findings[0]).toMatch(/^skill-md-empty:/);
    }
  });

  it('exposes the canonical guideline path constant for downstream tooling', () => {
    expect(LOOP_ENGINEERING_GUIDELINE_PATHS[0]).toBe(
      '.peaks/standards/loop-engineering-guidelines.md',
    );
  });

  it('does NOT flag LLM-coordinated verbs from the sediment / asset / evolution surface', () => {
    // Sanity check on the allowlist itself: every documented verb
    // from §7.4 must be present, so we never false-positive on
    // legitimate LLM-coordinated invocations.
    const must = [
      'asset',
      'crystallize',
      'evolution',
      'propose',
      'evaluate',
      'revert',
      'mark-keep',
      'add-segment',
      'add-bee',
      'refine-bee',
      'clone-bee',
      'promote',
      'retire',
      'dispose',
      'export',
      'import',
      'list',
      'show',
      'lint',
    ];
    for (const v of must) {
      expect(ALLOWED_CLI_VERBS.has(v), `verb ${v} should be allowlisted`).toBe(true);
    }
  });

  it('does NOT flag references to schema_version / peaks.bundle/1', () => {
    // Lines that mention schema_version or peaks.bundle/1 are
    // schema references, not hand-authoring instructions. The lint
    // must accept them.
    const text = buildSkillMd(
      [
        'Reference: .peaks/standards/loop-engineering-guidelines.md',
        '',
        'The manifest schema is described in peaks.bundle/1.',
        'Every release carries a schema_version field.',
      ].join('\n'),
    );
    const result = lintSkillLoopEngineeringReadiness(text);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      // helpful failure trace
      // eslint-disable-next-line no-console
      console.error(result.findings);
    }
  });

  it('exposes a JSON hand-authoring phrase list that includes both `edit the json` and `edit the manifest`', () => {
    // Sanity check on the rule set so future edits do not silently
    // narrow the coverage.
    const lower = JSON_HAND_AUTHORING_PHRASES.map((p) => p.toLowerCase());
    expect(lower).toContain('edit the json');
    expect(lower).toContain('edit the manifest');
  });
});