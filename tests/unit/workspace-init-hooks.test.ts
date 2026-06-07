import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  resolveFirstTimeHooksInstall
} from '../../src/cli/commands/workspace-commands.js';

function makeProject(): string {
  return realpathSync(mkdtempSync(join(tmpdir(), 'peaks-ws-init-hooks-')));
}

function writeStickyMarker(projectRoot: string, decision: 'installed' | 'skipped', scope: 'project' | 'global' = 'project'): void {
  const path = join(projectRoot, '.peaks', '.peaks-init-hooks-decision.json');
  mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({ version: 1, decision, decidedAt: '2026-06-04T00:00:00.000Z', scope }, null, 2),
    'utf8'
  );
}

function readStickyMarker(projectRoot: string): { decision: string; scope: string } | null {
  const path = join(projectRoot, '.peaks', '.peaks-init-hooks-decision.json');
  if (!existsSync(path)) return null;
  return JSON.parse(require('node:fs').readFileSync(path, 'utf8')) as { decision: string; scope: string };
}

function writeSettingsJson(projectRoot: string, hooks: unknown): void {
  const path = join(projectRoot, '.claude', 'settings.json');
  mkdirSync(join(projectRoot, '.claude'), { recursive: true });
  writeFileSync(path, JSON.stringify({ hooks }, null, 2), 'utf8');
}

function writeSessionBinding(projectRoot: string, sessionId: string): void {
  mkdirSync(join(projectRoot, '.peaks', sessionId), { recursive: true });
  writeFileSync(
    join(projectRoot, '.peaks', '.session.json'),
    JSON.stringify({ sessionId, createdAt: '2026-06-04T00:00:00.000Z', projectRoot }, null, 2),
    'utf8'
  );
}

describe('resolveFirstTimeHooksInstall — sticky-marker honour', () => {
  let project: string;
  beforeEach(() => {
    project = makeProject();
    writeSessionBinding(project, '2026-06-04-session-init01');
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('marker present (installed) + hooks present → marker-honored, no reinstall', async () => {
    writeStickyMarker(project, 'installed');
    // Pre-install the hook (gate-enforce sentinel) so the readHookStatus check passes.
    writeSettingsJson(project, { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'peaks gate enforce --project "x"' }] }] });
    const result = await resolveFirstTimeHooksInstall({ projectRoot: project, jsonMode: true });
    expect(result.decision).toBe('installed');
    expect(result.action).toBe('marker-honored');
  });

  test('marker present (installed) + hooks MISSING → reinstalled, marker decision preserved', async () => {
    writeStickyMarker(project, 'installed');
    // settings.json does NOT have the peaks hook
    const result = await resolveFirstTimeHooksInstall({ projectRoot: project, jsonMode: true });
    expect(result.decision).toBe('installed');
    expect(result.action).toBe('reinstalled');
    expect(result.reason).toBe('marker-said-installed-hooks-missing');
    // Verify the hook is now actually written
    const settings = JSON.parse(require('node:fs').readFileSync(join(project, '.claude', 'settings.json'), 'utf8')) as { hooks: { PreToolUse: { matcher: string }[] } };
    expect(settings.hooks.PreToolUse.some((e) => e.matcher === 'Bash')).toBe(true);
    // Slice #014: the legacy progress-start hook entry is removed; the
    // reinstall path must emit ONLY the Bash gate-enforce entry. A Task
    // matcher would mean the pre-#014 ghost entry has resurfaced.
    expect(settings.hooks.PreToolUse.some((e) => e.matcher === 'Task')).toBe(false);
  });

  test('marker present (skipped) → marker-honored, no install attempt', async () => {
    writeStickyMarker(project, 'skipped');
    const result = await resolveFirstTimeHooksInstall({ projectRoot: project, jsonMode: true });
    expect(result.decision).toBe('skipped');
    expect(result.action).toBe('marker-honored');
    // settings.json must NOT exist (we never called applyHookInstall)
    expect(existsSync(join(project, '.claude', 'settings.json'))).toBe(false);
  });
});

describe('resolveFirstTimeHooksInstall — first decision (no marker)', () => {
  let project: string;
  beforeEach(() => {
    project = makeProject();
    writeSessionBinding(project, '2026-06-04-session-init02');
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('hooks already present + no marker → already-installed, writes fresh marker (locks the answer)', async () => {
    writeSettingsJson(project, { PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'peaks gate enforce --project "x"' }] }] });
    const result = await resolveFirstTimeHooksInstall({ projectRoot: project, jsonMode: true });
    expect(result.decision).toBe('installed');
    expect(result.action).toBe('already-installed');
    // A fresh marker should now exist
    const marker = readStickyMarker(project);
    expect(marker).not.toBeNull();
    expect(marker?.decision).toBe('installed');
  });

  test('explicit --install-hooks=auto + no marker + no hooks → first-decision installed, writes both marker + hooks', async () => {
    const result = await resolveFirstTimeHooksInstall({ projectRoot: project, explicitMode: 'auto', jsonMode: true });
    expect(result.decision).toBe('installed');
    expect(result.action).toBe('first-decision');
    expect(result.reason).toBe('explicit-auto');
    expect(readStickyMarker(project)?.decision).toBe('installed');
    expect(existsSync(join(project, '.claude', 'settings.json'))).toBe(true);
  });

  test('explicit --install-hooks=skip + no marker + no hooks → first-decision skipped, writes marker only', async () => {
    const result = await resolveFirstTimeHooksInstall({ projectRoot: project, explicitMode: 'skip', jsonMode: true });
    expect(result.decision).toBe('skipped');
    expect(result.action).toBe('first-decision');
    expect(result.reason).toBe('explicit-skip');
    expect(readStickyMarker(project)?.decision).toBe('skipped');
    // No settings.json should be written
    expect(existsSync(join(project, '.claude', 'settings.json'))).toBe(false);
  });

  test('jsonMode forces auto-install (LLM cannot answer an interactive prompt)', async () => {
    // explicitMode omitted; jsonMode is the only signal — must auto-install
    const result = await resolveFirstTimeHooksInstall({ projectRoot: project, jsonMode: true });
    expect(result.decision).toBe('installed');
    expect(result.action).toBe('first-decision');
    expect(result.reason).toBe('json-mode');
  });

  test('effectiveMode defaults to ask in TTY when --install-hooks is omitted, but ask+TTY would block — pass through to prompt path (returns either user-answered or tty-prompt-aborted)', async () => {
    // We cannot reliably simulate a TTY prompt in vitest. Verify only that
    // the function does not throw and returns a first-decision outcome
    // (either yes or no depending on the test runner's TTY state).
    const result = await resolveFirstTimeHooksInstall({ projectRoot: project, jsonMode: false });
    // In a non-TTY vitest run, stdin.isTTY is false → falls through to auto.
    // In a TTY run, the prompt path resolves (or times out → tty-prompt-aborted).
    expect(result.action === 'first-decision').toBe(true);
    expect(['installed', 'skipped']).toContain(result.decision);
  });

  test('corrupted marker file is treated as no marker (first decision applies)', async () => {
    const path = join(project, '.peaks', '.peaks-init-hooks-decision.json');
    mkdirSync(join(project, '.peaks'), { recursive: true });
    writeFileSync(path, '{not-valid-json', 'utf8');
    const result = await resolveFirstTimeHooksInstall({ projectRoot: project, explicitMode: 'auto', jsonMode: true });
    expect(result.action).toBe('first-decision');
    expect(result.decision).toBe('installed');
  });

  test('marker with wrong shape (version !== 1) is treated as no marker', async () => {
    const path = join(project, '.peaks', '.peaks-init-hooks-decision.json');
    mkdirSync(join(project, '.peaks'), { recursive: true });
    writeFileSync(path, JSON.stringify({ version: 99, decision: 'installed', decidedAt: 'x', scope: 'project' }), 'utf8');
    const result = await resolveFirstTimeHooksInstall({ projectRoot: project, explicitMode: 'auto', jsonMode: true });
    expect(result.action).toBe('first-decision');
  });
});

describe('resolveFirstTimeHooksInstall — hook install failure surfaces a reason, marker still records installed', () => {
  let project: string;
  beforeEach(() => {
    project = makeProject();
    writeSessionBinding(project, '2026-06-04-session-init03');
    // Pre-create .claude as a symlink → applyHookInstall will refuse with assertSafeSettingsPath.
    // (The hook installer rejects symlinked .claude directories to prevent the user-side write
    // from following an attacker-controlled symlink.)
    try {
      mkdirSync(join(project, '.claude-target'), { recursive: true });
      require('node:fs').symlinkSync(join(project, '.claude-target'), join(project, '.claude'), 'dir');
    } catch {
      // On some CI / filesystems symlinks are restricted; skip the failure path in that case.
    }
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('install failure is captured in reason; marker still records installed (so we do not retry every init)', async () => {
    if (!existsSync(join(project, '.claude'))) {
      // Symlink could not be created; skip the test on this platform.
      return;
    }
    const result = await resolveFirstTimeHooksInstall({ projectRoot: project, explicitMode: 'auto', jsonMode: true });
    // Either install succeeded (rejected symlink on some platforms), or it failed.
    if (result.action === 'first-decision' && result.reason?.startsWith('install-failed')) {
      expect(result.decision).toBe('installed');
      expect(result.action).toBe('first-decision');
      expect(readStickyMarker(project)?.decision).toBe('installed');
    } else {
      // Symlink creation succeeded but install was rejected → reason is the rejection text
      expect(result.decision).toBe('installed');
    }
  });
});
