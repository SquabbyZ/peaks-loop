import { describe, it, expect, test, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { TRAE_SKILL_SCOPE } from '../../../../src/services/skill-scope/adapters/trae.js';
import { CURSOR_SKILL_SCOPE } from '../../../../src/services/skill-scope/adapters/cursor.js';
import { CODEX_SKILL_SCOPE } from '../../../../src/services/skill-scope/adapters/codex.js';
import { QODER_SKILL_SCOPE } from '../../../../src/services/skill-scope/adapters/qoder.js';
import { TONGYI_SKILL_SCOPE } from '../../../../src/services/skill-scope/adapters/tongyi.js';
import type { ScopeConfig, SkillScopeAdapter } from '../../../../src/services/skill-scope/types.js';

function fakeConfig(): ScopeConfig {
  return {
    generatedAt: '2026-06-10T00:00:00.000Z',
    ide: 'claude-code',
    strict: true,
    allowlist: ['peaks-solo', 'tdd-guide'],
    denylist: ['kotlin-patterns'],
    skills: [],
    signals: {
      hasPackageJson: true,
      isTypeScript: true,
      isTypeScriptESM: true,
      isReact: false, isVue: false, isSvelte: false, isNext: false,
      isNestJS: false, isExpress: false, isFastify: false,
      isPostgres: false, isMysql: false, isMongo: false, isRedis: false,
      isDocker: false, isK8s: false,
      isCommander: true, isCodegraph: false, isHeadroom: false,
      isPython: false,
      nodeEngineMajor: 20,
      topExtensions: ['.ts'],
      hasFileExtension: { ts: true },
      shareByExtension: { ts: 1.0 },
    },
  };
}

const STUB_ADAPTERS: Array<[string, SkillScopeAdapter]> = [
  ['trae', TRAE_SKILL_SCOPE],
  ['cursor', CURSOR_SKILL_SCOPE],
  ['codex', CODEX_SKILL_SCOPE],
  ['qoder', QODER_SKILL_SCOPE],
  ['tongyi-lingma', TONGYI_SKILL_SCOPE],
];

describe.each(STUB_ADAPTERS)('Stub adapter: %s (AC5)', (ideName, adapter) => {
  let projectRoot: string;
  beforeEach(() => { projectRoot = mkdtempSync(join(tmpdir(), `peaks-stub-${ideName}-`)); });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  test(`TC-STUB-${ideName}-1: applyScope returns NOT_SUPPORTED with a clear error message`, async () => {
    const result = await adapter.applyScope({
      allowlist: ['peaks-solo'],
      denylist: ['kotlin-patterns'],
      strict: true,
      projectRoot,
      sourceConfig: { ...fakeConfig(), ide: ideName as never },
      shadowFallback: false,
    });
    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe('NOT_SUPPORTED');
    expect(result.error?.message).toMatch(new RegExp(ideName, 'i'));
    expect(result.error?.message).toMatch(/025\.\d|follow-up|not yet researched/i);
  });

  test(`TC-STUB-${ideName}-2: source-of-truth file .peaks/scope/${ideName}-skills.json is still written`, async () => {
    await adapter.applyScope({
      allowlist: ['peaks-solo'],
      denylist: ['kotlin-patterns'],
      strict: true,
      projectRoot,
      sourceConfig: { ...fakeConfig(), ide: ideName as never },
      shadowFallback: false,
    });
    const sot = join(projectRoot, '.peaks', 'scope', `${ideName}-skills.json`);
    expect(existsSync(sot), `missing source-of-truth file: ${sot}`).toBe(true);
    const data = JSON.parse(readFileSync(sot, 'utf-8'));
    expect(data.ide).toBe(ideName);
    expect(data.allowlist).toEqual(expect.arrayContaining(['peaks-solo']));
    expect(data.denylist).toEqual(expect.arrayContaining(['kotlin-patterns']));
    expect(data.strict).toBe(true);
  });
});