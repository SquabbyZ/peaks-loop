/**
 * Slice 2026-07-28-sub-agent-visibility — source-grep gate for the
 * G11.5 visibility contract.
 *
 * The dispatch CLI now exposes three new fields on the success envelope:
 *   - `orchestratorVisibleHint`  (single line prose, copy verbatim)
 *   - `artifactsPublicPaths`     (string[] of --write-artifact paths)
 *   - `expectedCompletionSeconds` (number ETA budget)
 *
 * Source-grep is the right tool here: the AC is "every dispatch
 * envelope includes the three fields on the success path", which the
 * runtime tests already cover end-to-end. This guard exists to make
 * sure a future refactor does not silently drop the fields. Mirrors
 * the pattern of `tests/unit/dispatch/test-tool-detection-injection.test.ts`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, '..', '..', '..');

const DISPATCH_COMMANDS = join(REPO_ROOT, 'src', 'cli', 'commands', 'dispatch-commands.ts');
const DISPATCH_FROM_DAG = join(REPO_ROOT, 'src', 'cli', 'commands', 'dispatch-from-dag.ts');
const CODE_REF = join(REPO_ROOT, 'skills', 'peaks-code', 'references', 'sub-agent-dispatch.md');
const RD_REF = join(REPO_ROOT, 'skills', 'bee', 'peaks-rd', 'references', 'rd-sub-agent-dispatch.md');

describe('G11.5 visibility contract — envelope fields present (slice 2026-07-28-sub-agent-visibility)', () => {
  test('source files exist', () => {
    expect(existsSync(DISPATCH_COMMANDS)).toBe(true);
    expect(existsSync(DISPATCH_FROM_DAG)).toBe(true);
    expect(existsSync(CODE_REF)).toBe(true);
    expect(existsSync(RD_REF)).toBe(true);
  });

  test('dispatch-commands.ts single-dispatch envelope includes the 3 G11.5 fields', () => {
    const body = readFileSync(DISPATCH_COMMANDS, 'utf8');
    expect(body).toMatch(/orchestratorVisibleHint/);
    expect(body).toMatch(/artifactsPublicPaths/);
    expect(body).toMatch(/expectedCompletionSeconds/);
  });

  test('dispatch-from-dag.ts --from-dag envelope includes the 3 G11.5 fields', () => {
    const body = readFileSync(DISPATCH_FROM_DAG, 'utf8');
    expect(body).toMatch(/orchestratorVisibleHint/);
    expect(body).toMatch(/artifactsPublicPaths/);
    expect(body).toMatch(/expectedCompletionSeconds/);
  });

  test('single-dispatch hint is the canonical "⏳ Spawning sub-agent via Task tool" form', () => {
    const body = readFileSync(DISPATCH_COMMANDS, 'utf8');
    expect(body).toMatch(/⏳\s*Spawning sub-agent via Task tool:\s*\$\{role\}/);
  });

  test('--from-dag hint names the fan-out count and DAG', () => {
    const body = readFileSync(DISPATCH_FROM_DAG, 'utf8');
    expect(body).toMatch(/⏳\s*Spawning\s*\$\{emittedSliceIds\.length\}\s*sub-agents via Task tool from DAG/);
  });
});

describe('G11.5 visibility contract — reference docs (slice 2026-07-28-sub-agent-visibility)', () => {
  test('peaks-code sub-agent-dispatch.md has a G11.5 heading', () => {
    const body = readFileSync(CODE_REF, 'utf8');
    expect(body).toMatch(/## G11\.5 — visibility contract/);
    expect(body).toContain('orchestratorVisibleHint');
    expect(body).toContain('artifactsPublicPaths');
    expect(body).toContain('expectedCompletionSeconds');
  });

  test('peaks-rd rd-sub-agent-dispatch.md has a G11.5 heading', () => {
    const body = readFileSync(RD_REF, 'utf8');
    expect(body).toMatch(/## G11\.5 visibility contract/);
    expect(body).toMatch(/⏳\s*Spawning sub-agent via Task tool:\s*<description>/);
  });
});
