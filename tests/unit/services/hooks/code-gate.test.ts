// tests/unit/services/hooks/code-gate.test.ts
//
// 4-dimension unit test for
//   - src/services/hooks/pre-tool-code-gate.ts (pure decision logic)
//   - src/services/hooks/pre-tool-code-gate.sh (vendor-neutral shell
//     hook; smoke-tested via child_process spawn)
//
// Slice 2026-08-06-codegate-vendor-neutral: the peaks-code
// orchestrator MUST NOT directly Edit/Write/MultiEdit on hard-blocked
// path families (src/, tests/unit/, tests/integration/, config/,
// bin/, scripts/). Two-layer enforcement:
//   (a) LLM-side: `peaks code orchestrator-can-do` (Step 0.51 probe)
//   (b) Tool-side: this hook (PreToolUse, exit 0 allow / exit 2 deny)
//
// The hook itself is vendor-neutral — no `claude`/`claude-code`/
// `anthropic` strings live in the script or the service module. The
// vendor-specific installer lives in `src/cli/commands/hooks-commands.ts`
// (which is the ONE file allowed to mention vendor names for
// adapter-level install logic).
//
// Dimensions covered:
//   - render:     verdict shape (action: 'allow' | 'deny' + reason + message)
//   - behavior:   6 hard-blocked families + 6 allow-list patterns + tool-name gate
//   - integration: real shell-hook smoke tests via child_process (JSON stdin)
//   - a11y:       stderr message includes the PEAKS_CODE_PROHIBITED_DIRECT_EDIT
//                 prefix and the `peaks sub-agent dispatch rd` next-action verb

import { describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';
import {
  decideGateAction,
  extractFilePath,
  HARD_BLOCKED_PATH_FAMILIES,
  ALLOW_LISTED_PATH_PATTERNS,
  type GateInput,
} from '~/src/services/hooks/pre-tool-code-gate';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

declareDimensions(
  'tests/unit/services/hooks/code-gate.test.ts',
  ['render', 'behavior', 'integration', 'a11y']
);

// ---------------------------------------------------------------------------
// Pure helpers — extractFilePath + hard-blocked/allow-listed constants
// ---------------------------------------------------------------------------

describe('Scenario: render — extractFilePath falls back through input keys', () => {
  it('given input.file_path, should return file_path', () => {
    expect(extractFilePath({ file_path: 'src/foo.ts' })).toBe('src/foo.ts');
  });

  it('given input.path, should return path when file_path is missing', () => {
    expect(extractFilePath({ path: 'src/foo.ts' })).toBe('src/foo.ts');
  });

  it('given input.notebook_path, should return notebook_path when others are missing', () => {
    expect(extractFilePath({ notebook_path: 'src/foo.ts' })).toBe('src/foo.ts');
  });

  it('given empty / missing keys, should return empty string', () => {
    expect(extractFilePath({})).toBe('');
    expect(extractFilePath({ unrelated: 'x' })).toBe('');
  });
});

describe('Scenario: render — HARD_BLOCKED_PATH_FAMILIES pins to the 6 deny families', () => {
  it('when invoked, should equal the canonical 6-family deny list', () => {
    expect(HARD_BLOCKED_PATH_FAMILIES).toEqual([
      'src/',
      'tests/unit/',
      'tests/integration/',
      'config/',
      'bin/',
      'scripts/',
    ]);
  });

  it('when invoked, should NOT include .peaks/, skills/, or docs/ (allow-list lives separately)', () => {
    expect(HARD_BLOCKED_PATH_FAMILIES).not.toContain('.peaks/');
    expect(HARD_BLOCKED_PATH_FAMILIES).not.toContain('skills/');
    expect(HARD_BLOCKED_PATH_FAMILIES).not.toContain('docs/');
  });
});

describe('Scenario: render — ALLOW_LISTED_PATH_PATTERNS pins to the orchestrator-allowed families', () => {
  it('when invoked, should include .peaks/, skills/, docs/, .md, CHANGELOG, README', () => {
    expect(ALLOW_LISTED_PATH_PATTERNS).toContain('.peaks/');
    expect(ALLOW_LISTED_PATH_PATTERNS).toContain('skills/');
    expect(ALLOW_LISTED_PATH_PATTERNS).toContain('docs/');
    expect(ALLOW_LISTED_PATH_PATTERNS).toContain('.md');
    expect(ALLOW_LISTED_PATH_PATTERNS).toContain('CHANGELOG.md');
    expect(ALLOW_LISTED_PATH_PATTERNS).toContain('README.md');
  });
});

// ---------------------------------------------------------------------------
// decideGateAction — the pure decision function
// ---------------------------------------------------------------------------

describe('Scenario: behavior — decideGateAction tool-name gate', () => {
  it('given tool=Bash, when called, then action=allow (only Edit/Write/MultiEdit are gated)', () => {
    const verdict = decideGateAction('Bash', { command: 'rm -rf /' });
    expect(verdict.action).toBe('allow');
  });

  it('given tool=Read, when called, then action=allow', () => {
    const verdict = decideGateAction('Read', { file_path: 'src/services/foo.ts' });
    expect(verdict.action).toBe('allow');
  });

  it('given tool=Grep, when called, then action=allow', () => {
    const verdict = decideGateAction('Grep', { file_path: 'src/services/foo.ts' });
    expect(verdict.action).toBe('allow');
  });
});

describe('Scenario: behavior — decideGateAction allow-list short-circuits', () => {
  it('given Edit on .peaks/memory/notes.md, when called, then action=allow', () => {
    const verdict = decideGateAction('Edit', { file_path: '.peaks/memory/notes.md' });
    expect(verdict.action).toBe('allow');
  });

  it('given Edit on skills/peaks-code/SKILL.md, when called, then action=allow', () => {
    const verdict = decideGateAction('Edit', { file_path: 'skills/peaks-code/SKILL.md' });
    expect(verdict.action).toBe('allow');
  });

  it('given Edit on docs/spec.md, when called, then action=allow', () => {
    const verdict = decideGateAction('Edit', { file_path: 'docs/spec.md' });
    expect(verdict.action).toBe('allow');
  });

  it('given Write on CHANGELOG.md, when called, then action=allow', () => {
    const verdict = decideGateAction('Write', { file_path: 'CHANGELOG.md' });
    expect(verdict.action).toBe('allow');
  });

  it('given Write on README.md, when called, then action=allow', () => {
    const verdict = decideGateAction('Write', { file_path: 'README.md' });
    expect(verdict.action).toBe('allow');
  });
});

describe('Scenario: behavior — decideGateAction hard-blocked family deny (all 6 families)', () => {
  it('given Edit on src/services/foo.ts, when called, then action=deny with PEAKS_CODE_PROHIBITED_DIRECT_EDIT message', () => {
    const verdict = decideGateAction('Edit', { file_path: 'src/services/foo.ts' });
    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.filePath).toBe('src/services/foo.ts');
    expect(verdict.message).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
    expect(verdict.message).toContain('peaks sub-agent dispatch rd');
    expect(verdict.reason).toContain('src/');
  });

  it('given Write on tests/unit/services/foo.test.ts, when called, then action=deny', () => {
    const verdict = decideGateAction('Write', { file_path: 'tests/unit/services/foo.test.ts' });
    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.reason).toContain('tests/unit/');
  });

  it('given Edit on tests/integration/foo.test.ts, when called, then action=deny', () => {
    const verdict = decideGateAction('Edit', { file_path: 'tests/integration/foo.test.ts' });
    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.reason).toContain('tests/integration/');
  });

  it('given Write on config/peaks.json, when called, then action=deny', () => {
    const verdict = decideGateAction('Write', { file_path: 'config/peaks.json' });
    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.reason).toContain('config/');
  });

  it('given Edit on bin/peaks.js, when called, then action=deny', () => {
    const verdict = decideGateAction('Edit', { file_path: 'bin/peaks.js' });
    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.reason).toContain('bin/');
  });

  it('given Edit on scripts/release.sh, when called, then action=deny', () => {
    const verdict = decideGateAction('Edit', { file_path: 'scripts/release.sh' });
    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.reason).toContain('scripts/');
  });

  it('given MultiEdit on src/cli/commands/foo.ts, when called, then action=deny', () => {
    const verdict = decideGateAction('MultiEdit', { file_path: 'src/cli/commands/foo.ts' });
    expect(verdict.action).toBe('deny');
  });
});

describe('Scenario: behavior — decideGateAction fail-open on missing path', () => {
  it('given Edit with no file_path, when called, then action=allow (fail-open)', () => {
    const verdict = decideGateAction('Edit', {});
    expect(verdict.action).toBe('allow');
  });

  it('given Edit with empty file_path, when called, then action=allow', () => {
    const verdict = decideGateAction('Edit', { file_path: '' });
    expect(verdict.action).toBe('allow');
  });
});

// ---------------------------------------------------------------------------
// a11y — stderr message contract (LLM-readable next-action verb)
// ---------------------------------------------------------------------------

describe('Scenario: a11y — deny message carries the LLM-readable next-action verb', () => {
  it('when verdict.action=deny, then message starts with PEAKS_CODE_PROHIBITED_DIRECT_EDIT and ends with peaks sub-agent dispatch rd hint', () => {
    const verdict = decideGateAction('Edit', { file_path: 'src/services/foo.ts' });
    expect(verdict.action).toBe('deny');
    if (verdict.action !== 'deny') return;
    expect(verdict.message.startsWith('PEAKS_CODE_PROHIBITED_DIRECT_EDIT: ')).toBe(true);
    expect(verdict.message).toContain('peaks sub-agent dispatch rd');
  });
});

// ---------------------------------------------------------------------------
// Integration — shell-hook smoke tests via child_process spawn
// ---------------------------------------------------------------------------

const HOOK_SCRIPT = resolve(__dirname, '..', '..', '..', '..', 'src', 'services', 'hooks', 'pre-tool-code-gate.sh');

interface SpawnResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

async function runHook(input: GateInput): Promise<SpawnResult> {
  return new Promise<SpawnResult>((resolveFn, reject) => {
    const child = spawn('bash', [HOOK_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      resolveFn({
        exitCode: typeof code === 'number' ? code : -1,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

describe('Scenario: integration — shell hook smoke (real child_process)', () => {
  it('given Edit on src/services/foo.ts, when hook runs, then exit=2 + stderr contains PEAKS_CODE_PROHIBITED_DIRECT_EDIT', async () => {
    const result = await runHook({ tool: 'Edit', input: { file_path: 'src/services/foo.ts' } });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
    expect(result.stderr).toContain('src/services/foo.ts');
    expect(result.stderr).toContain('peaks sub-agent dispatch rd');
  });

  it('given Edit on .peaks/memory/notes.md, when hook runs, then exit=0 (allow)', async () => {
    const result = await runHook({ tool: 'Edit', input: { file_path: '.peaks/memory/notes.md' } });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });

  it('given Edit on skills/peaks-code/SKILL.md, when hook runs, then exit=0 (skill files allowed)', async () => {
    const result = await runHook({ tool: 'Edit', input: { file_path: 'skills/peaks-code/SKILL.md' } });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });

  it('given Edit on tests/unit/services/foo.test.ts, when hook runs, then exit=2', async () => {
    const result = await runHook({ tool: 'Edit', input: { file_path: 'tests/unit/services/foo.test.ts' } });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });

  it('given MultiEdit on bin/peaks.js, when hook runs, then exit=2', async () => {
    const result = await runHook({ tool: 'MultiEdit', input: { file_path: 'bin/peaks.js' } });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });

  it('given Bash tool call, when hook runs, then exit=0 (not gated)', async () => {
    const result = await runHook({ tool: 'Bash', input: { command: 'ls' } });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain('PEAKS_CODE_PROHIBITED_DIRECT_EDIT');
  });

  it('given empty stdin, when hook runs, then exit=0 (tolerate empty payload)', async () => {
    const result = await new Promise<SpawnResult>((resolveFn, reject) => {
      const child = spawn('bash', [HOOK_SCRIPT], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
      child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
      child.on('error', (err) => reject(err));
      child.on('close', (code) => {
        resolveFn({ exitCode: typeof code === 'number' ? code : -1, stdout: stdout.trim(), stderr: stderr.trim() });
      });
      child.stdin.end('');
    });
    expect(result.exitCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Vendor-neutrality audit — verify the script + the service module do NOT
// reference any vendor names.
// ---------------------------------------------------------------------------

describe('Scenario: behavior — vendor-neutrality (no claude / anthropic strings in new files)', () => {
  it('the shell hook script must not reference claude, claude-code, anthropic, or us.anthropic', async () => {
    const fs = await import('node:fs/promises');
    const src = await fs.readFile(HOOK_SCRIPT, 'utf8');
    expect(src).not.toMatch(/\bclaude\b/i);
    expect(src).not.toMatch(/\bclaude-code\b/i);
    expect(src).not.toMatch(/\banthropic\b/i);
    expect(src).not.toMatch(/us\.anthropic/i);
  });

  it('the service module must not reference claude, claude-code, anthropic, or us.anthropic', async () => {
    const fs = await import('node:fs/promises');
    const servicePath = resolve(__dirname, '..', '..', '..', '..', 'src', 'services', 'hooks', 'pre-tool-code-gate.ts');
    const src = await fs.readFile(servicePath, 'utf8');
    expect(src).not.toMatch(/\bclaude\b/i);
    expect(src).not.toMatch(/\bclaude-code\b/i);
    expect(src).not.toMatch(/\banthropic\b/i);
    expect(src).not.toMatch(/us\.anthropic/i);
  });
});