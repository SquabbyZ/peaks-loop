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
import { resolve } from 'node:path';
import type { AssertionsReport, WeakExample, WeakPattern, WeakPatternCount } from './types.js';
import { assertTestFilesUsable } from './test-files.js';

const WEAK_PATTERNS: ReadonlyArray<{
  readonly pattern: WeakPattern;
  readonly regex: RegExp;
}> = [
  { pattern: 'toBeDefined', regex: /\.toBeDefined\s*\(\s*\)/g },
  { pattern: 'toBeTruthy', regex: /\.toBeTruthy\s*\(\s*\)/g },
  { pattern: 'expect-anything', regex: /expect\.anything\s*\(\s*\)/g }
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

/**
 * The self-equality examples in one file: `expect(x).toEqual(x)` and
 * `expect(x).toBe(x)` both need the RECEIVER extracted, so they share this.
 * Extracted so `scanAssertions` stays inside the per-function line cap.
 */
function collectSelfExamples(content: string, file: string, regex: RegExp): WeakExample[] {
  const examples: WeakExample[] = [];
  for (const match of content.matchAll(regex)) {
    const receivers = content
      .slice(0, match.index ?? 0)
      .match(/expect\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/g);
    const lastReceiver = receivers?.[receivers.length - 1];
    const receiverName = lastReceiver?.match(/expect\s*\(\s*([a-zA-Z_$][\w$]*)\s*\)/)?.[1];
    if (receiverName && receiverName === match[1]) {
      examples.push({ file, line: lineOf(content, match.index ?? 0), code: match[0] });
    }
  }
  return examples;
}

/** The self-equality patterns, in the order they are reported. */
const SELF_PATTERNS: ReadonlyArray<{ pattern: WeakPattern; regex: RegExp }> = [
  { pattern: 'toEqual-self', regex: TO_EQUAL_SELF },
  { pattern: 'toBe-self', regex: TO_BE_SELF }
];

/** The weak-pattern examples of one file, grouped by pattern. */
function collectWeakPatternExamples(
  content: string,
  file: string
): Map<WeakPattern, WeakExample[]> {
  const found = new Map<WeakPattern, WeakExample[]>();
  for (const { pattern, regex } of WEAK_PATTERNS) {
    const matches = [...content.matchAll(regex)];
    if (matches.length === 0) {
      continue;
    }
    found.set(
      pattern,
      matches.map((m) => ({ file, line: lineOf(content, m.index ?? 0), code: m[0] }))
    );
  }
  return found;
}

export async function scanAssertions(input: ScanInput): Promise<AssertionsReport> {
  // BEFORE anything is read: a missing file must fail with a NAMED code
  // (`MUT_TEST_FILE_NOT_FOUND`), not with whatever `readFile` throws, and a
  // PATTERN must fail with its own code — this scanner reads literal files.
  assertTestFilesUsable({
    project: input.project,
    testFiles: input.testFiles,
    allowPatterns: false
  });

  let total = 0;
  let weak = 0;
  const byPattern = new Map<WeakPattern, WeakExample[]>();

  for (const file of input.testFiles) {
    // `resolve`, not `join`: an absolute `--test-files` entry must stay
    // absolute instead of being appended to the project root.
    const fullPath = resolve(input.project, file);
    const content = await readFile(fullPath, 'utf8');
    total += await countAssertions(content);

    for (const [pattern, examples] of collectWeakPatternExamples(content, file)) {
      weak += examples.length;
      const list = byPattern.get(pattern) ?? [];
      list.push(...examples);
      byPattern.set(pattern, list);
    }

    for (const { pattern, regex } of SELF_PATTERNS) {
      const examples = collectSelfExamples(content, file, regex);
      if (examples.length === 0) {
        continue;
      }
      weak += examples.length;
      const list = byPattern.get(pattern) ?? [];
      list.push(...examples);
      byPattern.set(pattern, list);
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
    weakPatterns
  };
}
