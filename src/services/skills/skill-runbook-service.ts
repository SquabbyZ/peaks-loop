import { dirname, join } from 'node:path';
import * as path from 'node:path';
import { readText } from 'peaks-loop-shared/fs';
import { loadSkillRegistry } from './skill-registry.js';

const DESTRUCTIVE_APPLY_PATTERNS = [
  /peaks\s+memory\s+sync[^\n]*--apply/,
  /peaks\s+memory\s+extract[^\n]*--apply/,
  /peaks\s+artifacts\s+sync[^\n]*--apply/,
  /peaks\s+openspec\s+archive[^\n]*--apply/,
  /peaks\s+standards\s+(?:init|update)[^\n]*--apply/,
  /peaks\s+workspace\s+reconcile[^\n]*--apply/
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
  // Find a `## Default runbook` heading at the start of a line, then capture
  // the section body up to the next `## ` heading or end of input.
  //
  // Implementation note: we avoid a regex with a multiline `(?=\n## |$)`
  // lookahead because the `m` flag turns `$` into "end of any line" in
  // JavaScript, which would let the lazy capture stop at the first `\n`.
  // Instead, we (a) use the regex only to locate the heading, then (b)
  // manually scan forward for the next `## ` heading or end of input.
  const headingRe = /^## Default runbook[^\n]*(?:\n|$)/m;
  const headingMatch = headingRe.exec(body);
  if (headingMatch === null) return null;
  const startAfter = headingMatch.index + headingMatch[0].length;
  const rest = body.slice(startAfter);
  // Find the next `## ` heading at the start of a line.
  const nextHeadingRe = /^## /m;
  const nextMatch = nextHeadingRe.exec(rest);
  const end = nextMatch === null ? rest.length : nextMatch.index;
  return rest.slice(0, end);
}

/**
 * Load the runbook section, falling back to `references/runbook.md` if the
 * SKILL.md only has a pointer section. This supports skills (notably
 * `peaks-code`) that extracted their 150-line bash runbook to a sibling
 * reference to keep SKILL.md under the 800-line cap. The CLI
 * `peaks skill runbook` command uses the same fallback so a human
 * reviewer sees the full runbook regardless of where it lives.
 *
 * Strategy: prefer the LONGER of the two sections. A short pointer section
 * in SKILL.md (~ 1-2 lines) is treated as a "this runbook is in the
 * reference" marker; a long inline section (>= the reference length) is
 * treated as the canonical runbook. This avoids the false positive where
 * the pointer section's regex match returns a non-null but content-poor
 * string.
 */
async function loadRunbookSection(skillPath: string, body: string): Promise<string | null> {
  const inline = extractRunbookSection(body);
  const skillDir = dirname(skillPath);
  // Try multiple reference filenames. Convention: each skill may name its
  // runbook file `runbook.md` (the generic name, used by peaks-code), or
  // `<role>-runbook.md` (the role-suffixed name, used by peaks-rd → rd-runbook.md,
  // peaks-qa → qa-runbook.md, etc.). Prefer the longest extracted section.
  const refCandidates = [
    join(skillDir, 'references', 'runbook.md'),
    join(skillDir, 'references', `${path.basename(skillDir).replace(/^peaks-/, '')}-runbook.md`)
  ];
  let bestRef: string | null = null;
  for (const refPath of refCandidates) {
    try {
      const refBody = await readText(refPath);
      const refSection = extractRunbookSection(refBody);
      if (refSection === null) continue;
      if (bestRef === null || refSection.length > bestRef.length) {
        bestRef = refSection;
      }
    } catch { // TODO(g2): legacy silent catch — grace: 1 minor release (v2.14.0)
      // candidate not present or unreadable; try the next one
    }
  }
  const refSection = bestRef;
  if (inline === null) return refSection;
  if (refSection === null) return inline;
  return inline.length >= refSection.length ? inline : refSection;
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
  const section = await loadRunbookSection(skill.skillPath, body);
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
