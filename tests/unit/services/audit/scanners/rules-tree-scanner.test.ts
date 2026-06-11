import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanRulesTree } from '../../../../../src/services/audit/scanners/rules-tree-scanner.js';

describe('rules-tree-scanner', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'audit-rules-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns empty result when .claude/rules/ is missing', () => {
    const result = scanRulesTree({ projectRoot });
    expect(result.lines).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('walks markdown files recursively under .claude/rules', () => {
    mkdirSync(join(projectRoot, '.claude/rules/common'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude/rules/common/coding-style.md'), '# coding-style\n\nA rule.\n');
    mkdirSync(join(projectRoot, '.claude/rules/typescript'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude/rules/typescript/coding-style.md'), '# ts coding-style\n\nA rule.\n');

    const result = scanRulesTree({ projectRoot });
    const files = new Set(result.lines.map((l) => l.file));
    expect(files.has('.claude/rules/common/coding-style.md')).toBe(true);
    expect(files.has('.claude/rules/typescript/coding-style.md')).toBe(true);
  });

  it('skips non-markdown files', () => {
    mkdirSync(join(projectRoot, '.claude/rules'), { recursive: true });
    writeFileSync(join(projectRoot, '.claude/rules/coding-style.md'), '# md\n');
    writeFileSync(join(projectRoot, '.claude/rules/coding-style.txt'), 'text file');
    const result = scanRulesTree({ projectRoot });
    const files = new Set(result.lines.map((l) => l.file));
    expect(files.has('.claude/rules/coding-style.md')).toBe(true);
    expect(files.has('.claude/rules/coding-style.txt')).toBe(false);
  });
});
