/**
 * rid-011 — peaks changeset check integration tests (Phase 4 slice 2).
 *
 * Covers AC-1, AC-3 (canary blocked), AC-7 (hotfix blocked) via in-process
 * CLI invocation through `runCli`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { runCli } from './_cli-helper.js';

interface CliJsonResult {
  ok: boolean;
  command: string;
  data: unknown;
}

function parseCliJson(stdout: string): CliJsonResult {
  return JSON.parse(stdout.trim()) as CliJsonResult;
}

function makeProjectRoot(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-changeset-int-'));
}

function writeChangesetStaged(projectRoot: string, files: string[]): void {
  mkdirSync(join(projectRoot, '.changeset'), { recursive: true });
  writeFileSync(join(projectRoot, '.changeset', 'config.json'), '{}');
  writeFileSync(join(projectRoot, '.changeset', 'README.md'), '# readme');
  for (const f of files) {
    writeFileSync(join(projectRoot, '.changeset', f), `---\n---\n`);
  }
}

describe('peaks changeset check — integration', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeProjectRoot();
  });
  afterEach(() => {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  });

  // AC-1: clean .changeset/ (only config + README) → exit 0, ok: true.
  it('AC-1 — clean changeset dir exits 0', async () => {
    mkdirSync(join(tmp, '.changeset'), { recursive: true });
    writeFileSync(join(tmp, '.changeset', 'config.json'), '{}');
    writeFileSync(join(tmp, '.changeset', 'README.md'), '# readme');
    const r = await runCli(['changeset', 'check', '--project', tmp, '--json'], tmp);
    expect(r.code).toBe(0);
    const json = parseCliJson(r.stdout);
    expect(json.command).toBe('changeset.check');
    expect(json.ok).toBe(true);
  });

  // AC-1: staged .changeset/foo.md → exit 1, ok: false, CHANGESET_BLOCKED.
  it('AC-1 — staged foo.md exits 1 with CHANGESET_BLOCKED', async () => {
    writeChangesetStaged(tmp, ['foo.md']);
    const r = await runCli(['changeset', 'check', '--project', tmp, '--json'], tmp);
    expect(r.code).toBe(1);
    const json = parseCliJson(r.stdout);
    expect(json.command).toBe('changeset.check');
    expect(json.ok).toBe(false);
    expect(json.data).toMatchObject({ stagedFiles: ['foo.md'], state: 'staged-present' });
  });

  // AC-1: missing .changeset/ → exit 0, dir-missing.
  it('AC-1 — missing .changeset/ exits 0 with dir-missing state', async () => {
    const r = await runCli(['changeset', 'check', '--project', tmp, '--json'], tmp);
    expect(r.code).toBe(0);
    const json = parseCliJson(r.stdout);
    expect(json.ok).toBe(true);
    expect(json.data).toMatchObject({ state: 'dir-missing', stagedFiles: [] });
  });

  // AC-1: multiple unsorted files → sorted stagedFiles array.
  it('AC-1 — multiple staged files return sorted', async () => {
    writeChangesetStaged(tmp, ['zeta.md', 'alpha.md', 'middle.md']);
    const r = await runCli(['changeset', 'check', '--project', tmp, '--json'], tmp);
    expect(r.code).toBe(1);
    const json = parseCliJson(r.stdout);
    expect(json.data).toMatchObject({
      stagedFiles: ['alpha.md', 'middle.md', 'zeta.md'],
      state: 'staged-present'
    });
  });

  // AC-7: hotfix blocked fixture — pending file → CHANGESET_BLOCKED.
  it('AC-7 — hotfix with staged changesets exits 1 with CHANGESET_BLOCKED', async () => {
    writeChangesetStaged(tmp, ['pending-change.md']);
    const r = await runCli(
      ['release', 'hotfix', '4.0.0-beta.99', '--project', tmp, '--json'],
      tmp
    );
    expect(r.code).toBe(1);
    const json = parseCliJson(r.stdout);
    expect(json.command).toBe('release.hotfix');
    // The fail envelope carries the CHANGESET_BLOCKED code.
    expect(r.stdout).toContain('CHANGESET_BLOCKED');
    expect(r.stdout).toContain('pending-change.md');
  });

  // AC-3 / AC-9: changset namespace exists with only `check` child.
  it('peaks changeset namespace has only `check` subcommand (no skip flag)', async () => {
    const r = await runCli(['changeset', '--help'], tmp);
    expect(r.code).toBe(0);
    // Help output lists subcommands; verify no --skip-changeset-check.
    expect(r.stdout).not.toContain('--skip-changeset-check');
    expect(r.stdout).toContain('check');
  });
});