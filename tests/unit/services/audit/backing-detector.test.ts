import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { classifyBacking, classifyBackingBatch } from '../../../../src/services/audit/backing-detector.js';
import type { RedLineEntry } from '../../../../src/services/audit/types.js';

function makeEntry(overrides: Partial<RedLineEntry> = {}): RedLineEntry {
  return {
    id: 'rl-test-001',
    rule: 'Test Rule',
    source: {
      file: 'test.md',
      line: 1,
      marker: 'MANDATORY',
      context: 'Test context',
    },
    backing: 'prose-only',
    enforcerRef: null,
    ...overrides,
  };
}

describe('backing-detector.classifyBacking', () => {
  it('downgrades to prose-only when enforcer file does not exist on disk', () => {
    const projectRoot = '/tmp/nonexistent-project-xyz';
    const entry = makeEntry({ enforcerRef: 'src/services/missing.ts' });
    const result = classifyBacking(entry, projectRoot);
    expect(result.entry.backing).toBe('prose-only');
    expect(result.enforcerExists).toBe(false);
  });

  it('keeps cli-backed when enforcer file exists on disk', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'audit-bd-'));
    try {
      const enforcerPath = 'src/services/exists.ts';
      mkdirSync(join(projectRoot, 'src/services'), { recursive: true });
      writeFileSync(join(projectRoot, enforcerPath), '// existing enforcer file');
      const entry = makeEntry({ enforcerRef: enforcerPath });
      const result = classifyBacking(entry, projectRoot);
      expect(result.entry.backing).toBe('cli-backed');
      expect(result.enforcerExists).toBe(true);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it('upgrades to partial when context contains "if llm cooperates" marker', () => {
    const projectRoot = '/tmp/no-fs';
    const entry = makeEntry({
      enforcerRef: 'src/services/audit/enforcers/solo-code-ban.ts',
      source: {
        file: 'skills/peaks-code/SKILL.md',
        line: 1,
        marker: 'MANDATORY',
        context: 'This rule is best-effort, if LLM cooperates.',
      },
    });
    const result = classifyBacking(entry, projectRoot);
    expect(result.entry.backing).toBe('partial');
  });

  it('keeps prose-only when enforcerRef is null', () => {
    const projectRoot = '/tmp/no-fs';
    const entry = makeEntry({ enforcerRef: null });
    const result = classifyBacking(entry, projectRoot);
    expect(result.entry.backing).toBe('prose-only');
    expect(result.enforcerExists).toBe(false);
  });
});

describe('backing-detector.classifyBackingBatch', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'audit-bd-batch-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('re-classifies each entry independently', () => {
    writeFileSync(join(projectRoot, 'exists-a.ts'), '// a');
    writeFileSync(join(projectRoot, 'exists-b.ts'), '// b');
    const entries: RedLineEntry[] = [
      makeEntry({ id: 'a', enforcerRef: 'exists-a.ts' }),
      makeEntry({ id: 'b', enforcerRef: 'exists-b.ts' }),
      makeEntry({ id: 'c', enforcerRef: 'missing-c.ts' }),
      makeEntry({ id: 'd', enforcerRef: null }),
    ];
    const result = classifyBackingBatch(entries, projectRoot);
    expect(result.entries.find((e) => e.id === 'a')?.backing).toBe('cli-backed');
    expect(result.entries.find((e) => e.id === 'b')?.backing).toBe('cli-backed');
    expect(result.entries.find((e) => e.id === 'c')?.backing).toBe('prose-only');
    expect(result.entries.find((e) => e.id === 'd')?.backing).toBe('prose-only');
    expect(result.warnings).toEqual([]);
  });
});
