import { readFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { CODEX_ADAPTER } from '../../../src/services/ide/adapters/codex-adapter.js';
import { codexSubAgentDispatcher } from '../../../src/services/dispatch/sub-agent-dispatcher.js';
import { CLAUDE_CODE_ADAPTER } from '../../../src/services/ide/adapters/claude-code-adapter.js';
import { _resetAdaptersForTesting, getAdapter, listAdapterIds } from '../../../src/services/ide/ide-registry.js';
import { applyHookInstall, readHookStatus } from '../../../src/services/skills/hooks-settings-service.js';

afterEach(() => {
  _resetAdaptersForTesting();
});

describe('CODEX_ADAPTER — identity fields (slice #13, 2.4.0)', () => {
  test('id is "codex"', () => {
    expect(CODEX_ADAPTER.id).toBe('codex');
  });

  test('displayName is "Codex"', () => {
    expect(CODEX_ADAPTER.displayName).toBe('Codex');
  });

  test('envVar is CODEX_PROJECT_DIR (used for ${...} placeholder substitution; UNVERIFIED — see PRD R-3)', () => {
    expect(CODEX_ADAPTER.envVar).toBe('CODEX_PROJECT_DIR');
  });

  test('hookEvent is "pre_tool_use" (Codex lowercase snake_case; UNVERIFIED — see PRD R-3)', () => {
    expect(CODEX_ADAPTER.hookEvent).toBe('pre_tool_use');
  });

  test('toolMatcher is "shell" (Codex shell command matcher)', () => {
    expect(CODEX_ADAPTER.toolMatcher).toBe('shell');
  });

  test('installHints mention restarting Codex so hooks take effect', () => {
    expect(CODEX_ADAPTER.installHints.length).toBeGreaterThan(0);
    expect(CODEX_ADAPTER.installHints.join(' ')).toMatch(/restart|reload/i);
  });
});

describe('CODEX_ADAPTER — capabilities', () => {
  test('gateEnforce is true (per the PRD R-2 hard rule — every adapter enforces gates)', () => {
    expect(CODEX_ADAPTER.capabilities.gateEnforce).toBe(true);
  });

  test('statusline is false (Codex CLI has no statusline UI surface; AC14)', () => {
    // The dispatch layer / CLI emits a clear "not supported" stderr when
    // a user runs `peaks statusline install --ide codex`. The adapter
    // declares the capability as false so the CLI can branch on it
    // without changing the dispatch chokepoint.
    expect(CODEX_ADAPTER.capabilities.statusline).toBe(false);
  });
});

describe('CODEX_ADAPTER — settings location', () => {
  test('dirName is ".codex"', () => {
    expect(CODEX_ADAPTER.settings.dirName).toBe('.codex');
  });

  test('settingsFileName is "settings.json"', () => {
    expect(CODEX_ADAPTER.settings.settingsFileName).toBe('settings.json');
  });

  test('supportsScope returns true for both project and global', () => {
    expect(CODEX_ADAPTER.settings.supportsScope('project')).toBe(true);
    expect(CODEX_ADAPTER.settings.supportsScope('global')).toBe(true);
  });

  test('resolveSettingsFile("global", _) returns <homedir>/.codex/settings.json', () => {
    const resolved = CODEX_ADAPTER.settings.resolveSettingsFile('global', undefined);
    const expected = join(resolve(homedir()), '.codex', 'settings.json');
    expect(resolved).toBe(expected);
  });

  test('resolveSettingsFile("project", root) returns <root>/.codex/settings.json (L1 default, AC13)', () => {
    const root = resolve('/p');
    const resolved = CODEX_ADAPTER.settings.resolveSettingsFile('project', root);
    // AC13: assert path is rooted at /p, NOT at homedir().
    expect(resolved).toBe(join(root, '.codex', 'settings.json'));
    expect(resolved.startsWith(root)).toBe(true);
    expect(resolved.startsWith(resolve(homedir()))).toBe(false);
  });
});

describe('CODEX_ADAPTER — registry integration', () => {
  test('production registry lists codex alongside claude-code, trae, and cursor in insertion order', () => {
    const ids = listAdapterIds();
    expect(ids).toContain('claude-code');
    expect(ids).toContain('trae');
    expect(ids).toContain('cursor');
    expect(ids).toContain('codex');
    // Insertion order: claude-code, trae, cursor, codex, hermes, openclaw
    expect(ids.indexOf('claude-code')).toBeLessThan(ids.indexOf('trae'));
    expect(ids.indexOf('trae')).toBeLessThan(ids.indexOf('cursor'));
    expect(ids.indexOf('cursor')).toBeLessThan(ids.indexOf('codex'));
  });

  test('getAdapter("codex") returns the Codex adapter instance', () => {
    const got = getAdapter('codex');
    expect(got.id).toBe('codex');
    expect(got.envVar).toBe('CODEX_PROJECT_DIR');
    expect(got.hookEvent).toBe('pre_tool_use');
    expect(got.toolMatcher).toBe('shell');
  });

  test('getAdapter("codex") returns a different instance from claude-code, trae, and cursor', () => {
    const codex = getAdapter('codex');
    const claude = getAdapter('claude-code');
    const trae = getAdapter('trae');
    const cursor = getAdapter('cursor');
    expect(codex).not.toBe(claude);
    expect(codex).not.toBe(trae);
    expect(codex).not.toBe(cursor);
    expect(codex.id).toBe('codex');
  });
});

describe('CODEX_ADAPTER — subAgentDispatcher per-IDE attribution (slice 1.3 AC-3.c)', () => {
  test('subAgentDispatcher reference is the codex dispatcher (real awaitBatch, 45s default)', () => {
    // Slice 1.3 AC-3.c: Codex promotes off `claudeCodeSubAgentDispatcher`
    // placeholder to its own `codexSubAgentDispatcher` (real file-polling
    // awaitBatch, 45s default per slice #13 R-3). The `buildToolCall`
    // shape remains byte-identical to claude-code; only the awaitBatch
    // wiring diverges.
    expect(CODEX_ADAPTER.subAgentDispatcher).toBe(codexSubAgentDispatcher);
    expect(CODEX_ADAPTER.subAgentDispatcher).not.toBe(CLAUDE_CODE_ADAPTER.subAgentDispatcher);
  });
});

describe('CODEX_ADAPTER — promptSizeAware: false (PRD R-3)', () => {
  test('promptSizeAware is false (Codex pre_tool_use semantics differ; opt out of G9 hook layer)', () => {
    // The CLI 兜底 layer in `peaks sub-agent dispatch` still enforces the
    // threshold regardless of this flag — `promptSizeAware` only controls
    // the hook layer. Opt out until real-install dogfood confirms.
    expect(CODEX_ADAPTER.promptSizeAware).toBe(false);
  });
});

describe('CODEX_ADAPTER — UNVERIFIED standardsProfile + skillInstall (NG6 / AC16)', () => {
  test('standardsProfile is undefined (UNVERIFIED — slice #013+ dogfood required)', () => {
    // The dispatch layer falls back to the legacy Claude Code path
    // (CLAUDE.md + .claude/rules/**) with a stderr warning when this is
    // undefined. See ide-adapter-resource-profile-framework.md.
    expect(CODEX_ADAPTER.standardsProfile).toBeUndefined();
  });

  test('skillInstall is undefined (UNVERIFIED — slice #013+ dogfood required)', () => {
    // The postinstall script writes bundled skills to `~/.claude/skills/`
    // (legacy Claude Code fallback) with a stderr warning, NOT to
    // `~/.codex/skills/`. See AC16.
    expect(CODEX_ADAPTER.skillInstall).toBeUndefined();
  });
});

/**
 * Slice #13 (2.4.0) closeout: prove the per-IDE install dispatch actually
 * writes a Codex-shaped settings.json (not a Claude-shaped one) when the
 * user passes `{ ide: 'codex' }`. The test asserts:
 *
 *   - AC13: install writes to <projectRoot>/.codex/settings.json
 *     (project scope, the L1 default) — NOT to ~/.codex/settings.json.
 *   - Codex's `pre_tool_use` event key is used (not PreToolUse).
 *   - Codex's `shell` matcher is used (not "Bash" or "terminal").
 *   - ${CODEX_PROJECT_DIR} env var is referenced in hook commands
 *     (not ${CLAUDE_PROJECT_DIR} or ${TRAE_PROJECT_DIR}).
 *
 * Note: AC14 (statusline install --ide codex returns non-zero) is verified
 * at the adapter level by `capabilities.statusline === false` above. The
 * CLI-level statusline capability branch is a downstream concern (peaks-ui
 * slice); modifying the dispatch chokepoint is forbidden by
 * ide-adapter-resource-profile-framework.md.
 */
describe('peaks hooks install — Codex integration (slice #13 closeout, AC13)', () => {
  let project: string;
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), 'peaks-codex-install-'));
  });

  test('applyHookInstall with { ide: "codex" } writes to <root>/.codex/settings.json (AC13, L1 default project scope)', async () => {
    const result = applyHookInstall('project', project, { ide: 'codex' });
    expect(result.applied).toBe(true);
    expect(result.settingsPath).toBe(join(project, '.codex', 'settings.json'));
    // The Claude path must NOT have been written.
    const claudePath = join(project, '.claude', 'settings.json');
    const { existsSync } = await import('node:fs');
    expect(existsSync(claudePath)).toBe(false);
  });

  test('Codex install uses "pre_tool_use" event key, not "PreToolUse"', async () => {
    applyHookInstall('project', project, { ide: 'codex' });
    const settings = JSON.parse(
      await readFile(join(project, '.codex', 'settings.json'), 'utf8')
    ) as { hooks: Record<string, unknown[]> };
    // The Codex install should use pre_tool_use (lowercase snake_case).
    expect(settings.hooks).toHaveProperty('pre_tool_use');
    const preTool = settings.hooks.pre_tool_use ?? [];
    expect(preTool.length).toBeGreaterThan(0);
    // The Claude event key must NOT be present.
    expect(settings.hooks).not.toHaveProperty('PreToolUse');
  });

  test('Codex install uses "shell" matcher (not "Bash" or "terminal") and CODEX_PROJECT_DIR env var', async () => {
    applyHookInstall('project', project, { ide: 'codex' });
    const settings = JSON.parse(
      await readFile(join(project, '.codex', 'settings.json'), 'utf8')
    ) as { hooks: { pre_tool_use: { matcher: string; hooks: { command: string }[] }[] } };
    const entries = settings.hooks.pre_tool_use ?? [];
    const matchers = entries.map((entry) => entry.matcher);
    expect(matchers).toContain('shell');
    expect(matchers).not.toContain('Bash');
    expect(matchers).not.toContain('terminal');
    // Every command must reference ${CODEX_PROJECT_DIR}, not Claude or Trae.
    for (const entry of entries) {
      for (const handler of entry.hooks) {
        expect(handler.command).toContain('${CODEX_PROJECT_DIR}');
        expect(handler.command).not.toContain('${CLAUDE_PROJECT_DIR}');
        expect(handler.command).not.toContain('${TRAE_PROJECT_DIR}');
        expect(handler.command).not.toContain('${CURSOR_PROJECT_DIR}');
      }
    }
  });

  test('readHookStatus with { ide: "codex" } reports installed=true after a Codex install', async () => {
    applyHookInstall('project', project, { ide: 'codex' });
    const status = readHookStatus('project', project, { ide: 'codex' });
    expect(status.installed).toBe(true);
    expect(status.exists).toBe(true);
  });
});
