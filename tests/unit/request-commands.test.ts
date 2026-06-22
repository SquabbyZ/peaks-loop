import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { getMockedHomeDir, parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

const homeDir = getMockedHomeDir();

async function makeProject(name: string): Promise<string> {
  const project = join(homeDir, name);
  if (existsSync(project)) {
    await rm(project, { recursive: true, force: true });
  }
  await mkdir(project, { recursive: true });
  return project;
}

describe('peaks request init command', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns a preview for every role without writing files', async () => {
    const project = await makeProject('request-init-preview');

    for (const role of ['prd', 'ui', 'rd', 'qa', 'sc'] as const) {
      const result = await runCommand(['request', 'init', '--role', role, '--id', '2026-05-23-preview', '--project', project, '--session-id', 'test-session', '--json']);
      const output = parseJsonOutput<{ applied: boolean; path: string }>(result.stdout);

      expect(output.ok).toBe(true);
      expect(output.command).toBe('request.init');
      expect(output.data.applied).toBe(false);
      // Path now includes incrementing number prefix (e.g., 001-2026-05-23-preview.md)
      expect(output.data.path).toContain('.peaks');
      expect(output.data.path).toContain('test-session');
      expect(output.data.path).toContain(role);
      expect(output.data.path).toContain('requests');
      expect(output.data.path).toMatch(/001-2026-05-23-preview\.md$/);
      expect(existsSync(output.data.path)).toBe(false);
    }
  });

  test('writes the artifact file for every role when --apply is passed', async () => {
    const project = await makeProject('request-init-apply');

    for (const role of ['prd', 'ui', 'rd', 'qa', 'sc'] as const) {
      const result = await runCommand(['request', 'init', '--role', role, '--id', '2026-05-23-apply', '--project', project, '--session-id', 'test-session', '--apply', '--json']);
      const output = parseJsonOutput<{ applied: boolean; path: string }>(result.stdout);

      expect(output.ok).toBe(true);
      expect(output.data.applied).toBe(true);
      const body = await readFile(output.data.path, 'utf8');
      expect(body).toMatch(new RegExp(`^# ${role.toUpperCase()} Request 2026-05-23-apply`, 'm'));
    }
  });

  test('rejects txt as a request role to keep TXT a meta layer', async () => {
    const project = await makeProject('request-init-reject-txt');

    await expect(
      runCommand(['request', 'init', '--role', 'txt', '--id', '2026-05-23-x', '--project', project, '--json'])
    ).rejects.toThrowError(/must be one of prd, ui, rd, qa, sc/);
    expect(existsSync(join(project, '.peaks'))).toBe(false);
  });

  test('rejects creating a duplicate request id when one already exists', async () => {
    const project = await makeProject('request-init-conflict');
    // Slice 006: the create writes to `.peaks/_runtime/<sid>/<role>/requests/`.
    const dir = join(project, '.peaks', '_runtime', 'test-session', 'prd', 'requests');
    await mkdir(dir, { recursive: true });
    // Create file with the new numbered format
    await writeFile(join(dir, '001-2026-05-23-existing.md'), 'existing', 'utf8');

    const result = await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-23-existing', '--project', project, '--session-id', 'test-session', '--apply', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('REQUEST_INIT_FAILED');
    expect(result.exitCode).toBe(1);
  });

  test('rejects an invalid role via the Commander parser', async () => {
    const project = await makeProject('request-init-bad-role');

    await expect(
      runCommand(['request', 'init', '--role', 'unknown', '--id', '2026-05-23-x', '--project', project, '--json'])
    ).rejects.toThrowError(/one of prd, ui, rd, qa/);
  });

  test('returns REQUEST_INIT_FAILED on invalid request id format', async () => {
    const project = await makeProject('request-init-bad-id');

    const result = await runCommand(['request', 'init', '--role', 'prd', '--id', '../escape', '--project', project, '--session-id', '2026-06-22-baseline-request-cmds', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('REQUEST_INIT_FAILED');
    expect(result.exitCode).toBe(1);
  });

  // Plan 1 followup hotfix (5cd4c87): --session-id is now REQUIRED.
  // The CLI rejects calls that omit it with SESSION_ID_REQUIRED
  // (exitCode 1, envelope.ok = false). The pre-hotfix "auto-generate
  // date-stamped session" behavior is gone. This test pins the new
  // contract.
  test('returns SESSION_ID_REQUIRED when --session-id is omitted', async () => {
    const project = await makeProject('request-init-default-session');

    const result = await runCommand(['request', 'init', '--role', 'qa', '--id', '2026-05-23-default-session', '--project', project, '--json']);
    const output = parseJsonOutput<{ sessionId: string }>(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('SESSION_ID_REQUIRED');
    expect(result.exitCode).toBe(1);
  });

  /**
   * Slice 007 — sub-agent session sharing. Plan 1 followup hotfix
   * (5cd4c87) made --session-id required; the auto-bind behavior is
   * gone. This test now pins the explicit-sid happy path: passing
   * the same --session-id to two consecutive request init calls
   * lands both artifacts under the same session dir, with NO
   * extra session dirs leaking under `.peaks/_runtime/`.
   */
  test('two consecutive request init calls with the same --session-id land under one session dir', async () => {
    const project = await makeProject('request-init-reuse-binding');
    const sid = '2026-06-22-baseline-request-cmds-shared';
    // Slice 008 F21 fix: pre-create the session dir the writer
    // expects to find.
    await mkdir(join(project, '.peaks', '_runtime', sid), { recursive: true });

    const first = await runCommand(['request', 'init', '--role', 'rd', '--id', '2026-05-23-reuse-a', '--project', project, '--session-id', sid, '--json']);
    const firstOutput = parseJsonOutput<{ sessionId: string; path: string }>(first.stdout);
    expect(firstOutput.ok).toBe(true);
    expect(firstOutput.data.sessionId).toBe(sid);

    const second = await runCommand(['request', 'init', '--role', 'rd', '--id', '2026-05-23-reuse-b', '--project', project, '--session-id', sid, '--json']);
    const secondOutput = parseJsonOutput<{ sessionId: string; path: string }>(second.stdout);
    expect(secondOutput.ok).toBe(true);
    expect(secondOutput.data.sessionId).toBe(sid);

    // Both artifacts land under the single pre-created session dir.
    const { readdir } = await import('node:fs/promises');
    const runtimeDir = join(project, '.peaks', '_runtime');
    const sessionDirs = (await readdir(runtimeDir, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && /^\d{4}-\d{2}-\d{2}-/.test(e.name))
      .map((e) => e.name);
    expect(sessionDirs).toEqual([sid]);
  });

  test('explicit --session-id still binds to that sid (regression for back-compat)', async () => {
    const project = await makeProject('request-init-explicit-sid');

    const result = await runCommand(['request', 'init', '--role', 'rd', '--id', '2026-05-23-explicit-sid', '--project', project, '--session-id', '2026-06-06-explicit-shared', '--json']);
    const output = parseJsonOutput<{ sessionId: string; path: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.sessionId).toBe('2026-06-06-explicit-shared');

    // With explicit --session-id the call path skips ensureSession
    // (the artifact body records the sid, but the on-disk binding
    // file is owned by the orchestrator's anchor). The session dir
    // is created on demand by the writer when --apply is passed, OR
    // left as a metadata-only path for the dry-run preview. The
    // contract this test pins is: the explicit --session-id value
    // survives the call (not auto-generated, not replaced).
    expect(output.data.path).toContain('2026-06-06-explicit-shared');
  });

  // Plan 1 followup hotfix (5cd4c87) made --session-id required.
  // The rotate→auto-generate path no longer exists (no implicit
  // binding). The post-rotate contract now is: rotate clears the
  // binding file on disk; the next explicit --session-id call
  // succeeds without resurrecting an auto-sid. This test pins the
  // explicit-sid post-rotate happy path.
  test('after rotate clears the binding, an explicit --session-id still lands the artifact', async () => {
    const project = await makeProject('request-init-after-rotate');
    const sid = '2026-06-22-baseline-request-cmds-post-rotate';
    // Pre-create the session dir (slice-008 F21 fix).
    await mkdir(join(project, '.peaks', '_runtime', sid), { recursive: true });

    // Anchor a binding via session-rotate, which writes the binding file.
    const rotate = await runCommand(['session', 'rotate', '--project', project, '--json']);
    expect(rotate.exitCode === 0 || rotate.exitCode === undefined).toBe(true);

    // Next request init: explicit --session-id. The CLI accepts it
    // and the artifact lands under the named session dir.
    const result = await runCommand(['request', 'init', '--role', 'rd', '--id', '2026-05-23-rot-b', '--project', project, '--session-id', sid, '--json']);
    const output = parseJsonOutput<{ sessionId: string }>(result.stdout);
    expect(output.ok).toBe(true);
    expect(output.data.sessionId).toBe(sid);
  });

  // ───────────────────────────────────────────────────────────
  // Slice 008 (F21 regression) — `peaks request init
  // --session-id <bad-sid>` must fail fast with a clear error
  // message listing the canonical binding, instead of silently
  // accepting the bad sid and planning to write to a non-
  // existent path. Pre-F21, a sub-agent with a typo or stale
  // binding wrote to nowhere.
  // ───────────────────────────────────────────────────────────
  test('rejects --session-id when the sid does not exist in _runtime/', async () => {
    const project = await makeProject('request-init-bad-sid');

    const result = await runCommand([
      'request', 'init',
      '--role', 'rd',
      '--id', '2026-06-06-bad-sid',
      '--session-id', '2025-01-01-session-bogus',
      '--project', project,
      '--json'
    ]);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('REQUEST_INIT_FAILED');
    expect(output.message).toContain('2025-01-01-session-bogus');
    expect(output.message).toContain('does not exist');
    expect(result.exitCode).toBe(1);

    // No file should be created in the bogus session dir.
    const bogusDir = join(project, '.peaks', '_runtime', '2025-01-01-session-bogus');
    expect(existsSync(bogusDir)).toBe(false);
  });

  test('accepts --session-id when the sid directory exists', async () => {
    // The existing `explicit --session-id still binds to that sid`
    // test already covers the happy-path back-compat. This is the
    // F21 companion: create the session dir explicitly, then
    // request init with that sid must succeed (not regress).
    const project = await makeProject('request-init-sid-dir-exists');
    const sidDir = join(project, '.peaks', '_runtime', '2026-06-06-existing-sid');
    await mkdir(sidDir, { recursive: true });

    const result = await runCommand([
      'request', 'init',
      '--role', 'rd',
      '--id', '2026-06-06-existing-sid-test',
      '--session-id', '2026-06-06-existing-sid',
      '--project', project,
      '--json'
    ]);
    const output = parseJsonOutput<{ sessionId: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.sessionId).toBe('2026-06-06-existing-sid');
  });
});

describe('peaks request list command', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('lists every per-request artifact when no filters are applied', async () => {
    const project = await makeProject('request-list-all');
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-23-a', '--project', project, '--session-id', 's1', '--apply', '--json']);
    await runCommand(['request', 'init', '--role', 'rd', '--id', '2026-05-23-a', '--project', project, '--session-id', 's1', '--apply', '--json']);
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-23-b', '--project', project, '--session-id', 's2', '--apply', '--json']);

    const result = await runCommand(['request', 'list', '--project', project, '--json']);
    const output = parseJsonOutput<{ count: number; items: Array<{ sessionId: string; role: string; requestId: string }> }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('request.list');
    expect(output.data.count).toBe(3);
  });

  test('filters by --session-id', async () => {
    const project = await makeProject('request-list-by-session');
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-23-x', '--project', project, '--session-id', 'session-x', '--apply', '--json']);
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-23-y', '--project', project, '--session-id', 'session-y', '--apply', '--json']);

    const result = await runCommand(['request', 'list', '--project', project, '--session-id', 'session-x', '--json']);
    const output = parseJsonOutput<{ count: number; items: Array<{ sessionId: string }> }>(result.stdout);

    expect(output.data.count).toBe(1);
    expect(output.data.items[0]?.sessionId).toBe('session-x');
  });

  test('filters by --role', async () => {
    const project = await makeProject('request-list-by-role');
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-23-x', '--project', project, '--session-id', 's', '--apply', '--json']);
    await runCommand(['request', 'init', '--role', 'qa', '--id', '2026-05-23-x', '--project', project, '--session-id', 's', '--apply', '--json']);

    const result = await runCommand(['request', 'list', '--project', project, '--role', 'qa', '--json']);
    const output = parseJsonOutput<{ items: Array<{ role: string }> }>(result.stdout);

    expect(output.data.items).toHaveLength(1);
    expect(output.data.items[0]?.role).toBe('qa');
  });

  test('returns an empty list when the project has no artifacts', async () => {
    const project = await makeProject('request-list-empty');

    const result = await runCommand(['request', 'list', '--project', project, '--json']);
    const output = parseJsonOutput<{ count: number; items: unknown[] }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.count).toBe(0);
    expect(output.data.items).toEqual([]);
  });

  test('returns REQUEST_LIST_FAILED when the service throws', async () => {
    const module = await import('../../src/services/artifacts/request-artifact-service.js');
    const spy = vi.spyOn(module, 'listRequestArtifacts').mockRejectedValueOnce(new Error('synthetic list failure'));

    const result = await runCommand(['request', 'list', '--project', homeDir, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('REQUEST_LIST_FAILED');
    expect(result.exitCode).toBe(1);
    spy.mockRestore();
  });
});

describe('peaks request show command', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('shows the artifact when sessionId is provided', async () => {
    const project = await makeProject('request-show-by-session');
    await runCommand(['request', 'init', '--role', 'rd', '--id', '2026-05-23-shown', '--project', project, '--session-id', 'session-r', '--apply', '--json']);

    const result = await runCommand(['request', 'show', '2026-05-23-shown', '--role', 'rd', '--project', project, '--session-id', 'session-r', '--json']);
    const output = parseJsonOutput<{ content: string; sessionId: string; role: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('request.show');
    expect(output.data.sessionId).toBe('session-r');
    expect(output.data.role).toBe('rd');
    expect(output.data.content).toMatch(/^# RD Request 2026-05-23-shown/m);
  });

  test('searches across sessions when sessionId is omitted', async () => {
    const project = await makeProject('request-show-across');
    await runCommand(['request', 'init', '--role', 'qa', '--id', '2026-05-23-wherever', '--project', project, '--session-id', 'somewhere', '--apply', '--json']);

    const result = await runCommand(['request', 'show', '2026-05-23-wherever', '--role', 'qa', '--project', project, '--json']);
    const output = parseJsonOutput<{ sessionId: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.sessionId).toBe('somewhere');
  });

  test('returns REQUEST_NOT_FOUND when the artifact does not exist', async () => {
    const project = await makeProject('request-show-missing');

    const result = await runCommand(['request', 'show', '2026-05-23-missing', '--role', 'prd', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('REQUEST_NOT_FOUND');
    expect(result.exitCode).toBe(1);
  });

  test('returns REQUEST_SHOW_FAILED on invalid request id', async () => {
    const project = await makeProject('request-show-bad-id');

    const result = await runCommand(['request', 'show', '../escape', '--role', 'prd', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('REQUEST_SHOW_FAILED');
    expect(result.exitCode).toBe(1);
  });
});

describe('peaks request transition command', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('moves a PRD artifact from draft to confirmed-by-user', async () => {
    const project = await makeProject('request-transition-ok');
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-24-feature', '--project', project, '--session-id', 's1', '--apply', '--json']);

    const result = await runCommand(['request', 'transition', '2026-05-24-feature', '--role', 'prd', '--state', 'confirmed-by-user', '--project', project, '--session-id', 's1', '--allow-incomplete', '--reason', 'test transition behavior', '--json']);
    const output = parseJsonOutput<{ state: string; previousState: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('request.transition');
    expect(output.data.state).toBe('confirmed-by-user');
    expect(output.data.previousState).toBe('draft');
  });

  test('appends a transition note when --reason is passed', async () => {
    const project = await makeProject('request-transition-reason');
    await runCommand(['request', 'init', '--role', 'rd', '--id', '2026-05-24-blocked', '--project', project, '--session-id', 's1', '--apply', '--json']);

    const result = await runCommand(['request', 'transition', '2026-05-24-blocked', '--role', 'rd', '--state', 'blocked', '--project', project, '--session-id', 's1', '--allow-incomplete', '--reason', 'awaiting QA bandwidth', '--json']);
    const output = parseJsonOutput<{ content: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.content).toContain('awaiting QA bandwidth');
  });

  test('searches across sessions when --session-id is omitted', async () => {
    const project = await makeProject('request-transition-cross');
    await runCommand(['request', 'init', '--role', 'qa', '--id', '2026-05-24-anywhere', '--project', project, '--session-id', 'somewhere', '--apply', '--json']);

    const result = await runCommand(['request', 'transition', '2026-05-24-anywhere', '--role', 'qa', '--state', 'running', '--project', project, '--allow-incomplete', '--reason', 'cross-session lookup test — prerequisites covered elsewhere', '--json']);
    const output = parseJsonOutput<{ sessionId: string; state: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.sessionId).toBe('somewhere');
    expect(output.data.state).toBe('running');
  });

  test('--allow-incomplete resolves presence from --project, not cwd (assisted → restricted)', async () => {
    const project = await makeProject('request-transition-presence');
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-24-p', '--project', project, '--session-id', 's1', '--apply', '--json']);
    // Assisted presence lives in the TARGET project, not the process cwd.
    await mkdir(join(project, '.peaks'), { recursive: true });
    await writeFile(join(project, '.peaks', '.active-skill.json'), JSON.stringify({ skill: 'peaks-prd', mode: 'assisted', setAt: '2026-05-28T00:00:00Z' }), 'utf8');

    // --allow-incomplete without --confirm must be restricted because the project's presence is assisted.
    const result = await runCommand(['request', 'transition', '2026-05-24-p', '--role', 'prd', '--state', 'confirmed-by-user', '--project', project, '--session-id', 's1', '--allow-incomplete', '--reason', 'x', '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(false);
    expect(output.code).toBe('ALLOW_INCOMPLETE_RESTRICTED');
    expect(result.exitCode).toBe(1);
  });

  test('returns REQUEST_NOT_FOUND when the target artifact is missing', async () => {
    const project = await makeProject('request-transition-missing');

    const result = await runCommand(['request', 'transition', '2026-05-24-missing', '--role', 'prd', '--state', 'blocked', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('REQUEST_NOT_FOUND');
    expect(result.exitCode).toBe(1);
  });

  test('rejects --state values that are not allowed for the role via the Commander parser', async () => {
    const project = await makeProject('request-transition-bad-state');
    await runCommand(['request', 'init', '--role', 'prd', '--id', '2026-05-24-x', '--project', project, '--session-id', 's', '--apply', '--json']);

    await expect(
      runCommand(['request', 'transition', '2026-05-24-x', '--role', 'prd', '--state', 'verdict-issued', '--project', project, '--session-id', 's', '--json'])
    ).rejects.toThrowError(/must be one of/);
  });

  test('returns REQUEST_TRANSITION_FAILED when the service throws on invalid request id format', async () => {
    const project = await makeProject('request-transition-bad-id');

    const result = await runCommand(['request', 'transition', '../escape', '--role', 'prd', '--state', 'blocked', '--project', project, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('REQUEST_TRANSITION_FAILED');
    expect(result.exitCode).toBe(1);
  });

  test('returns PREREQUISITES_MISSING with the list of missing files when gates are unmet', async () => {
    const project = await makeProject('request-transition-gated');
    await runCommand(['request', 'init', '--role', 'rd', '--id', '2026-05-25-feat', '--project', project, '--session-id', 's', '--apply', '--json']);

    const result = await runCommand(['request', 'transition', '2026-05-25-feat', '--role', 'rd', '--state', 'qa-handoff', '--project', project, '--session-id', 's', '--json']);
    const output = parseJsonOutput<{ missing: Array<{ path: string }> }>(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('PREREQUISITES_MISSING');
    expect(result.exitCode).toBe(1);
    const paths = output.data.missing.map((entry) => entry.path);
    expect(paths).toContain('rd/tech-doc.md');
    expect(paths).toContain('rd/code-review.md');
    expect(paths).toContain('rd/security-review.md');
  });

  test('rejects --allow-incomplete when --reason is not provided', async () => {
    const project = await makeProject('request-transition-no-reason');
    await runCommand(['request', 'init', '--role', 'rd', '--id', '2026-05-25-feat', '--project', project, '--session-id', 's', '--apply', '--json']);

    const result = await runCommand(['request', 'transition', '2026-05-25-feat', '--role', 'rd', '--state', 'qa-handoff', '--project', project, '--session-id', 's', '--allow-incomplete', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('BYPASS_REASON_REQUIRED');
    expect(result.exitCode).toBe(1);
  });

  test('init with --type bugfix records the type in the artifact and applies bugfix gates', async () => {
    const project = await makeProject('request-init-typed');
    const initResult = await runCommand(['request', 'init', '--role', 'rd', '--id', '2026-05-25-bug', '--project', project, '--session-id', 's', '--apply', '--type', 'bugfix', '--json']);
    const initOutput = parseJsonOutput<{ content: string; requestType?: string }>(initResult.stdout);
    expect(initOutput.ok).toBe(true);
    expect(initOutput.data.content).toContain('- type: bugfix');

    // Bugfix should require bug-analysis.md (not tech-doc.md) before rd:implemented.
    const blocked = await runCommand(['request', 'transition', '2026-05-25-bug', '--role', 'rd', '--state', 'implemented', '--project', project, '--session-id', 's', '--json']);
    const blockedOutput = parseJsonOutput<{ missing: Array<{ path: string }> }>(blocked.stdout);
    expect(blockedOutput.ok).toBe(false);
    expect(blockedOutput.code).toBe('PREREQUISITES_MISSING');
    expect(blockedOutput.data.missing.map((m) => m.path)).toContain('rd/bug-analysis.md');
  });

  test('init rejects an invalid --type value via the Commander parser', async () => {
    const project = await makeProject('request-init-bad-type');
    await expect(
      runCommand(['request', 'init', '--role', 'rd', '--id', '2026-05-25-bad', '--project', project, '--session-id', 's', '--apply', '--type', 'enhancement', '--json'])
    ).rejects.toThrowError(/must be one of/);
  });
});

// ---------------------------------------------------------------------------
// Slice 020.1 — callerId D4 priority integration in `peaks request init`.
// The CLI integration layer must surface the resolved callerId in the
// response envelope for all four D4 paths (flag > env > fallback > reject),
// not only the flag path. Regression guard against the slice 020 dogfood
// finding (env / fallback paths left envelope.callerId undefined).
// ---------------------------------------------------------------------------

describe('peaks request init — D4 callerId integration (slice 020.1)', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('D4 level 1 (flag) — envelope.callerId reflects the --caller-id flag', async () => {
    const project = await makeProject('d4-flag-path');
    const result = await runCommand([
      'request', 'init', '--role', 'rd', '--id', '020.1-d4-flag',
      '--project', project, '--session-id', 's', '--apply',
      '--caller-id', 'dogfood-flag', '--json'
    ]);
    const output = parseJsonOutput<{ callerId?: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.callerId).toBe('dogfood-flag');
  });

  test('D4 level 2 (env) — envelope.callerId reflects PEAKS_CALLER_ID when no flag is passed', async () => {
    const project = await makeProject('d4-env-path');
    const result = await runCommand(
      [
        'request', 'init', '--role', 'rd', '--id', '020.1-d4-env',
        '--project', project, '--session-id', 's', '--apply', '--json'
      ],
      { PEAKS_CALLER_ID: 'dogfood-env' }
    );
    const output = parseJsonOutput<{ callerId?: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.callerId).toBe('dogfood-env');
  });

  test('D4 level 3 (platform fallback) — envelope.callerId reflects CLAUDE_CODE_SESSION_ID when no flag/env is set', async () => {
    const project = await makeProject('d4-fallback-path');
    const result = await runCommand(
      [
        'request', 'init', '--role', 'rd', '--id', '020.1-d4-fallback',
        '--project', project, '--session-id', 's', '--apply', '--json'
      ],
      { CLAUDE_CODE_SESSION_ID: 'dogfood-fb-123' }
    );
    const output = parseJsonOutput<{ callerId?: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.callerId).toBe('dogfood-fb-123');
  });

  test('D4 level 4 (reject / D2) — returns CALLER_ID_INVALID with source=none and exit 64', async () => {
    const project = await makeProject('d4-reject-path');
    // Vitest workers inherit the host shell's CLAUDE_CODE_SESSION_ID; explicitly
    // unset both callerId sources so the resolver reaches D2 (reject).
    const result = await runCommand(
      [
        'request', 'init', '--role', 'rd', '--id', '020.1-d4-reject',
        '--project', project, '--session-id', 's', '--apply', '--json'
      ],
      { PEAKS_CALLER_ID: '', CLAUDE_CODE_SESSION_ID: '' }
    );
    const output = parseJsonOutput<{ source?: string }>(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('CALLER_ID_INVALID');
    expect(output.data.source).toBe('none');
    expect(result.exitCode).toBe(64);
  });

  test('D5 (regex fail via flag) — returns CALLER_ID_INVALID with source=flag and exit 65', async () => {
    const project = await makeProject('d4-regex-fail');
    const result = await runCommand([
      'request', 'init', '--role', 'rd', '--id', '020.1-d5-flag',
      '--project', project, '--session-id', 's', '--apply',
      '--caller-id', 'bad/value', '--json'
    ]);
    const output = parseJsonOutput<{ source?: string }>(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('CALLER_ID_INVALID');
    expect(output.data.source).toBe('flag');
    expect(result.exitCode).toBe(65);
  });

  test('D4 priority: flag beats env when both are set', async () => {
    const project = await makeProject('d4-flag-beats-env');
    const result = await runCommand(
      [
        'request', 'init', '--role', 'rd', '--id', '020.1-d4-priority',
        '--project', project, '--session-id', 's', '--apply',
        '--caller-id', 'flag-wins', '--json'
      ],
      { PEAKS_CALLER_ID: 'env-loses' }
    );
    const output = parseJsonOutput<{ callerId?: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.callerId).toBe('flag-wins');
  });
});
