// tests/integration/statusline-session-start-init.test.ts
//
// Slice rid-statusline-stale-ux AC-2 — verify the SessionStart hook
// channel includes the new `peaks session primer` entry.
//
// Tests:
//   1. applyHookInstall emits a SessionStart entry whose command
//      includes 'peaks session primer --project'.
//   2. applyHookInstall emits the new sentinel
//      HOOK_WORKSPACE_INIT_SENTINEL.
//   3. The actual project .claude/settings.json contains a
//      SessionStart entry whose command matches the primer contract.
//   4. HOOK_WORKSPACE_INIT_COMMAND exposes the right shape for
//      install + downstream consumers.
//
// Run with:
//   pnpm vitest run --config vitest.config.integration.ts tests/integration/statusline-session-start-init.test.ts

import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { applyHookInstall } from '~/src/services/skills/hooks-settings-service';
import {
  HOOK_WORKSPACE_INIT_SENTINEL,
  HOOK_WORKSPACE_INIT_COMMAND
} from '~/src/services/skills/session-start-hook-constants';

function makeTempProjectRoot(): { tmpRoot: string; settingsPath: string } {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-test-sessionstart-'));
  const settingsPath = join(tmpRoot, '.claude/settings.json');
  mkdirSync(dirname(settingsPath), { recursive: true });
  return { tmpRoot, settingsPath };
}

function copyRealSettingsInto(tmpRoot: string, settingsPath: string): void {
  const realSettingsPath = resolve(process.cwd(), '.claude/settings.json');
  const realSettings = JSON.parse(readFileSync(realSettingsPath, 'utf8')) as Record<string, unknown>;
  writeFileSync(settingsPath, JSON.stringify(realSettings, null, 2), 'utf8');
}

type SettingsShape = {
  hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>>;
};

function readSessionStartEntries(settingsPath: string): Array<{ matcher?: string; hooks?: Array<{ command?: string }> }> {
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as SettingsShape;
  return settings.hooks?.SessionStart ?? [];
}

describe("statusline-session-start-init — SessionStart primer is registered", () => {
  const tmpRoots: string[] = [];

  afterEach(() => {
    for (const root of tmpRoots) {
      try {
        if (existsSync(root)) {
          rmSync(root, { recursive: true, force: true });
        }
      } catch {
        // best-effort cleanup
      }
    }
    tmpRoots.length = 0;
  });

  it("applyHookInstall emits a SessionStart primer entry", () => {
    const { tmpRoot, settingsPath } = makeTempProjectRoot();
    tmpRoots.push(tmpRoot);
    copyRealSettingsInto(tmpRoot, settingsPath);
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const entries = readSessionStartEntries(settingsPath);
    const primer = entries.find((entry) =>
      (entry.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes('peaks session primer --project'))
    );
    expect(primer).toBeDefined();
    expect(primer?.hooks?.[0]?.command).toContain('${CLAUDE_PROJECT_DIR}');
  });

  it("applyHookInstall emits the HOOK_WORKSPACE_INIT_SENTINEL", () => {
    const { tmpRoot, settingsPath } = makeTempProjectRoot();
    tmpRoots.push(tmpRoot);
    copyRealSettingsInto(tmpRoot, settingsPath);
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const entries = readSessionStartEntries(settingsPath);
    const hasPrimerSentinel = entries.some((entry) =>
      (entry.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes(HOOK_WORKSPACE_INIT_SENTINEL))
    );
    expect(hasPrimerSentinel).toBe(true);
  });

  it("HOOK_WORKSPACE_INIT_COMMAND contains the CLAUDE_PROJECT_DIR placeholder", () => {
    expect(HOOK_WORKSPACE_INIT_COMMAND).toContain('${CLAUDE_PROJECT_DIR}');
    expect(HOOK_WORKSPACE_INIT_COMMAND).toContain('peaks session primer');
  });

  it("project .claude/settings.json contains the SessionStart primer hook", () => {
    // This is the self-check that confirms the repo hand-added the
    // SessionStart entry to its own settings.json (per RD §4.2.4).
    const settingsPath = resolve(process.cwd(), '.claude/settings.json');
    const entries = readSessionStartEntries(settingsPath);
    expect(entries.length).toBeGreaterThan(0);
    const primerCmd = entries[0]?.hooks?.[0]?.command ?? '';
    expect(primerCmd).toContain('peaks session primer --project "${CLAUDE_PROJECT_DIR}"');
  });
});
