/**
 * Unit tests for peaks skill sync 8-platform (Slice #12 final piece).
 *
 * Per spec §9 line 1105: `peaks skills sync 8 平台分发`. The
 * service wraps the existing `scripts/install-skills.mjs::
 * installBundledSkills` and fans out to the 8 platforms enumerated
 * by the IdeId union.
 *
 * Slice 2.0.1-bug2: when run from a consumer project (not the
 * peaks-loop repo itself), the CWD does not contain
 * `scripts/install-skills.mjs`. The service must:
 *   1. probe the peaks-loop install path (resolved via
 *      `import.meta.url` / `process.argv[1]`),
 *   2. fall back to the consumer CWD,
 *   3. gracefully skip with a single console.warn if neither
 *      candidate exists.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SYNC_PLATFORMS,
  runSkillSync,
  assertValidPlatform,
  __testing,
} from '../../../../src/services/skills/sync-service.js';

describe('skill sync-service — Slice #12 final piece', () => {
  it('enumerates the 8 platforms', () => {
    expect(SYNC_PLATFORMS).toHaveLength(8);
    expect(SYNC_PLATFORMS).toEqual([
      'claude-code',
      'trae',
      'codex',
      'cursor',
      'qoder',
      'tongyi-lingma',
      'hermes',
      'openclaw',
    ]);
  });

  describe('assertValidPlatform', () => {
    it('accepts each of the 8 platforms', () => {
      for (const p of SYNC_PLATFORMS) {
        expect(() => assertValidPlatform(p)).not.toThrow();
      }
    });

    it('rejects a bogus platform id', () => {
      expect(() => assertValidPlatform('bogus-ide')).toThrow(/unknown platform/);
      expect(() => assertValidPlatform('')).toThrow(/unknown platform/);
    });
  });

  describe('runSkillSync', () => {
    let projectRoot: string;

    beforeEach(() => {
      projectRoot = mkdtempSync(join(tmpdir(), 'peaks-skill-sync-test-'));
      mkdirSync(join(projectRoot, 'skills', 'peaks-solo'), { recursive: true });
      writeFileSync(
        join(projectRoot, 'skills', 'peaks-solo', 'SKILL.md'),
        '# peaks-solo\n\ntest skill\n'
      );
    });

    it('iterates all 8 platforms and aggregates the result', async () => {
      const result = await runSkillSync({ projectRoot });
      expect(result.applied).toBe(true);
      expect(result.dryRun).toBe(false);
      expect(result.perPlatform).toHaveLength(8);
      // The sync fans out to all 8 platforms regardless of whether
      // the underlying installer has a profile for each. The
      // `installBundledSkills` early-returns when a platform has
      // no `skillInstall` profile, so the per-platform result is
      // either an installed/skipped pair (sync OK) or an empty
      // result with ok=true (no-op for unverified adapters).
      expect(result.syncedCount).toBe(8);
      expect(result.failedCount).toBe(0);
      expect(result.totalInstalled).toBeGreaterThanOrEqual(0);
    });

    it('supports --platform <id> for a single-platform sync', async () => {
      const result = await runSkillSync({
        projectRoot,
        platforms: ['claude-code'],
      });
      expect(result.perPlatform).toHaveLength(1);
      expect(result.perPlatform[0]?.platform).toBe('claude-code');
      expect(result.syncedCount).toBe(1);
    });

    it('does NOT throw on a platform without a skillInstall profile', async () => {
      // None of the 8 platforms have explicit skillInstall
      // profiles in this test's empty project; the underlying
      // installer should fall back to the legacy Claude Code
      // path or no-op gracefully.
      const result = await runSkillSync({
        projectRoot,
        platforms: ['codex'],
      });
      expect(result.failedCount).toBe(0);
      expect(result.perPlatform[0]?.ok).toBe(true);
    });

    it('rejects an unknown platform id', async () => {
      await expect(
        runSkillSync({
          projectRoot,
          // @ts-expect-error: testing the runtime guard
          platforms: ['bogus-ide'],
        })
      ).rejects.toThrow(/unknown platform/);
    });

    it('returns applied=false when dry-run is true', async () => {
      const result = await runSkillSync({
        projectRoot,
        dryRun: true,
        platforms: ['claude-code'],
      });
      expect(result.dryRun).toBe(true);
      expect(result.applied).toBe(false);
    });

    it('records the projectRoot in the result envelope', async () => {
      const result = await runSkillSync({
        projectRoot,
        platforms: ['claude-code'],
      });
      expect(result.projectRoot).toBe(projectRoot);
    });
  });

  /**
   * Slice 2.0.1-bug2-skill-sync-fallback: graceful fallback when
   * `scripts/install-skills.mjs` is not in the consumer CWD.
   *
   * The test seam is `__testing` (exported from sync-service.ts):
   *   - `resolvePeaksCliInstallerPath(): string | null` — locate
   *     the script inside the peaks-loop install root, or null.
   *   - `resetInstallerCache()` — clear the per-process memo so
   *     each test starts from a clean slate.
   *   - `loadInstallerForTest(path: string): installer | null` —
   *     attempt to load a specific script path; null = not found.
   *
   * Tests use these to simulate the three-tier probe without
   * touching the real filesystem or the real install script.
   */
  describe('runSkillSync — 2.0.1-bug2 graceful fallback', () => {
    let projectRoot: string;
    let warnSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      projectRoot = mkdtempSync(join(tmpdir(), 'peaks-skill-sync-fallback-'));
      __testing.resetInstallerCache();
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      warnSpy.mockRestore();
      __testing.resetInstallerCache();
    });

    it('case A: no script in CWD, no script in peaks-loop install path → 0 installed, 0 failed, warning logged', async () => {
      const probeSpy = vi
        .spyOn(__testing.services, 'resolvePeaksCliInstallerPath')
        .mockReturnValue(null);
      const loadSpy = vi
        .spyOn(__testing.services, 'loadInstallerForTest')
        .mockResolvedValue(null);

      const result = await runSkillSync({
        projectRoot,
        platforms: ['claude-code'],
      });

      expect(result.perPlatform).toHaveLength(1);
      expect(result.perPlatform[0]?.ok).toBe(true);
      expect(result.perPlatform[0]?.installed).toEqual([]);
      expect(result.perPlatform[0]?.skipped).toEqual([
        'install-skills.mjs not found in project; skill sync skipped — bundled skills are installed via peaks-loop postinstall',
      ]);
      expect(result.failedCount).toBe(0);
      expect(result.syncedCount).toBe(1);
      expect(warnSpy).toHaveBeenCalledTimes(1);

      probeSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('case B: script in peaks-loop install path only → installed', async () => {
      const fakeInstaller = (): { installed: string[]; skipped: string[] } => ({
        installed: ['peaks-solo'],
        skipped: [],
      });
      const probeSpy = vi
        .spyOn(__testing.services, 'resolvePeaksCliInstallerPath')
        .mockReturnValue('/fake/peaks-loop/scripts/install-skills.mjs');
      const loadSpy = vi
        .spyOn(__testing.services, 'loadInstallerForTest')
        .mockImplementation((p: string) =>
          p === '/fake/peaks-loop/scripts/install-skills.mjs'
            ? Promise.resolve(fakeInstaller)
            : Promise.resolve(null)
        );

      const result = await runSkillSync({
        projectRoot,
        platforms: ['claude-code'],
      });

      expect(result.perPlatform).toHaveLength(1);
      expect(result.perPlatform[0]?.ok).toBe(true);
      expect(result.perPlatform[0]?.installed.length).toBeGreaterThan(0);
      expect(result.totalInstalled).toBeGreaterThan(0);
      expect(warnSpy).not.toHaveBeenCalled();

      probeSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('case C: script in CWD only → installed', async () => {
      const fakeInstaller = (): { installed: string[]; skipped: string[] } => ({
        installed: ['peaks-solo'],
        skipped: [],
      });
      const probeSpy = vi
        .spyOn(__testing.services, 'resolvePeaksCliInstallerPath')
        .mockReturnValue(null);
      // The production code probes `join(process.cwd(), 'scripts',
      // 'install-skills.mjs')`, NOT the test's `projectRoot`. The
      // cwd-only path in the test is whatever `process.cwd()`
      // happens to be at test time.
      const cwdScript = join(process.cwd(), 'scripts', 'install-skills.mjs');
      const loadSpy = vi
        .spyOn(__testing.services, 'loadInstallerForTest')
        .mockImplementation((p: string) =>
          p === cwdScript ? Promise.resolve(fakeInstaller) : Promise.resolve(null)
        );

      const result = await runSkillSync({
        projectRoot,
        platforms: ['claude-code'],
      });

      expect(result.perPlatform).toHaveLength(1);
      expect(result.perPlatform[0]?.ok).toBe(true);
      expect(result.perPlatform[0]?.installed.length).toBeGreaterThan(0);
      expect(result.totalInstalled).toBeGreaterThan(0);
      expect(warnSpy).not.toHaveBeenCalled();

      probeSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('memoizes the "not found" state — warn is logged once even with multiple platforms', async () => {
      const probeSpy = vi
        .spyOn(__testing.services, 'resolvePeaksCliInstallerPath')
        .mockReturnValue(null);
      const loadSpy = vi
        .spyOn(__testing.services, 'loadInstallerForTest')
        .mockResolvedValue(null);

      const result = await runSkillSync({
        projectRoot,
        platforms: ['claude-code', 'trae', 'cursor'],
      });

      expect(result.perPlatform).toHaveLength(3);
      expect(result.perPlatform.every((p) => p.ok === true)).toBe(true);
      // warning logged exactly once across 3 platform iterations
      expect(warnSpy).toHaveBeenCalledTimes(1);

      probeSpy.mockRestore();
      loadSpy.mockRestore();
    });
  });
});
