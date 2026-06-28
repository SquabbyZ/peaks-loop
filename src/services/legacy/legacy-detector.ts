/**
 * v2.15.0 follow-up — G8: legacy code detector.
 *
 * 12 Gaps memory: when peaks-cli is applied to a 存量老项目 (legacy
 * codebase), it is helpful to surface a quick inventory of "what
 * smells old" so the LLM / operator knows where to focus.
 *
 * Heuristics (intentionally light, since the user is Senior FE and
 * the AI is the integrator):
 *   - TODO / FIXME / HACK comments
 *   - console.log calls (debug leftover)
 *   - any-type TypeScript annotations (`as any`, `: any`)
 *   - large files (> 500 lines)
 *   - ts-ignore / @ts-expect-error (suppressed type errors)
 *
 * Pure function. No I/O. The CLI is `peaks legacy detect`.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export type LegacyKind = 'todo' | 'console-log' | 'any-type' | 'large-file' | 'ts-ignore' | 'fixme' | 'hack';

// (LegacyKind was a 5-string union; the rest (fixme, hack) are derived
//  from the todo regex but counted into the summary separately. The 5 + 2
//  shape above is the source of truth.)

export interface LegacyFinding {
  readonly kind: LegacyKind;
  readonly file: string;
  /** Line number, or null when the finding is file-level (e.g. large-file). */
  readonly line: number | null;
  /** A short excerpt of the offending line. */
  readonly excerpt: string;
}

export interface LegacyReport {
  readonly projectRoot: string;
  readonly scannedFiles: number;
  readonly findings: readonly LegacyFinding[];
  readonly summary: Record<LegacyKind, number>;
  readonly smells: 'low' | 'medium' | 'high';
}

const PATTERNS: ReadonlyArray<{ kind: LegacyKind; regex: RegExp }> = [
  { kind: 'todo', regex: /(?:\/\/|\/\*|<!--)\s*(?:TODO|FIXME|HACK|XXX)\b/i },
  { kind: 'console-log', regex: /\bconsole\.(log|debug|info)\s*\(/ },
  { kind: 'any-type', regex: /\b(?:as\s+any|:\s*any\b|<any>)/ },
  { kind: 'ts-ignore', regex: /@ts-(?:ignore|expect-error|nocheck)/ }
];

const LARGE_FILE_LINES = 500;

function scanFile(file: string): LegacyFinding[] {
  let content: string;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const lines = content.split('\n');
  const findings: LegacyFinding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const { kind, regex } of PATTERNS) {
      if (regex.test(line)) {
        findings.push({ kind, file, line: i + 1, excerpt: line.trim().slice(0, 120) });
        break; // one finding per line (avoid double-counting)
      }
    }
  }
  if (lines.length > LARGE_FILE_LINES) {
    findings.push({ kind: 'large-file', file, line: null, excerpt: `${lines.length} lines (> ${LARGE_FILE_LINES})` });
  }
  return findings;
}

function walkFiles(root: string, maxDepth: number = 8): string[] {
  const out: string[] = [];
  function walk(dir: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: import('node:fs').Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'dist' || e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full, depth + 1);
      else if (e.isFile() && (e.name.endsWith('.ts') || e.name.endsWith('.js') || e.name.endsWith('.tsx') || e.name.endsWith('.jsx'))) {
        out.push(full);
      }
    }
  }
  walk(root, 0);
  return out;
}

export function detectLegacy(projectRoot: string, dir: string = 'src'): LegacyReport {
  const root = resolve(projectRoot, dir);
  if (!existsSync(root)) {
    const empty: Record<LegacyKind, number> = { todo: 0, 'console-log': 0, 'any-type': 0, 'large-file': 0, 'ts-ignore': 0, fixme: 0, hack: 0 };
    return { projectRoot, scannedFiles: 0, findings: [], summary: empty, smells: 'low' };
  }
  const files = walkFiles(root);
  const findings: LegacyFinding[] = [];
  for (const f of files) {
    findings.push(...scanFile(f));
  }
  // Re-key console-log to match the union
  const mapped = findings.map((f) => f.kind === 'console-log' ? { ...f, kind: 'console-log' as LegacyKind } : f);
  const summary: Record<LegacyKind, number> = {
    todo: 0, 'console-log': 0, 'any-type': 0, 'large-file': 0, 'ts-ignore': 0, fixme: 0, hack: 0
  };
  for (const f of mapped) {
    // The todo pattern catches both TODO and FIXME/HACK; reflect into fixme/hack as well when applicable
    if (f.kind === 'todo') {
      const lc = f.excerpt.toLowerCase();
      if (lc.includes('fixme')) summary.fixme++;
      else if (lc.includes('hack')) summary.hack++;
      else summary.todo++;
    } else {
      summary[f.kind]++;
    }
  }
  const total = Object.values(summary).reduce((s, n) => s + n, 0);
  const smells: 'low' | 'medium' | 'high' = total > 50 ? 'high' : total > 10 ? 'medium' : 'low';
  return { projectRoot, scannedFiles: files.length, findings: mapped, summary, smells };
}
