import { join } from 'node:path';
import { listDirectories, pathExists, readText } from '../../shared/fs.js';
import { parseFrontmatter } from '../../shared/frontmatter.js';
import { skillsDir } from '../../shared/paths.js';

export type SkillMetadata = {
  name: string;
  description: string;
  directory: string;
  skillPath: string;
};

export type SkillLoadFailure = {
  directory: string;
  skillPath: string;
  message: string;
};

export type SkillRegistryResult = {
  skills: SkillMetadata[];
  failures: SkillLoadFailure[];
};

function getLoadFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unable to parse skill metadata';
}

export async function loadSkillRegistry(baseDir = skillsDir): Promise<SkillRegistryResult> {
  if (!(await pathExists(baseDir))) {
    return { skills: [], failures: [] };
  }

  const directories = await listDirectories(baseDir);
  const skills: SkillMetadata[] = [];
  const failures: SkillLoadFailure[] = [];

  for (const directory of directories) {
    // LLM-internal skills (bees) live under `bee/` per spec 2026-07-05.
    // Recurse one level into `bee/`; treat each child as a separate skill.
    if (directory === 'bee') {
      const subEntries = await listDirectories(join(baseDir, 'bee'));
      for (const subDir of subEntries) {
        const skillPath = join(baseDir, 'bee', subDir, 'SKILL.md');
        if (!(await pathExists(skillPath))) {
          continue;
        }
        try {
          const frontmatter = parseFrontmatter(await readText(skillPath));
          // `directory` is the on-disk skill folder name; for bees that is the
          // basename of the bee child, NOT `bee/<name>` (keeps the
          // doctor skill-name-matches-directory invariant working).
          skills.push({
            name: frontmatter.name,
            description: frontmatter.description,
            directory: subDir,
            skillPath
          });
        } catch (error) {
          failures.push({ directory: subDir, skillPath, message: getLoadFailureMessage(error) });
        }
      }
      continue;
    }
    const skillPath = join(baseDir, directory, 'SKILL.md');
    if (!(await pathExists(skillPath))) {
      continue;
    }
    try {
      const frontmatter = parseFrontmatter(await readText(skillPath));
      skills.push({
        name: frontmatter.name,
        description: frontmatter.description,
        directory,
        skillPath
      });
    } catch (error) {
      failures.push({ directory, skillPath, message: getLoadFailureMessage(error) });
    }
  }

  return {
    skills: skills.sort((left, right) => left.name.localeCompare(right.name)),
    failures: failures.sort((left, right) => left.directory.localeCompare(right.directory))
  };
}

export async function listSkills(baseDir = skillsDir): Promise<SkillMetadata[]> {
  return (await loadSkillRegistry(baseDir)).skills;
}
