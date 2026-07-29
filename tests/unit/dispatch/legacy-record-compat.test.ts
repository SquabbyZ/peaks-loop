/**
 * Slice 2026-07-29-dispatch-stall-governance / S1 — legacy record compat
 * (AC-1.4 / PB-2).
 *
 * Pins that a record written in the pre-slice shape still parses, and
 * that the *fallback* for an unparseable status is now `unreadable`
 * (a distinct, terminal label) rather than silently `no-execution`
 * (which now means "dispatched, never executed").
 */
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isDispatchStatus,
  readRecord,
  writeInitialDispatchRecord
} from '../../../src/services/dispatch/dispatch-record-writer.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-legacy-record-'));
});

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe('legacy record compat (PB-2 / AC-1.4)', () => {
  it('upgrades a record with the pre-slice status field intact', () => {
    const { path } = writeInitialDispatchRecord({
      projectRoot: root,
      sessionId: 'sess-legacy-1',
      requestId: 'rid-legacy-1',
      role: 'rd',
      prompt: 'p',
      toolCall: { name: 'Task', args: {} },
      batchId: 'b-legacy-1'
    });
    // Read, then rewrite the record with the pre-slice status field
    // (`no-execution` as the legacy silent default).
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    raw.status = 'no-execution';
    require('node:fs').writeFileSync(path, JSON.stringify(raw), 'utf8');
    const upgraded = readRecord(path);
    // Pre-slice `no-execution` is a known member of the union, so it
    // survives untouched.
    expect(upgraded.status).toBe('no-execution');
  });

  it('falls back to `unreadable` when the status field is missing', () => {
    const { path } = writeInitialDispatchRecord({
      projectRoot: root,
      sessionId: 'sess-legacy-2',
      requestId: 'rid-legacy-2',
      role: 'rd',
      prompt: 'p',
      toolCall: { name: 'Task', args: {} },
      batchId: 'b-legacy-2'
    });
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    delete raw.status;
    require('node:fs').writeFileSync(path, JSON.stringify(raw), 'utf8');
    const upgraded = readRecord(path);
    expect(upgraded.status).toBe('unreadable');
  });

  it('falls back to `unreadable` when the status field is an unrecognized string', () => {
    const { path } = writeInitialDispatchRecord({
      projectRoot: root,
      sessionId: 'sess-legacy-3',
      requestId: 'rid-legacy-3',
      role: 'rd',
      prompt: 'p',
      toolCall: { name: 'Task', args: {} },
      batchId: 'b-legacy-3'
    });
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
    raw.status = 'something-from-a-future-build';
    require('node:fs').writeFileSync(path, JSON.stringify(raw), 'utf8');
    const upgraded = readRecord(path);
    expect(upgraded.status).toBe('unreadable');
  });
});

describe('isDispatchStatus — accepts the new S1 members', () => {
  it('accepts `never-started` and `unreadable`', () => {
    expect(isDispatchStatus('never-started')).toBe(true);
    expect(isDispatchStatus('unreadable')).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isDispatchStatus('bogus-state')).toBe(false);
    expect(isDispatchStatus(null)).toBe(false);
    expect(isDispatchStatus(undefined)).toBe(false);
  });
});