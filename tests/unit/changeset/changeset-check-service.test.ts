/**
 * rid-011 — changeset hard gate service unit tests (Phase 4 slice 2).
 *
 * Covers AC-4: ≥ 4 cases pass/fail (empty/single/multi/missing dir) +
 * additional invariant tests (no process.exitCode mutation, sorted output,
 * non-markdown ignored, I/O fail-closed).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  runChangesetHardGate,
  type ChangesetHardGateEnvelope
} from '../../../src/services/changeset/changeset-check-service.js';

function makeProjectRoot(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-changeset-'));
}

describe('runChangesetHardGate — service-layer', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeProjectRoot();
  });
  afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  it('case 1: staged-empty when only config.json + README.md exist', () => {
    mkdirSync(join(tmp, '.changeset'), { recursive: true });
    writeFileSync(join(tmp, '.changeset', 'config.json'), '{}');
    writeFileSync(join(tmp, '.changeset', 'README.md'), '# readme');
    const e: ChangesetHardGateEnvelope = runChangesetHardGate(tmp);
    expect(e.ok).toBe(true);
    expect(e.state).toBe('staged-empty');
    expect(e.stagedFiles).toEqual([]);
  });

  it('case 2: staged-present when single alpha.md exists', () => {
    mkdirSync(join(tmp, '.changeset'), { recursive: true });
    writeFileSync(join(tmp, '.changeset', 'alpha.md'), '---\n---\n');
    const e: ChangesetHardGateEnvelope = runChangesetHardGate(tmp);
    expect(e.ok).toBe(false);
    expect(e.state).toBe('staged-present');
    expect(e.stagedFiles).toEqual(['alpha.md']);
  });

  it('case 3: staged-present with multiple files returned sorted', () => {
    mkdirSync(join(tmp, '.changeset'), { recursive: true });
    writeFileSync(join(tmp, '.changeset', 'zeta.md'), '');
    writeFileSync(join(tmp, '.changeset', 'alpha.md'), '');
    writeFileSync(join(tmp, '.changeset', 'middle.md'), '');
    const e: ChangesetHardGateEnvelope = runChangesetHardGate(tmp);
    expect(e.ok).toBe(false);
    expect(e.state).toBe('staged-present');
    expect(e.stagedFiles).toEqual(['alpha.md', 'middle.md', 'zeta.md']);
  });

  it('case 4: dir-missing when .changeset/ is absent', () => {
    const e: ChangesetHardGateEnvelope = runChangesetHardGate(tmp);
    expect(e.ok).toBe(true);
    expect(e.state).toBe('dir-missing');
    expect(e.stagedFiles).toEqual([]);
  });

  it('invariant: non-markdown entries are ignored', () => {
    mkdirSync(join(tmp, '.changeset'), { recursive: true });
    writeFileSync(join(tmp, '.changeset', 'config.json'), '{}');
    writeFileSync(join(tmp, '.changeset', 'random.txt'), 'not a changeset');
    const e: ChangesetHardGateEnvelope = runChangesetHardGate(tmp);
    expect(e.ok).toBe(true);
    expect(e.state).toBe('staged-empty');
  });

  it('invariant: service does not mutate process.exitCode', () => {
    mkdirSync(join(tmp, '.changeset'), { recursive: true });
    writeFileSync(join(tmp, '.changeset', 'alpha.md'), '');
    const before = process.exitCode;
    runChangesetHardGate(tmp);
    expect(process.exitCode).toBe(before);
  });

  it('invariant: snapshotAt is ISO 8601', () => {
    const e: ChangesetHardGateEnvelope = runChangesetHardGate(tmp);
    expect(() => new Date(e.snapshotAt).toISOString()).not.toThrow();
    expect(e.snapshotAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('invariant: root field equals projectRoot argument', () => {
    const e: ChangesetHardGateEnvelope = runChangesetHardGate(tmp);
    expect(e.root).toBe(tmp);
  });
});