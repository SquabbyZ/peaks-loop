/**
 * rules-tree-scanner — walks every markdown file under `.claude/rules/`
 * (recursive) and returns each file's raw lines for the classifier.
 *
 * Per `static-scan-must-cover-skills-tree-not-just-src.md` and the L2
 * redesign §5.2, the audit must cover .claude/rules in addition to skills.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { MarkdownLine, ScanWarning } from '../types.js';

const RULES_DIR = '.claude/rules';

function walkRulesDir(
  projectRoot: string,
  dir: string,
  out: { lines: MarkdownLine[]; warnings: ScanWarning[] },
): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    out.warnings.push({
      file: relative(projectRoot, dir).split('\\').join('/'),
      message: `readdir failed: ${error instanceof Error ? error.message : String(error)}`,
    });
    return;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkRulesDir(projectRoot, full, out);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      let content: string;
      try {
        content = readFileSync(full, 'utf-8');
      } catch (error) {
        out.warnings.push({
          file: relative(projectRoot, full).split('\\').join('/'),
          message: `read failed: ${error instanceof Error ? error.message : String(error)}`,
        });
        continue;
      }
      const rel = relative(projectRoot, full).split('\\').join('/');
      const lines = content.split(/\r?\n/);
      for (let idx = 0; idx < lines.length; idx++) {
        out.lines.push({ file: rel, line: idx + 1, text: lines[idx] ?? '' });
      }
    }
  }
}

export interface RulesTreeScanInput {
  readonly projectRoot: string;
}

export interface RulesTreeScanResult {
  readonly lines: readonly MarkdownLine[];
  readonly warnings: readonly ScanWarning[];
}

export function scanRulesTree(input: RulesTreeScanInput): RulesTreeScanResult {
  const rulesRoot = join(input.projectRoot, RULES_DIR);
  if (!existsSync(rulesRoot)) {
    return { lines: [], warnings: [] };
  }
  const out: { lines: MarkdownLine[]; warnings: ScanWarning[] } = { lines: [], warnings: [] };
  walkRulesDir(input.projectRoot, rulesRoot, out);
  return out;
}
