/**
 * Task 1.1 — compact-core vendor-neutrality red line (design §2.3, §14.1).
 *
 * Statically scans every source file under `src/services/compact-core/**`
 * and fails if any forbidden vendor name, vendor verb, slash command, or
 * vendor conditional branch appears. The core may only consume capability
 * contracts; it must never name a host, a binary, or `/compact`.
 *
 * This test reads its own repository source (no network, no host SDK) and
 * is the enforcement point referenced by the design's static red line.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
// tests/unit/services/compact-core → repo root is four levels up.
const repoRoot = join(here, '..', '..', '..', '..');
const coreRoot = join(repoRoot, 'src', 'services', 'compact-core');

function collectSourceFiles(dir: string): readonly string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...collectSourceFiles(full));
    } else if (full.endsWith('.ts')) {
      out.push(full);
    }
  }
  return out;
}

// Forbidden vendor names, matched case-insensitively as substrings.
const FORBIDDEN_TERMS: readonly string[] = [
  'claude',
  'claude-code',
  'zcode',
  'z-code',
  'codex',
  'copilot',
  'cursor',
  'trae',
  'anthropic'
];

// Forbidden slash command `/compact`, matched as a command token. The
// negative lookahead prevents false positives on the legitimate path
// segment `.../compact-core` and `.../compact-policy`.
const FORBIDDEN_SLASH_COMMAND = /\/compact(?![\w-])/i;

// Vendor-branch smells: reading a `vendor` discriminator to switch behaviour.
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  FORBIDDEN_SLASH_COMMAND,
  /vendor\s*===/i,
  /if\s*\(\s*vendor/i,
  /switch\s*\(\s*vendor/i
];

describe('compact-core is vendor-neutral', () => {
  const files = collectSourceFiles(coreRoot);

  it('has source files to scan', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('contains no forbidden vendor terms', () => {
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8').toLowerCase();
      for (const term of FORBIDDEN_TERMS) {
        if (content.includes(term.toLowerCase())) {
          violations.push(`${relative(repoRoot, file)} :: "${term}"`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('contains no vendor-conditional branches', () => {
    const violations: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const pattern of FORBIDDEN_PATTERNS) {
        if (pattern.test(content)) {
          violations.push(`${relative(repoRoot, file)} :: ${pattern.source}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
