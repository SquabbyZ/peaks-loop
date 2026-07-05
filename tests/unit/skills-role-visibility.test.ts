/**
 * Six role-skill SKILL.md frontmatter visibility markers — Task 1 of
 * peaks-solo → peaks-code rename plan.
 *
 * Pins two contract assertions on each role skill:
 *   1. frontmatter contains `metadata.visibility: internal`
 *   2. body (case-insensitive) contains the phrase "not user-invocable"
 *
 * These two markers together tell the LLM that the role skill is
 * LLM-only — peaks-code invokes it via `peaks sub-agent dispatch
 * --role <role>`, and the user never types the role name directly.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('六个 role skill SKILL.md frontmatter 含 visibility: internal', () => {
  const repoRoot = join(__dirname, '..', '..');
  const roleSkills = ['peaks-prd', 'peaks-rd', 'peaks-qa', 'peaks-ui', 'peaks-sc', 'peaks-txt'];

  for (const name of roleSkills) {
    it(`${name}/SKILL.md 含 metadata.visibility: internal`, () => {
      const content = readFileSync(join(repoRoot, 'skills', name, 'SKILL.md'), 'utf-8');
      expect(content).toMatch(/^visibility:\s*internal/m);
    });
    it(`${name}/SKILL.md 含 "not user-invocable"`, () => {
      const content = readFileSync(join(repoRoot, 'skills', name, 'SKILL.md'), 'utf-8');
      expect(content.toLowerCase()).toContain('not user-invocable');
    });
  }
});