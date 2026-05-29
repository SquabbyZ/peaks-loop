import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import {
  buildStatusLineModel,
  parseStatusLineStdin
} from '../../src/services/skills/skill-statusline-service.js';

function createTempDir(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-statusline-svc-'));
}

function writePeaksDir(root: string): void {
  mkdirSync(join(root, '.peaks'), { recursive: true });
}

function writePresence(root: string, data: object): void {
  writePeaksDir(root);
  writeFileSync(join(root, '.peaks', '.active-skill.json'), JSON.stringify(data), 'utf8');
}

function writeGitDir(root: string): void {
  mkdirSync(join(root, '.git'), { recursive: true });
}

describe('parseStatusLineStdin', () => {
  test('extracts cwd from workspace.current_dir', () => {
    const result = parseStatusLineStdin(JSON.stringify({ workspace: { current_dir: '/my/project' } }));
    expect(result?.workspace?.current_dir).toBe('/my/project');
  });

  test('returns null for empty string', () => {
    expect(parseStatusLineStdin('')).toBeNull();
  });

  test('returns null for invalid JSON', () => {
    expect(parseStatusLineStdin('not json')).toBeNull();
  });

  test('returns null for non-object JSON', () => {
    expect(parseStatusLineStdin('"string"')).toBeNull();
  });
});

describe('buildStatusLineModel', () => {
  test('returns idle when no presence file exists', () => {
    const root = createTempDir();
    try {
      writePeaksDir(root);
      writeGitDir(root);
      const model = buildStatusLineModel({ workspace: { current_dir: root } }, Date.now());
      expect(model.state).toBe('idle');
      expect(model.presence).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns active when presence file is fresh', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      writePresence(root, { skill: 'peaks-rd', mode: 'strict', gate: 'startup', setAt: new Date().toISOString() });
      const model = buildStatusLineModel({ workspace: { current_dir: root } }, Date.now());
      expect(model.state).toBe('active');
      expect(model.presence?.skill).toBe('peaks-rd');
      expect(model.presence?.mode).toBe('strict');
      expect(model.presence?.gate).toBe('startup');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns stale when presence is older than 24h', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      writePresence(root, { skill: 'peaks-qa', setAt: oldDate });
      const model = buildStatusLineModel({ workspace: { current_dir: root } }, Date.now());
      expect(model.state).toBe('stale');
      expect(model.ageMs).toBeGreaterThan(24 * 60 * 60 * 1000);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns invalid-presence for malformed presence file', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      writePeaksDir(root);
      writeFileSync(join(root, '.peaks', '.active-skill.json'), '{ "not-a-skill": true }', 'utf8');
      const model = buildStatusLineModel({ workspace: { current_dir: root } }, Date.now());
      expect(model.state).toBe('invalid-presence');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('CRITICAL: never deletes the presence file (read-only guarantee)', () => {
    const root = createTempDir();
    try {
      writeGitDir(root);
      const presenceData = { skill: 'peaks-solo', setAt: new Date().toISOString() };
      writePresence(root, presenceData);
      const presencePath = join(root, '.peaks', '.active-skill.json');

      // Call the renderer multiple times to ensure it never mutates the file
      buildStatusLineModel({ workspace: { current_dir: root } }, Date.now());
      buildStatusLineModel({ workspace: { current_dir: root } }, Date.now());
      buildStatusLineModel({ workspace: { current_dir: root } }, Date.now());

      // File must still exist with original content
      expect(existsSync(presencePath)).toBe(true);
      const content = JSON.parse(readFileSync(presencePath, 'utf8'));
      expect(content.skill).toBe(presenceData.skill);
      expect(content.setAt).toBe(presenceData.setAt);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('returns idle when no project root found (non-peaks dir)', () => {
    const root = createTempDir();
    try {
      // No .git, no .peaks — findProjectRoot returns null
      const model = buildStatusLineModel({ workspace: { current_dir: root } }, Date.now());
      expect(model.state).toBe('idle');
      expect(model.projectRoot).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('falls back to process.cwd() when stdin is null', () => {
    const root = createTempDir();
    try {
      writePeaksDir(root);
      writeGitDir(root);
      vi.spyOn(process, 'cwd').mockReturnValue(root);
      const model = buildStatusLineModel(null, Date.now());
      expect(model.projectRoot).toBe(root);
      vi.restoreAllMocks();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
