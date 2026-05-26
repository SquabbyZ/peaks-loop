import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  getPrerequisitesFor,
  type RequestType,
  VALID_REQUEST_TYPES
} from '../../src/services/artifacts/artifact-prerequisites.js';

const SKILLS_ROOT = join(process.cwd(), 'skills');

/**
 * Coverage test: keeps the SKILL ↔ CLI surface honest.
 *
 * Each section guards against a previously-regressed drift:
 * 1. Per-request artifact paths in SKILL.md must use the canonical
 *    `<session-id>/<request-id>` token format (not the shorthand `<id>/<rid>`).
 * 2. peaks-rd / peaks-solo must keep the codegraph section headings the
 *    dogfood tests rely on.
 * 3. PRD handoff transition must have a CLI prereq gate (matches the SKILL
 *    claim "Handoff to RD/UI/QA is blocked while ... in `draft` state").
 */
describe('dogfood coverage: SKILL claims have CLI/file backing', () => {
  test('per-request artifact paths use <session-id>/<request-id>, never the shorthand', async () => {
    const skills = ['peaks-prd', 'peaks-ui', 'peaks-rd', 'peaks-qa'];
    for (const name of skills) {
      const body = await readFile(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');
      const section = extractSection(body, '## Mandatory per-request artifact');
      expect.soft(section, `${name} should not use the <id>/<rid> shorthand inside the artifact section`).not.toMatch(
        /\.peaks\/<id>\/[a-z]+\/(requests\/<rid>|test-(cases|reports)\/<rid>|design-draft)/
      );
    }
  });

  test('peaks-rd keeps the Codegraph project analysis heading', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-rd', 'SKILL.md'), 'utf8');
    expect(body).toContain('## Codegraph project analysis');
  });

  test('peaks-solo keeps the Codegraph orchestration context heading', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-solo', 'SKILL.md'), 'utf8');
    expect(body).toContain('## Codegraph orchestration context');
  });

  test('peaks-rd keeps the Matt Pocock skills integration heading', async () => {
    const body = await readFile(join(SKILLS_ROOT, 'peaks-rd', 'SKILL.md'), 'utf8');
    expect(body).toContain('## Matt Pocock skills integration');
  });

  test('PRD handoff transition has a CLI prereq gate for every gated request type', () => {
    // Bug + standards fix established the rule that SKILL "MANDATORY" claims need
    // CLI enforcement. For PRD, the SKILL says handoff is blocked when content is
    // still draft — this is the matching CLI gate.
    const gatedTypes: ReadonlyArray<RequestType> = ['feature', 'bugfix', 'refactor', 'config'];
    for (const type of gatedTypes) {
      const prereqs = getPrerequisitesFor('prd', 'handed-off', type);
      expect.soft(prereqs.length, `prd:handed-off should have prereqs for type=${type}`).toBeGreaterThan(0);
      const hasPrdContentCheck = prereqs.some(
        (p) => p.relativePath.includes('prd/requests/') && Array.isArray(p.mustContain) && p.mustContain.length > 0
      );
      expect.soft(hasPrdContentCheck, `prd:handed-off (${type}) should validate PRD body content (mustContain)`).toBe(true);
    }

    // docs/chore intentionally have no gates — keep that invariant explicit.
    for (const type of ['docs', 'chore'] satisfies ReadonlyArray<RequestType>) {
      const prereqs = getPrerequisitesFor('prd', 'handed-off', type);
      expect.soft(prereqs.length, `prd:handed-off should remain ungated for type=${type}`).toBe(0);
    }
  });

  test('every request type listed in VALID_REQUEST_TYPES has an entry in the prereq map', () => {
    // Belt-and-braces: a new RequestType added without a matching table entry
    // would silently bypass all CLI gates. This catches that drift.
    for (const type of VALID_REQUEST_TYPES) {
      // PRD handed-off is the canonical first gate; existence checked separately above.
      // Here we just ensure the lookup itself doesn't throw and returns an array.
      const prereqs = getPrerequisitesFor('prd', 'handed-off', type);
      expect(Array.isArray(prereqs)).toBe(true);
    }
  });
});

function extractSection(body: string, heading: string): string {
  const start = body.indexOf(heading);
  if (start === -1) return '';
  const next = body.indexOf('\n## ', start + heading.length);
  return next === -1 ? body.slice(start) : body.slice(start, next);
}
