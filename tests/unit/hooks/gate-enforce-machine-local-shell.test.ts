/**
 * Slice 2026-09-10-rd-win-hook-fix — the gate-enforce hook's shell choice is
 * machine-specific, so it lives in the machine-local settings file.
 *
 * On Windows the default hook shell is Git Bash (MSYS2), which force-allocates
 * a console window on EVERY Bash tool call. `windowsHide` cannot help: the
 * window is created by the spawner (Claude Code) before any peaks code runs.
 * The only lever the hook schema offers is pinning `shell` — which makes the
 * entry machine-specific, and therefore un-committable in the shared
 * `.claude/settings.json` that macOS / Linux teammates also read.
 *
 * These cases assert the emitted JSON shape for each platform input WITHOUT
 * ever executing a hook (launching one is exactly what pops the window).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';

import { registerHooksCommands } from '~/src/cli/commands/hooks-commands';
import { makeCapturedIo, withEnv } from '../_setup/io.js';
import { resolveHookEntries, resolveHookShell, resolveHookSpec } from '~/src/services/skills/hooks-codegate-superpowers';
import { installAutoCompactHook } from '~/src/services/hooks/auto-compact-hook-install';
import { applyHookInstall, planHookInstall } from '~/src/services/skills/hooks-settings-service';
import { buildClaudeSettingsLocalJson, TEMPLATE_VERSION, templateContentMatches } from '~/src/services/workspace/claude-settings-template';

/** Force `process.platform` for the duration of a case. */
function stubPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true });
}

const realPlatform = process.platform;

/** Repo root — this file lives at `<root>/tests/unit/hooks/`. */
const ROOT = join(__dirname, '..', '..', '..');

type PreToolUseEntry = { matcher?: string; hooks?: Array<{ command?: string; shell?: string }> };

function readPreToolUseEntries(settingsPath: string): PreToolUseEntry[] {
  const parsed = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
    hooks?: { PreToolUse?: PreToolUseEntry[] };
  };
  return parsed.hooks?.PreToolUse ?? [];
}

function findGateEnforceHandler(entries: PreToolUseEntry[]): { command?: string; shell?: string } | undefined {
  for (const entry of entries) {
    for (const handler of entry.hooks ?? []) {
      if (typeof handler.command === 'string' && handler.command.includes('peaks gate enforce')) return handler;
    }
  }
  return undefined;
}

describe('behavior — gate-enforce hook shell is machine-specific', () => {
  const tmpRoots: string[] = [];

  beforeEach(() => stubPlatform(realPlatform));
  afterEach(() => {
    stubPlatform(realPlatform);
    for (const root of tmpRoots) {
      try {
        if (existsSync(root)) rmSync(root, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
    tmpRoots.length = 0;
  });

  function makeTempProjectRoot(): string {
    const tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-gate-shell-'));
    tmpRoots.push(tmpRoot);
    return tmpRoot;
  }

  it('when the platform is win32, should pin the hook shell to powershell', () => {
    // given: a Windows machine, where the default Git-Bash shell allocates a
    //        console window on every Bash tool call
    // when: the hook shell is resolved
    const shell = resolveHookShell('win32');
    // then: PowerShell is pinned
    expect(shell).toBe('powershell');
  });

  it('when the platform is POSIX, should omit the shell key', () => {
    // given: macOS / Linux, where the default `sh -c` shell is correct
    // when: the hook shell is resolved for each POSIX platform
    const darwin = resolveHookShell('darwin');
    const linux = resolveHookShell('linux');
    // then: no `shell` key is emitted at all
    expect(darwin).toBeUndefined();
    expect(linux).toBeUndefined();
  });

  it('when the claude-code spec is resolved on win32, should carry the powershell shell', () => {
    // given: a Windows machine
    stubPlatform('win32');
    // when: the canonical claude-code hook spec is resolved
    const spec = resolveHookSpec('claude-code');
    // then: the gate-enforce entry is both machine-local and shell-pinned
    expect(spec.hookEnforceShell).toBe('powershell');
    expect(spec.hookEnforceMachineLocal).toBe(true);
    expect(resolveHookEntries('claude-code')[0]?.machineLocal).toBe(true);
    expect(resolveHookEntries('claude-code')[0]?.shell).toBe('powershell');
  });

  it('when the claude-code spec is resolved on POSIX, should carry no shell', () => {
    // given: a POSIX machine
    stubPlatform('linux');
    // when: the canonical claude-code hook spec is resolved
    const spec = resolveHookSpec('claude-code');
    // then: no `shell` key is produced, so the default shell is untouched
    expect(spec.hookEnforceShell).toBeUndefined();
    expect(resolveHookEntries('claude-code')[0]?.shell).toBeUndefined();
  });

  it('when hooks install runs on win32, should write the shell-pinned entry to the machine-local file only', () => {
    // given: a fresh project root on Windows
    stubPlatform('win32');
    const tmpRoot = makeTempProjectRoot();
    // when: the peaks hooks are installed
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // then: the gate-enforce entry lands in the gitignored local file with
    //       `shell: powershell`, and the shared file carries no `shell`
    const shared = join(tmpRoot, '.claude', 'settings.json');
    const local = join(tmpRoot, '.claude', 'settings.local.json');
    const localHandler = findGateEnforceHandler(readPreToolUseEntries(local));
    expect(localHandler?.shell).toBe('powershell');
    expect(localHandler?.command).toMatch(/--json$/);
    expect(findGateEnforceHandler(existsSync(shared) ? readPreToolUseEntries(shared) : [])).toBeUndefined();
  });

  it('when the install plan is built, should attribute every entry to the settings file it lands in', () => {
    // given: a project on Windows, before anything is written
    stubPlatform('win32');
    const tmpRoot = makeTempProjectRoot();
    // when: the plan is built (this is what `hooks install --dry-run` reports)
    const plan = planHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const targetOf = (sentinel: string): string | undefined =>
      plan.entryTargets.find((entry) => entry.sentinel === sentinel)?.settingsPath;
    // then: the shell-pinned entry names the machine-local file and the
    //       platform-neutral one names the shared file — `settingsPath` alone
    //       does not say where the gate-enforce entry goes
    expect(targetOf('peaks gate enforce')).toBe(join(tmpRoot, '.claude', 'settings.local.json'));
    expect(targetOf('peaks code-gate')).toBe(join(tmpRoot, '.claude', 'settings.json'));
    expect(plan.localSettingsPath).toBe(join(tmpRoot, '.claude', 'settings.local.json'));
  });

  it('when hooks install runs on POSIX, should still route the entry to the machine-local file', () => {
    // given: a fresh project root on Linux
    stubPlatform('linux');
    const tmpRoot = makeTempProjectRoot();
    // when: the peaks hooks are installed
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // then: the entry is routed by an entry flag, not by the ambient platform,
    //       so the committed shared file stays identical across platforms
    const localHandler = findGateEnforceHandler(readPreToolUseEntries(join(tmpRoot, '.claude', 'settings.local.json')));
    expect(localHandler).toBeDefined();
    expect(localHandler?.shell).toBeUndefined();
  });

  it('when hooks install runs over a legacy shared entry, should migrate it out of the shared file', () => {
    // given: a shared settings file carrying the pre-fix hand-edited entry
    //        (shell-pinned, in the committed file)
    stubPlatform('win32');
    const tmpRoot = makeTempProjectRoot();
    const shared = join(tmpRoot, '.claude', 'settings.json');
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    writeFileSync(
      shared,
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: 'Bash',
                hooks: [{ type: 'command', command: 'peaks gate enforce --project "${CLAUDE_PROJECT_DIR}" --json', shell: 'powershell' }]
              }
            ]
          }
        },
        null,
        2
      ),
      'utf8'
    );
    // when: hooks install runs
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // then: the entry is gone from the shared file and present in the local one
    expect(findGateEnforceHandler(readPreToolUseEntries(shared))).toBeUndefined();
    expect(findGateEnforceHandler(readPreToolUseEntries(join(tmpRoot, '.claude', 'settings.local.json')))).toBeDefined();
  });

  it('when the workspace-init template is built on win32, should pin every peaks Bash handler', () => {
    // given: a Windows machine
    stubPlatform('win32');
    // when: the workspace-init template is built
    const template = buildClaudeSettingsLocalJson() as unknown as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ command?: string; shell?: string }> }> };
    };
    const bashHandlers = template.hooks.PreToolUse
      .filter((entry) => entry.matcher === 'Bash')
      .flatMap((entry) => entry.hooks);
    // then: EVERY Bash-matcher handler that spawns the peaks CLI is pinned —
    //       both `gate enforce` and `gate-step-08` run on every Bash call, so
    //       leaving either unpinned leaves the console window in place
    const peaksHandlers = bashHandlers.filter((h) => String(h.command).startsWith('peaks '));
    expect(peaksHandlers).toHaveLength(2);
    expect(peaksHandlers.map((h) => h.command?.split(' ')[2])).toEqual(['gate-step-08', 'enforce']);
    for (const handler of peaksHandlers) {
      expect(handler.shell).toBe('powershell');
    }
  });

  it('when the workspace-init template is built on POSIX, should pin nothing', () => {
    // given: a macOS / Linux machine
    stubPlatform('linux');
    // when: the workspace-init template is built
    const template = buildClaudeSettingsLocalJson() as unknown as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ command?: string; shell?: string }> }> };
    };
    // then: no Bash handler carries a `shell` key, so the default shell holds
    const bashHandlers = template.hooks.PreToolUse
      .filter((entry) => entry.matcher === 'Bash')
      .flatMap((entry) => entry.hooks);
    expect(bashHandlers.every((h) => h.shell === undefined)).toBe(true);
  });

  it('when the workspace-init template is materialized, should emit the gate-enforce entry itself', () => {
    // given: a Windows machine
    stubPlatform('win32');
    // when: the workspace-init template is built
    const serializedTemplate = JSON.stringify(buildClaudeSettingsLocalJson(), null, 2) + '\n';
    // then: the template carries the same shell-pinned entry the installer
    //       writes — the machine-local file has two writers, and a template
    //       that omitted the entry would erase it on the next init
    // 1.6.0 = slice c5-write-hook-exec-form: the Write|Edit|MultiEdit handler
    // moved from an inlined `node -e "<js>"` payload to `node <script>`.
    expect(TEMPLATE_VERSION).toBe('1.6.0');
    expect(findGateEnforceHandler(readPreToolUseEntriesSync(serializedTemplate))?.shell).toBe('powershell');
  });

  it('when the auto-compact hook is installed on win32, should pin the shell on its Bash|Task matcher', () => {
    // given: a fresh project root on Windows
    stubPlatform('win32');
    const tmpRoot = makeTempProjectRoot();
    // when: the auto-compact hook installer runs (the only other peaks
    //       installer that emits a Bash-matcher hook)
    const result = installAutoCompactHook({ projectRoot: tmpRoot }) as { settingsPath: string };
    // then: its handler is pinned like the other Bash-matcher peaks hooks,
    //       in the same machine-local file
    const serialized = readFileSync(result.settingsPath, 'utf8');
    const parsed = JSON.parse(serialized) as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ command?: string; shell?: string }> }> };
    };
    const handler = parsed.hooks.PreToolUse.find((e) => e.matcher === 'Bash|Task')?.hooks[0];
    expect(handler?.command).toBe('peaks code auto-compact');
    expect(handler?.shell).toBe('powershell');
  });

  it('when the auto-compact hook is installed on POSIX, should omit the shell key', () => {
    // given: a fresh project root on Linux
    stubPlatform('linux');
    const tmpRoot = makeTempProjectRoot();
    // when: the auto-compact hook installer runs
    const result = installAutoCompactHook({ projectRoot: tmpRoot }) as { settingsPath: string };
    // then: no `shell` key is written, so the default shell is untouched
    const parsed = JSON.parse(readFileSync(result.settingsPath, 'utf8')) as {
      hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ shell?: string }> }> };
    };
    expect(parsed.hooks.PreToolUse.find((e) => e.matcher === 'Bash|Task')?.hooks[0]?.shell).toBeUndefined();
  });

  it('when hooks install runs twice, should be a no-op the second time', () => {
    // given: a project on Windows with the hooks already installed
    stubPlatform('win32');
    const tmpRoot = makeTempProjectRoot();
    const first = applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // when: the install is run again, against the split shared/local shape
    const second = applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    // then: the second pass finds the desired shape already on disk in BOTH
    //       files and does not rewrite or duplicate anything
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(false);
    expect(second.alreadyInstalled).toBe(true);
    const local = readFileSync(join(tmpRoot, '.claude', 'settings.local.json'), 'utf8');
    expect((local.match(/peaks gate enforce/g) ?? [])).toHaveLength(1);
  });

  /** Drive `peaks hooks install` in-process against a throwaway HOME. */
  function runHooksInstall(args: ReadonlyArray<string>): { ok?: boolean; data?: Record<string, unknown>; text: string } {
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    registerHooksCommands(program, io);
    program.parse(['hooks', 'install', ...args], { from: 'user' });
    const text = captured.text();
    try {
      return { ...(JSON.parse(text) as { ok?: boolean; data?: Record<string, unknown> }), text };
    } catch {
      return { text };
    }
  }

  it('when the global install runs, should write the user-level settings.json once', () => {
    // given: a throwaway HOME on Windows (global scope is machine-local by
    //        nature: the user-level file is never committed, so the
    //        machine-specific `shell` belongs there)
    stubPlatform('win32');
    const home = makeTempProjectRoot();
    withEnv('USERPROFILE', home);
    withEnv('HOME', home);
    // when: the install runs twice
    const first = runHooksInstall(['--global', '--ide', 'claude-code', '--json']);
    const second = runHooksInstall(['--global', '--ide', 'claude-code', '--json']);
    // then: the first run installs into the user-level file with the pinned
    //       shell, there is no machine-local sibling in global scope, and the
    //       second run is a no-op
    expect(first.ok).toBe(true);
    expect(first.data?.applied).toBe(true);
    expect(first.data?.localSettingsPath).toBeUndefined();
    const homeSettings = join(home, '.claude', 'settings.json');
    expect(findGateEnforceHandler(readPreToolUseEntries(homeSettings))?.shell).toBe('powershell');
    expect(second.ok).toBe(true);
    expect(second.data?.applied).toBe(false);
  });

  it('when the install command resolves its hook sources, should not use __dirname', () => {
    // `package.json#type` is `module`: bare `__dirname` is a ReferenceError
    // both under `tsx src/cli/index.ts` and in the shipped `dist` build, and
    // it took the WHOLE `--global` path down (the two hook-script copies it
    // guards threw before the envelope was printed, so a completed install
    // was reported as HOOKS_INSTALL_FAILED with `applied: false`).
    //
    // This assertion is a source scan on purpose: vitest defines `__dirname`,
    // so no test body in this suite — including the CLI-driven ones above —
    // can fail when the source regresses. The module is run for real only by
    // tsx / node, where `__dirname` does not exist.
    const src = readFileSync(join(ROOT, 'src', 'cli', 'commands', 'hooks-commands.ts'), 'utf8');
    expect(src).not.toMatch(/\b__dirname\b/);
  });

  it('when the global dry-run runs, should name the user-level file and write nothing', () => {
    // given: a throwaway HOME and a project that does not exist
    stubPlatform('win32');
    const home = makeTempProjectRoot();
    withEnv('USERPROFILE', home);
    withEnv('HOME', home);
    // when: the dry-run runs
    const result = runHooksInstall(['--global', '--dry-run', '--ide', 'claude-code', '--json']);
    // then: it reports the user-level path it would write, and the
    //       `--dry-run` copied no hook script into HOME either
    expect(result.ok).toBe(true);
    expect(result.data?.settingsPath).toBe(join(home, '.claude', 'settings.json'));
    expect(existsSync(join(home, '.claude'))).toBe(false);
  });

  it('when workspace-init runs before hooks install, should not let the next init clobber the entry', () => {
    // given: a Windows project whose local settings file was written by
    //        `peaks workspace init` (the template), then installed over
    stubPlatform('win32');
    const tmpRoot = makeTempProjectRoot();
    mkdirSync(join(tmpRoot, '.claude'), { recursive: true });
    const serializedTemplate = JSON.stringify(buildClaudeSettingsLocalJson(), null, 2) + '\n';
    writeFileSync(join(tmpRoot, '.claude', 'settings.local.json'), serializedTemplate, 'utf8');
    // when: `peaks hooks install` merges its entries in, and the drift check
    //       that guards the next init is re-run
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const onDisk = readFileSync(join(tmpRoot, '.claude', 'settings.local.json'), 'utf8');
    // then: the entry is still present and the file still matches the
    //       template, so the next init is a no-op instead of a rewrite
    expect(findGateEnforceHandler(readPreToolUseEntries(join(tmpRoot, '.claude', 'settings.local.json')))?.shell).toBe('powershell');
    expect(templateContentMatches(serializedTemplate, onDisk)).toBe(true);
  });
});

/** Parse PreToolUse entries out of an in-memory serialized settings string. */
function readPreToolUseEntriesSync(serialized: string): PreToolUseEntry[] {
  const parsed = JSON.parse(serialized) as { hooks?: { PreToolUse?: PreToolUseEntry[] } };
  return parsed.hooks?.PreToolUse ?? [];
}
