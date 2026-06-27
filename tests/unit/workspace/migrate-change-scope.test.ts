/**
 * Slice 2026-06-28-solo-mode-bypass-fix (defect #3 migration CLI).
 *
 * Pins the contract for `peaks workspace migrate-change-scope`:
 *   - dry-run default: prints plans but does NOT touch disk
 *   - --apply: renames misplaced `.peaks/_runtime/<changeId>/` to
 *     canonical `.peaks/_runtime/change/<changeId>/`
 *   - idempotent: re-running on a clean workspace reports no work
 *   - refuses entries that look like date-stamped session ids
 *     (refusal code MIGRATION_REFUSED_SESSION_ID_COLLISION)
 *   - refuses when target dir exists with non-equal contents
 *     (refusal code MIGRATION_REFUSED_TARGET_NOT_EMPTY)
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  migrateChangeScope,
  type MigrateChangeScopePlan
} from '../../../src/cli/commands/workspace/migrate-change-scope-command.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-migrate-change-scope-'));
  mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe('migrateChangeScope — slice 2026-06-28-solo-mode-bypass-fix', () => {
  it('dry-run: plans a move without touching disk', () => {
    const changeId = 'migrate-dryrun';
    const src = join(projectRoot, '.peaks', '_runtime', changeId, 'qa');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'security-findings-001.md'), '# sec');

    const result = migrateChangeScope({ projectRoot, apply: false });
    const plan = result.plans.find((p: MigrateChangeScopePlan) => p.changeId === changeId);
    expect(plan?.action).toBe('would-move');
    expect(existsSync(join(projectRoot, '.peaks', '_runtime', changeId))).toBe(true);
    expect(existsSync(join(projectRoot, '.peaks', '_runtime', 'change', changeId))).toBe(false);
  });

  it('apply: renames misplaced dir to canonical', () => {
    const changeId = 'migrate-apply';
    const src = join(projectRoot, '.peaks', '_runtime', changeId, 'qa');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'security-findings-001.md'), '# sec');

    const result = migrateChangeScope({ projectRoot, apply: true });
    const plan = result.plans.find((p: MigrateChangeScopePlan) => p.changeId === changeId);
    expect(plan?.action).toBe('moved');
    expect(existsSync(join(projectRoot, '.peaks', '_runtime', changeId))).toBe(false);
    const canonical = join(projectRoot, '.peaks', '_runtime', 'change', changeId);
    expect(existsSync(canonical)).toBe(true);
    expect(existsSync(join(canonical, 'qa', 'security-findings-001.md'))).toBe(true);
    expect(existsSync(join(canonical, '.peaks-migration.json'))).toBe(true);
    const marker = JSON.parse(readFileSync(join(canonical, '.peaks-migration.json'), 'utf8'));
    expect(marker.slice).toBe('2026-06-28-solo-mode-bypass-fix');
  });

  it('idempotent: re-run after apply reports no work', () => {
    const changeId = 'migrate-idempotent';
    const src = join(projectRoot, '.peaks', '_runtime', changeId, 'qa');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'security-findings-001.md'), '# sec');

    migrateChangeScope({ projectRoot, apply: true });
    const second = migrateChangeScope({ projectRoot, apply: false });
    expect(second.plans.find((p: MigrateChangeScopePlan) => p.changeId === changeId)).toBeUndefined();
    expect(second.plans.length).toBe(0);
  });

  it('refuses date-stamped session-id-looking entries', () => {
    const sidLooking = '2026-06-28-session-deadbeef';
    const src = join(projectRoot, '.peaks', '_runtime', sidLooking, 'qa');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'foo.md'), '# foo');

    const result = migrateChangeScope({ projectRoot, apply: false });
    const plan = result.plans.find((p: MigrateChangeScopePlan) => p.changeId === sidLooking);
    expect(plan?.action).toBe('refused-session-id-collision');
    expect(existsSync(join(projectRoot, '.peaks', '_runtime', sidLooking))).toBe(true);
  });

  it('refuses when canonical dir exists with different contents', () => {
    const changeId = 'migrate-conflict';
    const src = join(projectRoot, '.peaks', '_runtime', changeId, 'qa');
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'security-findings-001.md'), 'src content');
    const tgt = join(projectRoot, '.peaks', '_runtime', 'change', changeId, 'qa');
    mkdirSync(tgt, { recursive: true });
    writeFileSync(join(tgt, 'security-findings-001.md'), 'DIFFERENT content');

    const result = migrateChangeScope({ projectRoot, apply: false });
    const plan = result.plans.find((p: MigrateChangeScopePlan) => p.changeId === changeId);
    expect(plan?.action).toBe('refused-target-not-empty');
  });

  it('NEVER treats .peaks/<project-data> dirs as misplaced change-ids (defense against destroying workspace)', () => {
    // Slice 2026-06-28-solo-mode-bypass-fix critical regression guard:
    // .peaks/memory, .peaks/standards, .peaks/retrospective, .peaks/sc,
    // .peaks/sops, .peaks/project-scan, .peaks/_sub_agents are all
    // project-level data dirs. A whitelist bug that picks them up as
    // misplaced change-ids and renames them to .peaks/_runtime/change/<name>/
    // would silently destroy the workspace.
    const projectDataDirs = [
      'memory',
      'standards',
      'retrospective',
      'sc',
      'sops',
      'project-scan',
      '_sub_agents'
    ];
    for (const dir of projectDataDirs) {
      mkdirSync(join(projectRoot, '.peaks', dir), { recursive: true });
      writeFileSync(join(projectRoot, '.peaks', dir, 'sample.md'), `# ${dir}`);
    }

    const result = migrateChangeScope({ projectRoot, apply: false });
    // Every project-data dir name must be ABSENT from the plan list.
    for (const dir of projectDataDirs) {
      const plan = result.plans.find((p: MigrateChangeScopePlan) => p.changeId === dir);
      expect(plan, `project-data dir "${dir}" was wrongly listed as a migration candidate`).toBeUndefined();
    }
  });
});