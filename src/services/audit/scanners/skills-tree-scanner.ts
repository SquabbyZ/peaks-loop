/**
 * skills-tree-scanner — walks each `skills/<name>/SKILL.md` and returns
 * each file's raw lines for the classifier to consume.
 *
 * Per `static-scan-must-cover-skills-tree-not-just-src.md`, the red-line
 * audit MUST cover the skills tree, not just `src/`. This scanner is the
 * entry point for that coverage.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { MarkdownLine, ScanWarning } from '../types.js';

const SKILLS_DIR = 'skills';

export interface SkillsTreeScanInput {
  readonly projectRoot: string;
}

export interface SkillsTreeScanResult {
  readonly lines: readonly MarkdownLine[];
  readonly warnings: readonly ScanWarning[];
}

function readSkillFile(projectRoot: string, skillDir: string, file: string): readonly MarkdownLine[] {
  const fullPath = join(projectRoot, SKILLS_DIR, skillDir, file);
  if (!existsSync(fullPath)) return [];
  const rel = relative(projectRoot, fullPath).split('\\').join('/');
  const content = readFileSync(fullPath, 'utf-8');
  const lines = content.split(/\r?\n/);
  return lines.map((text, idx) => ({ file: rel, line: idx + 1, text }));
}

export function scanSkillsTree(input: SkillsTreeScanInput): SkillsTreeScanResult {
  const skillsRoot = join(input.projectRoot, SKILLS_DIR);
  if (!existsSync(skillsRoot)) {
    return { lines: [], warnings: [] };
  }

  const lines: MarkdownLine[] = [];
  const warnings: ScanWarning[] = [];

  let entries;
  try {
    entries = readdirSync(skillsRoot, { withFileTypes: true });
  } catch (error) {
    warnings.push({
      file: SKILLS_DIR,
      message: `readdir failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return { lines, warnings };
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const skillMd = readSkillFile(input.projectRoot, entry.name, 'SKILL.md');
    lines.push(...skillMd);
  }

  return { lines, warnings };
}
