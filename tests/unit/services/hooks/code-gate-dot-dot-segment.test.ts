// tests/unit/services/hooks/code-gate-dot-dot-segment.test.ts
//
// The gate's verdict must be decided by WHERE the target file lives, not by
// how the path that names it happens to be spelled. An unresolved `..` in a
// RELATIVE path is one of those spellings: `docs/../src/foo.ts` resolves into
// `src/`, so it is the file `src/foo.ts` and must get that file's verdict.
//
// The counter-case is in this file too, because it is what a too-broad fix
// would break: a `..` that leaves the project names a file OUTSIDE the
// project, which belongs to no family and is allowed - the same rule an
// absolute path outside the project follows.
//
// Dimensions covered:
//   - render:     the normalized form of a path
//   - behavior:   the verdict for each spelling, and the cases that stay out
//   - integration: the shell sibling, handed the same bytes
//   - a11y:       the deny message names the path the tool asked for

import { isAbsolute, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { runHook as runHookScript } from '../../_setup/code-gate-shell-harness.js';
import {
  decideGateAction,
  normalizeGatePath,
  type GateInput
} from '~/src/services/hooks/pre-tool-code-gate';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../../_setup/subprocess-timeouts.js';

declareDimensions('tests/unit/services/hooks/code-gate-dot-dot-segment.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** A project root that exists, so a path can be related to it. */
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..');

/** The same file under `src/`, spelled in the ways that must agree. */
const SPELLINGS = [
  'src/services/foo.ts',
  './src/services/foo.ts',
  'docs/../src/services/foo.ts',
  'src/./services/foo.ts'
] as const;

describe('render — normalizeGatePath resolves the `..` of a relative path', () => {
  it('given a relative path carrying `..`, should resolve it to the project-relative form', () => {
    expect(normalizeGatePath('docs/../src/services/foo.ts', PROJECT_ROOT)).toBe(
      'src/services/foo.ts'
    );
    expect(normalizeGatePath('src/./services/foo.ts', PROJECT_ROOT)).toBe('src/services/foo.ts');
  });

  it('given a `..` that leaves the project, should return a path outside it', () => {
    const escaped = normalizeGatePath('../../elsewhere/src/x.ts', PROJECT_ROOT);
    // Outside the project means "belongs to no family", which is the same
    // rule an absolute path outside the project follows.
    expect(escaped.startsWith('..')).toBe(false);
    expect(isAbsolute(escaped)).toBe(true);
  });

  it('given no project root, should still collapse the `..` of a relative path', () => {
    expect(normalizeGatePath('docs/../src/services/foo.ts', null)).toBe('src/services/foo.ts');
  });

  it('given a path that climbs out, should keep the climb', () => {
    // The climb is KEPT, so the path still reads as "outside" and lands in no
    // family - with or without a project root to resolve it against.
    expect(normalizeGatePath('../src/services/foo.ts', null)).toBe('../src/services/foo.ts');
    expect(normalizeGatePath('../../src/services/foo.ts', null)).toBe('../../src/services/foo.ts');
  });

  it('given the project root itself, should name no family', () => {
    const verdict = decideGateAction('Edit', { file_path: '.' }, null, PROJECT_ROOT);
    expect(verdict.action).toBe('allow');
  });

  it('given a doubled separator, should collapse it to one', () => {
    // The empty segment of a doubled separator is dropped, so the path names
    // the same file the single-separator spelling names.
    expect(normalizeGatePath('src//services/foo.ts', PROJECT_ROOT)).toBe('src/services/foo.ts');
    expect(normalizeGatePath('src//services/foo.ts', null)).toBe('src/services/foo.ts');
  });
});

describe('behavior — a relative path carrying `..` is the file it names', () => {
  it('given one file spelled four ways, should deny all four', () => {
    for (const spelling of SPELLINGS) {
      const verdict = decideGateAction('Edit', { file_path: spelling }, null, PROJECT_ROOT);
      expect(verdict.action, `spelling: ${spelling}`).toBe('deny');
    }
  });

  it('given one file spelled four ways, should reach the same family every time', () => {
    const reasons = SPELLINGS.map((spelling) => {
      const verdict = decideGateAction('Edit', { file_path: spelling }, null, PROJECT_ROOT);
      if (verdict.action !== 'deny') throw new Error(`expected a deny for ${spelling}`);
      return verdict.reason;
    });
    expect(new Set(reasons).size).toBe(1);
    expect(reasons[0]).toContain('src/');
  });

  it('given a relative path carrying `..`, should deny it', () => {
    const verdict = decideGateAction(
      'Edit',
      { file_path: 'docs/../src/services/foo.ts' },
      null,
      PROJECT_ROOT
    );
    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.reason).toContain('src/');
  });

  it('given a `..` that leaves the project, should allow it', () => {
    // The counter-case: a target outside the project belongs to no family,
    // exactly like an absolute path outside it.
    const verdict = decideGateAction(
      'Edit',
      { file_path: '../../elsewhere/src/x.ts' },
      null,
      PROJECT_ROOT
    );
    expect(verdict.action).toBe('allow');
  });

  it('given the fast lane, should still open the families for every spelling', () => {
    for (const spelling of SPELLINGS) {
      const verdict = decideGateAction(
        'Edit',
        { file_path: spelling },
        'peaks-race-code',
        PROJECT_ROOT
      );
      expect(verdict.action, `spelling: ${spelling}`).toBe('allow');
    }
  });

  it('given an allow-listed path, should still allow it', () => {
    for (const spelling of ['docs/spec.md', '.peaks/memory/notes.md', 'README.md']) {
      const verdict = decideGateAction('Edit', { file_path: spelling }, null, PROJECT_ROOT);
      expect(verdict.action, `spelling: ${spelling}`).toBe('allow');
    }
  });
});

describe('a11y — the deny message names the path the tool asked for', () => {
  it('given a path carrying `..`, should echo that spelling', () => {
    const verdict = decideGateAction(
      'Edit',
      { file_path: 'docs/../src/services/foo.ts' },
      null,
      PROJECT_ROOT
    );
    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.filePath).toBe('docs/../src/services/foo.ts');
    expect(verdict.message).toContain('docs/../src/services/foo.ts');
    expect(verdict.message).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });
});

// ---------------------------------------------------------------------------
// Integration — the shell sibling, handed the same bytes
// ---------------------------------------------------------------------------

/**
 * The script is a THIN WRAPPER over the Node command: where a command is
 * reachable it execs it, so a test of the script's own decision has to run it
 * with NO command reachable. What answers is the conservative path inside it —
 * the one a harness without Node gets.
 */
async function runHook(input: GateInput): Promise<{ exitCode: number; stderr: string }> {
  const run = runHookScript({ payload: JSON.stringify(input), cli: false });
  return { exitCode: run.status ?? -1, stderr: run.stderr.trim() };
}

describe('integration — the shell sibling resolves the `..` too', () => {
  it(
    'given Edit on a relative path carrying `..`, should exit 2',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const result = await runHook({
        tool: 'Edit',
        input: { file_path: 'docs/../src/services/foo.ts' }
      });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
    }
  );

  it(
    'given Edit on a `..` that leaves the project, should exit 0',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const result = await runHook({
        tool: 'Edit',
        input: { file_path: '../src/services/foo.ts' }
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).not.toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
    }
  );

  it(
    'given Edit on an allow-listed path, should exit 0',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const result = await runHook({ tool: 'Edit', input: { file_path: 'docs/spec.md' } });
      expect(result.exitCode).toBe(0);
    }
  );
});
