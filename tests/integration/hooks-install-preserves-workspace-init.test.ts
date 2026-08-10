// tests/integration/hooks-install-preserves-workspace-init.test.ts
//
// Slice rid-statusline-stale-ux AC-2 — regression guard for the
// `applyHookInstall` re-install path. The new
// HOOK_WORKSPACE_INIT_SENTINEL must round-trip through install +
// uninstall without being treated as a non-Peaks entry (which would
// silently strip the user's hand-added SessionStart primer on the
// next install).
//
// H-A regression guard: every case uses a mkdtempSync tmp root and
// never touches the git-tracked .claude/settings.json. Case 4
// explicitly asserts the git-tracked file is byte-identical before
// and after the install call against a tmp root.
//
// Run with:
//   pnpm vitest run tests/integration/hooks-install-preserves-workspace-init.test.ts

import { describe, expect, it, afterEach } from 'vitest';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import {
  applyHookInstall,
  removeHookInstall
} from '~/src/services/skills/hooks-settings-service';
import {
  HOOK_WORKSPACE_INIT_SENTINEL
} from '~/src/services/skills/session-start-hook-constants';

function makeTempProjectRoot(): { tmpRoot: string; settingsPath: string } {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-test-hooks-'));
  const settingsPath = join(tmpRoot, '.claude/settings.json');
  mkdirSync(dirname(settingsPath), { recursive: true });
  return { tmpRoot, settingsPath };
}

function copyRealSettingsInto(tmpRoot: string, settingsPath: string): void {
  const realSettingsPath = resolve(process.cwd(), '.claude/settings.json');
  const realSettings = JSON.parse(readFileSync(realSettingsPath, 'utf8')) as Record<string, unknown>;
  writeFileSync(settingsPath, JSON.stringify(realSettings, null, 2), 'utf8');
}

function sha256(buf: Buffer | string): string {
  return createHash('sha256').update(buf).digest('hex');
}

describe("hooks-install-preserves-workspace-init — regression guard", () => {
  const tmpRoots: string[] = [];

  afterEach(() => {
    // Clean up every tmp root we created, even if a case failed mid-way.
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

  it("applyHookInstall twice retains the SessionStart primer entry (P1 #12)", () => {
    const { tmpRoot, settingsPath } = makeTempProjectRoot();
    tmpRoots.push(tmpRoot);
    copyRealSettingsInto(tmpRoot, settingsPath);
    // Re-install twice — sentinel-based merge must NOT strip the
    // existing SessionStart primer entry on the second pass.
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const result = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks?: Record<string, Array<{ matcher?: string; hooks?: Array<{ command?: string }> }>>;
    };
    const sessionStartEntries = result.hooks?.SessionStart;
    expect(sessionStartEntries).toBeDefined();
    expect(Array.isArray(sessionStartEntries)).toBe(true);
    const hasPrimer = sessionStartEntries?.some((entry) =>
      (entry.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes('peaks session primer --project'))
    );
    expect(hasPrimer).toBe(true);
  });

  it("resolveHookEntries('claude-code') includes HOOK_WORKSPACE_INIT_SENTINEL and the install produces a primer entry", () => {
    const { tmpRoot, settingsPath } = makeTempProjectRoot();
    tmpRoots.push(tmpRoot);
    copyRealSettingsInto(tmpRoot, settingsPath);
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const result = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    const sessionStartEntries = result.hooks?.SessionStart ?? [];
    const primerEntry = sessionStartEntries.find((entry) =>
      (entry.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes(HOOK_WORKSPACE_INIT_SENTINEL))
    );
    expect(primerEntry).toBeDefined();
  });

  it("removeHookInstall cleanly removes the SessionStart primer entry", () => {
    const { tmpRoot, settingsPath } = makeTempProjectRoot();
    tmpRoots.push(tmpRoot);
    copyRealSettingsInto(tmpRoot, settingsPath);
    // Install first (which writes the SessionStart primer entry),
    // then uninstall — uninstall must strip the SessionStart
    // entry because HOOK_WORKSPACE_INIT_SENTINEL is in
    // resolveLegacySentinels('claude-code').
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    removeHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const result = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks?: Record<string, Array<{ hooks?: Array<{ command?: string }> }>>;
    };
    const sessionStartEntries = result.hooks?.SessionStart;
    // Either undefined (cleaned up) or an empty array — no primer left.
    if (sessionStartEntries !== undefined) {
      const hasPrimer = sessionStartEntries.some((entry) =>
        (entry.hooks ?? []).some((h) => typeof h.command === 'string' && h.command.includes(HOOK_WORKSPACE_INIT_SENTINEL))
      );
      expect(hasPrimer).toBe(false);
    }
  });

  it("does NOT clobber git-tracked .claude/settings.json (H-A regression guard)", () => {
    // Read the git-tracked settings.json BEFORE the install call
    // against a tmp root. The install operates on the tmp root
    // only; the git-tracked file must be byte-identical afterwards.
    const realSettingsPath = resolve(process.cwd(), '.claude/settings.json');
    const beforeBuf = readFileSync(realSettingsPath);
    const beforeHash = sha256(beforeBuf);
    const { tmpRoot, settingsPath } = makeTempProjectRoot();
    tmpRoots.push(tmpRoot);
    copyRealSettingsInto(tmpRoot, settingsPath);
    applyHookInstall('project', tmpRoot, { ide: 'claude-code' });
    const afterBuf = readFileSync(realSettingsPath);
    const afterHash = sha256(afterBuf);
    expect(afterHash).toBe(beforeHash);
  });
});
