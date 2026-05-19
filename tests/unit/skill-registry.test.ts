import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import { listSkills } from '../../src/services/skills/skill-registry.js';

describe('listSkills', () => {
  test('derives skills from SKILL.md frontmatter', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-skills-'));
    await mkdir(join(root, 'demo-skill'));
    await writeFile(join(root, 'demo-skill', 'SKILL.md'), `---\nname: demo-skill\ndescription: Demo skill\n---\n# Demo\n`);

    const skills = await listSkills(root);

    expect(skills).toEqual([
      expect.objectContaining({ name: 'demo-skill', description: 'Demo skill', directory: 'demo-skill' })
    ]);
  });

  test('ignores directories without SKILL.md', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-skills-'));
    await mkdir(join(root, 'empty'));

    await expect(listSkills(root)).resolves.toEqual([]);
  });

  test('skips invalid SKILL.md frontmatter without dropping valid skills', async () => {
    const root = await mkdtemp(join(tmpdir(), 'peaks-skills-'));
    await mkdir(join(root, 'valid-skill'));
    await mkdir(join(root, 'broken-skill'));
    await writeFile(join(root, 'valid-skill', 'SKILL.md'), `---\nname: valid-skill\ndescription: Valid skill\n---\n# Valid\n`);
    await writeFile(join(root, 'broken-skill', 'SKILL.md'), `---\nname: broken-skill\n---\n# Broken\n`);

    const skills = await listSkills(root);

    expect(skills).toEqual([
      expect.objectContaining({ name: 'valid-skill', description: 'Valid skill', directory: 'valid-skill' })
    ]);
  });

  test('returns empty array when base directory does not exist', async () => {
    const result = await listSkills('/this/path/does/not/exist/at/all');
    expect(result).toEqual([]);
  });
});
