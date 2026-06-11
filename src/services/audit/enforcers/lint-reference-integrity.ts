/**
 * P2-a Theme E — reference integrity enforcers.
 *
 * Static pattern scans of skill bodies + references/ for inline
 * shell snippets that violate the project's "no
 * mkdir-outside-project" / "no /tmp cp" / "no cd .." rules.
 *
 * These are pattern-based: the audit framework invokes the helper
 * with a skill's body and the helper returns lint hits.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LintHit, SkillFile } from './lint-style.js';

const MKDIR_PATTERN = /\bmkdir\s+(?:-p\s+)?(\/[^\s'`"]+|[A-Z]:[^\s'`"]+)/g;
const CD_OUT_PATTERN = /\bcd\s+(\.\.[\\/]|[A-Z]:[\\/])/g;
const CP_MV_LN_TMP_PATTERN = /\b(cp|mv|ln)\b[^\n]*\/tmp\b/g;

/** Theme E — reference integrity. */
export function lintRefPathResolves(skillsRoot: string, name: string, refs: readonly string[]): readonly LintHit[] {
  const hits: LintHit[] = [];
  for (const ref of refs) {
    const path = join(skillsRoot, name, 'references', ref);
    if (!existsSync(path)) {
      hits.push({
        catalogId: 'rl-ref-path-resolves-001',
        rule: 'every references/<file>.md link resolves',
        file: join(skillsRoot, name, 'SKILL.md'),
        line: 1,
        matchedText: ref
      });
    }
  }
  return hits;
}

export function lintNoBrokenMkdir(skill: SkillFile): readonly LintHit[] {
  const hits: LintHit[] = [];
  for (let i = 0; i < skill.lines.length; i += 1) {
    const line = skill.lines[i] ?? '';
    if (MKDIR_PATTERN.test(line)) {
      hits.push({
        catalogId: 'rl-ref-no-broken-mkdir-001',
        rule: 'no `mkdir -p` outside the project root',
        file: skill.path,
        line: i + 1,
        matchedText: line.trim()
      });
    }
    MKDIR_PATTERN.lastIndex = 0;
  }
  return hits;
}

export function lintNoPwdSymlinkJumps(skill: SkillFile): readonly LintHit[] {
  const hits: LintHit[] = [];
  for (let i = 0; i < skill.lines.length; i += 1) {
    const line = skill.lines[i] ?? '';
    if (CD_OUT_PATTERN.test(line)) {
      hits.push({
        catalogId: 'rl-ref-no-pwd-symlink-jumps-001',
        rule: 'no `cd ..` chain jumping outside the project',
        file: skill.path,
        line: i + 1,
        matchedText: line.trim()
      });
    }
    CD_OUT_PATTERN.lastIndex = 0;
  }
  return hits;
}

export function lintNoRelativeArchivePaths(skill: SkillFile): readonly LintHit[] {
  const hits: LintHit[] = [];
  for (let i = 0; i < skill.lines.length; i += 1) {
    const line = skill.lines[i] ?? '';
    if (CP_MV_LN_TMP_PATTERN.test(line)) {
      hits.push({
        catalogId: 'rl-ref-no-relative-archive-paths-001',
        rule: 'no `cp`/`mv`/`ln` to absolute /tmp paths',
        file: skill.path,
        line: i + 1,
        matchedText: line.trim()
      });
    }
    CP_MV_LN_TMP_PATTERN.lastIndex = 0;
  }
  return hits;
}
