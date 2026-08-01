import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { runMergeBack } from '~/src/services/dispatch/merge-back-runner';
import { runE2EVerify } from '~/src/cli/commands/e2e-verify';

function setupRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-mrg-'));
  execSync('git init -b main', { cwd: root });
  execSync('git config user.email t@e', { cwd: root });
  execSync('git config user.name T', { cwd: root });
  writeFileSync(join(root, 'a.txt'), 'base\n');
  execSync('git add a.txt && git commit -m base', { cwd: root });
  return root;
}

describe('runMergeBack', () => {
  it('fast-forwards when agent and caller share a linear history', async () => {
    const root = setupRepo();
    execSync('git checkout -b feat/x', { cwd: root });
    writeFileSync(join(root, 'a.txt'), 'base\nfeat\n');
    execSync('git commit -am feat', { cwd: root });
    const result = await runMergeBack({
      projectRoot: root, sessionId: 's1', dispatchId: 'd1',
      callerBranch: 'main', agentBranch: 'feat/x',
      onConflict: async () => ({ ok: true }),
    });
    expect(result.kind).toBe('merged');
    expect(execSync('git rev-parse --abbrev-ref HEAD', { cwd: root }).toString().trim()).toBe('main');
  });
});

describe('runE2EVerify', () => {
  it('returns no-fixtures when qa/e2e is empty', async () => {
    const root = setupRepo();
    const result = await runE2EVerify({ projectRoot: root, slice: 'rid-test' });
    expect(result.outcome).toBe('no-fixtures');
  });

  it('falls back to deterministic stub when PEAKS_PLAYWRIGHT_* env vars are unset (CI smoke)', async () => {
    // 2026-08-01-bundle archive (Task 3): the real Playwright runner
    // must NEVER silently mask a CI host without Chromium. When the env
    // vars are unset the runner MUST degrade to the deterministic stub
    // and surface runner: 'stub' so CI smoke stays green.
    const prevUserData = process.env.PEAKS_PLAYWRIGHT_USER_DATA_DIR;
    const prevProfile = process.env.PEAKS_PLAYWRIGHT_PROFILE_NAME;
    delete process.env.PEAKS_PLAYWRIGHT_USER_DATA_DIR;
    delete process.env.PEAKS_PLAYWRIGHT_PROFILE_NAME;
    try {
      const root = setupRepo();
      const dir = join(root, 'qa', 'e2e', 'rid-stub', 'login');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'happy.md'), [
        '# Login',
        'url: http://localhost:3000/login',
        'matchers:',
        '  - "Welcome"',
      ].join('\n'));
      const result = await runE2EVerify({ projectRoot: root, slice: 'rid-stub' });
      expect(result.outcome).toBe('pass');
      expect(result.passCount).toBe(1);
      expect(result.failCount).toBe(0);
      expect(result.runner).toBe('stub');
    } finally {
      if (prevUserData !== undefined) process.env.PEAKS_PLAYWRIGHT_USER_DATA_DIR = prevUserData;
      if (prevProfile !== undefined) process.env.PEAKS_PLAYWRIGHT_PROFILE_NAME = prevProfile;
    }
  });
});

describe('full pipeline smoke (spawn → merge → e2e)', () => {
  it('runs through end-to-end with no fixtures', async () => {
    const root = setupRepo();
    execSync('git checkout -b feat/y', { cwd: root });
    writeFileSync(join(root, 'b.txt'), 'y');
    execSync('git add b.txt && git commit -m y', { cwd: root });
    const result = await runMergeBack({
      projectRoot: root, sessionId: 's2', dispatchId: 'd2',
      callerBranch: 'main', agentBranch: 'feat/y',
      onConflict: async () => ({ ok: true }),
    });
    expect(result.kind).toBe('merged');
    const e2e = await runE2EVerify({ projectRoot: root, slice: 'rid-y' });
    expect(e2e.outcome).toBe('no-fixtures');
  });

  it('runs through end-to-end with a fixture', async () => {
    const root = setupRepo();
    const dir = join(root, 'qa', 'e2e', 'rid-z', 'login');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'happy.md'), [
      '# Login',
      'url: http://localhost:3000/login',
      'matchers:',
      '  - "Welcome"',
    ].join('\n'));
    const e2e = await runE2EVerify({ projectRoot: root, slice: 'rid-z' });
    expect(e2e.outcome).toBe('pass');
    expect(e2e.passCount).toBe(1);
  });
});
