import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync } from 'node:fs';
import { readText } from '../../shared/fs.js';
import { requiredSchemaFiles, requiredSkillNames, schemasDir } from '../../shared/paths.js';
import { getErrorMessage } from '../../shared/result.js';
import { loadSkillRegistry } from '../skills/skill-registry.js';

export type DoctorCheck = {
  id: string;
  ok: boolean;
  message: string;
};

export type DoctorReport = {
  checks: DoctorCheck[];
  summary: {
    ok: boolean;
    passed: number;
    failed: number;
  };
};

export type DoctorOptions = {
  schemasBaseDir?: string;
  skillsBaseDir?: string;
};

export async function runDoctor(options: DoctorOptions = {}): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const registry = await loadSkillRegistry(options.skillsBaseDir);
  const skills = registry.skills;
  const skillNames = new Set(skills.map((skill) => skill.name));

  for (const requiredSkill of requiredSkillNames) {
    checks.push({
      id: `skill:${requiredSkill}`,
      ok: skillNames.has(requiredSkill),
      message: skillNames.has(requiredSkill)
        ? `Required skill ${requiredSkill} exists`
        : `Missing required skill ${requiredSkill}`
    });
  }

  for (const skill of skills) {
    checks.push({
      id: `skill-name:${skill.directory}`,
      ok: skill.name === skill.directory,
      message: skill.name === skill.directory
        ? `Skill ${skill.name} matches its directory`
        : `Skill ${skill.directory} declares mismatched name ${skill.name}`
    });
  }

  for (const failure of registry.failures) {
    checks.push({
      id: `skill-parse:${failure.directory}`,
      ok: false,
      message: `Skill ${failure.directory} has invalid metadata: ${failure.message}`
    });
  }

  const schemaRoot = options.schemasBaseDir ?? schemasDir;

  for (const schemaFile of requiredSchemaFiles) {
    try {
      JSON.parse(await readText(join(schemaRoot, schemaFile)));
      checks.push({ id: `schema:${schemaFile}`, ok: true, message: `Schema ${schemaFile} is valid JSON` });
    } catch (error) {
      checks.push({
        id: `schema:${schemaFile}`,
        ok: false,
        message: `Schema ${schemaFile} is missing or invalid: ${getErrorMessage(error)}`
      });
    }
  }

  const userConfigPath = join(homedir(), '.peaks', 'config.json');
  const hasUserConfig = existsSync(userConfigPath);
  checks.push({
    id: 'config:user',
    ok: hasUserConfig,
    message: hasUserConfig ? 'User config exists at ~/.peaks/config.json' : 'User config not found at ~/.peaks/config.json'
  });

  const failed = checks.filter((check) => !check.ok).length;
  return {
    checks,
    summary: {
      ok: failed === 0,
      passed: checks.length - failed,
      failed
    }
  };
}
