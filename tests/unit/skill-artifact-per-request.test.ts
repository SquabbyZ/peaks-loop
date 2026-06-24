import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const SKILLS_ROOT = join(process.cwd(), 'skills');

const ENFORCED_SKILLS: Array<{ name: string; role: string }> = [
  { name: 'peaks-prd', role: 'prd' },
  { name: 'peaks-ui', role: 'ui' },
  { name: 'peaks-rd', role: 'rd' },
  { name: 'peaks-qa', role: 'qa' }
];

describe('dogfood: per-request artifact requirement is documented in SKILL.md and references/', () => {
  for (const { name, role } of ENFORCED_SKILLS) {
    test(`${name} SKILL.md declares the Mandatory per-request artifact section`, async () => {
      const body = await readFile(join(SKILLS_ROOT, name, 'SKILL.md'), 'utf8');

      expect(body).toMatch(/## Mandatory per-request artifact/);
      expect(body).toMatch(new RegExp(`\\.peaks/_runtime/<session-id>/${role}/requests/<request-id>\\.md`));
      expect(body).toMatch(/references\/artifact-per-request\.md/);
    });

    test(`${name} references/artifact-per-request.md exists and defines required content`, async () => {
      const body = await readFile(join(SKILLS_ROOT, name, 'references', 'artifact-per-request.md'), 'utf8');

      expect(body).toMatch(/## Required path/);
      expect(body).toMatch(/## Required content/);
      expect(body).toMatch(/## Rules/);
      expect(body).toMatch(new RegExp(`\\.peaks/_runtime/<session-id>/${role}/requests/<request-id>\\.md`));
    });
  }

  test('per-request artifact references all share a consistent request-id format hint', async () => {
    for (const { name } of ENFORCED_SKILLS) {
      const body = await readFile(join(SKILLS_ROOT, name, 'references', 'artifact-per-request.md'), 'utf8');
      expect.soft(body, `${name} references should mention the YYYY-MM-DD-<kebab-slug> id format`).toMatch(/YYYY-MM-DD-<kebab-slug>/);
    }
  });
});
