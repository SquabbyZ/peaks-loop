/**
 * v2.15.0 follow-up — G7 tests: doc-generator.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  generateSkillFromCommands,
  renderSkillMarkdown,
  parseCommitSubject,
  suggestChangelog
} from '../../../../src/services/doc/doc-generator.js';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'peaks-doc-test-'));
});
afterEach(() => {
  if (existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
});

describe('generateSkillFromCommands', () => {
  it('returns empty when the directory does not exist', () => {
    const r = generateSkillFromCommands('foo', join(tmpDir, 'nope'));
    expect(r.sections).toEqual([]);
  });
  it('extracts program.command() names and .description() from a command file', () => {
    writeFileSync(join(tmpDir, 'demo-commands.ts'), `
      import type { Command } from 'commander';
      export function register(program: Command): void {
        program.command('foo').description('the foo command').action(() => {});
        program.command('bar').description('the bar command').action(() => {});
      }
    `);
    const r = generateSkillFromCommands('demo', tmpDir);
    expect(r.sections).toHaveLength(1);
    expect(r.sections[0]?.heading).toBe('Commands');
    expect(r.sections[0]?.bullets.length).toBe(2);
    // The two commands should both appear in the bullets; the order is
    // by sort (foo before bar alphabetically) but we use set-equality to
    // avoid depending on insertion order.
    const bullets = r.sections[0]?.bullets ?? [];
    expect(bullets.some((b) => b.includes('peaks foo'))).toBe(true);
    expect(bullets.some((b) => b.includes('peaks bar'))).toBe(true);
  });
});

describe('renderSkillMarkdown', () => {
  it('produces a markdown skeleton with the skill name + sections', () => {
    const md = renderSkillMarkdown({
      name: 'demo',
      description: 'demo description',
      sections: [{ heading: 'Commands', bullets: ['- peaks foo — the foo command'] }]
    });
    expect(md).toContain('# demo');
    expect(md).toContain('demo description');
    expect(md).toContain('## Commands');
    expect(md).toContain('- peaks foo');
  });
});

describe('parseCommitSubject', () => {
  it('parses conventional commit with scope', () => {
    const e = parseCommitSubject('feat(prd): G3 4 必填块', 'git log');
    expect(e.kind).toBe('feat');
    expect(e.subject).toBe('G3 4 必填块');
  });
  it('parses conventional commit without scope', () => {
    const e = parseCommitSubject('fix: silent catch', 'git log');
    expect(e.kind).toBe('fix');
    expect(e.subject).toBe('silent catch');
  });
  it('falls back to chore for non-conventional subject', () => {
    const e = parseCommitSubject('random commit message', 'git log');
    expect(e.kind).toBe('chore');
    expect(e.subject).toBe('random commit message');
  });
});

describe('suggestChangelog', () => {
  it('groups by kind and emits markdown', () => {
    const md = suggestChangelog([
      { kind: 'feat', subject: 'G3', file: 'git' },
      { kind: 'feat', subject: 'G4', file: 'git' },
      { kind: 'fix', subject: 'silent catch', file: 'git' }
    ]);
    expect(md).toContain('## [Unreleased]');
    expect(md).toContain('### Feat');
    expect(md).toContain('### Fix');
    expect(md).toContain('G3');
    expect(md).toContain('G4');
    expect(md).toContain('silent catch');
  });
  it('returns the empty-changelog message when no entries', () => {
    expect(suggestChangelog([])).toContain('no changes since the reference');
  });
});
