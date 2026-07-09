/**
 * zcode-adapter fixture (slice 2026-07-09-add-zcode-adapter, Slice B B.6).
 * Per SC-3 §3.5 T-1 ~ T-10:
 *   - import zcodeAdapter from src/services/ide/adapters/zcode-adapter.js
 *   - import IdeId from src/services/ide/ide-types.js
 *   - import { IDE_DETECTION_DIRS, IDE_SKILL_INSTALL_PROFILES } from
 *     scripts/install-skills.mjs (ESM module — script body is guarded by
 *     `import.meta.url === pathToFileURL(...)` so importing here is safe
 *     and triggers no side effects).
 */
import { describe, expect, it } from 'vitest';
import { ZCODE_ADAPTER } from '../../../src/services/ide/adapters/zcode-adapter.js';
import type { IdeId } from '../../../src/services/ide/ide-types.js';
// install-skills.mjs is a runtime-only ESM script (no .d.ts).
// The script body is guarded by `import.meta.url === ...` so importing
// here triggers no side effects.
// @ts-expect-error — install-skills.mjs has no .d.ts declaration file
import * as installSkills from '../../../scripts/install-skills.mjs';

interface IdeDetectionEntry {
  id: string;
  dir: string;
}

interface IdeSkillInstallProfile {
  skillsDir: string;
  outputStylesDir?: string;
  agentsDir?: string;
  envVar: string;
  outputStylesEnvVar?: string;
  agentsEnvVar?: string;
}

const IDE_DETECTION_DIRS = (installSkills as unknown as {
  IDE_DETECTION_DIRS: IdeDetectionEntry[];
}).IDE_DETECTION_DIRS;

const IDE_SKILL_INSTALL_PROFILES = (installSkills as unknown as {
  IDE_SKILL_INSTALL_PROFILES: Record<string, IdeSkillInstallProfile>;
}).IDE_SKILL_INSTALL_PROFILES;

describe('ZCODE_ADAPTER (zcode-adapter)', () => {
  it('T-1: id is "zcode"', () => {
    expect(ZCODE_ADAPTER.id).toBe('zcode');
  });

  it('T-2: settings.dirName is ".zcode"', () => {
    expect(ZCODE_ADAPTER.settings.dirName).toBe('.zcode');
  });

  it('T-3: standardsProfile.rootFile is "CLAUDE.md" (z-code 借用 .claude/)', () => {
    expect(ZCODE_ADAPTER.standardsProfile?.rootFile).toBe('CLAUDE.md');
  });

  it('T-4: standardsProfile.rulesDir is ".claude/rules" (z-code 借用 .claude/)', () => {
    expect(ZCODE_ADAPTER.standardsProfile?.rulesDir).toBe('.claude/rules');
  });

  it('T-5: skillInstall.skillsDir is ~/.zcode/skills', () => {
    expect(ZCODE_ADAPTER.skillInstall?.skillsDir).toMatch(/[/\\]\.zcode[/\\]skills$/);
  });

  it('T-6: compact is undefined (降级 — z-code 无 CLI)', () => {
    expect(ZCODE_ADAPTER.compact).toBeUndefined();
  });

  it('T-7: hookEvent is UNVERIFIED 占位 "PreToolUse" (类型为 string)', () => {
    // hookEvent 是 IdeAdapter 必填 string 字段,不能设 undefined;
    // z-code 没有公开 hook 协议,这里用占位值 + 注释 UNVERIFIED。
    expect(typeof ZCODE_ADAPTER.hookEvent).toBe('string');
    expect(ZCODE_ADAPTER.hookEvent).toBeTruthy();
  });

  it('T-8: IdeId 类型包含 "zcode" (compile-time TS check)', () => {
    // Compile-time 验证 'zcode' 满足 IdeId 联合类型;runtime 通过赋给该类型变量。
    const id: IdeId = 'zcode';
    expect(id).toBe('zcode');
  });

  it('T-9: IDE_DETECTION_DIRS 数组包含 { id: "zcode", dir: ".zcode" }', () => {
    const entry = IDE_DETECTION_DIRS.find((d: IdeDetectionEntry) => d.id === 'zcode');
    expect(entry).toBeDefined();
    expect(entry?.dir).toBe('.zcode');
  });

  it('T-10: IDE_SKILL_INSTALL_PROFILES["zcode"] 存在', () => {
    expect(IDE_SKILL_INSTALL_PROFILES['zcode']).toBeDefined();
    const profile = IDE_SKILL_INSTALL_PROFILES['zcode'] as IdeSkillInstallProfile;
    expect(profile.skillsDir).toMatch(/[/\\]\.zcode[/\\]skills$/);
    expect(profile.envVar).toBe('PEAKS_ZCODE_SKILLS_DIR');
  });
});
