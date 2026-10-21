// tests/unit/services/hooks/code-gate-path-spelling.test.ts
//
// The gate's verdict must not depend on how the target path happens to be
// SPELLED. The deny families are project-relative prefixes (`src/`,
// `tests/unit/`, …), so `src/x.ts`, `./src/x.ts` and the absolute spelling
// of that same file are one file and must get one verdict.
//
// Before this, the match was a raw prefix test on the payload's own
// spelling: `src/x.ts` was denied while `./src/x.ts` and the absolute form
// were allowed — the same edit, judged two ways, and the allowed one is the
// one that happens.
//
// Dimensions covered:
//   - render:     the normalized form of a path (the one spelling the
//                 families are written in)
//   - behavior:   the verdict for the spelling matrix, and the case that
//                 stays out of scope (a path in ANOTHER repository)
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

declareDimensions('tests/unit/services/hooks/code-gate-path-spelling.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** A project root that exists, so an absolute path can be related to it. */
const PROJECT_ROOT = resolve(__dirname, '..', '..', '..', '..');

/** The same file, spelled three ways. */
const RELATIVE = 'src/services/foo.ts';
const DOT_RELATIVE = './src/services/foo.ts';
const ABSOLUTE_POSIX = `${PROJECT_ROOT.replace(/\\/g, '/')}/src/services/foo.ts`;
const ABSOLUTE_NATIVE = resolve(PROJECT_ROOT, 'src', 'services', 'foo.ts');

describe('render — normalizeGatePath reduces a path to the one form the families use', () => {
  it('given a relative path, should return it unchanged', () => {
    expect(normalizeGatePath(RELATIVE, PROJECT_ROOT)).toBe(RELATIVE);
  });

  it('given a `./`-prefixed path, should return the path without the prefix', () => {
    expect(normalizeGatePath(DOT_RELATIVE, PROJECT_ROOT)).toBe(RELATIVE);
  });

  it('given an absolute path inside the project root, should return the project-relative path', () => {
    expect(normalizeGatePath(ABSOLUTE_POSIX, PROJECT_ROOT)).toBe(RELATIVE);
    expect(normalizeGatePath(ABSOLUTE_NATIVE, PROJECT_ROOT)).toBe(RELATIVE);
  });

  it('given a path spelled with backslashes, should return the same path with forward slashes', () => {
    expect(normalizeGatePath('src\\services\\foo.ts', PROJECT_ROOT)).toBe(RELATIVE);
  });

  it('given an empty path, should return an empty path', () => {
    expect(normalizeGatePath('', PROJECT_ROOT)).toBe('');
  });
});

describe('behavior — the verdict is the same for every spelling of one file', () => {
  const spellings = [RELATIVE, DOT_RELATIVE, ABSOLUTE_POSIX, ABSOLUTE_NATIVE];

  it('given one file spelled four ways, should deny all four for a caller the gate cannot place', () => {
    for (const spelling of spellings) {
      const verdict = decideGateAction('Edit', { file_path: spelling }, null, PROJECT_ROOT);
      expect(verdict.action, `spelling: ${spelling}`).toBe('deny');
    }
  });

  it('given one file spelled four ways, should reach the same family every time', () => {
    const reasons = spellings.map((spelling) => {
      const verdict = decideGateAction('Edit', { file_path: spelling }, null, PROJECT_ROOT);
      if (verdict.action !== 'deny') throw new Error(`expected a deny for ${spelling}`);
      return verdict.reason;
    });
    expect(new Set(reasons).size).toBe(1);
    expect(reasons[0]).toContain('src/');
  });

  it('given one file spelled four ways, should open the family the same way for the fast lane', () => {
    for (const spelling of spellings) {
      const verdict = decideGateAction(
        'Edit',
        { file_path: spelling },
        'peaks-race-code',
        PROJECT_ROOT
      );
      expect(verdict.action, `spelling: ${spelling}`).toBe('allow');
    }
  });

  it('given an allow-listed file spelled three ways, should allow all three', () => {
    for (const spelling of [
      'docs/spec.md',
      './docs/spec.md',
      `${PROJECT_ROOT.replace(/\\/g, '/')}/docs/spec.md`
    ]) {
      const verdict = decideGateAction('Edit', { file_path: spelling }, null, PROJECT_ROOT);
      expect(verdict.action, `spelling: ${spelling}`).toBe('allow');
    }
  });

  it('given a path in ANOTHER repository, should leave it alone rather than judge it as this project', () => {
    // The families name THIS project's directories. A path in another
    // repository is another project's business, and the gate has always
    // allowed every absolute path — so this is not a widening, it is the
    // reason an absolute path outside the root stays absolute.
    const outside = resolve(PROJECT_ROOT, '..', 'other-repo', 'src', 'foo.ts');
    const verdict = decideGateAction('Edit', { file_path: outside }, null, PROJECT_ROOT);
    expect(verdict.action).toBe('allow');
  });

  it('given no project root, should leave an absolute path alone', () => {
    const verdict = decideGateAction('Edit', { file_path: ABSOLUTE_POSIX }, null, null);
    expect(verdict.action).toBe('allow');
  });
});

describe('a11y — the deny message names the path the tool asked for', () => {
  it('given an absolute path, should echo that path and not the normalized one', () => {
    const verdict = decideGateAction('Edit', { file_path: ABSOLUTE_POSIX }, null, PROJECT_ROOT);
    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.filePath).toBe(ABSOLUTE_POSIX);
    expect(verdict.message).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
    expect(verdict.message).toContain(ABSOLUTE_POSIX);
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
    'given Edit on a `./`-prefixed hard-blocked path, should exit 2',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const result = await runHook({ tool: 'Edit', input: { file_path: DOT_RELATIVE } });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
    }
  );

  it(
    'given Edit on a backslash-spelled hard-blocked path, should exit 2',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const result = await runHook({ tool: 'Edit', input: { file_path: 'src\\services\\foo.ts' } });
      expect(result.exitCode).toBe(2);
      expect(result.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
    }
  );

  it(
    'given Edit on a `./`-prefixed allow-listed path, should exit 0',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      const result = await runHook({ tool: 'Edit', input: { file_path: './docs/spec.md' } });
      expect(result.exitCode).toBe(0);
    }
  );
});
