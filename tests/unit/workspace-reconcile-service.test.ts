import { existsSync, mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  applyDeletions,
  discoverSessions,
  findDeletionCandidates,
  migrateOldRuntimeState,
  migrateSubAgentState,
  pickCanonicalSession,
  reconcileWorkspace,
  repointSessionJson,
  syncChangeMarker
} from '../../src/services/workspace/reconcile-service.js';
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
 * Slice 006 invariant: after `reconcileWorkspace` runs, the
 * `change/<canonicalSid>/` live marker MUST exist as the SINGLE entry
 * under `.peaks/_runtime/change/`. The marker is an EMPTY directory
 * (no symlink, no manifest, no content).
 *
 * Pre-slice (F3) behaviour: the reconcile command wrote a per-change-id
 * symlink layer (or the EPERM `.peaks-link.json` manifest fallback).
 * Slice 006 collapses that to a single canonical live marker, removes
 * the per-change-id walker, and exposes a smaller `changeMarker` field
 * in the reconcile envelope.
 */
describe('canonical live marker (slice 006 — change/<sid>/ single live marker)', () => {
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

  test('reconcileWorkspace creates change/<sid>/ live marker and exposes changeMarker in the envelope', () => {
    const sid = '2026-06-06-session-7bcb6e';
    // Plant a real session dir on disk (discoverSessions needs a directory
    // matching the session-id pattern under `.peaks/_runtime/`).
    const sessionDir = join(projectRoot, '.peaks', '_runtime', sid);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(
      join(sessionDir, 'session.json'),
      JSON.stringify({ sessionId: sid, projectRoot, createdAt: new Date().toISOString() }),
      'utf8'
    );
    bindCanonicalSession(projectRoot, sid);
    writeActiveSkill(projectRoot, sid);

    const result = reconcileWorkspace({
      projectRoot,
      apply: false,
      olderThanMs: 7 * 24 * 60 * 60 * 1000
    });

    // The live marker exists at the canonical path.
    const markerPath = join(projectRoot, '.peaks', '_runtime', 'change', sid);
    expect(existsSync(markerPath)).toBe(true);
    // No .peaks-link.json manifest anywhere under change/.
    const manifestPath = join(projectRoot, '.peaks', '_runtime', 'change', '.peaks-link.json');
    expect(existsSync(manifestPath)).toBe(false);
    // The marker is an empty directory.
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    expect(readdirSync(markerPath)).toEqual([]);

    // The result envelope reports the new changeMarker shape.
    expect(result.changeMarker).toBeDefined();
    expect(result.changeMarker?.created).toBe(sid);
    expect(result.changeMarker?.removed).toEqual([]);
    expect(result.changeMarker?.error).toBeNull();
    // The legacy changeLinks field is gone.
    expect((result as { changeLinks?: unknown }).changeLinks).toBeUndefined();
  });
});

/**
 * Slice 006 — `syncChangeMarker` unit tests. The new function is the
 * ONLY entry point that writes under `.peaks/_runtime/change/`. It
 * maintains a single live marker (`.peaks/_runtime/change/<sid>/`)
 * and removes every other entry. No symlinks, no manifest, no
 * per-change-id walker.
 */
describe('syncChangeMarker (slice 006 — single live marker)', () => {
  beforeEach(() => { projectRoot = makeProject(); });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  test('on a clean tree (no change/ dir) creates change/<sid>/ and returns created=<sid>', () => {
    const sid = '2026-06-06-session-aaaaa1';
    const result = syncChangeMarker(projectRoot, sid);
    expect(result).toEqual({ removed: [], created: sid, error: null });
    const markerPath = join(projectRoot, '.peaks', '_runtime', 'change', sid);
    expect(existsSync(markerPath)).toBe(true);
  });

  test('when change/<sid>/ already exists: no-op, returns created=null', () => {
    const sid = '2026-06-06-session-aaaaa2';
    const first = syncChangeMarker(projectRoot, sid);
    expect(first.created).toBe(sid);
    const second = syncChangeMarker(projectRoot, sid);
    expect(second).toEqual({ removed: [], created: null, error: null });
  });

  test('when change/<old-sid>/ exists and canonical session changed: deletes old, creates new', () => {
    const oldSid = '2026-06-06-session-aaaaa3';
    const newSid = '2026-06-06-session-bbbbb3';
    syncChangeMarker(projectRoot, oldSid);
    const oldMarker = join(projectRoot, '.peaks', '_runtime', 'change', oldSid);
    expect(existsSync(oldMarker)).toBe(true);

    const result = syncChangeMarker(projectRoot, newSid);
    expect(result).toEqual({ removed: [oldSid], created: newSid, error: null });
    expect(existsSync(oldMarker)).toBe(false);
    const newMarker = join(projectRoot, '.peaks', '_runtime', 'change', newSid);
    expect(existsSync(newMarker)).toBe(true);
  });

  test('is idempotent: 3 calls with the same canonical sid produce exactly one change/<sid>/ and no .peaks-link.json', () => {
    const sid = '2026-06-06-session-aaaaa4';
    syncChangeMarker(projectRoot, sid);
    syncChangeMarker(projectRoot, sid);
    syncChangeMarker(projectRoot, sid);
    const changeDir = join(projectRoot, '.peaks', '_runtime', 'change');
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const entries = readdirSync(changeDir);
    expect(entries).toEqual([sid]);
    expect(existsSync(join(changeDir, '.peaks-link.json'))).toBe(false);
  });

  test('the change/<sid>/ marker is empty (no files, no symlinks, no manifest)', () => {
    const sid = '2026-06-06-session-aaaaa5';
    syncChangeMarker(projectRoot, sid);
    const markerPath = join(projectRoot, '.peaks', '_runtime', 'change', sid);
    const { readdirSync } = require('node:fs') as typeof import('node:fs');
    const entries = readdirSync(markerPath);
    expect(entries).toEqual([]);
  });
});

/**
 * Slice 006 — the reconcile step removes the legacy
 * `.peaks/_runtime/<sid>/system/` subdir introduced in F3. The cleanup
 * is idempotent: re-running on a tree without the subdir is a no-op.
 */
describe('reconcileWorkspace (slice 006 — system/ subdir cleanup)', () => {
  beforeEach(() => { projectRoot = makeProject(); });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  test('removes .peaks/_runtime/<canonicalSid>/system/ if it exists', () => {
    const sid = '2026-06-06-session-aaa001';
    // Plant a canonical session and a leftover system/ subdir.
    const sessionDir = join(projectRoot, '.peaks', '_runtime', sid);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session.json'), JSON.stringify({ sessionId: sid, projectRoot, createdAt: new Date().toISOString() }), 'utf8');
    mkdirSync(join(sessionDir, 'system'), { recursive: true });
    writeFileSync(join(sessionDir, 'system', 'note.txt'), 'leftover', 'utf8');
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

    expect(existsSync(join(sessionDir, 'system'))).toBe(false);
    // The session dir still exists; only the system/ subdir was removed.
    expect(existsSync(sessionDir)).toBe(true);
    expect(result.canonicalSessionId).toBe(sid);
  });

  test('is a no-op when .peaks/_runtime/<canonicalSid>/system/ does not exist', () => {
    const sid = '2026-06-06-session-aaa002';
    const sessionDir = join(projectRoot, '.peaks', '_runtime', sid);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session.json'), JSON.stringify({ sessionId: sid, projectRoot, createdAt: new Date().toISOString() }), 'utf8');
    writeFileSync(
      join(projectRoot, '.peaks', '_runtime', 'session.json'),
      JSON.stringify({ sessionId: sid, projectRoot, createdAt: new Date().toISOString() }),
      'utf8'
    );
    writeActiveSkill(projectRoot, sid);

    // Should not throw and should not change the tree.
    const result = reconcileWorkspace({
      projectRoot,
      apply: false,
      olderThanMs: 7 * 24 * 60 * 60 * 1000
    });
    expect(result.canonicalSessionId).toBe(sid);
    expect(existsSync(sessionDir)).toBe(true);
  });
});

/**
 * Slice 2026-06-06-sub-agent-spawn-bug-and-decouple — sub-agent state
 * migration. The two legacy files at `.peaks/<sid>/system/{subagent-
 * progress,progress-spawn}.json` are moved to `.peaks/_sub_agents/<sid>/`
 * on the first `reconcileWorkspace` run. The empty `<sid>/system/` dir
 * is removed (R-2 guard) only when it has zero remaining files.
 */
describe('migrateSubAgentState (slice 2026-06-06-sub-agent-spawn-bug-and-decouple)', () => {
  beforeEach(() => { projectRoot = makeProject(); });
  afterEach(() => { rmSync(projectRoot, { recursive: true, force: true }); });

  test('moves both legacy sub-agent state files into .peaks/_sub_agents/<sid>/', () => {
    // SESSION_ID_PATTERN requires `[a-f0-9]+` after `session-`, so the
    // test sid must use a hex-like suffix.
    const sid = '2026-06-06-session-aa0001';
    const sessionDir = join(projectRoot, '.peaks', sid);
    mkdirSync(join(sessionDir, 'system'), { recursive: true });
    writeFileSync(join(sessionDir, 'system', 'subagent-progress.json'), '{"version":1}', 'utf8');
    writeFileSync(join(sessionDir, 'system', 'progress-spawn.json'), '{"version":1,"pid":1}', 'utf8');

    const result = migrateSubAgentState(projectRoot);

    expect(result.errors).toEqual([]);
    expect(result.migratedFiles).toEqual([
      join('.peaks', sid, 'system', 'subagent-progress.json'),
      join('.peaks', sid, 'system', 'progress-spawn.json')
    ]);
    // New path is populated; old path is gone.
    expect(existsSync(join(projectRoot, '.peaks', '_sub_agents', sid, 'subagent-progress.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.peaks', '_sub_agents', sid, 'progress-spawn.json'))).toBe(true);
    expect(existsSync(join(sessionDir, 'system', 'subagent-progress.json'))).toBe(false);
    expect(existsSync(join(sessionDir, 'system', 'progress-spawn.json'))).toBe(false);
    // The now-empty system/ dir is removed (R-2 guard: nothing else in it).
    expect(existsSync(join(sessionDir, 'system'))).toBe(false);
  });

  test('is idempotent: a second call returns migratedFiles: []', () => {
    const sid = '2026-06-06-session-aa0002';
    const sessionDir = join(projectRoot, '.peaks', sid);
    mkdirSync(join(sessionDir, 'system'), { recursive: true });
    writeFileSync(join(sessionDir, 'system', 'subagent-progress.json'), '{}', 'utf8');
    writeFileSync(join(sessionDir, 'system', 'progress-spawn.json'), '{}', 'utf8');

    const first = migrateSubAgentState(projectRoot);
    expect(first.migratedFiles).toHaveLength(2);

    const second = migrateSubAgentState(projectRoot);
    expect(second.migratedFiles).toEqual([]);
    expect(second.errors).toEqual([]);
  });

  test('does NOT remove the legacy system/ dir when it has other files (R-2 guard)', () => {
    const sid = '2026-06-06-session-aa0003';
    const sessionDir = join(projectRoot, '.peaks', sid);
    mkdirSync(join(sessionDir, 'system'), { recursive: true });
    writeFileSync(join(sessionDir, 'system', 'subagent-progress.json'), '{}', 'utf8');
    writeFileSync(join(sessionDir, 'system', 'progress-spawn.json'), '{}', 'utf8');
    // Unrelated user content in the same dir — must not be deleted.
    writeFileSync(join(sessionDir, 'system', 'user-note.txt'), 'keep me', 'utf8');

    migrateSubAgentState(projectRoot);

    // The sub-agent files moved, but the system/ dir and the user note remain.
    expect(existsSync(join(projectRoot, '.peaks', '_sub_agents', sid, 'subagent-progress.json'))).toBe(true);
    expect(existsSync(join(projectRoot, '.peaks', '_sub_agents', sid, 'progress-spawn.json'))).toBe(true);
    expect(existsSync(join(sessionDir, 'system'))).toBe(true);
    expect(existsSync(join(sessionDir, 'system', 'user-note.txt'))).toBe(true);
  });

  test('reconcileWorkspace exposes subAgentStateMigrated: 2 after a run on a temp fixture', () => {
    const sid = '2026-06-06-session-aa0004';
    const sessionDir = join(projectRoot, '.peaks', sid);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, 'session.json'), JSON.stringify({ sessionId: sid, projectRoot, createdAt: new Date().toISOString() }), 'utf8');
    mkdirSync(join(sessionDir, 'system'), { recursive: true });
    writeFileSync(join(sessionDir, 'system', 'subagent-progress.json'), '{}', 'utf8');
    writeFileSync(join(sessionDir, 'system', 'progress-spawn.json'), '{}', 'utf8');

    const result = reconcileWorkspace({
      projectRoot,
      apply: false,
      olderThanMs: 7 * 24 * 60 * 60 * 1000
    });

    // Both files migrated → subAgentStateMigrated reflects the count.
    expect(result.subAgentStateMigrated).toBe(2);
    // Idempotent re-run: no further migrations.
    const second = reconcileWorkspace({
      projectRoot,
      apply: false,
      olderThanMs: 7 * 24 * 60 * 60 * 1000
    });
    expect(second.subAgentStateMigrated).toBe(0);
  });
});
