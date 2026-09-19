/**
 * Contract: `hooks uninstall` is idempotent for an IDE that can never carry a
 * peaks hook.
 *
 * `qoder` / `tongyi-lingma` / `zcode` are reserved adapter ids with no
 * `HOOK_COMMAND_BY_IDE` entry, so `hooks install` correctly fails closed. But
 * "there was never anything to remove" is not an error, and the lifecycle
 * table in `tests/integration/adapter-commands-e2e.test.ts`
 * (`HOOK_IDE_EXPECTATIONS`) already models these three IDEs as
 * `install: 'unsupported'` + `removed: false`. The asymmetry is deliberate:
 * `install` must keep failing, because succeeding would claim an enforcement
 * that cannot exist; `uninstall` must succeed, because the post-condition it
 * promises ("no peaks hook here") already holds.
 *
 * The resolver behind install / status / uninstall / plan is one shared
 * function, so its failure message must stay caller-neutral — naming the
 * install verb in an uninstall call is a lie about which command failed.
 *
 * Style: BDD given/when/then per peaks-loop 4.0.11+ contract.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveHookSpec } from '~/src/services/skills/hooks-codegate-superpowers';
import { applyHookInstall, removeHookInstall } from '~/src/services/skills/hooks-settings-service';

/** Adapter ids the registry knows but `HOOK_COMMAND_BY_IDE` does not table. */
const HOOK_UNSUPPORTED_IDES = ['qoder', 'tongyi-lingma', 'zcode'] as const;

describe('behavior — hooks uninstall tolerates an IDE that cannot host a hook', () => {
  const tmpRoots: string[] = [];

  afterEach(() => {
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
    const tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-hooks-unsupported-'));
    tmpRoots.push(tmpRoot);
    return tmpRoot;
  }

  it.each(HOOK_UNSUPPORTED_IDES)(
    'when uninstall runs for %s, should report removed:false instead of throwing',
    (ide) => {
      // given: a project that never carried a peaks hook for this IDE
      const tmpRoot = makeTempProjectRoot();
      // when: the uninstall is requested
      const result = removeHookInstall('project', tmpRoot, { ide });
      // then: nothing was there, so nothing was removed — and that is success
      expect(result.removed).toBe(false);
      expect(result.scope).toBe('project');
      expect(result.settingsPath.length).toBeGreaterThan(0);
    }
  );

  it.each(HOOK_UNSUPPORTED_IDES)(
    'when install runs for %s, should still fail closed rather than claim enforcement',
    (ide) => {
      // given: the same IDE, asked to install instead of uninstall
      const tmpRoot = makeTempProjectRoot();
      // when/then: install keeps failing — its success would be a false claim
      //            that the IDE is now gated
      expect(() => applyHookInstall('project', tmpRoot, { ide })).toThrow(/unsupported IDE/);
    }
  );

  it('when the shared resolver rejects an IDE, should not name one caller’s verb', () => {
    // given: one resolver serves install / status / uninstall / plan
    let message = '';
    try {
      resolveHookSpec('qoder');
    } catch (error: unknown) {
      message = error instanceof Error ? error.message : String(error);
    }
    // then: it names the IDE and the table that must gain an entry …
    expect(message).toContain("unsupported IDE 'qoder'");
    expect(message).toContain('HOOK_COMMAND_BY_IDE');
    // … and names neither a verb (which caller?) nor a file that is not the
    // table (the table lives in hooks-codegate-superpowers.ts)
    expect(message).not.toContain('peaks hooks install');
    expect(message).not.toContain('hooks-settings-service.ts');
  });
});
