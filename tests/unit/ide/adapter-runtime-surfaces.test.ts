// tests/unit/ide/adapter-runtime-surfaces.test.ts
//
// Slice 2026-09-15-s9-platform-vendor-coverage, D6 — companion to
// `adapter-declared-shape.test.ts`. That file pins what each adapter
// DECLARES; this one pins what the rest of the system DOES with the
// declaration, because a declared value nothing consumes is a comment:
//
//   - `settings.resolveSettingsFile` — the path an install writes to, in both
//     scopes, including the `projectRoot === undefined` branch.
//   - `resolveHookSpec` — the hook entry the install actually emits. It
//     interpolates the adapter's `envVar` into the command and copies its
//     `hookEvent` / `toolMatcher` verbatim, so this is where a wrong declared
//     value becomes a wrong written file.
//   - `detectIdeFromContext` — the env-var and cwd heuristics that pick an
//     adapter when the user does not name one.
//   - `resolveHookShell` — the platform difference the brief calls out: the
//     Windows `shell` pin and the macOS/Linux `undefined` that omits the key.
//
// Dimensions covered:
//   - behavior:    path resolution per scope, hook-spec projection, and the
//                  platform branch of the shell resolver
//   - integration: real tmp directories on a real filesystem, the real
//                  registry, and real `process.env`
//   - render:      omitted — nothing here renders; the assembled hook entry is
//                  asserted as data
//   - a11y:        omitted — the two refusal messages are asserted as text
//                  under behavior, not as a rendered surface

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { getAdapter, listAdapterIds } from '../../../src/services/ide/ide-registry.js';
import { detectIdeFromContext } from '../../../src/services/ide/hook-translator.js';
import type { IdeId } from '../../../src/services/ide/ide-types.js';
import {
  hasHookSpec,
  resolveHookShell,
  resolveHookSpec,
} from '../../../src/services/skills/hooks-codegate-superpowers.js';

declareDimensions(
  'tests/unit/ide/adapter-runtime-surfaces.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'nothing renders here; the assembled hook entry is asserted as data' },
    { dim: 'a11y', reason: 'the two refusal messages are asserted as text under behavior' },
  ],
);

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-adapter-surfaces-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Every adapter whose `HOOK_COMMAND_BY_IDE` entry exists. The remaining three
 * registered ids (`qoder`, `tongyi-lingma`, `zcode`) have no entry on purpose
 * — see the "table not yet filled" scenario below, which pins that refusal
 * rather than leaving it unnoticed.
 */
const IDES_WITH_HOOK_SPEC: readonly IdeId[] = ['claude-code', 'trae', 'cursor', 'codex', 'hermes', 'openclaw'];
const IDES_WITHOUT_HOOK_SPEC: readonly IdeId[] = ['qoder', 'tongyi-lingma', 'zcode'];

describe('Scenario: behavior — settings paths resolve per scope, platform-correctly', () => {
  it('when a project scope is resolved with a root, should be an absolute path under that root', () => {
    const root = makeTmpDir();
    for (const ide of listAdapterIds()) {
      const adapter = getAdapter(ide);
      const expected = join(resolve(root), adapter.settings.dirName, adapter.settings.settingsFileName);
      const actual = adapter.settings.resolveSettingsFile('project', root);

      expect(actual, ide).toBe(expected);
      // and: genuinely absolute, and built with THIS platform's separator —
      // a hand-concatenated `/`-joined string passes on Linux CI and is
      // wrong on Windows, which is the platform gap this case exists for
      expect(isAbsolute(actual), ide).toBe(true);
      expect(actual, ide).toContain(sep);
    }
  });

  it('when a global scope is resolved, should be under the user home directory', () => {
    for (const ide of listAdapterIds()) {
      const adapter = getAdapter(ide);
      expect(adapter.settings.resolveSettingsFile('global', makeTmpDir()), ide).toBe(
        join(homedir(), adapter.settings.dirName, adapter.settings.settingsFileName),
      );
    }
  });

  it('when the project root is undefined, should fall back to the home directory rather than throw', () => {
    // The `projectRoot ?? homedir()` branch. A caller that could not resolve
    // a project root must get a usable path, not `undefined`/'' or a crash —
    // and the fallback must be the SAME path the global scope yields, or the
    // two spellings of "no root" would disagree.
    for (const ide of listAdapterIds()) {
      const adapter = getAdapter(ide);
      expect(adapter.settings.resolveSettingsFile('project', undefined), ide).toBe(
        adapter.settings.resolveSettingsFile('global', makeTmpDir()),
      );
    }
  });
});

describe('Scenario: behavior — the install emits the adapter own event, matcher and env var', () => {
  for (const ide of IDES_WITH_HOOK_SPEC) {
    it(`when the ${ide} hook spec is resolved, should project the adapter event, matcher and env var`, () => {
      // given: the adapter as declared, and the spec the installer consumes
      const adapter = getAdapter(ide);
      const spec = resolveHookSpec(ide);

      // then: the event and matcher are the adapter's, copied verbatim — this
      // is the one place a wrong declared value reaches a written file
      expect(spec.hookEnforceEvent).toBe(adapter.hookEvent);
      expect(spec.hookEnforceMatcher).toBe(adapter.toolMatcher);

      // and: the command interpolates THIS adapter's project-root variable,
      // not a sibling's, and names the gate-enforce sentinel the uninstaller
      // later matches on
      expect(spec.hookEnforceCommand).toContain(adapter.envVar);
      expect(spec.hookEnforceCommand).toContain(spec.hookEnforceSentinel);

      // and: only Claude Code may take the machine-local route — the other
      // five adapters declare no machine-local settings layer at all, so
      // routing them there would write to a file their IDE never reads
      expect(spec.hookEnforceMachineLocal).toBe(ide === 'claude-code');
    });
  }

  it('when the claude-code spec is resolved, should use the gate-enforce surface and the shared json flag', () => {
    // given: the one adapter whose hook takes `--json` (its validator rejects
    // a plain `{}` stdout). Asserting the exact command pins the flag.
    const spec = resolveHookSpec('claude-code');
    expect(spec.hookEnforceCommand).toBe('peaks gate enforce --project "${CLAUDE_PROJECT_DIR}" --json');
  });

  it('when a non-claude spec is resolved, should dispatch through `peaks hook handle` and omit the json flag', () => {
    // given: the Cursor-style siblings. A copy-paste that leaves the
    // claude-code command on a non-Claude adapter is the failure this pins.
    for (const ide of ['trae', 'cursor', 'codex'] as const) {
      const spec = resolveHookSpec(ide);
      expect(spec.hookEnforceCommand, ide).toContain('peaks hook handle');
      expect(spec.hookEnforceCommand, ide).not.toContain('--json');
      expect(spec.hookEnforceCommand, ide).not.toContain('peaks gate enforce');
    }
  });

  it('when the three tableless ids are resolved, should refuse and name the table to fill', () => {
    // `qoder` / `tongyi-lingma` / `zcode` are registered adapters with no
    // hook command entry, so `peaks hooks install --ide <them>` fails closed
    // while an uninstall is a no-op. That asymmetry is deliberate; pinning it
    // means a future slice filling the table has to say so here.
    for (const ide of IDES_WITHOUT_HOOK_SPEC) {
      expect(hasHookSpec(ide), ide).toBe(false);
      expect(() => resolveHookSpec(ide), ide).toThrow(/no HOOK_COMMAND_BY_IDE entry/);
      // and: the message names the file that owns the table, so the fix is
      // reachable from the error alone
      expect(() => resolveHookSpec(ide), ide).toThrow(/hooks-codegate-superpowers\.ts/);
    }
    for (const ide of IDES_WITH_HOOK_SPEC) {
      expect(hasHookSpec(ide), ide).toBe(true);
    }
  });
});

describe('Scenario: behavior — the hook shell pin is a platform branch with an explicit absent side', () => {
  it('when the platform is win32, should pin the hook shell to powershell', () => {
    // The Windows-only pin: Git Bash force-allocates a console window on
    // every Bash tool call, and the hook schema's only lever is `shell`.
    expect(resolveHookShell('win32')).toBe('powershell');
  });

  it('when the platform is darwin or linux, should omit the shell key entirely', () => {
    // The other half of the same decision. `undefined` means "omit the key
    // and let the IDE use its default" — a value like `'bash'` here would
    // change every non-Windows teammate's hook, which is exactly what the
    // pin's scope comment says must not happen.
    expect(resolveHookShell('darwin')).toBeUndefined();
    expect(resolveHookShell('linux')).toBeUndefined();
  });

  it('when a non-claude hook spec is resolved, should never carry a shell pin on any platform', () => {
    // `hookEnforceShell` is Claude-Code-only by construction. Asserted here
    // because it is a per-OS value a non-Claude IDE would have nowhere to
    // put: those six adapters declare no machine-local settings layer.
    for (const ide of IDES_WITH_HOOK_SPEC) {
      if (ide === 'claude-code') continue;
      expect(resolveHookSpec(ide).hookEnforceShell, ide).toBeUndefined();
      expect(getAdapter(ide).settings.localSettingsFileName, ide).toBeUndefined();
    }
  });

  it('when the running platform is win32, should carry the pin through to the claude-code hook spec', () => {
    // The whole point of the pair above is that the value reaches the spec.
    // This case stubs the platform so the flow is asserted, not just the
    // pure resolver — and restores it, because `process.platform` is global.
    const realPlatform = process.platform;
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
    try {
      expect(resolveHookSpec('claude-code').hookEnforceShell).toBe('powershell');
    } finally {
      Object.defineProperty(process, 'platform', { value: realPlatform, configurable: true });
    }
  });
});

describe('Scenario: integration — detection picks the adapter each signal names', () => {
  it('when only one adapter project-root variable is present, should detect that adapter', () => {
    // given: the env-var heuristic, which wins over everything else
    for (const ide of listAdapterIds()) {
      const adapter = getAdapter(ide);
      const detected = detectIdeFromContext({
        env: { [adapter.envVar]: makeTmpDir() },
        cwd: makeTmpDir(),
        parsedStdin: null,
      });
      expect(detected, `${adapter.envVar} detected as ${detected}`).toBe(ide);
    }
  });

  it('when only one adapter settings directory is present, should detect that adapter from the cwd', () => {
    // given: a real directory tree per adapter — the cwd heuristic reads it
    for (const ide of listAdapterIds()) {
      const cwd = makeTmpDir();
      mkdirSync(join(cwd, getAdapter(ide).settings.dirName), { recursive: true });
      const detected = detectIdeFromContext({ env: {}, cwd, parsedStdin: null });
      expect(detected, `${getAdapter(ide).settings.dirName} detected as ${detected}`).toBe(ide);
    }
  });

  it('when an env var and a competing settings directory are both present, should prefer the env var', () => {
    // given: a Trae env var and a Codex-shaped cwd
    const cwd = makeTmpDir();
    mkdirSync(join(cwd, '.codex'), { recursive: true });

    // when / then: documenting which signal wins — the heuristics are ordered,
    // and a reordering is a behaviour change
    expect(detectIdeFromContext({ env: { TRAE_PROJECT_DIR: makeTmpDir() }, cwd, parsedStdin: null })).toBe('trae');
  });

  it('when the stdin payload is Cursor-shaped, should detect cursor', () => {
    // given: the three stdin shapes the translator recognises
    expect(detectIdeFromContext({ env: {}, cwd: makeTmpDir(), parsedStdin: { toolName: 'Bash' } })).toBe('cursor');
  });

  it('when the stdin payload is Trae-shaped, should detect trae', () => {
    expect(detectIdeFromContext({ env: {}, cwd: makeTmpDir(), parsedStdin: { eventName: 'beforeToolCall' } })).toBe('trae');
  });

  it('when the stdin payload is claude-shaped, should detect claude-code', () => {
    expect(detectIdeFromContext({ env: {}, cwd: makeTmpDir(), parsedStdin: { tool_name: 'Bash' } })).toBe('claude-code');
  });

  it('when nothing matches, should fall back to claude-code rather than an unregistered value', () => {
    // given: an empty env, an empty cwd, and no stdin
    // when / then: the documented backward-compatible fallback. Asserting the
    // EXACT value matters: the fallback must be a registered adapter, or every
    // downstream `getAdapter` call throws on a machine with nothing installed.
    const detected = detectIdeFromContext({ env: {}, cwd: makeTmpDir(), parsedStdin: null });
    expect(detected).toBe('claude-code');
    expect(listAdapterIds()).toContain(detected);
  });
});
