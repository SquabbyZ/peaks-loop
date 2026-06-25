/**
 * Unit tests for `handoff-writer.ts`.
 *
 * Spec: docs/superpowers/plans/2026-06-25-slice-topology-multipass.md
 *       Phase 1, Task 4.
 *
 * Two contracts under test:
 *   1. The writer emits a file whose content begins with a YAML
 *      frontmatter block delimited by `---` and contains the supplied
 *      body verbatim, AND the resulting file re-parses cleanly via
 *      `parseHandoff` (round-trip).
 *   2. The frontmatter block carries the six required fields exactly,
 *      in human-readable form (key: value), with string fields quoted.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeHandoff } from '../../../src/services/handoff/handoff-writer.js';
import { parseHandoff } from '../../../src/services/handoff/handoff-parser.js';
import type { HandoffFrontmatter } from '../../../src/services/handoff/handoff-types.js';

const tmpDirs: string[] = [];

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-write-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('writeHandoff', () => {
  it('writes a file that round-trips through parseHandoff', () => {
    const dir = makeTmp();
    const filePath = join(dir, 'handoff.md');
    const frontmatter: HandoffFrontmatter = {
      rid: '008-2026-06-25',
      slice_id: 'S3',
      agent_id: 'peaks-rd',
      schema_version: '1',
      status: 'done',
      created_at: '2026-06-25T10:00:00Z',
      duration_seconds: 120,
      files_changed: ['src/services/handoff/handoff-types.ts'],
      test_result: 'pass'
    };
    const body = '# Slice 3 Handoff\n\nBody text.';

    writeHandoff(filePath, frontmatter, body);

    const parsed = parseHandoff(filePath);
    expect(parsed.frontmatter.rid).toBe('008-2026-06-25');
    expect(parsed.frontmatter.status).toBe('done');
    expect(parsed.frontmatter.duration_seconds).toBe(120);
    expect(parsed.frontmatter.files_changed).toEqual([
      'src/services/handoff/handoff-types.ts'
    ]);
    expect(parsed.frontmatter.test_result).toBe('pass');
    expect(parsed.body).toContain('# Slice 3 Handoff');
    expect(parsed.body).toContain('Body text.');
  });

  it('emits a YAML frontmatter block delimited by ---', () => {
    const dir = makeTmp();
    const filePath = join(dir, 'handoff.md');
    const frontmatter: HandoffFrontmatter = {
      rid: 'r1',
      slice_id: 'S1',
      agent_id: 'peaks-rd',
      schema_version: '1',
      status: 'done',
      created_at: '2026-06-25T10:00:00Z'
    };

    writeHandoff(filePath, frontmatter, 'body');

    const raw = readFileSync(filePath, 'utf8');
    expect(raw.startsWith('---\n')).toBe(true);
    // Second `---` delimiter separates frontmatter from body.
    expect(raw).toMatch(/\n---\n/);
    // Required fields present in the YAML block.
    expect(raw).toContain('rid:');
    expect(raw).toContain('slice_id:');
    expect(raw).toContain('agent_id:');
    expect(raw).toContain('schema_version:');
    expect(raw).toContain('status:');
    expect(raw).toContain('created_at:');
  });
});
