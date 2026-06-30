/**
 * v2.13.3 AC-4 — prd/handoff.md auto-regen tests.
 *
 * Pins:
 *   - missing handoff → created with sha256-locked frontmatter
 *     (v2.13.3: primary field is now `sha256:` to align with the
 *     AUDIT_REQUIRES_HANDOFF prereq, with `handoffHash:` kept as
 *     a literal alias for back-compat consumers)
 *   - existing handoff → not overwritten
 *   - sha256 round-trip verified (primary `sha256:` field)
 *   - AUDIT_REQUIRES_HANDOFF prereq check passes on the auto-regen
 *     output (regression pin for the dogfood "missing section(s): sha256:"
 *     bug)
 */
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { autoRegenPrdHandoff } from '../../../../src/services/prd/handoff-auto-regen.js';
import { checkPrerequisites } from '../../../../src/services/artifacts/artifact-prerequisites.js';

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

describe('v2.13.3 prd/handoff.md auto-regen (AC-4)', () => {
  let project: string;
  const sid = '2026-06-27-session-test';
  const requestId = 'rid-1';
  const sessionId = 'v2-13-3-patch';

  beforeEach(() => {
    project = makeProject(sid);
  });

  afterEach(() => {
    rmSync(project, { recursive: true, force: true });
  });

  test('A: missing handoff → created with sha256 + handoffHash alias (schemaVersion: 2)', async () => {
    const handoffPath = join(project, '.peaks', '_runtime', sid, 'prd', 'handoff.md');
    expect(existsSync(handoffPath)).toBe(false);
    const result = await autoRegenPrdHandoff({
      projectRoot: project, sessionId: sid, requestId, role: 'prd'
    });
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    expect(existsSync(handoffPath)).toBe(true);
    const raw = readFileSync(handoffPath, 'utf8');
    expect(raw).toMatch(/^---/);
    expect(raw).toMatch(/schemaVersion: 2/);
    // v2.13.3 AC-4: primary field is `sha256:` to align with
    // AUDIT_REQUIRES_HANDOFF mustContain. `handoffHash:` is kept as
    // a literal alias for back-compat consumers.
    expect(raw).toMatch(new RegExp(`^sha256: ${result.sha256}`, 'm'));
    expect(raw).toMatch(new RegExp(`^handoffHash: ${result.sha256}`, 'm'));
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
      projectRoot: project, sessionId: sid, requestId, role: 'prd'
    });
    expect(result.status).toBe('skipped-exists');
    const after = readFileSync(handoffPath, 'utf8');
    expect(after).toBe(beforeMtime);
    expect(after).toContain('EXISTING — should not be touched');
  });

  test('C: sha256 round-trip — frontmatter `sha256:` field matches the body content', async () => {
    const result = await autoRegenPrdHandoff({
      projectRoot: project, sessionId: sid, requestId, role: 'prd'
    });
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    const raw = readFileSync(result.path, 'utf8');
    const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    expect(match).not.toBeNull();
    const fm = match![1]!;
    const body = match![2]!;
    // v2.13.3 AC-4: read from the primary `sha256:` field.
    const hashMatch = fm.match(/^sha256:\s*([a-f0-9]{64})\s*$/m);
    expect(hashMatch).not.toBeNull();
    const expected = hashMatch![1]!;
    const actual = createHash('sha256').update(body, 'utf8').digest('hex');
    expect(actual).toBe(expected);
    expect(actual).toBe(result.sha256);
  });

  test('D: non-prd role returns failed (surgical guard, AC-4 only fires for prd)', async () => {
    const result = await autoRegenPrdHandoff({
      projectRoot: project, sessionId: sid, requestId, role: 'rd'
    });
    expect(result.status).toBe('failed');
  });

  test('E (v2.13.3 AC-4 new): AUDIT_REQUIRES_HANDOFF prereq passes on auto-regen output', async () => {
    // Regression pin for dogfood bug: pre-2.13.3 the auto-regen wrote
    // `handoffHash:` but the AUDIT_REQUIRES_HANDOFF prereq required
    // `sha256:` — the own prereq would reject its own handoff. After
    // the AC-4 fix, the prereq must pass when run on the auto-regen
    // output (no `missing` entry with `sha256:` in the description).
    const result = await autoRegenPrdHandoff({
      projectRoot: project, sessionId: sid, requestId, role: 'prd'
    });
    expect(result.status).toBe('created');
    if (result.status !== 'created') return;
    const prereq = await checkPrerequisites({
      projectRoot: project,
      sessionId: sid,
      role: 'rd',
      newState: 'qa-handoff',
      requestId,
      requestType: 'feature'
    });
    // The AUDIT_REQUIRES_HANDOFF entry is at `rd:qa-handoff` for
    // feature slices. If sha256: were missing, the prereq would have
    // a `missing` entry whose description ends with `sha256:`.
    const auditHandoffMissing = prereq.missing.find(
      (m) => m.path === 'prd/handoff.md' && m.description.includes('sha256:')
    );
    expect(auditHandoffMissing).toBeUndefined();
    // The handoff itself must not be reported as missing (it exists).
    const handoffMissing = prereq.missing.find((m) => m.path === 'prd/handoff.md');
    expect(handoffMissing).toBeUndefined();
  });
});