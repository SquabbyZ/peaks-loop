/**
 * Existing-system visual-token extraction (B wave-3 file-size split).
 *
 * Extracted verbatim from `existing-system-service.ts`: the visual
 * token keyword lists, the Less/Sass/CSS/Tailwind parsers, the token
 * classifier, the dedupe cap, and the cross-source inconsistency
 * finder. Function bodies and literals are unchanged (verbatim move);
 * the file walkers and the public `scanExistingSystem` entry stay in
 * the sibling module.
 */

import { join } from 'node:path';
import { pathExists, readText } from 'peaks-loop-shared/fs';

import type { VisualToken, VisualTokenSource } from './scan-types.js';

const COLOR_KEYWORDS = [
  'color',
  'primary',
  'success',
  'warning',
  'error',
  'danger',
  'info',
  'bg',
  'background',
  'border',
  'text'
];
const SPACING_KEYWORDS = ['spacing', 'gap', 'padding', 'margin', 'size'];
const TYPO_KEYWORDS = ['font', 'text-size', 'line-height', 'letter-spacing', 'heading'];
const RADIUS_KEYWORDS = ['radius', 'rounded'];

export function classifyToken(name: string): 'color' | 'spacing' | 'typography' | 'radius' | null {
  const lower = name.toLowerCase();
  if (RADIUS_KEYWORDS.some((kw) => lower.includes(kw))) return 'radius';
  if (TYPO_KEYWORDS.some((kw) => lower.includes(kw))) return 'typography';
  if (SPACING_KEYWORDS.some((kw) => lower.includes(kw))) return 'spacing';
  if (COLOR_KEYWORDS.some((kw) => lower.includes(kw))) return 'color';
  return null;
}

export function parseLessOrSassVars(content: string, sourceRel: string): VisualToken[] {
  const tokens: VisualToken[] = [];
  // Match `@var: value;` (Less) or `$var: value;` (Sass)
  const regex = /^\s*[@$]([a-zA-Z][\w-]*)\s*:\s*([^;]+);/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const [, rawName, rawValue] = match;
    if (rawName === undefined || rawValue === undefined) continue;
    tokens.push({ name: rawName, value: rawValue.trim(), source: sourceRel });
  }
  return tokens;
}

export function parseCssVars(content: string, sourceRel: string): VisualToken[] {
  const tokens: VisualToken[] = [];
  const regex = /--([a-zA-Z][\w-]*)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    const [, rawName, rawValue] = match;
    if (rawName === undefined || rawValue === undefined) continue;
    tokens.push({ name: `--${rawName}`, value: rawValue.trim(), source: sourceRel });
  }
  return tokens;
}

export async function extractTailwindTokens(
  projectRoot: string
): Promise<{ tokens: VisualToken[]; source: VisualTokenSource | null }> {
  const candidates = [
    'tailwind.config.js',
    'tailwind.config.ts',
    'tailwind.config.cjs',
    'tailwind.config.mjs'
  ];
  for (const candidate of candidates) {
    const full = join(projectRoot, candidate);
    if (await pathExists(full)) {
      const content = await readText(full);
      const tokens: VisualToken[] = [];
      // Heuristic: extract keys under theme.extend.* via simple regex.
      const colorBlock = /colors\s*:\s*\{([\s\S]*?)\}/.exec(content);
      if (colorBlock?.[1] !== undefined) {
        const colorRegex = /([a-zA-Z_][\w-]*)\s*:\s*['"`]([^'"`]+)['"`]/g;
        let match: RegExpExecArray | null;
        while ((match = colorRegex.exec(colorBlock[1])) !== null) {
          const [, name, value] = match;
          if (name !== undefined && value !== undefined) {
            tokens.push({ name, value, source: candidate });
          }
        }
      }
      return { tokens, source: { path: candidate, kind: 'tailwind-config' } };
    }
  }
  return { tokens: [], source: null };
}

export function dedupeTokens(tokens: VisualToken[], max: number): VisualToken[] {
  const seen = new Set<string>();
  const out: VisualToken[] = [];
  for (const token of tokens) {
    const key = `${token.name}=${token.value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(token);
    if (out.length >= max) break;
  }
  return out;
}

export function findInconsistencies(tokens: VisualToken[]): string[] {
  const issues: string[] = [];
  const byName = new Map<string, Set<string>>();
  for (const token of tokens) {
    const set = byName.get(token.name) ?? new Set<string>();
    set.add(token.value);
    byName.set(token.name, set);
  }
  for (const [name, values] of byName.entries()) {
    if (values.size > 1) {
      issues.push(
        `token "${name}" has ${values.size} different values across sources: ${[...values].join(' | ')}`
      );
    }
  }
  return issues;
}
