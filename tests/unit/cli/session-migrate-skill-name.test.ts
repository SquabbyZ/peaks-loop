import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { migrateSkillName } from '../../../src/services/migrate-skill-name/migrate.js';

// IMPORTANT: This test pins the `peaks session migrate-skill-name` contract
// for the rename peaks-solo → peaks-code. The beforeEach seed data MUST keep
// the legacy `peaks-solo` literals so the migrate call (from: 'peaks-solo',
// to: 'peaks-code') actually has something to rename. After the user-wide
// sweep in 593d915 (chore(repo): user global sweep peaks-solo → peaks-code)
// over-corrected this file, every assertion became a no-op because the
// rename pair collapsed to (from: 'peaks-code', to: 'peaks-code') — leaving
// modifiedFiles === 0 and breaking the migrate contract tests below.
// See tests/fixtures/runtime/session-with-peaks-solo.json for the same
// retention rationale (peaks-solo kept verbatim on purpose).

describe('peaks session migrate-skill-name', () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = join(tmpdir(), `migrate-skill-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(join(sandbox, '.peaks', '_runtime'), { recursive: true });
    writeFileSync(
      join(sandbox, '.peaks', '_runtime', 'active-skill.json'),
      JSON.stringify({ skill: 'peaks-solo', sessionId: 'test', setAt: '2026-07-05T00:00:00Z' }, null, 2),
    );
    writeFileSync(
      join(sandbox, '.peaks', '_runtime', 'session.json'),
      JSON.stringify({ skill: 'peaks-solo', sessionId: 'test' }, null, 2),
    );
  });

  afterEach(() => {
    if (existsSync(sandbox)) rmSync(sandbox, { recursive: true, force: true });
  });

  it('dry-run 不改盘', () => {
    const result = migrateSkillName({ projectRoot: sandbox, from: 'peaks-solo', to: 'peaks-code', apply: false });
    expect(result.scannedFiles).toBeGreaterThan(0);
    expect(result.modifiedFiles).toBe(0);
    const after = JSON.parse(readFileSync(join(sandbox, '.peaks', '_runtime', 'active-skill.json'), 'utf-8'));
    expect(after.skill).toBe('peaks-solo');
  });

  it('--apply 改 active-skill.json 的 skill 字段', () => {
    const result = migrateSkillName({ projectRoot: sandbox, from: 'peaks-solo', to: 'peaks-code', apply: true });
    expect(result.modifiedFiles).toBeGreaterThanOrEqual(1);
    const after = JSON.parse(readFileSync(join(sandbox, '.peaks', '_runtime', 'active-skill.json'), 'utf-8'));
    expect(after.skill).toBe('peaks-code');
  });

  it('--apply 改 session.json 的 skill 字段', () => {
    migrateSkillName({ projectRoot: sandbox, from: 'peaks-solo', to: 'peaks-code', apply: true });
    const after = JSON.parse(readFileSync(join(sandbox, '.peaks', '_runtime', 'session.json'), 'utf-8'));
    expect(after.skill).toBe('peaks-code');
  });

  it('--apply 改 role/*.json 嵌套文件', () => {
    mkdirSync(join(sandbox, '.peaks', '_runtime', 'rd'), { recursive: true });
    writeFileSync(
      join(sandbox, '.peaks', '_runtime', 'rd', 'progress.json'),
      JSON.stringify({ skill: 'peaks-solo', slice: 1 }, null, 2),
    );
    migrateSkillName({ projectRoot: sandbox, from: 'peaks-solo', to: 'peaks-code', apply: true });
    const after = JSON.parse(readFileSync(join(sandbox, '.peaks', '_runtime', 'rd', 'progress.json'), 'utf-8'));
    expect(after.skill).toBe('peaks-code');
  });

  it('跳过 .peaks/memory/**', () => {
    mkdirSync(join(sandbox, '.peaks', 'memory'), { recursive: true });
    writeFileSync(join(sandbox, '.peaks', 'memory', 'test.md'), 'this mentions peaks-solo historically');
    const before = readFileSync(join(sandbox, '.peaks', 'memory', 'test.md'), 'utf-8');
    const result = migrateSkillName({ projectRoot: sandbox, from: 'peaks-solo', to: 'peaks-code', apply: true });
    expect(result.skipped.some((p) => p.includes('memory'))).toBe(true);
    const after = readFileSync(join(sandbox, '.peaks', 'memory', 'test.md'), 'utf-8');
    expect(after).toBe(before);
  });

  it('跳过 .peaks/skills/.system/bees/peaks-code/manifest.json', () => {
    mkdirSync(join(sandbox, '.peaks', 'skills', '.system', 'bees', 'peaks-code'), { recursive: true });
    writeFileSync(
      join(sandbox, '.peaks', 'skills', '.system', 'bees', 'peaks-code', 'manifest.json'),
      JSON.stringify({ id: 'peaks-code', displayName: 'Peaks Code' }, null, 2),
    );
    const before = readFileSync(join(sandbox, '.peaks', 'skills', '.system', 'bees', 'peaks-code', 'manifest.json'), 'utf-8');
    migrateSkillName({ projectRoot: sandbox, from: 'peaks-solo', to: 'peaks-code', apply: true });
    const after = readFileSync(join(sandbox, '.peaks', 'skills', '.system', 'bees', 'peaks-code', 'manifest.json'), 'utf-8');
    expect(after).toBe(before);
  });

  it('幂等: 第二次跑 --apply 返回 0 modifications', () => {
    migrateSkillName({ projectRoot: sandbox, from: 'peaks-solo', to: 'peaks-code', apply: true });
    const result2 = migrateSkillName({ projectRoot: sandbox, from: 'peaks-solo', to: 'peaks-code', apply: true });
    expect(result2.modifiedFiles).toBe(0);
    expect(result2.keyValueReplacements).toBe(0);
  });

  it('错误路径: JSON 损坏返回清晰错误(不静默跳过)', () => {
    writeFileSync(join(sandbox, '.peaks', '_runtime', 'broken.json'), '{ broken json');
    const result = migrateSkillName({ projectRoot: sandbox, from: 'peaks-solo', to: 'peaks-code', apply: true });
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.ok).toBe(false);
  });
});