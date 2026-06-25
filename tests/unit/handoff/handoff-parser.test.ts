/**
 * Unit tests for `handoff-parser.ts`.
 *
 * Spec: docs/superpowers/plans/2026-06-25-slice-topology-multipass.md
 *       Phase 1, Task 4 (Handoff frontmatter types + parser + writer).
 *
 * Three contracts under test:
 *   1. Valid frontmatter + body parse cleanly, fields round-trip via the
 *      resulting `HandoffFrontmatter` object.
 *   2. Legacy handoffs WITHOUT a YAML frontmatter block fall back to
 *      `schema_version: '0'` and `status: 'unknown'` (backward compat).
 *   3. Frontmatter that is missing any of the required fields throws
 *      `IncompleteHandoffError` — never silently accepts partial data.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseHandoff, IncompleteHandoffError } from '../../../src/services/handoff/handoff-parser.js';

const tmpDirs: string[] = [];

function makeTmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-parse-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseHandoff', () => {
  it('parses valid handoff with frontmatter + body', () => {
    const dir = makeTmp();
    const filePath = join(dir, 'handoff.md');
    writeFileSync(
      filePath,
      `---
rid: "008-2026-06-25"
slice_id: "S3"
agent_id: "peaks-rd"
schema_version: "1"
status: "done"
created_at: "2026-06-25T10:00:00Z"
---

# Slice 3 Handoff

This is the body.`,
      'utf8'
    );

    const result = parseHandoff(filePath);

    expect(result.frontmatter.rid).toBe('008-2026-06-25');
    expect(result.frontmatter.slice_id).toBe('S3');
    expect(result.frontmatter.agent_id).toBe('peaks-rd');
    expect(result.frontmatter.schema_version).toBe('1');
    expect(result.frontmatter.status).toBe('done');
    expect(result.frontmatter.created_at).toBe('2026-06-25T10:00:00Z');
    expect(result.body).toContain('This is the body');
    expect(result.body).toContain('# Slice 3 Handoff');
  });

  it('returns defaults for legacy handoff without frontmatter', () => {
    const dir = makeTmp();
    const filePath = join(dir, 'legacy.md');
    writeFileSync(filePath, '# Legacy handoff\n\nNo frontmatter here.', 'utf8');

    const result = parseHandoff(filePath);

    expect(result.frontmatter.schema_version).toBe('0');
    expect(result.frontmatter.status).toBe('unknown');
    expect(result.body).toContain('Legacy handoff');
  });

  it('throws IncompleteHandoffError when required fields missing', () => {
    const dir = makeTmp();
    const filePath = join(dir, 'incomplete.md');
    // Only rid + schema_version; missing slice_id, agent_id, status, created_at.
    writeFileSync(
      filePath,
      `---
rid: "x"
schema_version: "1"
---
body`,
      'utf8'
    );

    expect(() => parseHandoff(filePath)).toThrow(IncompleteHandoffError);
  });
});
