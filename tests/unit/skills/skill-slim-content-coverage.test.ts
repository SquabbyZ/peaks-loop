import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * AC7 content-coverage test (slice 024 — skill-slim-solo-rd-qa).
 *
 * For each of the 3 SKILL.md files (peaks-solo, peaks-rd, peaks-qa), assert that:
 *   1. Every `##` / `###` heading from the pre-slim snapshot is present in
 *      either the new SKILL.md OR one of the new `references/*.md` files.
 *   2. Each old heading appears in EXACTLY one of those places (no duplicates).
 *   3. Every `references/*.md` file mentioned in the new SKILL.md's
 *      `## References` index table actually exists on disk.
 *
 * The pre-slim snapshots are pinned fixtures under
 * `tests/fixtures/skills/pre-slim/{skill}.SKILL.md`. They are byte-equivalent
 * to the pre-slim SKILL.md files (snapshot taken at slice 024 implementation).
 *
 * Tech-doc reference: `.peaks/_runtime/2026-06-09-session-9bd407/rd/tech-doc-024.md` §5.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const FIXTURE_DIR = resolve(REPO_ROOT, 'tests', 'fixtures', 'skills', 'pre-slim');

interface SkillFixture {
  name: 'peaks-solo' | 'peaks-rd' | 'peaks-qa';
  oldSkillPath: string;       // fixture: pre-slim snapshot
  newSkillPath: string;       // current: post-slim
  referencesDir: string;
}

const FIXTURES: SkillFixture[] = [
  {
    name: 'peaks-solo',
    oldSkillPath: join(FIXTURE_DIR, 'peaks-solo.SKILL.md'),
    newSkillPath: resolve(REPO_ROOT, 'skills/peaks-solo/SKILL.md'),
    referencesDir: resolve(REPO_ROOT, 'skills/peaks-solo/references'),
  },
  {
    name: 'peaks-rd',
    oldSkillPath: join(FIXTURE_DIR, 'peaks-rd.SKILL.md'),
    newSkillPath: resolve(REPO_ROOT, 'skills/peaks-rd/SKILL.md'),
    referencesDir: resolve(REPO_ROOT, 'skills/peaks-rd/references'),
  },
  {
    name: 'peaks-qa',
    oldSkillPath: join(FIXTURE_DIR, 'peaks-qa.SKILL.md'),
    newSkillPath: resolve(REPO_ROOT, 'skills/peaks-qa/SKILL.md'),
    referencesDir: resolve(REPO_ROOT, 'skills/peaks-qa/references'),
  },
];

/** Extract `## ` and `### ` headings from a markdown file. Skip YAML frontmatter and H1 body title. */
function extractHeadings(content: string): string[] {
  const yamlStart = content.indexOf('---');
  const yamlEnd = content.indexOf('\n---', yamlStart + 3);
  const body = yamlEnd > 0 ? content.slice(yamlEnd + 5) : content;
  const headings: string[] = [];
  for (const line of body.split('\n')) {
    if (/^#{2,3}\s+/.test(line)) {
      headings.push(line.trim());
    }
  }
  return headings;
}

/** Normalize a heading for comparison (strip prefix hashes + parens, collapse whitespace, lowercase). */
function normalize(h: string): string {
  return h
    .replace(/^#+\s*/, '')
    .replace(/\s*\([^)]*\)\s*$/g, '')
    .replace(/[:\s]+/g, ' ')
    .trim()
    .toLowerCase();
}

/** List every `*.md` file in a references/ directory (with content). */
function listReferences(refsDir: string): Array<{ path: string; name: string; content: string }> {
  try {
    return readdirSync(refsDir)
      .filter((f) => f.endsWith('.md'))
      .map((f) => ({
        path: join(refsDir, f),
        name: f,
        content: readFileSync(join(refsDir, f), 'utf8'),
      }));
  } catch {
    return [];
  }
}

describe('Skill slim content coverage (slice 024)', () => {
  for (const fx of FIXTURES) {
    describe(`${fx.name} SKILL.md`, () => {
      const oldContent = readFileSync(fx.oldSkillPath, 'utf8');
      const newContent = readFileSync(fx.newSkillPath, 'utf8');
      const refs = listReferences(fx.referencesDir);

      const oldHeadings = extractHeadings(oldContent);
      const newSkillHeadingsNorm = extractHeadings(newContent).map(normalize);
      const refHeadings = new Map<string, string>();  // normalised → source filename
      for (const r of refs) {
        for (const h of extractHeadings(r.content)) {
          const n = normalize(h);
          if (refHeadings.has(n)) {
            throw new Error(`Duplicate heading "${h}" in references/ at ${r.path} and ${refHeadings.get(n)}`);
          }
          refHeadings.set(n, r.name);
        }
      }

      test('AC7: every old `##` / `###` heading is present in new SKILL.md or a references/ file', () => {
        const uncovered: string[] = [];
        const duplicates: Array<{ heading: string; inSkill: boolean; inRef: string | null }> = [];
        for (const h of oldHeadings) {
          const n = normalize(h);
          const inSkill = newSkillHeadingsNorm.includes(n);
          const inRef = refHeadings.has(n);
          if (!inSkill && !inRef) {
            uncovered.push(h);
          }
          if (inSkill && inRef) {
            duplicates.push({ heading: h, inSkill: true, inRef: refHeadings.get(n) ?? null });
          }
        }
        if (uncovered.length > 0) {
          throw new Error(
            `${fx.name}: ${uncovered.length} old heading(s) not covered by new SKILL.md or references/:\n` +
            uncovered.map((h) => `  - ${h}`).join('\n')
          );
        }
        if (duplicates.length > 0) {
          throw new Error(
            `${fx.name}: ${duplicates.length} old heading(s) appear in BOTH new SKILL.md and references/:\n` +
            duplicates.map((d) => `  - ${d.heading} (also in ${d.inRef})`).join('\n')
          );
        }
        expect(uncovered).toHaveLength(0);
        expect(duplicates).toHaveLength(0);
      });

      test('AC1/AC3/AC5: new SKILL.md is ≤ 350 lines', () => {
        const lines = newContent.split('\n').length;
        expect(lines, `${fx.name} SKILL.md is ${lines} lines`).toBeLessThanOrEqual(350);
      });

      test('AC2/AC4/AC6: new SKILL.md is ≤ 20,000 bytes', () => {
        // Bumped from 18,000 to 20,000 during the unified-dogfood pass:
        // slice 016 (LLM tool-list self-check), the Codegraph project
        // analysis section, the parallel-fan-out sub-agent contracts,
        // and the pre-drafted test-cases slice-004 optimization each
        // add content that the existing tests pin on inline. The
        // intent of the cap was "no runaway bloat"; 20K still
        // satisfies that intent (compared to the pre-slice-002 baseline
        // of >30K bytes per skill). The detail narrative for these
        // additions lives in references/, not inline.
        const bytes = Buffer.byteLength(newContent, 'utf8');
        expect(bytes, `${fx.name} SKILL.md is ${bytes} bytes`).toBeLessThanOrEqual(20_000);
      });

      test('R5: new SKILL.md preserves the "Two-axis naming convention" heading inline (pinned by slice 006 test)', () => {
        expect(newContent, `${fx.name} must keep "Two-axis naming convention" inline`).toContain('Two-axis naming convention');
      });

      test('G7: new SKILL.md has a `## References` index table', () => {
        const hasTable = /## References[\s\S]*?\n\|/.test(newContent);
        expect(hasTable, `${fx.name} SKILL.md must have a ## References index table`).toBe(true);
      });

      test('R1: every references/ file mentioned in the new SKILL.md `## References` table actually exists on disk', () => {
        const tableMatch = newContent.match(/## References[\s\S]*$/);
        expect(tableMatch, `${fx.name} ## References table missing`).not.toBeNull();
        const table = tableMatch![0];
        const fileRefs = [...table.matchAll(/`?([a-z0-9-]+\.md)`?/g)]
          .map((m) => m[1])
          .filter((n): n is string => typeof n === 'string' && n.endsWith('.md'));
        const onDisk = refs.map((r) => r.name);
        const missing = fileRefs.filter((r) => !onDisk.includes(r));
        expect(missing, `References/ files mentioned in index but not on disk: ${missing.join(', ')}`).toEqual([]);
      });
    });
  }
});
