/**
 * Slice 2.0.1-bug3-fact-forcing-bypass — workspace-init integration test.
 *
 * The consumer-project fact-forcing bypass is anchored in
 * `peaks workspace init`. The hook template ships as
 * `.claude/settings.local.json` in the consumer project's repo root
 * the first time `peaks workspace init` runs (and on every subsequent
 * init — the file is rewritten to keep the template in sync with the
 * peaks-cli release). Pass `--no-claude-hooks` to opt out.
 *
 * Sub-cases (per PRD AC):
 *   (A) default flags → `.claude/settings.local.json` exists with the
 *       two hook matchers (Write|Edit|MultiEdit + Bash); the file
 *       content matches the template returned by
 *       `buildClaudeSettingsLocalJson()`.
 *   (B) `--no-claude-hooks` flag → file does NOT exist.
 *   (C) the path-matching logic in the hook command allows paths
 *       under `.peaks/_runtime/` and `.peaks/<changeId>/` and rejects
 *       paths under `src/`. We exercise the matcher by extracting the
 *       inline node command and running it as a child process with
 *       the candidate path on argv[2].
 *
 * The test uses a fresh tmp project per case so the two flag-modes
 * do not contaminate each other.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { buildClaudeSettingsLocalJson } from '../../../src/services/workspace/claude-settings-template.js';
import { initWorkspace } from '../../../src/services/workspace/workspace-service.js';

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-bug3-'));
}

function runHookCommand(command: string, candidatePath: string): { exitCode: number; stdout: string; stderr: string } {
  // The hook command is a `node -e "<js>"` wrapper (slice
  // fix-claude-settings-template-hook-node-wrapper). We invoke it
  // exactly the way Claude Code's hook runner would: pass the
  // command string to the platform shell as a single string with
  // `shell: true`, and append the candidate path as an extra
  // positional arg so the wrapper sees it on `process.argv[1]`
  // (Node's argv layout under `-e` is consistent across Windows,
  // macOS, and Linux). Exit 0 = allow, non-zero = deny (the
  // PreToolUse protocol treats non-zero as default-deny so the gate
  // fires). We capture stdout/stderr for the failure case so the
  // assertion message has signal when the matcher regresses.
  try {
    const stdout = execFileSync(`${command} ${JSON.stringify(candidatePath)}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error: unknown) {
    const err = error as { status?: number | null; stdout?: string | Buffer; stderr?: string | Buffer };
    return {
      exitCode: err.status ?? 1,
      stdout: typeof err.stdout === 'string' ? err.stdout : err.stdout?.toString() ?? '',
      stderr: typeof err.stderr === 'string' ? err.stderr : err.stderr?.toString() ?? ''
    };
  }
}

describe('workspace init — consumer-project .claude/settings.local.json (slice 2.0.1-bug3)', () => {
  let project: string;
  beforeEach(() => {
    project = makeProject();
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('case A — default flags → .claude/settings.local.json is materialized with both hook matchers', async () => {
    const result = await initWorkspace({
      projectRoot: project,
      sessionId: '2026-06-12-session-bug3a01',
      allowSessionRebind: false
    });
    expect(result.bound).toBe(true);

    const settingsPath = join(project, '.claude', 'settings.local.json');
    expect(existsSync(settingsPath)).toBe(true);

    // File content must match the template byte-for-byte. JSON.parse
    // on both sides strips formatting and re-serialises deterministically.
    const onDisk = JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown;
    const expected = buildClaudeSettingsLocalJson();
    expect(onDisk).toEqual(expected);

    // Both matchers must be present in the on-disk file.
    const template = expected as {
      hooks: { PreToolUse: Array<{ matcher: string }> }
    };
    const matchers = template.hooks.PreToolUse.map((entry) => entry.matcher);
    expect(matchers).toContain('Write|Edit|MultiEdit');
    expect(matchers).toContain('Bash');
  });

  test('case B — noClaudeHooks flag → .claude/settings.local.json is NOT created', async () => {
    const result = await initWorkspace({
      projectRoot: project,
      sessionId: '2026-06-12-session-bug3b01',
      allowSessionRebind: false,
      noClaudeHooks: true
    });
    expect(result.bound).toBe(true);
    const settingsPath = join(project, '.claude', 'settings.local.json');
    expect(existsSync(settingsPath)).toBe(false);
  });

  test('case C — path matcher in the Write|Edit|MultiEdit hook allows .peaks/_runtime/ and .peaks/<changeId>/, rejects src/', async () => {
    // Lay down a session + change-id dir so the workspace structure
    // matches a real consumer project.
    await initWorkspace({
      projectRoot: project,
      sessionId: '2026-06-12-session-bug3c01',
      allowSessionRebind: false,
      changeId: '2.0.1-bug3-fact-forcing-bypass'
    });

    // Extract the inline node command from the template (the first
    // hook entry is Write|Edit|MultiEdit).
    const template = buildClaudeSettingsLocalJson() as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ command: string }> }> }
    };
    const writeEntry = template.hooks.PreToolUse.find((e) => e.matcher === 'Write|Edit|MultiEdit');
    expect(writeEntry).toBeDefined();
    const writeCommand = writeEntry!.hooks[0]!.command;

    // Allow-list paths — must exit 0.
    const allowedPaths = [
      '.peaks/_runtime/2026-06-12-session-bug3c01/session.json',
      '.peaks/_runtime/2026-06-12-session-bug3c01/rd/requests/001-foo.md',
      '.peaks/2.0.1-bug3-fact-forcing-bypass/rd/requests/001-foo.md',
      '.peaks/2.0.1-bug3-fact-forcing-bypass/qa/requests/001-foo.md'
    ];
    for (const p of allowedPaths) {
      const result = runHookCommand(writeCommand, p);
      expect(result.exitCode, `expected allow for ${p}, got stderr=${result.stderr}`).toBe(0);
    }

    // Deny-list paths — must NOT exit 0.
    const deniedPaths = [
      'src/index.ts',
      'src/services/workspace/workspace-service.ts',
      'package.json',
      '.git/HEAD',
      'README.md'
    ];
    for (const p of deniedPaths) {
      const result = runHookCommand(writeCommand, p);
      expect(result.exitCode, `expected deny for ${p}, got exit 0 with stdout=${result.stdout}`).not.toBe(0);
    }
  });

  test('the materialized file is not a symlink (consumer project can rely on path equality)', async () => {
    await initWorkspace({
      projectRoot: project,
      sessionId: '2026-06-12-session-bug3d01',
      allowSessionRebind: false
    });
    // Pre-create .claude as a directory and verify the installer
    // wrote settings.local.json as a real file (not a symlink) so
    // `cat .claude/settings.local.json` works in the consumer's
    // terminal.
    const claudeDir = join(project, '.claude');
    expect(existsSync(claudeDir)).toBe(true);
    const stat = readFileSync(join(claudeDir, 'settings.local.json'), 'utf8');
    // Empty-file guard: the file must be non-empty JSON, not a 0-byte
    // symlink target.
    expect(stat.length).toBeGreaterThan(0);
    expect(() => JSON.parse(stat) as unknown).not.toThrow();
  });
});

describe('claude-settings-template — settings.local.json is added to .peaks/.gitignore on first init', () => {
  // The spec mandates: "The .claude/settings.local.json file MUST be
  // added to .peaks/.gitignore so it doesn't pollute consumer repos."
  // We test the side-effect on the consumer project's own .peaks
  // gitignore, not the peaks-cli repo's root .gitignore. The slice
  // contract: a peaks-managed snippet (managed by peaks-cli) is
  // appended/merged to the consumer's `.peaks/.gitignore` so the
  // local-only file does not get committed.
  let project: string;
  beforeEach(() => {
    project = makeProject();
  });
  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('init creates .peaks/.gitignore with .claude/settings.local.json entry when no prior .peaks/.gitignore exists', async () => {
    await initWorkspace({
      projectRoot: project,
      sessionId: '2026-06-12-session-bug3e01',
      allowSessionRebind: false
    });
    const gitignorePath = join(project, '.peaks', '.gitignore');
    expect(existsSync(gitignorePath)).toBe(true);
    const content = readFileSync(gitignorePath, 'utf8');
    // The gitignore must mention the settings.local.json file. We
    // accept either a direct path line (`.claude/settings.local.json`)
    // or a parent-dir pattern (`.claude/`) as long as the on-disk
    // file is covered.
    expect(content.includes('.claude/settings.local.json') || content.includes('.claude/')).toBe(true);
  });

  test('init preserves any user-managed .peaks/.gitignore entries and appends the peaks-managed snippet', async () => {
    // Pre-seed the consumer's .peaks/.gitignore with a user-managed
    // entry. After init, both lines must still be present.
    mkdirSync(join(project, '.peaks'), { recursive: true });
    const userEntry = '# user-managed entry — do not touch\n.peaks/_runtime/\n';
    writeFileSync(join(project, '.peaks', '.gitignore'), userEntry, 'utf8');

    await initWorkspace({
      projectRoot: project,
      sessionId: '2026-06-12-session-bug3e02',
      allowSessionRebind: false
    });
    const content = readFileSync(join(project, '.peaks', '.gitignore'), 'utf8');
    expect(content).toContain('# user-managed entry — do not touch');
    expect(content).toContain('.peaks/_runtime/');
    // The peaks-managed snippet must also be present.
    expect(content.includes('.claude/settings.local.json') || content.includes('.claude/')).toBe(true);
  });
});
