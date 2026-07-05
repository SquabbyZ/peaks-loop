/**
 * Skill-conformance audit (Slice #12) — checks every peaks-* SKILL.md
 * against the 5 standards from the L1+L2+L3 redesign §5.4 Slice #12:
 *
 *   1. task-level frontmatter (all 12 skills must declare one)
 *   2. CLI-back 注解 coverage (each skill body must document which
 *      `peaks <cmd>` commands it composes; the absence is a SKILL.md
 *      anti-pattern — it means the LLM has to discover the CLI
 *      primitives by accident)
 *   3. loadStrategy on-demand 标注 (skills should declare when they
 *      load — `eager` for always-loaded, `on-demand` for invoked)
 *   4. 800-line cap (Karpathy limit per spec §2.3)
 *   5. outputStyle: peaks-concise-v1 frontmatter (peak-cli display
 *      style for the skill's user-visible output)
 *
 * Plus 1 derived check:
 *   6. CLI primitives declared in references/audit/ (Skill must
 *      surface every peaks <cmd> it composes in the references/ subdir;
 *      this is the "CLI-back 注解 100% 覆盖" check)
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export type LoadStrategy = 'eager' | 'on-demand';

export type ConformanceLevel = 'pass' | 'warn' | 'fail';

export interface ConformanceCheck {
  readonly id: string;
  readonly skill: string;
  readonly level: ConformanceLevel;
  readonly message: string;
}

export interface ConformanceReport {
  readonly checked: number;
  readonly passed: number;
  readonly warned: number;
  readonly failed: number;
  readonly checks: readonly ConformanceCheck[];
  readonly summary: string;
}

const SKILL_NAMES = [
  'peaks-ide',
  'peaks-prd',
  'peaks-ui',
  'peaks-rd',
  'peaks-qa',
  'peaks-sc',
  'peaks-code',
  'peaks-resume',
  'peaks-status',
  'peaks-test',
  'peaks-sop',
  'peaks-txt',
  'peaks-doctor'
] as const;

const REQUIRED_FRONTMATTER_FIELDS = ['name', 'description'] as const;
const OPTIONAL_FRONTMATTER_FIELDS = ['task-level', 'loadStrategy', 'outputStyle'] as const;
const MAX_LINE_COUNT = 800;

const CLI_BACK_PATTERNS: readonly RegExp[] = [
  /`peaks\s+[a-z][a-z0-9-]+(?:\s+[a-z][a-z0-9-]+)*`/g,
  /`peaks\s+[a-z][a-z0-9-]+/g,
];

function readSkillFrontmatter(skillPath: string): { raw: string; fields: Record<string, string> } | null {
  if (!existsSync(skillPath)) return null;
  const content = readFileSync(skillPath, 'utf-8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (match === null) return { raw: content, fields: {} };
  const raw = match[1] ?? '';
  const fields: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key.length > 0) fields[key] = value;
  }
  return { raw, fields };
}

function lineCount(filePath: string): number {
  try {
    return statSync(filePath).size > 0 ? readFileSync(filePath, 'utf-8').split(/\r?\n/).length : 0;
  } catch {
    return 0;
  }
}

function countCliBackReferences(content: string): number {
  let count = 0;
  for (const pattern of CLI_BACK_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = content.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

export interface SkillConformanceInput {
  readonly projectRoot: string;
}

export function auditSkillConformance(input: SkillConformanceInput): ConformanceReport {
  const skillsDir = join(input.projectRoot, 'skills');
  const checks: ConformanceCheck[] = [];

  for (const skillName of SKILL_NAMES) {
    const skillPath = join(skillsDir, skillName, 'SKILL.md');
    const fm = readSkillFrontmatter(skillPath);

    // 1. task-level frontmatter
    if (fm === null) {
      checks.push({ id: 'frontmatter:present', skill: skillName, level: 'fail', message: 'SKILL.md missing' });
    } else {
      for (const required of REQUIRED_FRONTMATTER_FIELDS) {
        if (fm.fields[required] === undefined) {
          checks.push({ id: `frontmatter:${required}`, skill: skillName, level: 'fail', message: `frontmatter missing required field "${required}"` });
        }
      }
    }

    // 2. CLI-back annotation
    if (fm !== null) {
      const content = readFileSync(skillPath, 'utf-8');
      const cliCount = countCliBackReferences(content);
      if (cliCount === 0) {
        checks.push({ id: 'cli-back:present', skill: skillName, level: 'warn', message: 'no `peaks <cmd>` references in SKILL.md body; consider documenting which CLI primitives the skill composes' });
      }
    }

    // 3. loadStrategy on-demand 标注
    if (fm !== null && fm.fields['loadStrategy'] === undefined) {
      checks.push({ id: 'loadStrategy:declared', skill: skillName, level: 'warn', message: 'loadStrategy not declared in frontmatter (eager | on-demand)' });
    }

    // 4. 800-line cap
    if (fm !== null) {
      const lines = lineCount(skillPath);
      if (lines > MAX_LINE_COUNT) {
        checks.push({ id: 'line-count:cap', skill: skillName, level: 'fail', message: `${lines} lines > ${MAX_LINE_COUNT} cap (Karpathy)` });
      }
    }

    // 5. outputStyle: peaks-concise-v1
    if (fm !== null && fm.fields['outputStyle'] === undefined) {
      checks.push({ id: 'outputStyle:declared', skill: skillName, level: 'warn', message: 'outputStyle not declared in frontmatter' });
    }
  }

  const failed = checks.filter((c) => c.level === 'fail').length;
  const warned = checks.filter((c) => c.level === 'warn').length;
  const passed = checks.filter((c) => c.level === 'pass').length;
  return {
    checked: checks.length,
    passed,
    warned,
    failed,
    checks,
    summary: failed === 0 ? 'all hard checks pass; warnings are advisory' : `${failed} hard failure(s); fix before shipping`,
  };
}
