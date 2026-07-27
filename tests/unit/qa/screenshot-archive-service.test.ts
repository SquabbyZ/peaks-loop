/**
 * rid-012 (2026-07-27) — screenshot archive service unit tests.
 *
 * Covers peaks-qa SKILL.md "Hard contracts for browser validation"
 * Contract 1 enforcement: stray .png / .jpg / .jpeg files in the
 * project root (or a specified --source dir) are moved to
 * `.peaks/_runtime/<sessionId>/qa/screenshots/`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { archiveScreenshots } from '../../../src/services/qa/screenshot-archive-service.js';

function makeProjectRoot(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-screenshot-archive-'));
}

describe('archiveScreenshots — peak-qa Contract 1 enforcement', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeProjectRoot();
  });
  afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it('moves stray project-root .png to screenshots/ dir', () => {
    writeFileSync(join(tmp, 'login-page.png'), 'fake-png');
    const target = join(tmp, 'screenshots');
    const env = archiveScreenshots({ sourceDir: tmp, targetDir: target });
    expect(env.moved).toHaveLength(1);
    expect(env.moved[0]!.from).toBe(join(tmp, 'login-page.png'));
    expect(env.moved[0]!.to).toBe(join(target, 'login-page.png'));
    expect(existsSync(join(target, 'login-page.png'))).toBe(true);
    expect(existsSync(join(tmp, 'login-page.png'))).toBe(false);
  });

  it('moves .jpg and .jpeg in addition to .png', () => {
    writeFileSync(join(tmp, 'a.png'), 'a');
    writeFileSync(join(tmp, 'b.jpg'), 'b');
    writeFileSync(join(tmp, 'c.jpeg'), 'c');
    const target = join(tmp, 'screenshots');
    const env = archiveScreenshots({ sourceDir: tmp, targetDir: target });
    expect(env.moved).toHaveLength(3);
    expect(env.moved.map((m) => m.to.split(/[\\/]/).pop()).sort()).toEqual(['a.png', 'b.jpg', 'c.jpeg']);
  });

  it('auto-creates the target directory when missing', () => {
    writeFileSync(join(tmp, 'page.png'), 'fake');
    const target = join(tmp, 'deep', 'nested', 'screenshots');
    expect(existsSync(target)).toBe(false);
    const env = archiveScreenshots({ sourceDir: tmp, targetDir: target });
    expect(env.moved).toHaveLength(1);
    expect(existsSync(target)).toBe(true);
  });

  it('handles filename collision with ISO-timestamp suffix', () => {
    writeFileSync(join(tmp, 'dup.png'), 'first');
    const target = join(tmp, 'screenshots');
    archiveScreenshots({ sourceDir: tmp, targetDir: target, now: new Date('2026-07-27T00:00:00.000Z') });
    writeFileSync(join(tmp, 'dup.png'), 'second');
    const env = archiveScreenshots({ sourceDir: tmp, targetDir: target, now: new Date('2026-07-27T00:00:00.000Z') });
    expect(env.moved).toHaveLength(1);
    expect(env.moved[0]!.to).toBe(join(target, 'dup-2026-07-27T00-00-00-000Z.png'));
  });

  it('skips .peaks/ + node_modules/ subdirs when recursing 1 level', () => {
    mkdirSync(join(tmp, '.peaks', 'nested'), { recursive: true });
    writeFileSync(join(tmp, '.peaks', 'nested', 'inside.png'), 'x');
    mkdirSync(join(tmp, 'node_modules', 'pkg'), { recursive: true });
    writeFileSync(join(tmp, 'node_modules', 'pkg', 'inside.png'), 'x');
    writeFileSync(join(tmp, 'root.png'), 'r');
    mkdirSync(join(tmp, 'subdir'), { recursive: true });
    writeFileSync(join(tmp, 'subdir', 'nested.png'), 'n');
    const target = join(tmp, 'screenshots');
    const env = archiveScreenshots({ sourceDir: tmp, targetDir: target });
    expect(env.moved).toHaveLength(2);
    const movedNames = env.moved.map((m) => m.from.split(/[\\/]/).pop()).sort();
    expect(movedNames).toEqual(['nested.png', 'root.png']);
  });

  it('returns empty moved list when no stray screenshots exist', () => {
    writeFileSync(join(tmp, 'README.md'), 'no screenshot');
    const target = join(tmp, 'screenshots');
    const env = archiveScreenshots({ sourceDir: tmp, targetDir: target });
    expect(env.moved).toHaveLength(0);
    expect(env.skipped).toHaveLength(0);
    expect(env.archivedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('skips source-dir-not-found with reason instead of throwing', () => {
    const ghostSource = join(tmp, 'does-not-exist');
    const target = join(tmp, 'screenshots');
    const env = archiveScreenshots({ sourceDir: ghostSource, targetDir: target });
    expect(env.moved).toHaveLength(0);
    expect(env.skipped).toHaveLength(1);
    expect(env.skipped[0]!.reason).toBe('source dir not found');
  });

  it('after archive: targetContentsAfter contains all moved files', () => {
    writeFileSync(join(tmp, 'a.png'), 'a');
    writeFileSync(join(tmp, 'b.png'), 'b');
    const target = join(tmp, 'screenshots');
    const env = archiveScreenshots({ sourceDir: tmp, targetDir: target });
    expect([...env.targetContentsAfter].sort()).toEqual(['a.png', 'b.png']);
    expect([...readdirSync(target)].sort()).toEqual(['a.png', 'b.png']);
  });
});