/**
 * v2.13.2 AC-4 — prd/handoff.md auto-regen tests (≥3 cases).
 *
 * Pins:
 *   - missing handoff → created with sha256
 *   - existing handoff → not overwritten
 *   - sha256 round-trip verified
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { autoRegenPrdHandoff } from '../../../../src/services/prd/handoff-auto-regen.js';

function makeProject(sid: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'handoff-auto-'));
  const runtime = join(dir, '.peaks', '_runtime', sid);
  mkdirSync(join(runtime, 'prd', 'requests'), { recursive: true });
  // Write a request artifact body
  writeFileSync(
    join(runtime, 'prd', 'requests', 'rid-1.md'),
    '# PRD rid-1\n\n## Goals\n- g1\n\n## Acceptance\n- ac1\n'
  );
  return dir;
}

describe('v2.13.2 prd/handoff.md auto-regen (AC-4)', () => {
  let project: string;
  const sid = '2026-06-27-session-test';
  const requestId = 'rid-1';
  const changeId = 'v2-13-2-patch';

  beforeEach(() => {
    project = makeProject(sid);
  });

  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('A: missing handoff → created with sha256-locked frontmatter (schemaVersion: 2)', async () => {
    const handoffPath = join(project, '.peaks', '_runtime', sid, 'prd', 'handoff.md');
    expect(existsSync(handoffPath)).toBe(false);
    const result = await autoRegenPrdHandoff({
      projectRoot: project, sessionId: sid, requestId, changeId, role: 'prd'
    });
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    expect(existsSync(handoffPath)).toBe(true);
    const raw = readFileSync(handoffPath, 'utf8');
    expect(raw).toMatch(/^---/);
    expect(raw).toMatch(/schemaVersion: 2/);
    expect(raw).toMatch(new RegExp(`handoffHash: ${result.sha256}`));
    // Body is the PRD body
    expect(raw).toContain('# PRD rid-1');
    expect(raw).toContain('## Goals');
  });

  test('B: existing handoff → not overwritten, status = skipped-exists', async () => {
    const handoffPath = join(project, '.peaks', '_runtime', sid, 'prd', 'handoff.md');
    mkdirSync(join(project, '.peaks', '_runtime', sid, 'prd'), { recursive: true });
    const existingBody = '# EXISTING — should not be touched\n';
    const existingHash = createHash('sha256').update(existingBody, 'utf8').digest('hex');
    writeFileSync(
      handoffPath,
      `---\nschemaVersion: 2\nhandoffHash: ${existingHash}\n---\n${existingBody}`
    );
    const beforeMtime = readFileSync(handoffPath, 'utf8');
    const result = await autoRegenPrdHandoff({
      projectRoot: project, sessionId: sid, requestId, changeId, role: 'prd'
    });
    expect(result.status).toBe('skipped-exists');
    const after = readFileSync(handoffPath, 'utf8');
    expect(after).toBe(beforeMtime);
    expect(after).toContain('EXISTING — should not be touched');
  });

  test('C: sha256 round-trip — frontmatter hash matches the body content', async () => {
    const result = await autoRegenPrdHandoff({
      projectRoot: project, sessionId: sid, requestId, changeId, role: 'prd'
    });
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    const raw = readFileSync(result.path, 'utf8');
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    expect(match).not.toBeNull();
    const fm = match![1]!;
    const body = match![2]!;
    const hashMatch = fm.match(/^handoffHash:\s*([a-f0-9]{64})\s*$/m);
    expect(hashMatch).not.toBeNull();
    const expected = hashMatch![1]!;
    const actual = createHash('sha256').update(body, 'utf8').digest('hex');
    expect(actual).toBe(expected);
    expect(actual).toBe(result.sha256);
  });

  test('D: non-prd role returns failed (surgical guard, AC-4 only fires for prd)', async () => {
    const result = await autoRegenPrdHandoff({
      projectRoot: project, sessionId: sid, requestId, changeId, role: 'rd'
    });
    expect(result.status).toBe('failed');
  });
});