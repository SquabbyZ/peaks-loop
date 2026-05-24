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

const DESTRUCTIVE_APPLY_PATTERNS = [
  /peaks\s+memory\s+sync[^\n]*--apply/,
  /peaks\s+memory\s+extract[^\n]*--apply/,
  /peaks\s+artifacts\s+sync[^\n]*--apply/,
  /peaks\s+openspec\s+archive[^\n]*--apply/,
  /peaks\s+standards\s+(?:init|update)[^\n]*--apply/
];

const AUTHORIZATION_KEYWORDS_PATTERN = /authoriz|explicit|--dry-run|approv|only after|only when/i;

function extractRunbookSection(body: string): string | null {
  const match = /## Default runbook\n+([\s\S]*?)(?=\n## |$)/.exec(body);
  return match === null ? null : (match[1] ?? null);
}

function findDestructiveApplyLines(section: string): string[] {
  const lines = section.split(/\r?\n/);
  return lines.filter((line) => DESTRUCTIVE_APPLY_PATTERNS.some((pattern) => pattern.test(line)));
}

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

  const requiredSkillNameSet = new Set<string>(requiredSkillNames);
  for (const skill of skills) {
    if (!requiredSkillNameSet.has(skill.name)) {
      continue;
    }
    try {
      const body = await readText(skill.skillPath);
      const hasRunbook = /## Default runbook\s/.test(body);
      checks.push({
        id: `skill-runbook:${skill.name}`,
        ok: hasRunbook,
        message: hasRunbook
          ? `Skill ${skill.name} declares a Default runbook`
          : `Skill ${skill.name} is missing a ## Default runbook section`
      });

      const runbookSection = extractRunbookSection(body);
      if (runbookSection !== null) {
        const destructiveLines = findDestructiveApplyLines(runbookSection);
        if (destructiveLines.length === 0) {
          checks.push({
            id: `skill-apply-note:${skill.name}`,
            ok: true,
            message: `Skill ${skill.name} runbook has no destructive --apply commands to gate`
          });
        } else {
          const hasAuthorizationNote = AUTHORIZATION_KEYWORDS_PATTERN.test(runbookSection);
          checks.push({
            id: `skill-apply-note:${skill.name}`,
            ok: hasAuthorizationNote,
            message: hasAuthorizationNote
              ? `Skill ${skill.name} gates ${destructiveLines.length} destructive --apply command(s) with an authorization note`
              : `Skill ${skill.name} has ${destructiveLines.length} destructive --apply command(s) without an authorization/dry-run note in the runbook section`
          });
        }
      }
    } catch (error) {
      checks.push({
        id: `skill-runbook:${skill.name}`,
        ok: false,
        message: `Skill ${skill.name} runbook check failed: ${getErrorMessage(error)}`
      });
    }
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
    ok: true,
    message: hasUserConfig ? 'User config exists at ~/.peaks/config.json' : 'Optional user config not found at ~/.peaks/config.json'
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
