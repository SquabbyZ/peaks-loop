/**
 * Per spec §4.2 验收审计 + §7 阶段二 — 5-pattern weak-assertion AST scan.
 *
 * Hard constraints:
 *   H6 (CLI裁决): every detection is regex/AST-based, not LLM-judged.
 *   KISS: regex matchers on common expect() patterns. Production slice
 *   would migrate to TypeScript Compiler API; v1 ships regex for speed.
 *
 * Weak patterns (5):
 *   - toBeDefined()
 *   - toBeTruthy()
 *   - toEqual(x) where arg === receiver (toEqual-self)
 *   - expect.anything()
 *   - toBe(x) where arg === receiver (toBe-self)
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  AssertionsReport, WeakExample, WeakPattern, WeakPatternCount,
} from './types.js';

const WEAK_PATTERNS: ReadonlyArray<{
  readonly pattern: WeakPattern;
  readonly regex: RegExp;
}> = [
  { pattern: 'toBeDefined', regex: /\.toBeDefined\s*\(\s*\)/g },
  { pattern: 'toBeTruthy', regex: /\.toBeTruthy\s*\(\s*\)/g },
  { pattern: 'expect-anything', regex: /expect\.anything\s*\(\s*\)/g },
  // Self-equality patterns require matched-pair parsing; handled below.
];

const TO_EQUAL_SELF = /\.toEqual\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/g;
const TO_BE_SELF = /\.toBe\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/g;

export interface ScanInput {
  readonly project: string;
  readonly testFiles: ReadonlyArray<string>;
}

async function countAssertions(content: string): Promise<number> {
  // Approximate: count expect(...).method( occurrences.
  // Handle nested parens by finding expect( and matching to a balanced close.
  let count = 0;
  const re = /expect\s*\(/g;
  for (const m of content.matchAll(re)) {
    let depth = 1;
    let i = (m.index ?? 0) + m[0].length;
    while (i < content.length && depth > 0) {
      const ch = content[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
    // After balanced expect(...), check for .method( pattern.
    const tail = content.slice(i);
    if (/^\s*\.\w+\s*\(/.test(tail)) {
      count++;
    }
  }
  return count;
}

function lineOf(content: string, offset: number): number {
  return content.slice(0, offset).split('\n').length;
}

export async function scanAssertions(input: ScanInput): Promise<AssertionsReport> {
  let total = 0;
  let weak = 0;
  const byPattern = new Map<WeakPattern, WeakExample[]>();

  for (const file of input.testFiles) {
    const fullPath = join(input.project, file);
    const content = await readFile(fullPath, 'utf8');
    total += await countAssertions(content);

    for (const { pattern, regex } of WEAK_PATTERNS) {
      const matches = [...content.matchAll(regex)];
      if (matches.length > 0) {
        weak += matches.length;
        const list = byPattern.get(pattern) ?? [];
        for (const m of matches) {
          const idx = m.index ?? 0;
          list.push({ file, line: lineOf(content, idx), code: m[0] });
        }
        byPattern.set(pattern, list);
      }
    }

    // toEqual-self: needs receiver extraction.
    const eqSelf = [...content.matchAll(TO_EQUAL_SELF)];
    for (const m of eqSelf) {
      const receiverMatch = content.slice(0, m.index ?? 0).match(/expect\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/g);
      if (receiverMatch && receiverMatch.length > 0) {
        const lastReceiver = receiverMatch[receiverMatch.length - 1];
        const receiverName = lastReceiver?.match(/expect\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/)?.[1];
        if (receiverName && receiverName === m[1]) {
          weak += 1;
          const idx = m.index ?? 0;
          const list = byPattern.get('toEqual-self') ?? [];
          list.push({ file, line: lineOf(content, idx), code: m[0] });
          byPattern.set('toEqual-self', list);
        }
      }
    }

    // toBe-self: same pattern.
    const beSelf = [...content.matchAll(TO_BE_SELF)];
    for (const m of beSelf) {
      const receiverMatch = content.slice(0, m.index ?? 0).match(/expect\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/g);
      if (receiverMatch && receiverMatch.length > 0) {
        const lastReceiver = receiverMatch[receiverMatch.length - 1];
        const receiverName = lastReceiver?.match(/expect\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/)?.[1];
        if (receiverName && receiverName === m[1]) {
          weak += 1;
          const idx = m.index ?? 0;
          const list = byPattern.get('toBe-self') ?? [];
          list.push({ file, line: lineOf(content, idx), code: m[0] });
          byPattern.set('toBe-self', list);
        }
      }
    }
  }

  const weakPatterns: WeakPatternCount[] = [];
  for (const [pattern, examples] of byPattern.entries()) {
    weakPatterns.push({ pattern, count: examples.length, examples });
  }

  return {
    totalAssertions: total,
    weakAssertions: weak,
    weakRate: total === 0 ? 0 : weak / total,
    weakPatterns,
  };
}