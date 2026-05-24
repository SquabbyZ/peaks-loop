import { readText } from '../../shared/fs.js';
import { loadSkillRegistry } from './skill-registry.js';

const DESTRUCTIVE_APPLY_PATTERNS = [
  /peaks\s+memory\s+sync[^\n]*--apply/,
  /peaks\s+memory\s+extract[^\n]*--apply/,
  /peaks\s+artifacts\s+sync[^\n]*--apply/,
  /peaks\s+openspec\s+archive[^\n]*--apply/,
  /peaks\s+standards\s+(?:init|update)[^\n]*--apply/
];

const AUTHORIZATION_KEYWORDS_PATTERN = /authoriz|explicit|--dry-run|approv|only after|only when/i;
const PEAKS_COMMAND_LINE_PATTERN = /^\s*peaks\s+\w/;

export type SkillRunbookInspection = {
  name: string;
  directory: string;
  hasRunbook: boolean;
  peaksCommandCount: number;
  peaksCommandLines: string[];
  destructiveApplyLines: string[];
  hasAuthorizationNote: boolean;
  ok: boolean;
};

function extractRunbookSection(body: string): string | null {
  const match = /## Default runbook\n+([\s\S]*?)(?=\n## |$)/.exec(body);
  return match === null ? null : (match[1] ?? null);
}

function findDestructiveApplyLines(section: string): string[] {
  const lines = section.split(/\r?\n/);
  return lines.filter((line) => DESTRUCTIVE_APPLY_PATTERNS.some((pattern) => pattern.test(line)));
}

function findPeaksCommandLines(section: string): string[] {
  return section
    .split(/\r?\n/)
    .filter((line) => PEAKS_COMMAND_LINE_PATTERN.test(line))
    .map((line) => line.trim());
}

export async function inspectSkillRunbook(name: string, baseDir?: string): Promise<SkillRunbookInspection> {
  const registry = await loadSkillRegistry(baseDir);
  const skill = registry.skills.find((entry) => entry.name === name);
  if (skill === undefined) {
    throw new Error(`Skill "${name}" not found under skills directory`);
  }

  const body = await readText(skill.skillPath);
  const section = extractRunbookSection(body);
  if (section === null) {
    return {
      name: skill.name,
      directory: skill.directory,
      hasRunbook: false,
      peaksCommandCount: 0,
      peaksCommandLines: [],
      destructiveApplyLines: [],
      hasAuthorizationNote: false,
      ok: false
    };
  }

  const peaksCommandLines = findPeaksCommandLines(section);
  const destructiveApplyLines = findDestructiveApplyLines(section);
  const hasAuthorizationNote = AUTHORIZATION_KEYWORDS_PATTERN.test(section);
  const ok = destructiveApplyLines.length === 0 || hasAuthorizationNote;

  return {
    name: skill.name,
    directory: skill.directory,
    hasRunbook: true,
    peaksCommandCount: peaksCommandLines.length,
    peaksCommandLines,
    destructiveApplyLines,
    hasAuthorizationNote,
    ok
  };
}
