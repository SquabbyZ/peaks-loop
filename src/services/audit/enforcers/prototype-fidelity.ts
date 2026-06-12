/**
 * prototype-fidelity enforcer (L2.2 P1) — verifies a prototype is
 * functional (not a stub).
 *
 * Two red lines:
 *   - rl-prototype-fidelity-001: prototype files must not contain TODO/FIXME/XXX
 *   - rl-prototype-fidelity-002: prototype must have at least 1 passing test
 *
 * (L2.2 ships the source-level check; deeper test-running integration is
 * deferred to a follow-up slice.)
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const STUB_MARKER_PATTERNS: readonly RegExp[] = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bXXX\b/,
  /\bHACK\b/,
  /\bstub\b\s*[:=]/i,
  /\bnot implemented\b/i,
];

export interface PrototypeFidelityInput {
  readonly projectRoot: string;
  readonly filePaths: readonly string[];
}

export interface PrototypeFidelityResult {
  readonly stubMarkers: readonly { filePath: string; pattern: string; snippet: string }[];
  readonly testFiles: readonly string[];
}

export function findStubMarkers(input: PrototypeFidelityInput): PrototypeFidelityResult {
  const markers: { filePath: string; pattern: string; snippet: string }[] = [];
  for (const filePath of input.filePaths) {
    const abs = join(input.projectRoot, filePath);
    let content: string;
    try {
      content = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    for (const pattern of STUB_MARKER_PATTERNS) {
      const match = pattern.exec(content);
      if (match !== null) {
        markers.push({ filePath, pattern: pattern.source, snippet: match[0] });
      }
    }
  }
  return { stubMarkers: markers, testFiles: [] };
}

export function findTestFiles(projectRoot: string, sourceDir: string): readonly string[] {
  const testsDir = join(projectRoot, sourceDir.replace(/^src\//, 'tests/'));
  if (!existsSync(testsDir)) return [];
  try {
    const stat = statSync(testsDir);
    if (!stat.isDirectory()) return [];
  } catch {
    return [];
  }
  const result: string[] = [];
  const walk = (dir: string) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && /\.(test|spec)\.ts$/.test(entry.name)) {
        result.push(full);
      }
    }
  };
  walk(testsDir);
  return result;
}
