/**
 * Slice 2026-06-24-test-tool-detection-injection — source-grep gate.
 *
 * Mirrors the source-grep pattern from
 * `tests/unit/dispatch/dispatch-fanout-mandatory.test.ts` (lines 179-221).
 * Verifies that the two dispatch chokepoints both import the
 * `formatTestToolDetection` helper and actually call it to prepend the
 * block to the sub-agent prompt.
 *
 * Source-grep is the right tool here because the AC is "every dispatch
 * path prepends the block" — we don't need to instantiate a CLI; we
 * just need to confirm the call site exists. The runtime contract
 * (block length, ordering) is covered by the dispatch-commands tests
 * and the unit test in test-tool-detection.test.ts.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '..', '..', '..');

const DISPATCH_COMMANDS = join(REPO_ROOT, 'src', 'cli', 'commands', 'dispatch-commands.ts');
const DAG_ORCHESTRATOR = join(REPO_ROOT, 'src', 'services', 'code', 'dag-orchestrator.ts');
const HELPER = join(REPO_ROOT, 'src', 'services', 'dispatch', 'test-tool-detection.ts');

describe('Test Tool Detection — injection in dispatch-commands.ts (AC-2.1 / AC-2.2 / AC-2.3)', () => {
  test('source files exist', () => {
    expect(existsSync(DISPATCH_COMMANDS)).toBe(true);
    expect(existsSync(DAG_ORCHESTRATOR)).toBe(true);
    expect(existsSync(HELPER)).toBe(true);
  });

  test('dispatch-commands.ts imports formatTestToolDetection + TEST_TOOL_DETECTION_BLOCK', () => {
    const body = readFileSync(DISPATCH_COMMANDS, 'utf8');
    expect(body).toMatch(
      /import\s*\{[^}]*TEST_TOOL_DETECTION_BLOCK[^}]*formatTestToolDetection[^}]*\}\s*from\s*['"][^'"]*test-tool-detection\.js['"]/
    );
  });

  test('dispatch-commands.ts accounts for block length in PROMPT_LIMIT_BYTES check', () => {
    const body = readFileSync(DISPATCH_COMMANDS, 'utf8');
    expect(body).toMatch(/options\.prompt\.length\s*\+\s*TEST_TOOL_DETECTION_BLOCK\.length\s*>\s*PROMPT_LIMIT_BYTES/);
  });

  test('dispatch-commands.ts effectivePrompt preprends the block', () => {
    const body = readFileSync(DISPATCH_COMMANDS, 'utf8');
    expect(body).toMatch(/let\s+effectivePrompt\s*=\s*`\$\{formatTestToolDetection\(\)\}\\n\\n\$\{options\.prompt\}`/);
  });

  test('dispatch-commands.ts envelopeVersion is bumped to 2.2.0', () => {
    const body = readFileSync(DISPATCH_COMMANDS, 'utf8');
    expect(body).toMatch(/envelopeVersion:\s*['"]2\.2\.0['"]/);
    expect(body).not.toMatch(/envelopeVersion:\s*['"]2\.1\.0['"]/);
  });
});

describe('Test Tool Detection — injection in dag-orchestrator.ts (AC-3.1)', () => {
  test('dag-orchestrator.ts imports formatTestToolDetection', () => {
    const body = readFileSync(DAG_ORCHESTRATOR, 'utf8');
    expect(body).toMatch(
      /import\s*\{\s*formatTestToolDetection\s*\}\s*from\s*['"][^'"]*test-tool-detection\.js['"]/
    );
  });

  test('dag-orchestrator.ts prepends block in the node.prompt early-return branch', () => {
    const body = readFileSync(DAG_ORCHESTRATOR, 'utf8');
    expect(body).toMatch(/prompt:\s*`\$\{formatTestToolDetection\(\)\}\\n\\n\$\{node\.prompt\}`/);
  });

  test('dag-orchestrator.ts prepends block in the structured fallback prompt array', () => {
    const body = readFileSync(DAG_ORCHESTRATOR, 'utf8');
    // The structured fallback pushes `formatTestToolDetection()` and `''` as
    // the first two entries of the array before the slice-dag-dispatcher line.
    expect(body).toMatch(/const\s+prompt\s*=\s*\[[\s\S]*?formatTestToolDetection\(\)/);
  });
});

describe('Test Tool Detection — helper module exports', () => {
  test('test-tool-detection.ts exports TEST_TOOL_DETECTION_BLOCK and formatTestToolDetection', () => {
    const body = readFileSync(HELPER, 'utf8');
    expect(body).toMatch(/export\s+const\s+TEST_TOOL_DETECTION_BLOCK/);
    expect(body).toMatch(/export\s+function\s+formatTestToolDetection/);
  });
});
