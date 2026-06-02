import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import {
  evaluateGate,
  stripMetaForGrep
} from '../../src/services/sop/sop-check-service.js';
import { lintSop } from '../../src/services/sop/sop-service.js';
import type { SopGate } from '../../src/services/sop/sop-types.js';

function grepGate(file: string, pattern: string, absent: boolean, stripMeta?: boolean): SopGate {
  const check: SopGate['check'] = stripMeta === undefined
    ? { type: 'grep', file, pattern, absent }
    : { type: 'grep', file, pattern, absent, stripMeta };
  return { id: 'no-todo', phase: 'published', check };
}

function makeTempProject(): string {
  const root = join(tmpdir(), `sop-strip-meta-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(root, { recursive: true });
  return root;
}

describe('stripMetaForGrep — pure-string helper', () => {
  test('removes HTML comments', () => {
    const input = 'real content\n<!-- T-O-D-O -->\nmore content';
    const output = stripMetaForGrep(input);
    expect(output).not.toContain('T-O-D-O');
    expect(output).toContain('real content');
    expect(output).toContain('more content');
  });

  test('removes HTML comments that span multiple lines', () => {
    const input = 'before\n<!--\nT-O-D-O\nspans\nmany\nlines\n-->\nafter';
    const output = stripMetaForGrep(input);
    expect(output).not.toContain('T-O-D-O');
    expect(output).toContain('before');
    expect(output).toContain('after');
  });

  test('removes fenced code blocks', () => {
    const input = 'paragraph\n```js\nT-O-D-O inside code\n```\nparagraph two';
    const output = stripMetaForGrep(input);
    expect(output).not.toContain('T-O-D-O');
    expect(output).toContain('paragraph');
    expect(output).toContain('paragraph two');
  });

  test('removes fenced code blocks without language tag', () => {
    const input = 'before\n```\nT-O-D-O\n```\nafter';
    const output = stripMetaForGrep(input);
    expect(output).not.toContain('T-O-D-O');
    expect(output).toContain('before');
    expect(output).toContain('after');
  });

  test('removes C-style block comments', () => {
    const input = 'before /* T-O-D-O inside */ after';
    const output = stripMetaForGrep(input);
    expect(output).not.toContain('T-O-D-O');
    expect(output).toContain('before');
    expect(output).toContain('after');
  });

  test('removes C-style block comments that span multiple lines', () => {
    const input = 'before\n/*\nT-O-D-O\nspans\n*/\nafter';
    const output = stripMetaForGrep(input);
    expect(output).not.toContain('T-O-D-O');
    expect(output).toContain('before');
    expect(output).toContain('after');
  });

  test('unclosed fence is left as-is (conservative fail-safe)', () => {
    const input = 'before\n```\nT-O-D-O never closes\nno more lines';
    const output = stripMetaForGrep(input);
    // Unclosed fence means we cannot safely strip; the input passes through
    // unchanged so the regex will still match the embedded T-O-D-O.
    expect(output).toBe(input);
  });

  test('unclosed block comment is left as-is (conservative fail-safe)', () => {
    const input = 'before\n/* T-O-D-O unterminated\nmore lines\nno closer';
    const output = stripMetaForGrep(input);
    expect(output).toBe(input);
  });

  test('content without any meta is unchanged', () => {
    const input = 'plain prose with T-O-D-O inline';
    expect(stripMetaForGrep(input)).toBe(input);
  });
});

describe('evaluateGate — stripMeta wiring', () => {
  test('absent:true + stripMeta:true passes when only an HTML comment contains the pattern (AC1)', () => {
    const project = makeTempProject();
    writeFileSync(join(project, 'post.md'), 'real text\n<!-- T-O-D-O -->\nmore text', 'utf8');
    const verdict = evaluateGate(project, grepGate('post.md', 'T-O-D-O', true, true));
    expect(verdict).toEqual({ result: 'pass' });
  });

  test('absent:true + stripMeta:true still fails when rendered content contains the pattern (AC2)', () => {
    const project = makeTempProject();
    writeFileSync(join(project, 'post.md'), 'real text T-O-D-O and also <!-- also T-O-D-O -->', 'utf8');
    const verdict = evaluateGate(project, grepGate('post.md', 'T-O-D-O', true, true));
    expect(verdict.result).toBe('fail');
  });

  test('absent:true + stripMeta:true passes when only a fenced code block contains the pattern (AC3)', () => {
    const project = makeTempProject();
    writeFileSync(join(project, 'post.md'), 'paragraph one\n```\nT-O-D-O\n```\nparagraph two', 'utf8');
    const verdict = evaluateGate(project, grepGate('post.md', 'T-O-D-O', true, true));
    expect(verdict).toEqual({ result: 'pass' });
  });

  test('absent:true without stripMeta is byte-identical to pre-slice behavior (AC5, regression guard)', () => {
    const project = makeTempProject();
    writeFileSync(join(project, 'post.md'), 'real text T-O-D-O and <!-- T-O-D-O -->', 'utf8');
    const without = evaluateGate(project, grepGate('post.md', 'T-O-D-O', true));
    const withFalse = evaluateGate(project, grepGate('post.md', 'T-O-D-O', true, false));
    expect(without).toEqual(withFalse);
    expect(without.result).toBe('fail');
  });

  test('absent:false + stripMeta:true fails when only meta contains the pattern (OQ1 PRD answer)', () => {
    // "absent:false" semantics are: pass if pattern is found anywhere in (stripped) content.
    // If only meta contains the pattern, after stripping the regex doesn't match, so verdict fails.
    const project = makeTempProject();
    writeFileSync(join(project, 'post.md'), '<!-- T-O-D-O -->\nclean prose', 'utf8');
    const verdict = evaluateGate(project, grepGate('post.md', 'T-O-D-O', false, true));
    expect(verdict.result).toBe('fail');
  });
});

describe('lintManifest — stripMeta warnings', () => {
  test('emits a warning when a grep gate declares stripMeta:true (AC6)', async () => {
    const projectRoot = makeTempProject();
    const sopDir = join(projectRoot, '.peaks', 'sops', 'strip-meta-demo');
    mkdirSync(sopDir, { recursive: true });
    writeFileSync(
      join(sopDir, 'sop.json'),
      JSON.stringify({
        id: 'strip-meta-demo',
        name: 'Strip Meta Demo',
        phases: ['draft', 'published'],
        gates: [
          {
            id: 'no-todo-with-meta',
            phase: 'published',
            check: { type: 'grep', file: 'post.md', pattern: 'T-O-D-O', absent: true, stripMeta: true }
          }
        ]
      }),
      'utf8'
    );
    const result = await lintSop({ id: 'strip-meta-demo', projectRoot });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    expect(result!.findings).toEqual([]);
    expect(result!.warnings).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/stripMeta.*no-todo-with-meta|excluded from grep/i)
      ])
    );
  });

  test('does not warn for a grep gate without stripMeta (AC6 / PRD P3)', async () => {
    const projectRoot = makeTempProject();
    const sopDir = join(projectRoot, '.peaks', 'sops', 'plain-grep-demo');
    mkdirSync(sopDir, { recursive: true });
    writeFileSync(
      join(sopDir, 'sop.json'),
      JSON.stringify({
        id: 'plain-grep-demo',
        name: 'Plain Grep Demo',
        phases: ['draft', 'published'],
        gates: [
          {
            id: 'no-todo',
            phase: 'published',
            check: { type: 'grep', file: 'post.md', pattern: 'T-O-D-O', absent: true }
          }
        ]
      }),
      'utf8'
    );
    const result = await lintSop({ id: 'plain-grep-demo', projectRoot });
    expect(result).not.toBeNull();
    expect(result!.ok).toBe(true);
    expect(result!.warnings).toEqual([]);
  });
});
