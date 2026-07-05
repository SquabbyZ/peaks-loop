/**
 * Slice 2026-06-24-test-tool-detection-injection — docs gate (AC-4.1 / AC-4.2 / AC-4.3).
 *
 * Verifies that BOTH reference docs surface the new `## Test Tool
 * Detection (mandatory)` section with the canonical 4-literal markers
 * the LLM-side runner needs to recognize the rule at planning time.
 *
 * Mirrors `tests/unit/skills/karpathy-prompt-injection.test.ts:108-119`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '..', '..', '..');

const RD_REF = join(REPO_ROOT, 'skills', 'bee', 'peaks-rd', 'references', 'rd-sub-agent-dispatch.md');
const QA_REF = join(REPO_ROOT, 'skills', 'bee', 'peaks-qa', 'references', 'qa-sub-agent-dispatch.md');

const REQUIRED_LITERALS = [
  '## Test Tool Detection (mandatory)',
  'package.json#scripts.test',
  'npx <runner>',
  'peaks test --json'
];

describe('Test Tool Detection — reference doc gate (AC-4.1 / AC-4.2 / AC-4.3)', () => {
  test('rd-sub-agent-dispatch.md exists', () => {
    expect(existsSync(RD_REF)).toBe(true);
  });

  test('qa-sub-agent-dispatch.md exists', () => {
    expect(existsSync(QA_REF)).toBe(true);
  });

  test('rd-sub-agent-dispatch.md contains all 4 canonical literals', () => {
    const body = readFileSync(RD_REF, 'utf8');
    for (const literal of REQUIRED_LITERALS) {
      expect(body, `rd-sub-agent-dispatch.md must contain ${JSON.stringify(literal)}`).toContain(literal);
    }
  });

  test('qa-sub-agent-dispatch.md contains all 4 canonical literals', () => {
    const body = readFileSync(QA_REF, 'utf8');
    for (const literal of REQUIRED_LITERALS) {
      expect(body, `qa-sub-agent-dispatch.md must contain ${JSON.stringify(literal)}`).toContain(literal);
    }
  });
});
