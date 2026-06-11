import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanSkillsTree } from '../../../../../src/services/audit/scanners/skills-tree-scanner.js';

describe('skills-tree-scanner', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'audit-skills-'));
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns empty result when skills/ is missing', () => {
    const result = scanSkillsTree({ projectRoot });
    expect(result.lines).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('reads each skill SKILL.md and emits MarkdownLine entries', () => {
    mkdirSync(join(projectRoot, 'skills/peaks-solo'), { recursive: true });
    writeFileSync(join(projectRoot, 'skills/peaks-solo/SKILL.md'), '# peaks-solo\n\nA short doc.\n');
    mkdirSync(join(projectRoot, 'skills/peaks-rd'), { recursive: true });
    writeFileSync(join(projectRoot, 'skills/peaks-rd/SKILL.md'), '# peaks-rd\n\nAnother doc.\n');

    const result = scanSkillsTree({ projectRoot });
    const files = new Set(result.lines.map((l) => l.file));
    expect(files.has('skills/peaks-solo/SKILL.md')).toBe(true);
    expect(files.has('skills/peaks-rd/SKILL.md')).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('skips skill dirs without SKILL.md', () => {
    mkdirSync(join(projectRoot, 'skills/empty-dir'), { recursive: true });
    writeFileSync(join(projectRoot, 'skills/empty-dir/notes.md'), '# notes');
    mkdirSync(join(projectRoot, 'skills/peaks-solo'), { recursive: true });
    writeFileSync(join(projectRoot, 'skills/peaks-solo/SKILL.md'), '# peaks-solo');
    const result = scanSkillsTree({ projectRoot });
    const files = new Set(result.lines.map((l) => l.file));
    expect(files.has('skills/peaks-solo/SKILL.md')).toBe(true);
    expect(files.has('skills/empty-dir/notes.md')).toBe(false);
  });

  it('skips hidden directories', () => {
    mkdirSync(join(projectRoot, 'skills/.hidden'), { recursive: true });
    writeFileSync(join(projectRoot, 'skills/.hidden/SKILL.md'), '# hidden');
    mkdirSync(join(projectRoot, 'skills/peaks-solo'), { recursive: true });
    writeFileSync(join(projectRoot, 'skills/peaks-solo/SKILL.md'), '# peaks-solo');
    const result = scanSkillsTree({ projectRoot });
    const files = new Set(result.lines.map((l) => l.file));
    expect(files.has('skills/.hidden/SKILL.md')).toBe(false);
    expect(files.has('skills/peaks-solo/SKILL.md')).toBe(true);
  });
});
