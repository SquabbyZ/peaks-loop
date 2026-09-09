// tests/unit/doctor/l3-memory-health-drift.test.ts
//
// Unit tests for the upgraded L3 memory health check (slice
// 2026-09-09-memory-system-overhaul, slice D).
//
// The original check reported `ok: true` for "index.json is well-formed
// JSON" and never looked at coverage, orphans, or unclassified files.
// These tests pin the four findings, plus the back-compat guarantee that
// the original `L3:l3-memory-health` assertion is unchanged.
//
// Run with:
//   pnpm vitest run tests/unit/doctor/l3-memory-health-drift.test.ts

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { check } from '~/src/services/doctor/doctor-service/checks/l3-memory-health';
import type { DoctorCheck, DoctorContext } from '~/src/services/doctor/doctor-service/types';

let root: string;
let memoryDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-doctor-memory-'));
  memoryDir = join(root, '.peaks', 'memory');
  mkdirSync(memoryDir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function makeContext(resolvedL3Root: string): DoctorContext {
  return {
    options: {},
    registry: { skills: [], failures: [] },
    skills: [],
    schemaRoot: '',
    presence: null,
    workspaceInitialized: false,
    statusLineInstalled: false,
    platform: process.platform,
    resolvedL3Root,
    projectRootResolver: () => null,
    isValidSessionId: () => true,
    accumulatedChecks: []
  };
}

function run(): readonly DoctorCheck[] {
  return check.run(makeContext(root));
}

function byId(checks: readonly DoctorCheck[], id: string): DoctorCheck {
  const found = checks.find((entry) => entry.id === id);
  if (found === undefined) throw new Error(`missing check ${id}; got ${checks.map((c) => c.id).join(', ')}`);
  return found;
}

function writeMemory(fileName: string, type: string | null): void {
  const frontmatter = type === null
    ? '---\nname: x\ndescription: no kind here\n---\n'
    : `---\nname: x\ndescription: y\nmetadata:\n  type: ${type}\n---\n`;
  writeFileSync(join(memoryDir, fileName), `${frontmatter}\nBody text long enough to summarize.\n`, 'utf8');
}

function writeIndex(entries: Array<{ name: string; kind: string; sourcePath: string }>): void {
  const hot: Record<string, unknown[]> = {};
  for (const entry of entries) {
    (hot[entry.kind] ??= []).push({ ...entry, description: 'd', sourceArtifact: null, updatedAt: '2026-01-01' });
  }
  writeFileSync(join(memoryDir, 'index.json'), JSON.stringify({
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    hot,
    warm: {}
  }, null, 2), 'utf8');
}

describe('l3-memory-health (no index)', () => {
  it('passes when there is no index.json yet', () => {
    const checks = run();
    expect(checks).toHaveLength(1);
    expect(checks[0]!.id).toBe('L3:l3-memory-health');
    expect(checks[0]!.ok).toBe(true);
  });
});

describe('l3-memory-health (well-formed JSON back-compat)', () => {
  it('keeps the original id + message when the index is well formed', () => {
    writeMemory('a.md', 'rule');
    writeIndex([{ name: 'a', kind: 'rule', sourcePath: join(memoryDir, 'a.md') }]);

    const health = byId(run(), 'L3:l3-memory-health');
    expect(health.ok).toBe(true);
    expect(health.message).toContain('well-formed JSON');
    expect(health.message).toContain('1 hot + 0 warm');
  });

  it('still fails hard on malformed JSON', () => {
    writeFileSync(join(memoryDir, 'index.json'), '{ not json', 'utf8');
    const checks = run();
    expect(checks).toHaveLength(1);
    expect(checks[0]!.ok).toBe(false);
    expect(checks[0]!.message).toContain('not valid JSON');
  });

  it('still fails hard when the version marker is missing', () => {
    writeFileSync(join(memoryDir, 'index.json'), JSON.stringify({ hot: {}, warm: {} }), 'utf8');
    const checks = run();
    expect(checks).toHaveLength(1);
    expect(checks[0]!.ok).toBe(false);
    expect(checks[0]!.message).toContain('missing schema_version / version field');
  });
});

describe('l3-memory-health (drift findings)', () => {
  it('warns on a coverage gap beyond the threshold', () => {
    for (const name of ['a', 'b', 'c', 'd']) writeMemory(`${name}.md`, 'rule');
    writeIndex([{ name: 'a', kind: 'rule', sourcePath: join(memoryDir, 'a.md') }]);

    const coverage = byId(run(), 'L3:l3-memory-coverage');
    expect(coverage.ok).toBe(false);
    expect(coverage.severity).toBe('warning');
    expect(coverage.message).toContain('4 file(s) on disk vs 1 indexed');
  });

  it('does not warn when the gap is within the threshold', () => {
    writeMemory('a.md', 'rule');
    writeMemory('b.md', 'rule');
    writeIndex([{ name: 'a', kind: 'rule', sourcePath: join(memoryDir, 'a.md') }]);

    const coverage = byId(run(), 'L3:l3-memory-coverage');
    expect(coverage.ok).toBe(true);
    expect(coverage.severity).toBeUndefined();
  });

  it('reports an index entry whose sourcePath is gone as an error', () => {
    writeMemory('a.md', 'rule');
    writeIndex([
      { name: 'a', kind: 'rule', sourcePath: join(memoryDir, 'a.md') },
      { name: 'ghost', kind: 'rule', sourcePath: join(memoryDir, 'ghost.md') }
    ]);

    const orphans = byId(run(), 'L3:l3-memory-orphans');
    expect(orphans.ok).toBe(false);
    expect(orphans.severity).toBe('error');
    expect(orphans.message).toContain('ghost');
  });

  it('warns on files with no resolvable kind', () => {
    writeMemory('classified.md', 'rule');
    writeMemory('mystery.md', null);
    writeIndex([{ name: 'classified', kind: 'rule', sourcePath: join(memoryDir, 'classified.md') }]);

    const unclassified = byId(run(), 'L3:l3-memory-unclassified');
    expect(unclassified.ok).toBe(false);
    expect(unclassified.severity).toBe('warning');
    expect(unclassified.message).toContain('mystery');
  });

  it('passes the drift checks on a fully consistent memory dir', () => {
    writeMemory('a.md', 'rule');
    writeIndex([{ name: 'a', kind: 'rule', sourcePath: join(memoryDir, 'a.md') }]);

    const checks = run();
    expect(byId(checks, 'L3:l3-memory-coverage').ok).toBe(true);
    expect(byId(checks, 'L3:l3-memory-orphans').ok).toBe(true);
    expect(byId(checks, 'L3:l3-memory-unclassified').ok).toBe(true);
  });

  it('does not treat the generated MEMORY.md as a memory file', () => {
    writeMemory('a.md', 'rule');
    writeIndex([{ name: 'a', kind: 'rule', sourcePath: join(memoryDir, 'a.md') }]);
    writeFileSync(join(memoryDir, 'MEMORY.md'), '<!-- generated -->\n', 'utf8');

    const checks = run();
    expect(byId(checks, 'L3:l3-memory-coverage').ok).toBe(true);
    expect(byId(checks, 'L3:l3-memory-unclassified').ok).toBe(true);
  });
});
