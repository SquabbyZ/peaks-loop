import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { migrateRetrospectiveFromMd } from '../../../../src/services/retrospective/migrate-from-md.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `peaks-retro-mig-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

function seedLegacyDir(sliceId: string, body: string): void {
  const dir = join(tmpDir, '.peaks', 'retrospective', sliceId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'summary.md'), body);
}

function makeBody(overrides: { title?: string; type?: string; session?: string; rid?: string } = {}): string {
  const title = overrides.title ?? 'Test Entry';
  const session = overrides.session ?? '2026-06-04-session-89f7cb';
  const type = overrides.type ?? 'feature';
  const rid = overrides.rid ?? '001-2026-06-04-test';
  return [
    `# ${title}`,
    '',
    `- session: ${session}`,
    `- rid: ${rid}`,
    `- type: ${type}`,
    '',
    '## Goals',
    '',
    'First paragraph summary content.',
    '',
    '## Key Decisions',
    '',
    '- **Decision**: Use 4-tier heuristic',
    '- **Decision**: Idempotent re-run',
    '',
    '## Lessons Learned',
    '',
    '- Lesson one',
    '- Lesson two',
    ''
  ].join('\n');
}

describe('migrateRetrospectiveFromMd', () => {
  test('dry-run produces no index.json (safe default)', () => {
    seedLegacyDir('001-2026-06-04-test', makeBody());
    const result = migrateRetrospectiveFromMd({ projectRoot: tmpDir, apply: false });
    expect(result.parsedEntries).toBe(1);
    expect(existsSync(join(tmpDir, '.peaks', 'retrospective', 'index.json'))).toBe(false);
    expect(result.status).toBe('partial');
  });

  test('apply builds index.json, archives legacy dirs, deletes live dirs (TC-MIG-1 partial)', () => {
    seedLegacyDir('001-2026-06-04-test', makeBody());
    const result = migrateRetrospectiveFromMd({ projectRoot: tmpDir, apply: true, expectedEntries: 1 });
    if (result.status !== 'applied') {
      // Print debug so we can see why the migration failed.
      // eslint-disable-next-line no-console
      console.error('migration failed:', JSON.stringify(result, null, 2));
    }
    expect(result.status).toBe('applied');
    expect(result.parsedEntries).toBe(1);
    expect(result.archiveVerified).toBe(true);
    expect(existsSync(join(tmpDir, '.peaks', 'retrospective', 'index.json'))).toBe(true);
    expect(existsSync(join(tmpDir, '.peaks', 'retrospective', '001-2026-06-04-test'))).toBe(false);
    expect(existsSync(join(tmpDir, '.peaks', '_archive', 'retrospective-2026-06-09-pre-r3.tar.gz'))).toBe(true);
  });

  test('idempotency: re-run with index present and no legacy MDs is a no-op', () => {
    seedLegacyDir('001-2026-06-04-test', makeBody());
    const firstRun = migrateRetrospectiveFromMd({ projectRoot: tmpDir, apply: true, expectedEntries: 1 });
    expect(firstRun.status).toBe('applied');

    const secondRun = migrateRetrospectiveFromMd({ projectRoot: tmpDir, apply: true, expectedEntries: 1 });
    expect(secondRun.status).toBe('no-op');
    expect(secondRun.parsedEntries).toBe(1);
  });

  test('malformed MD (no # Title) skipped, archive gated (TC-MIG-2)', () => {
    seedLegacyDir('001-2026-06-04-good', makeBody());
    seedLegacyDir('002-2026-06-04-bad', 'just some text without title');
    const result = migrateRetrospectiveFromMd({ projectRoot: tmpDir, apply: true, expectedEntries: 2 });
    expect(result.status).toBe('partial');
    expect(result.failedEntries.length).toBeGreaterThan(0);
    // Archive should NOT be created when there are unparseable entries.
    expect(existsSync(join(tmpDir, '.peaks', '_archive'))).toBe(false);
  });

  test('missing legacy dir returns failed status', () => {
    const result = migrateRetrospectiveFromMd({ projectRoot: tmpDir, apply: true });
    expect(result.status).toBe('failed');
  });

  test('archive integrity: tar -tzf lists the original dir names (TC-MIG-3)', () => {
    seedLegacyDir('001-2026-06-04-test', makeBody());
    const result = migrateRetrospectiveFromMd({ projectRoot: tmpDir, apply: true, expectedEntries: 1 });
    expect(result.status).toBe('applied');
    // Use a relative path so the System32 tar.exe on Windows does not
    // choke on the `C:` drive letter.
    const tarResult = spawnSync('tar', ['-tzf', join('.peaks', '_archive', 'retrospective-2026-06-09-pre-r3.tar.gz')], { encoding: 'utf8', cwd: tmpDir });
    expect(tarResult.status).toBe(0);
    expect(tarResult.stdout).toContain('001-2026-06-04-test');
  });

  test('index.json is valid JSON with the expected entry shape', () => {
    seedLegacyDir('001-2026-06-04-test', makeBody());
    migrateRetrospectiveFromMd({ projectRoot: tmpDir, apply: true, expectedEntries: 1 });
    const raw = readFileSync(join(tmpDir, '.peaks', 'retrospective', 'index.json'), 'utf8');
    const parsed = JSON.parse(raw);
    expect(parsed.version).toBe(1);
    expect(parsed.entries).toHaveLength(1);
    const entry = parsed.entries[0];
    expect(entry.id).toBe('001-2026-06-04-test');
    expect(entry.sessionId).toBe('2026-06-04-session-89f7cb');
    expect(entry.type).toBe('feature');
    expect(entry.title).toBe('Test Entry');
    expect(entry.keyDecisions.length).toBeGreaterThan(0);
    expect(entry.lessonsLearned).toBe(2);
  });
});
