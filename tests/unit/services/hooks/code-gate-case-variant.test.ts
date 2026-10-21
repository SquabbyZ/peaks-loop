// tests/unit/services/hooks/code-gate-case-variant.test.ts
//
// The gate's verdict must be decided by WHERE the target file lives, not by
// how the path that names it happens to be spelled. A CASE variant is one of
// those spellings: every hard-blocked family name is lower-case, and on any
// case-insensitive filesystem (Windows, and macOS by default) `SRC/foo.ts` IS
// the file `src/foo.ts`. Comparing the case exactly therefore let the
// spelling decide the verdict.
//
// The counter-case is in this file too, because it is what a too-broad fix
// would break: the fast lane still opens the families, an allow-listed path
// is still allowed, and a path in another repository is still left alone.
//
// Dimensions covered:
//   - render:     the normalized form of a path
//   - behavior:   the verdict for each spelling, and the cases that stay out
//   - integration: the shell sibling, handed the same bytes
//   - a11y:       the deny message names the path the tool asked for

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  decideGateAction,
  normalizeGatePath,
  type GateInput
} from '~/src/services/hooks/pre-tool-code-gate';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../../_setup/subprocess-timeouts.js';

declareDimensions('tests/unit/services/hooks/code-gate-case-variant.test.ts', [
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
  'SRC/services/foo.ts',
  'src/Services/foo.ts',
  'Src/services/foo.ts'
] as const;

describe('render — normalizeGatePath keeps the spelling the tool used', () => {
  it('given a case variant, should not fold the case in the path itself', () => {
    // The case is folded for the COMPARISON, not in the path: the caller is
    // told about the path it asked for.
    expect(normalizeGatePath('SRC/services/foo.ts', PROJECT_ROOT)).toBe('SRC/services/foo.ts');
  });
});

describe('behavior — a case variant is the file it names', () => {
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

  it('given a case variant of an allow-listed file, should reach the same verdict', () => {
    // Both lists are folded the SAME way, because both are judged against
    // the same path. A case variant of an allow-listed file that became a
    // deny would be the same spelling defect, moved to the other list.
    const lower = decideGateAction(
      'Edit',
      { file_path: 'src/services/foo.md' },
      null,
      PROJECT_ROOT
    );
    const variant = decideGateAction(
      'Edit',
      { file_path: 'SRC/Services/foo.md' },
      null,
      PROJECT_ROOT
    );
    expect(lower.action).toBe('allow');
    expect(variant.action).toBe('allow');
  });

  it('given a path in ANOTHER repository, should leave it alone', () => {
    const outside = resolve(PROJECT_ROOT, '..', 'other-repo', 'src', 'foo.ts');
    const verdict = decideGateAction('Edit', { file_path: outside }, null, PROJECT_ROOT);
    expect(verdict.action).toBe('allow');
  });
});

describe('a11y — the deny message names the path the tool asked for', () => {
  it('given a case variant, should echo that spelling and not the folded one', () => {
    const verdict = decideGateAction(
      'Edit',
      { file_path: 'SRC/services/foo.ts' },
      null,
      PROJECT_ROOT
    );
    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.filePath).toBe('SRC/services/foo.ts');
    expect(verdict.message).toContain('SRC/services/foo.ts');
    expect(verdict.message).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });
});

// ---------------------------------------------------------------------------
// Integration — the shell sibling, handed the same bytes
// ---------------------------------------------------------------------------

const HOOK_SCRIPT = resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'src',
  'services',
  'hooks',
  'pre-tool-code-gate.sh'
);

async function runHook(input: GateInput): Promise<{ exitCode: number; stderr: string }> {
  return new Promise((resolveFn, reject) => {
    const child = spawn('bash', [HOOK_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      resolveFn({ exitCode: typeof code === 'number' ? code : -1, stderr: stderr.trim() });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

describe('integration — the shell sibling judges the spelling, not the letters', () => {
  it(
    'given Edit on a case variant of a hard-blocked path, should exit 2',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const result = await runHook({ tool: 'Edit', input: { file_path: 'SRC/services/foo.ts' } });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
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
