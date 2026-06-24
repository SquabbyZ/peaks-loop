/**
 * Slice 2026-06-23-request-init-change-scope-leak — change-scope-service
 * regression tests.
 *
 * Pins the contract for `ensureChangeScopeDir` (and its sibling helpers):
 *   - Idempotent: repeated calls produce exactly one dir.
 *   - Rejects unsafe changeIds (path traversal, slashes, empty, dots).
 *   - Lives under `.peaks/_runtime/change/<changeId>/` (not top-level).
 *
 * The CLI uses this helper to pre-create the change-id scope dir on
 * `peaks request init --apply` so the sub-agent prompt always has a
 * canonical scope to write to — never `.peaks/_runtime/<id>/` at top level
 * (hard ban from CLAUDE.md 2.8.3).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ensureChangeScopeDir,
  isSafeChangeScopeId,
  CHANGE_SCOPE_TOP_LEVEL_BANNED
} from '../../src/services/artifacts/change-scope-service.js';

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'peaks-change-scope-'));
});

afterEach(() => {
  if (existsSync(projectRoot)) {
    rmSync(projectRoot, { recursive: true, force: true });
  }
});

describe('isSafeChangeScopeId', () => {
  it('accepts a normal changeId', () => {
    expect(isSafeChangeScopeId('2026-06-23-indicator-derived-operator-formitem')).toBe(true);
  });
  it('accepts a session-style id', () => {
    expect(isSafeChangeScopeId('2026-06-23-session-8d14dd')).toBe(true);
  });
  it('accepts dotted ids', () => {
    expect(isSafeChangeScopeId('feat.foo-bar_001')).toBe(true);
  });
  it('rejects empty string', () => {
    expect(isSafeChangeScopeId('')).toBe(false);
  });
  it('rejects "." and ".."', () => {
    expect(isSafeChangeScopeId('.')).toBe(false);
    expect(isSafeChangeScopeId('..')).toBe(false);
  });
  it('rejects forward slashes (path injection)', () => {
    expect(isSafeChangeScopeId('a/b')).toBe(false);
  });
  it('rejects backslashes (path injection)', () => {
    expect(isSafeChangeScopeId('a\\b')).toBe(false);
  });
  it('rejects whitespace', () => {
    expect(isSafeChangeScopeId('foo bar')).toBe(false);
  });
});

describe('ensureChangeScopeDir', () => {
  it('creates .peaks/_runtime/change/<changeId>/ when it does not exist', () => {
    const changeId = '2026-06-23-test-scope';
    const result = ensureChangeScopeDir(projectRoot, changeId);
    expect(result.existedBefore).toBe(false);
    expect(result.path).toBe(join(projectRoot, '.peaks', '_runtime', 'change', changeId));
    expect(existsSync(result.path)).toBe(true);
  });

  it('is idempotent: re-running returns existedBefore=true and does not error', () => {
    const changeId = '2026-06-23-idempotent';
    const first = ensureChangeScopeDir(projectRoot, changeId);
    const second = ensureChangeScopeDir(projectRoot, changeId);
    expect(first.existedBefore).toBe(false);
    expect(second.existedBefore).toBe(true);
    expect(first.path).toBe(second.path);
    expect(existsSync(second.path)).toBe(true);
  });

  it('NEVER writes a top-level .peaks/_runtime/<changeId>/ dir (hard ban)', () => {
    const changeId = '2026-06-23-top-level-guard';
    ensureChangeScopeDir(projectRoot, changeId);
    // The forbidden top-level dir MUST NOT exist.
    const forbiddenTop = join(projectRoot, '.peaks', changeId);
    expect(existsSync(forbiddenTop)).toBe(false);
  });

  it('returns the same canonical path when the dir already exists with content', () => {
    const changeId = '2026-06-23-preexisting';
    const expectedPath = join(projectRoot, '.peaks', '_runtime', 'change', changeId);
    mkdirSync(expectedPath, { recursive: true });
    // Pretend an artifact was already written there.
    mkdirSync(join(expectedPath, 'rd'), { recursive: true });

    const result = ensureChangeScopeDir(projectRoot, changeId);
    expect(result.existedBefore).toBe(true);
    expect(result.path).toBe(expectedPath);
    // The pre-existing content is NOT clobbered.
    expect(existsSync(join(expectedPath, 'rd'))).toBe(true);
  });

  it('throws ChangeScopeIdValidationError on unsafe changeId', () => {
    expect(() => ensureChangeScopeDir(projectRoot, '../escape')).toThrow(/Invalid change-scope id/);
    expect(() => ensureChangeScopeDir(projectRoot, 'a/b')).toThrow(/Invalid change-scope id/);
    expect(() => ensureChangeScopeDir(projectRoot, '')).toThrow(/Invalid change-scope id/);
  });

  it('exports the hard-ban marker constant', () => {
    expect(CHANGE_SCOPE_TOP_LEVEL_BANNED).toBe(true);
  });
});
