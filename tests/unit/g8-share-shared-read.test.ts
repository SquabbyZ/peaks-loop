/**
 * G8.4 CLI — `peaks sub-agent share` + `peaks sub-agent shared-read` happy paths.
 *
 * These tests call the underlying `writeSharedEntry` + `readSharedChannel`
 * helpers directly (not the CLI surface, which is exercised by the
 * integration dogfood). The CLI handlers are thin wrappers around these
 * helpers and add JSON envelope formatting, so the helpers cover the
 * real logic.
 */
import { existsSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readSharedChannel, writeSharedEntry } from '../../src/services/context/shared-channel.js';

let root: string;
const SID = '2026-06-06-session-5b1095';
const RID = '003-2026-06-07';
const BATCH = 'batch-test-001';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-g8-cli-'));
  mkdirSync(join(root, '.peaks', '_sub_agents', SID, 'shared'), { recursive: true });
});

afterEach(() => {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe('G8 share -> shared-read roundtrip', () => {
  it('rd writes a completion entry; qa reads it', () => {
    const wr = writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'rd.completed',
      from: 'rd',
      value: { summary: 'wrote tech-doc', size: 1234 }
    });
    expect(wr.ok).toBe(true);

    const ch = readSharedChannel({ projectRoot: root, sid: SID, rid: RID, batchId: BATCH });
    expect(Object.keys(ch.entries)).toContain('rd.completed');
    expect(ch.entries['rd.completed']?.from).toBe('rd');
    expect(ch.entries['rd.completed']?.value).toEqual({ summary: 'wrote tech-doc', size: 1234 });
  });

  it('multiple sub-agents write to the same batch; shared-read sees all', () => {
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'rd.completed',
      from: 'rd',
      value: { v: 'r' }
    });
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'qa-business.completed',
      from: 'qa-business',
      value: { v: 'q1' }
    });
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'qa-perf.completed',
      from: 'qa-perf',
      value: { v: 'q2' }
    });
    const ch = readSharedChannel({ projectRoot: root, sid: SID, rid: RID, batchId: BATCH });
    expect(Object.keys(ch.entries).sort()).toEqual([
      'qa-business.completed',
      'qa-perf.completed',
      'rd.completed'
    ]);
  });

  it('--key pattern filters in shared-read', () => {
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'rd.completed',
      from: 'rd',
      value: { v: 'r' }
    });
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'qa.completed',
      from: 'qa',
      value: { v: 'q' }
    });
    const ch = readSharedChannel({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      keyPattern: 'rd.*'
    });
    expect(Object.keys(ch.entries)).toEqual(['rd.completed']);
  });
});

describe('G8 last-write-wins', () => {
  it('second share with same key overwrites; shared-read sees the new value', () => {
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'rd.partial',
      from: 'rd',
      value: { progress: 50 }
    });
    const r2 = writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'rd.partial',
      from: 'rd',
      value: { progress: 100 }
    });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.lastWriteWins).toBe(true);
    }
    const ch = readSharedChannel({ projectRoot: root, sid: SID, rid: RID, batchId: BATCH });
    expect(ch.entries['rd.partial']?.value).toEqual({ progress: 100 });
  });
});

describe('G8 --since filter', () => {
  it('shared-read with --since future returns empty', () => {
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      key: 'k1',
      from: 'rd',
      value: { v: 1 }
    });
    const future = new Date(Date.now() + 60_000).toISOString();
    const ch = readSharedChannel({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: BATCH,
      since: future
    });
    expect(ch.entries).toEqual({});
  });
});

describe('G8 cross-batch isolation (RL-26)', () => {
  it('batchA entries do not appear in batchB', () => {
    writeSharedEntry({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: 'batchA',
      key: 'rd.completed',
      from: 'rd',
      value: { v: 'a' }
    });
    const chB = readSharedChannel({
      projectRoot: root,
      sid: SID,
      rid: RID,
      batchId: 'batchB'
    });
    expect(chB.entries).toEqual({});
  });
});
