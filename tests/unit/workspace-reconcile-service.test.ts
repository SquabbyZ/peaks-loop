import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  applyDeletions,
  discoverSessions,
  findDeletionCandidates,
  migrateOldRuntimeState,
  pickCanonicalSession,
  reconcileWorkspace,
  repointSessionJson
} from '../../src/services/workspace/reconcile-service.js';
import {
  discoverRequestArtifacts,
  regenerateChangeLinks,
  resolveChangeId
} from '../../src/services/workspace/change-link-service.js';
import { getSessionId } from '../../src/services/session/session-manager.js';

let projectRoot: string;

function makeProject(): string {
  const root = join(tmpdir(), `peaks-reconcile-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(join(root, '.peaks'), { recursive: true });
  return root;
}

function writeActiveSkill(root: string, sessionId: string | null): void {
  const path = join(root, '.peaks', '.active-skill.json');
  if (sessionId === null) {
    if (existsSync(path)) rmSync(path);
    return;
  }
  writeFileSync(path, JSON.stringify({ sessionId, skill: 'peaks-rd', mode: 'inline', gate: 'startup', setAt: new Date().toISOString() }, null, 2), 'utf8');
}

function makeSessionDir(root: string, sessionId: string, options: { mtimeMs?: number; withMeta?: boolean; files?: string[] } = {}): string {
  const dir = join(root, '.peaks', sessionId);
  mkdirSync(dir, { recursive: true });
  if (options.withMeta !== false) {
    const metaPath = join(dir, 'session.json');
    writeFileSync(metaPath, JSON.stringify({ sessionId, createdAt: new Date().toISOString(), projectRoot: root }, null, 2), 'utf8');
    if (typeof options.mtimeMs === 'number') {
      try { utimesSync(metaPath, options.mtimeMs / 1000, options.mtimeMs / 1000); } catch { /* best effort */ }
    }
  }
  for (const rel of options.files ?? []) {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, 'content', 'utf8');
  }
  return dir;
}

describe('discoverSessions', () => {
  beforeEach(() => { projectRoot = makeProject(); });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  test('returns empty array when .peaks/ does not exist', () => {
    const altRoot = join(tmpdir(), `peaks-reconcile-no-peaks-${Date.now()}`);
    mkdirSync(altRoot, { recursive: true });
    try {
      expect(discoverSessions(altRoot)).toEqual([]);
    } finally {
      rmSync(altRoot, { recursive: true, force: true });
    }
  });

  test('returns empty array when .peaks/ exists but has no session dirs', () => {
    writeFileSync(join(projectRoot, '.peaks', 'README.md'), 'hi', 'utf8');
    expect(discoverSessions(projectRoot)).toEqual([]);
  });

  test('returns entries for matching session dirs sorted by name', () => {
    const a = makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa');
    const b = makeSessionDir(projectRoot, '2026-06-02-session-bbbbbb');
    const c = makeSessionDir(projectRoot, '2026-06-03-session-cccccc');
    const entries = discoverSessions(projectRoot);
    expect(entries.map((e) => e.sessionId)).toEqual([
      '2026-06-01-session-aaaaaa',
      '2026-06-02-session-bbbbbb',
      '2026-06-03-session-cccccc'
    ]);
    expect(entries.map((e) => e.path)).toEqual([a, b, c]);
  });

  test('ignores directories that do not match the session id pattern', () => {
    makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa');
    mkdirSync(join(projectRoot, '.peaks', 'not-a-session'), { recursive: true });
    mkdirSync(join(projectRoot, '.peaks', '2026-06-01-also-not-a-session'), { recursive: true });
    const entries = discoverSessions(projectRoot);
    expect(entries.map((e) => e.sessionId)).toEqual(['2026-06-01-session-aaaaaa']);
  });

  test('counts artifactCount excluding session.json', () => {
    makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa', {
      files: ['rd/tech-doc.md', 'qa/test-cases/x.md', 'prd/requests/x.md']
    });
    const [entry] = discoverSessions(projectRoot);
    expect(entry?.artifactCount).toBe(3);
  });

  test('reports lastActivity as null when session.json is missing', () => {
    const dir = makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa', { withMeta: false });
    expect(existsSync(join(dir, 'session.json'))).toBe(false);
    const [entry] = discoverSessions(projectRoot);
    expect(entry?.lastActivity).toBeNull();
  });
});

describe('pickCanonicalSession', () => {
  test('returns null when entries is empty', () => {
    expect(pickCanonicalSession([], null)).toBeNull();
  });

  test('tier 1: active-skill sessionId wins when it matches a real entry', () => {
    const entries = [
      { sessionId: '2026-06-01-session-aaaaaa', path: '/x', lastActivity: 100, artifactCount: 0 },
      { sessionId: '2026-06-02-session-bbbbbb', path: '/y', lastActivity: 500, artifactCount: 0 },
      { sessionId: '2026-06-03-session-cccccc', path: '/z', lastActivity: 200, artifactCount: 0 }
    ];
    const result = pickCanonicalSession(entries, '2026-06-02-session-bbbbbb');
    expect(result).toEqual({ sessionId: '2026-06-02-session-bbbbbb', source: 'active-skill' });
  });

  test('tier 1 is skipped when active-skill sessionId does not match a real entry', () => {
    const entries = [
      { sessionId: '2026-06-01-session-aaaaaa', path: '/x', lastActivity: 100, artifactCount: 0 }
    ];
    const result = pickCanonicalSession(entries, '2026-06-99-session-zzzzzz');
    expect(result?.source).toBe('latest-session-json-mtime');
    expect(result?.sessionId).toBe('2026-06-01-session-aaaaaa');
  });

  test('tier 2: latest session.json mtime wins when no active-skill', () => {
    const entries = [
      { sessionId: '2026-06-01-session-aaaaaa', path: '/x', lastActivity: 100, artifactCount: 0 },
      { sessionId: '2026-06-02-session-bbbbbb', path: '/y', lastActivity: 500, artifactCount: 0 },
      { sessionId: '2026-06-03-session-cccccc', path: '/z', lastActivity: 200, artifactCount: 0 }
    ];
    const result = pickCanonicalSession(entries, null);
    expect(result).toEqual({ sessionId: '2026-06-02-session-bbbbbb', source: 'latest-session-json-mtime' });
  });

  test('tier 3: latest any-file mtime wins when no session.json in any dir', () => {
    const projectRoot = makeProject();
    try {
      const old = makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa', { withMeta: false });
      const newer = makeSessionDir(projectRoot, '2026-06-02-session-bbbbbb', { withMeta: false });
      writeFileSync(join(old, 'note.md'), 'old');
      writeFileSync(join(newer, 'note.md'), 'newer');
      const oldTime = new Date('2020-01-01T00:00:00Z').getTime();
      const newTime = new Date('2024-01-01T00:00:00Z').getTime();
      utimesSync(join(old, 'note.md'), oldTime / 1000, oldTime / 1000);
      utimesSync(join(newer, 'note.md'), newTime / 1000, newTime / 1000);

      const entries = discoverSessions(projectRoot);
      const result = pickCanonicalSession(entries, null);
      expect(result?.source).toBe('latest-any-file-mtime');
      expect(result?.sessionId).toBe('2026-06-02-session-bbbbbb');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('tier 4: dir-name sort last wins as last resort', () => {
    const projectRoot = makeProject();
    try {
      makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa', { withMeta: false });
      makeSessionDir(projectRoot, '2026-06-02-session-bbbbbb', { withMeta: false });
      makeSessionDir(projectRoot, '2026-06-03-session-cccccc', { withMeta: false });

      const entries = discoverSessions(projectRoot);
      // Force every entry to look like "no file" so tier 2 and tier 3 miss
      for (const e of entries) e.lastActivity = null;
      const result = pickCanonicalSession(entries, null);
      expect(result?.source).toBe('dir-name-sort');
      expect(result?.sessionId).toBe('2026-06-03-session-cccccc');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

describe('repointSessionJson', () => {
  beforeEach(() => { projectRoot = makeProject(); });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  test('writes a new .peaks/.session.json binding to the canonical session', () => {
    const result = repointSessionJson(projectRoot, '2026-06-04-session-89f7cb', '2026-06-04-session-cda1cd');
    expect(result).toEqual({ repointedFrom: '2026-06-04-session-cda1cd', repointedTo: '2026-06-04-session-89f7cb' });
    expect(getSessionId(projectRoot)).toBe('2026-06-04-session-89f7cb');
  });

  test('handles null previous binding', () => {
    const result = repointSessionJson(projectRoot, '2026-06-04-session-aaaaaa', null);
    expect(result.repointedFrom).toBeNull();
    expect(result.repointedTo).toBe('2026-06-04-session-aaaaaa');
    expect(getSessionId(projectRoot)).toBe('2026-06-04-session-aaaaaa');
  });
});

describe('findDeletionCandidates', () => {
  beforeEach(() => { projectRoot = makeProject(); });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  test('flags empty dirs whose mtime is older than the threshold', () => {
    const oldTime = new Date('2020-01-01T00:00:00Z').getTime();
    const dir = makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa', { mtimeMs: oldTime, withMeta: true });
    const entries = discoverSessions(projectRoot);
    const candidates = findDeletionCandidates(entries, 7 * 24 * 60 * 60 * 1000);
    expect(candidates.map((c) => c.sessionId)).toEqual(['2026-06-01-session-aaaaaa']);
    expect(existsSync(dir)).toBe(true); // not deleted by the candidate selector
  });

  test('does NOT flag dirs with artifacts', () => {
    const oldTime = new Date('2020-01-01T00:00:00Z').getTime();
    makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa', { mtimeMs: oldTime, withMeta: true, files: ['rd/tech-doc.md'] });
    const entries = discoverSessions(projectRoot);
    const candidates = findDeletionCandidates(entries, 7 * 24 * 60 * 60 * 1000);
    expect(candidates).toEqual([]);
  });

  test('does NOT flag dirs whose mtime is newer than the threshold', () => {
    const now = Date.now();
    makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa', { mtimeMs: now, withMeta: true });
    const entries = discoverSessions(projectRoot);
    const candidates = findDeletionCandidates(entries, 7 * 24 * 60 * 60 * 1000);
    expect(candidates).toEqual([]);
  });

  test('session.json alone does not disqualify (it is auto-generated)', () => {
    const oldTime = new Date('2020-01-01T00:00:00Z').getTime();
    makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa', { mtimeMs: oldTime, withMeta: true });
    const entries = discoverSessions(projectRoot);
    expect(entries[0]?.artifactCount).toBe(0); // session.json is excluded
    const candidates = findDeletionCandidates(entries, 7 * 24 * 60 * 60 * 1000);
    expect(candidates.length).toBe(1);
  });
});

describe('applyDeletions', () => {
  beforeEach(() => { projectRoot = makeProject(); });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  test('apply=false: reports wouldDelete, no disk mutation', () => {
    const dir = makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa');
    const entries = discoverSessions(projectRoot);
    const result = applyDeletions(entries, false);
    expect(result.deleted).toEqual([]);
    expect(result.wouldDelete).toEqual(['2026-06-01-session-aaaaaa']);
    expect(existsSync(dir)).toBe(true);
  });

  test('apply=true: actually removes the dir and reports deleted', () => {
    const dir = makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa');
    const entries = discoverSessions(projectRoot);
    const result = applyDeletions(entries, true);
    expect(result.deleted).toEqual(['2026-06-01-session-aaaaaa']);
    expect(result.wouldDelete).toEqual([]);
    expect(existsSync(dir)).toBe(false);
  });

  test('empty candidates list returns empty arrays', () => {
    const result = applyDeletions([], true);
    expect(result).toEqual({ deleted: [], wouldDelete: [], errors: [] });
  });
});

describe('reconcileWorkspace (top-level orchestrator)', () => {
  beforeEach(() => { projectRoot = makeProject(); });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  test('dry-run: repoints binding to canonical and lists deletion candidates', () => {
    const oldTime = new Date('2020-01-01T00:00:00Z').getTime();
    const recent = Date.now();
    makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa', { mtimeMs: oldTime, withMeta: true });
    makeSessionDir(projectRoot, '2026-06-02-session-bbbbbb', { mtimeMs: recent, withMeta: true });
    writeActiveSkill(projectRoot, null);

    const result = reconcileWorkspace({
      projectRoot,
      apply: false,
      olderThanMs: 7 * 24 * 60 * 60 * 1000
    });

    expect(result.canonicalSessionId).toBe('2026-06-02-session-bbbbbb');
    expect(result.canonicalSource).toBe('latest-session-json-mtime');
    expect(result.apply).toBe(false);
    expect(result.wouldDelete).toEqual(['2026-06-01-session-aaaaaa']);
    expect(result.deleted).toEqual([]);
    expect(getSessionId(projectRoot)).toBe('2026-06-02-session-bbbbbb');
  });

  test('apply: actually deletes the deletion candidates', () => {
    const oldTime = new Date('2020-01-01T00:00:00Z').getTime();
    const recent = Date.now();
    const orphanDir = makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa', { mtimeMs: oldTime, withMeta: true });
    makeSessionDir(projectRoot, '2026-06-02-session-bbbbbb', { mtimeMs: recent, withMeta: true });
    writeActiveSkill(projectRoot, null);

    const result = reconcileWorkspace({
      projectRoot,
      apply: true,
      olderThanMs: 7 * 24 * 60 * 60 * 1000
    });

    expect(result.deleted).toEqual(['2026-06-01-session-aaaaaa']);
    expect(result.wouldDelete).toEqual([]);
    expect(existsSync(orphanDir)).toBe(false);
  });

  test('tier 1: active-skill wins over mtime', () => {
    const oldTime = new Date('2020-01-01T00:00:00Z').getTime();
    const recent = Date.now();
    makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa', { mtimeMs: recent, withMeta: true });
    makeSessionDir(projectRoot, '2026-06-02-session-bbbbbb', { mtimeMs: oldTime, withMeta: true });
    writeActiveSkill(projectRoot, '2026-06-02-session-bbbbbb');

    const result = reconcileWorkspace({
      projectRoot,
      apply: false,
      olderThanMs: 7 * 24 * 60 * 60 * 1000
    });

    expect(result.canonicalSessionId).toBe('2026-06-02-session-bbbbbb');
    expect(result.canonicalSource).toBe('active-skill');
  });

  test('no session dirs: canonicalSessionId is null', () => {
    const result = reconcileWorkspace({
      projectRoot,
      apply: false,
      olderThanMs: 7 * 24 * 60 * 60 * 1000
    });
    expect(result.canonicalSessionId).toBeNull();
    expect(result.sessions).toEqual([]);
    expect(result.deletionCandidates).toEqual([]);
    expect(result.repointed).toBe(false);
  });

  test('no-op when canonical === current binding', () => {
    const now = Date.now();
    makeSessionDir(projectRoot, '2026-06-01-session-aaaaaa', { mtimeMs: now, withMeta: true });
    writeFileSync(join(projectRoot, '.peaks', '.session.json'), JSON.stringify({ sessionId: '2026-06-01-session-aaaaaa', createdAt: new Date().toISOString(), projectRoot }, null, 2), 'utf8');
    writeActiveSkill(projectRoot, null);

    const result = reconcileWorkspace({
      projectRoot,
      apply: false,
      olderThanMs: 7 * 24 * 60 * 60 * 1000
    });
    expect(result.canonicalSessionId).toBe('2026-06-01-session-aaaaaa');
    expect(result.repointedFrom).toBe('2026-06-01-session-aaaaaa');
    expect(result.repointedTo).toBe('2026-06-01-session-aaaaaa');
    expect(result.repointed).toBe(false);
  });
});

describe('migrateOldRuntimeState (slice 2026-06-05-peaks-runtime-layer)', () => {
  beforeEach(() => { projectRoot = makeProject(); });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  test('moves the 3 old-path files into .peaks/_runtime/ and reports them in migratedFiles', () => {
    // Pre-seed the 3 old-path files in their legacy locations.
    writeFileSync(join(projectRoot, '.peaks', '.session.json'), JSON.stringify({ sessionId: '2026-06-04-session-aaaaaa', projectRoot, createdAt: new Date().toISOString() }, null, 2), 'utf8');
    writeFileSync(join(projectRoot, '.peaks', '.active-skill.json'), JSON.stringify({ skill: 'peaks-rd', sessionId: '2026-06-04-session-aaaaaa' }, null, 2), 'utf8');
    mkdirSync(join(projectRoot, '.peaks', 'sop-state'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'sop-state', 'phase.json'), JSON.stringify({ phase: 'startup' }, null, 2), 'utf8');

    const result = migrateOldRuntimeState(projectRoot);

    expect(result.errors).toEqual([]);
    expect(result.migratedFiles).toEqual([
      join('.peaks', '.session.json'),
      join('.peaks', '.active-skill.json'),
      join('.peaks', 'sop-state')
    ]);
    expect(existsSync(join(projectRoot, '.peaks', '_runtime', 'session.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.peaks', '_runtime', 'active-skill.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.peaks', '_runtime', 'sop-state', 'phase.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.peaks', '.session.json'))).toBe(false);
    expect(existsSync(join(projectRoot, '.peaks', '.active-skill.json'))).toBe(false);
    expect(existsSync(join(projectRoot, '.peaks', 'sop-state'))).toBe(false);
  });

  test('is idempotent: second call returns migratedFiles: []', () => {
    writeFileSync(join(projectRoot, '.peaks', '.session.json'), JSON.stringify({ sessionId: '2026-06-04-session-aaaaaa', projectRoot }, null, 2), 'utf8');

    const first = migrateOldRuntimeState(projectRoot);
    expect(first.migratedFiles.length).toBeGreaterThan(0);

    const second = migrateOldRuntimeState(projectRoot);
    expect(second.migratedFiles).toEqual([]);
    expect(second.errors).toEqual([]);
  });

  test('returns empty migratedFiles when no old-path files exist', () => {
    const result = migrateOldRuntimeState(projectRoot);
    expect(result.migratedFiles).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  test('reconcileWorkspace exposes migratedFiles additively on the envelope', () => {
    writeFileSync(join(projectRoot, '.peaks', '.session.json'), JSON.stringify({ sessionId: '2026-06-04-session-aaaaaa', projectRoot }, null, 2), 'utf8');
    writeFileSync(join(projectRoot, '.peaks', '.active-skill.json'), JSON.stringify({ skill: 'peaks-rd', sessionId: '2026-06-04-session-aaaaaa' }, null, 2), 'utf8');
    mkdirSync(join(projectRoot, '.peaks', 'sop-state'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'sop-state', 'phase.json'), '{}', 'utf8');

    const result = reconcileWorkspace({
      projectRoot,
      apply: false,
      olderThanMs: 7 * 24 * 60 * 60 * 1000
    });

    expect(result.migratedFiles).toEqual([
      join('.peaks', '.session.json'),
      join('.peaks', '.active-skill.json'),
      join('.peaks', 'sop-state')
    ]);
    // Idempotent re-run produces no diff on migratedFiles.
    const second = reconcileWorkspace({
      projectRoot,
      apply: false,
      olderThanMs: 7 * 24 * 60 * 60 * 1000
    });
    expect(second.migratedFiles).toEqual([]);
  });
});

/**
 * Slice 003 invariant: after `reconcileWorkspace` runs, the canonical
 * `change/<rid>` symlink layer (or the EPERM `.peaks-link.json`
 * manifest fallback) MUST exist for every request artifact under
 * `.peaks/_runtime/<sid>/<role>/requests/<rid>.md`. The symlink
 * points to `../<sid>/` and the manifest maps `<rid> → <sid>`.
 *
 * Pre-slice behaviour: no symlink layer exists. The reconcile command
 * migrates legacy runtime files + repoints the binding + reports
 * deletion candidates, but does NOT generate per-change-id links.
 * Slice 003 adds the link-regeneration step inside `reconcileWorkspace`
 * and exposes a `--change-links` flag for the link-only regen path.
 */
describe('canonical layout (slice 003 — change/<rid> symlink layer)', () => {
  beforeEach(() => { projectRoot = makeProject(); });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  test('reconcileWorkspace regenerates change/<rid> symlink (or EPERM manifest) for every request artifact', () => {
    const sid = '2026-06-06-session-aaaaaa';
    const rid = '001-2026-06-06-doctor-dist-version-check';
    // Build a minimal canonical tree: a bound session + an rd/requests/<rid>.md
    const sessionDir = join(projectRoot, '.peaks', '_runtime', sid);
    mkdirSync(join(sessionDir, 'rd', 'requests'), { recursive: true });
    writeFileSync(
      join(sessionDir, 'rd', 'requests', `${rid}.md`),
      `---\nrid: ${rid}\n---\n\n# Test fixture\n`,
      'utf8'
    );
    writeFileSync(
      join(sessionDir, 'session.json'),
      JSON.stringify({ sessionId: sid, projectRoot, createdAt: new Date().toISOString() }),
      'utf8'
    );
    // Bind the session so reconcile picks it up.
    writeFileSync(
      join(projectRoot, '.peaks', '_runtime', 'session.json'),
      JSON.stringify({ sessionId: sid, projectRoot, createdAt: new Date().toISOString() }),
      'utf8'
    );
    writeActiveSkill(projectRoot, sid);

    const result = reconcileWorkspace({
      projectRoot,
      apply: false,
      olderThanMs: 7 * 24 * 60 * 60 * 1000
    });

    // Either the symlink or the EPERM manifest is present at the canonical path.
    const symPath = join(projectRoot, '.peaks', '_runtime', 'change', rid);
    const manifestPath = join(projectRoot, '.peaks', '_runtime', 'change', '.peaks-link.json');
    const hasSym = existsSync(symPath);
    const hasManifest = existsSync(manifestPath);
    expect(hasSym || hasManifest).toBe(true);

    // The result envelope reports the link-regeneration outcome.
    expect(result.changeLinks).toBeDefined();
    if (hasSym) {
      // Symlink path: at least 1 link created (or skipped because already correct).
      expect(result.changeLinks?.created.length ?? 0 + (result.changeLinks?.skipped.length ?? 0)).toBeGreaterThan(0);
    }
    if (hasManifest) {
      // EPERM fallback: the manifest has a mapping for the rid.
      const mapping = JSON.parse(readFileSync(manifestPath, 'utf8') as string) as Record<string, string>;
      expect(mapping[rid]).toBe(sid);
    }
  });
});

/**
 * Slice 003 repair cycle 1: the change-link walker MUST discover
 * request artifacts under per-change-id scopes
 * (`.peaks/<rid>/<role>/requests/`), retrospective
 * (`.peaks/retrospective/<rid>/<role>/requests/`), and dogfood
 * (`.peaks/_dogfood/<rid>/<role>/requests/`), not just per-session
 * (`.peaks/_runtime/<sid>/<role>/requests/`).
 *
 * Bug observed: the original walker only did (a) per-session. On the
 * current repo the per-session dirs are EMPTY, so the walker
 * returned `{}` and the user-facing symlink layer was empty. After
 * the fix, the walker binds per-change-id rids to the canonical
 * session from `.peaks/_runtime/session.json`.
 */
describe('change-link walker (slice 003 repair cycle 1 — per-change-id scope)', () => {
  beforeEach(() => { projectRoot = makeProject(); });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  function bindCanonicalSession(root: string, sid: string): void {
    mkdirSync(join(root, '.peaks', '_runtime'), { recursive: true });
    writeFileSync(
      join(root, '.peaks', '_runtime', 'session.json'),
      JSON.stringify({ sessionId: sid, projectRoot: root, createdAt: new Date().toISOString() }),
      'utf8'
    );
  }

  test('discoverRequestArtifacts binds a per-change-id rd request to the canonical session', () => {
    const sid = '2026-06-06-session-aaaaaa';
    const rid = '001-2026-06-06-doctor-dist-version-check';
    bindCanonicalSession(projectRoot, sid);
    mkdirSync(join(projectRoot, '.peaks', rid, 'rd', 'requests'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', rid, 'rd', 'requests', `${rid}.md`),
      '---\nrid: 001\n---\n# Test',
      'utf8'
    );

    const map = discoverRequestArtifacts(projectRoot);
    expect(map[rid]).toBe(sid);
  });

  test('discoverRequestArtifacts strips the incrementing-number filename prefix (e.g. 001-<rid>.md)', () => {
    const sid = '2026-06-06-session-aaaaaa';
    const rid = '002-2026-06-06-reconcile-help-text';
    bindCanonicalSession(projectRoot, sid);
    mkdirSync(join(projectRoot, '.peaks', rid, 'rd', 'requests'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', rid, 'rd', 'requests', `001-${rid}.md`),
      '---\nrid: 001\n---\n# Test',
      'utf8'
    );

    const map = discoverRequestArtifacts(projectRoot);
    expect(map[rid]).toBe(sid);
  });

  test('discoverRequestArtifacts walks retrospective/<rid>/<role>/requests as a best-effort binding', () => {
    const sid = '2026-06-06-session-aaaaaa';
    const archivedRid = '2026-06-04-solo-skill-slim-extract';
    bindCanonicalSession(projectRoot, sid);
    mkdirSync(join(projectRoot, '.peaks', 'retrospective', archivedRid, 'rd', 'requests'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', 'retrospective', archivedRid, 'rd', 'requests', `${archivedRid}.md`),
      '# Archived test',
      'utf8'
    );

    const map = discoverRequestArtifacts(projectRoot);
    expect(map[archivedRid]).toBe(sid);
  });

  test('discoverRequestArtifacts walks _dogfood/<rid>/<role>/requests as a best-effort binding', () => {
    const sid = '2026-06-06-session-aaaaaa';
    const dogfoodRid = '2026-06-05-dogfood-gateb9-empty';
    bindCanonicalSession(projectRoot, sid);
    mkdirSync(join(projectRoot, '.peaks', '_dogfood', dogfoodRid, 'rd', 'requests'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', '_dogfood', dogfoodRid, 'rd', 'requests', `${dogfoodRid}.md`),
      '# Dogfood test',
      'utf8'
    );

    const map = discoverRequestArtifacts(projectRoot);
    expect(map[dogfoodRid]).toBe(sid);
  });

  test('discoverRequestArtifacts binds per-session AND per-change-id rids when both are present', () => {
    const sidSession = '2026-06-06-session-aaaaaa';
    const sidCanonical = '2026-06-06-session-bbbbbb';
    const ridSession = 'session-only-rid';
    const ridChangeId = '001-2026-06-06-changes-only-rid';

    // Per-session: bind a session-id via the active skill + a session.json
    mkdirSync(join(projectRoot, '.peaks', '_runtime', sidSession, 'rd', 'requests'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', '_runtime', sidSession, 'rd', 'requests', `${ridSession}.md`),
      '# per-session',
      'utf8'
    );
    // Per-change-id: bind to a different canonical session
    bindCanonicalSession(projectRoot, sidCanonical);
    mkdirSync(join(projectRoot, '.peaks', ridChangeId, 'rd', 'requests'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', ridChangeId, 'rd', 'requests', `${ridChangeId}.md`),
      '# per-change-id',
      'utf8'
    );

    const map = discoverRequestArtifacts(projectRoot);
    expect(map[ridSession]).toBe(sidSession);
    expect(map[ridChangeId]).toBe(sidCanonical);
  });

  test('discoverRequestArtifacts returns {} when no canonical session is bound (per-change-id scope inactive)', () => {
    const rid = '001-2026-06-06-doctor-dist-version-check';
    mkdirSync(join(projectRoot, '.peaks', rid, 'rd', 'requests'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', rid, 'rd', 'requests', `${rid}.md`),
      '# Test',
      'utf8'
    );

    const map = discoverRequestArtifacts(projectRoot);
    // No canonical session → per-change-id scope is not bound; map is empty.
    expect(map[rid]).toBeUndefined();
  });

  test('discoverRequestArtifacts ignores non-change-id dirs in the per-change-id scope', () => {
    const sid = '2026-06-06-session-aaaaaa';
    bindCanonicalSession(projectRoot, sid);
    mkdirSync(join(projectRoot, '.peaks', 'system', 'rd', 'requests'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', 'system', 'rd', 'requests', 'system-rid.md'),
      '# system test',
      'utf8'
    );
    mkdirSync(join(projectRoot, '.peaks', 'project-scan', 'rd', 'requests'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', 'project-scan', 'rd', 'requests', 'project-scan-rid.md'),
      '# scan test',
      'utf8'
    );

    const map = discoverRequestArtifacts(projectRoot);
    expect(map['system-rid']).toBeUndefined();
    expect(map['project-scan-rid']).toBeUndefined();
  });

  test('regenerateChangeLinks creates the change/<rid> entry for per-change-id rids (RED → GREEN)', () => {
    const sid = '2026-06-06-session-aaaaaa';
    const rid = '001-2026-06-06-doctor-dist-version-check';
    bindCanonicalSession(projectRoot, sid);
    mkdirSync(join(projectRoot, '.peaks', rid, 'rd', 'requests'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', rid, 'rd', 'requests', `001-${rid}.md`),
      '# Test',
      'utf8'
    );

    const result = regenerateChangeLinks({ projectRoot });

    // The change-link layer (symlink OR EPERM manifest) MUST exist for
    // the per-change-id rid, because the F3 spec's acceptance criterion
    // requires `.. /requests/<rid>.md` → `change/<rid>` binding.
    const symPath = join(projectRoot, '.peaks', '_runtime', 'change', rid);
    const manifestPath = join(projectRoot, '.peaks', '_runtime', 'change', '.peaks-link.json');
    const hasSym = existsSync(symPath);
    const hasManifest = existsSync(manifestPath);
    expect(hasSym || hasManifest).toBe(true);

    // The mapping reports the binding.
    expect(result.mapping[rid]).toBe(sid);

    // resolveChangeId confirms the canonical-session binding is now
    // discoverable from the rid alone. The source depends on which
    // form (symlink vs manifest) was written.
    const resolved = resolveChangeId(rid, projectRoot);
    expect(resolved.sessionId).toBe(sid);
    expect(['symlink', 'manifest', 'session-walk']).toContain(resolved.source);

    if (hasManifest) {
      // EPERM fallback: the manifest reports the binding.
      const mapping = JSON.parse(readFileSync(manifestPath, 'utf8') as string) as Record<string, string>;
      expect(mapping[rid]).toBe(sid);
    } else {
      // Symlink path: the rid must be in `created` or `skipped`.
      expect(result.created.includes(rid) || result.skipped.includes(rid)).toBe(true);
    }
  });

  test('regenerateChangeLinks binds multiple per-change-id rids (active + retrospective)', () => {
    const sid = '2026-06-06-session-aaaaaa';
    bindCanonicalSession(projectRoot, sid);
    const activeRid = '001-2026-06-06-doctor-dist-version-check';
    const retroRid = '2026-06-04-solo-skill-slim-extract';
    mkdirSync(join(projectRoot, '.peaks', activeRid, 'rd', 'requests'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', activeRid, 'rd', 'requests', `${activeRid}.md`),
      '# active',
      'utf8'
    );
    mkdirSync(join(projectRoot, '.peaks', 'retrospective', retroRid, 'rd', 'requests'), { recursive: true });
    writeFileSync(
      join(projectRoot, '.peaks', 'retrospective', retroRid, 'rd', 'requests', `${retroRid}.md`),
      '# retro',
      'utf8'
    );

    const result = regenerateChangeLinks({ projectRoot });

    expect(result.mapping[activeRid]).toBe(sid);
    expect(result.mapping[retroRid]).toBe(sid);

    const resolvedActive = resolveChangeId(activeRid, projectRoot);
    const resolvedRetro = resolveChangeId(retroRid, projectRoot);
    expect(resolvedActive.sessionId).toBe(sid);
    expect(resolvedRetro.sessionId).toBe(sid);
  });
});
