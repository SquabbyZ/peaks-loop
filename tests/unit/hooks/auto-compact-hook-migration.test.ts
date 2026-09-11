import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { installAutoCompactHook } from '../../../src/services/hooks/auto-compact-hook-install.js';

/**
 * A corrected hook command must reach machines that already installed the
 * hook.
 *
 * The installer used to key "already installed" off the MATCHER alone, so
 * any existing install returned early and kept whatever command was
 * already on disk. `AUTO_COMPACT_HOOK_COMMAND` shipped without the
 * `--project` flag its command declares as a `.requiredOption`, so the
 * hook exited `required option '--project <path>' not specified` on every
 * Bash/Task call — and re-running the installer could not repair any
 * machine that already had it. Fixing the constant alone would have
 * reached only fresh installs.
 */
function tempSettingsPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-ac-migrate-'));
  mkdirSync(join(dir, '.claude'), { recursive: true });
  return join(dir, '.claude', 'settings.local.json');
}

function seed(path: string, entries: unknown[]): void {
  writeFileSync(path, JSON.stringify({ hooks: { PreToolUse: entries } }, null, 2) + '\n', 'utf8');
}

type Parsed = {
  hooks: { PreToolUse: Array<{ matcher: string; hooks: Array<{ command?: string }> }> };
};

describe('auto-compact hook install is a migration, not a presence check', () => {
  it('rewrites a stale command instead of reporting it as already installed', () => {
    const path = tempSettingsPath();
    seed(path, [{ matcher: 'Bash|Task', hooks: [{ type: 'command', command: 'peaks code auto-compact' }] }]);

    const result = installAutoCompactHook({ projectRoot: '', settingsPath: path });

    expect(result.action).toBe('updated');
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Parsed;
    const entry = parsed.hooks.PreToolUse.find((e) => e.matcher === 'Bash|Task');
    expect(entry?.hooks[0]?.command).toBe('peaks code auto-compact --project .');
  });

  it('is idempotent once the command is current', () => {
    const path = tempSettingsPath();
    seed(path, []);

    expect(installAutoCompactHook({ projectRoot: '', settingsPath: path }).action).toBe('installed');
    // Second run finds the CORRECT command and leaves the file alone.
    expect(installAutoCompactHook({ projectRoot: '', settingsPath: path }).action).toBe('already-installed');
  });

  it('preserves unrelated PreToolUse entries while repairing its own', () => {
    const path = tempSettingsPath();
    seed(path, [
      { matcher: 'Write|Edit', hooks: [{ type: 'command', command: 'node "/some/other/gate.js"' }] },
      { matcher: 'Bash|Task', hooks: [{ type: 'command', command: 'peaks code auto-compact' }] }
    ]);

    installAutoCompactHook({ projectRoot: '', settingsPath: path });

    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Parsed;
    const other = parsed.hooks.PreToolUse.find((e) => e.matcher === 'Write|Edit');
    expect(other?.hooks[0]?.command).toBe('node "/some/other/gate.js"');
  });
});
