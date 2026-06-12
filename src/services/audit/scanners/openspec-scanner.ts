/**
 * openspec-scanner — walks every markdown file under `openspec/changes/`
 * (recursive) and returns each file's raw lines. OpenSpec change records
 * often contain red lines for the slice they describe; the audit framework
 * picks them up.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { MarkdownLine, ScanWarning } from '../types.js';

const OPENSPEC_DIR = 'openspec/changes';

function walkOpenSpecDir(
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
      walkOpenSpecDir(projectRoot, full, out);
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

export interface OpenSpecScanInput {
  readonly projectRoot: string;
}

export interface OpenSpecScanResult {
  readonly lines: readonly MarkdownLine[];
  readonly warnings: readonly ScanWarning[];
}

export function scanOpenSpecTree(input: OpenSpecScanInput): OpenSpecScanResult {
  const root = join(input.projectRoot, OPENSPEC_DIR);
  if (!existsSync(root)) {
    return { lines: [], warnings: [] };
  }
  const out: { lines: MarkdownLine[]; warnings: ScanWarning[] } = { lines: [], warnings: [] };
  walkOpenSpecDir(input.projectRoot, root, out);
  return out;
}
