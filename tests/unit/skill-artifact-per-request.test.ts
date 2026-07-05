import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SKILLS_ROOT = join(process.cwd(), 'skills');

// After the v2.13.0 bee-demote (commit de0872b), the role skills
// (peaks-prd, peaks-rd, peaks-qa, peaks-ui, peaks-sc, peaks-txt)
// moved under `skills/bee/<role>/` while user-facing helpers stayed
// at `skills/<name>/`. Tests need to read whichever layout exists.
async function readSkillFile(name: string, ...segments: string[]): Promise<string> {
  const direct = join(SKILLS_ROOT, name, ...segments);
  const demoted = join(SKILLS_ROOT, 'bee', name, ...segments);
  try {
    return await readFile(direct, 'utf8');
  } catch {
    return await readFile(demoted, 'utf8');
  }
}

const ENFORCED_SKILLS: Array<{ name: string; role: string }> = [
  { name: 'peaks-prd', role: 'prd' },
  { name: 'peaks-ui', role: 'ui' },
  { name: 'peaks-rd', role: 'rd' },
  { name: 'peaks-qa', role: 'qa' }
];

describe('dogfood: per-request artifact requirement is documented in SKILL.md and references/', () => {
  for (const { name, role } of ENFORCED_SKILLS) {
    test(`${name} SKILL.md declares the Mandatory per-request artifact section`, async () => {
      const body = await readSkillFile(name, 'SKILL.md');

      expect(body).toMatch(/## Mandatory per-request artifact/);
      expect(body).toMatch(new RegExp(`\\.peaks/_runtime/<session-id>/${role}/requests/<request-id>\\.md`));
      expect(body).toMatch(/references\/artifact-per-request\.md/);
    });

    test(`${name} references/artifact-per-request.md exists and defines required content`, async () => {
      const body = await readSkillFile(name, 'references', 'artifact-per-request.md');

      expect(body).toMatch(/## Required path/);
      expect(body).toMatch(/## Required content/);
      expect(body).toMatch(/## Rules/);
      expect(body).toMatch(new RegExp(`\\.peaks/_runtime/<session-id>/${role}/requests/<request-id>\\.md`));
    });
  }

  test('per-request artifact references all share a consistent request-id format hint', async () => {
    for (const { name } of ENFORCED_SKILLS) {
      const body = await readSkillFile(name, 'references', 'artifact-per-request.md');
      expect.soft(body, `${name} references should mention the YYYY-MM-DD-<kebab-slug> id format`).toMatch(/YYYY-MM-DD-<kebab-slug>/);
    }
  });
});
