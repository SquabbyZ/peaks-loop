/**
 * Unit tests for peaks skill sync 8-platform (Slice #12 final piece).
 *
 * Per spec §9 line 1105: `peaks skills sync 8 平台分发`. The
 * service wraps the existing `scripts/install-skills.mjs::
 * installBundledSkills` and fans out to the 8 platforms enumerated
 * by the IdeId union.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SYNC_PLATFORMS, runSkillSync, assertValidPlatform } from '../../../../src/services/skills/sync-service.js';

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
});
