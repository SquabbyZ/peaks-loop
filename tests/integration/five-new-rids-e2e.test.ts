import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const REPO = resolve(__dirname, '../..');
const BIN_TIMEOUT_MS = 120_000;
const PICKED_RID = '2026-06-13-slice-decompose-impl';

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

interface CliEnvelope<T> {
  readonly ok: boolean;
  readonly command: string;
  readonly data: T;
}

function runCli(args: readonly string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: BIN_TIMEOUT_MS,
      env: { ...process.env, PEAKS_CALLER_ID: 'five-new-rids-e2e' }
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (error: unknown) {
    const caught = error as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: typeof caught.stdout === 'string' ? caught.stdout : caught.stdout?.toString('utf8') ?? '',
      stderr: typeof caught.stderr === 'string' ? caught.stderr : caught.stderr?.toString('utf8') ?? '',
      code: caught.status ?? 1
    };
  }
}

function parseEnvelope<T>(result: RunResult): CliEnvelope<T> {
  return JSON.parse(result.stdout) as CliEnvelope<T>;
}

const projects: string[] = [];

function makeProject(prefix: string): string {
  const project = mkdtempSync(join(tmpdir(), prefix));
  projects.push(project);
  return project;
}

afterEach(() => {
  for (const project of projects) {
    if (existsSync(project)) rmSync(project, { recursive: true, force: true });
  }
  projects.length = 0;
});

describe('rid-010 fix-claude-settings-template-hook-node-wrapper', () => {
  test('skips then restores the JSON-safe node wrapper with argv[1]', () => {
    const project = makeProject('peaks-rid-010-');
    const settingsPath = join(project, '.claude', 'settings.local.json');
    const sessionArgs = ['--session-id', '2026-07-25-rid010-e2e'] as const;

    const skipped = runCli([
      'workspace', 'init', '--project', project, ...sessionArgs, '--install-hooks', 'skip',
      '--no-claude-hooks', '--no-project-scan-bootstrap', '--json'
    ], project);
    expect(skipped.code).toBe(0);
    expect(existsSync(settingsPath)).toBe(false);

    const restored = runCli([
      'workspace', 'init', '--project', project, ...sessionArgs, '--install-hooks', 'skip',
      '--no-project-scan-bootstrap', '--json'
    ], project);
    expect(restored.code).toBe(0);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks?: { PreToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    const commands = (settings.hooks?.PreToolUse ?? [])
      .flatMap((entry) => entry.hooks ?? [])
      .map((hook) => hook.command ?? '');
    expect(commands.some((command) => /node\s+-e\s+"/.test(command))).toBe(true);
    expect(commands.some((command) => command.includes('process.argv[1]'))).toBe(true);
  });
});

describe('rid-012 add-tech-dry-run-gate', () => {
  test('plans and reports a change-id-keyed technical gate', () => {
    const project = makeProject('peaks-rid-012-');
    const changeId = 'e2e-tech-dry-run';

    const planned = runCli([
      'tech', 'plan-change-id', '--change-id', changeId,
      '--goal', 'Verify the technical dry-run gate', '--json'
    ], project);
    expect(planned.code).toBe(0);
    const plan = parseEnvelope<{ available: boolean; changeId: string }>(planned);
    expect(plan.ok).toBe(true);
    expect(plan.data.available).toBe(true);
    expect(plan.data.changeId).toBe(changeId);

    const checked = runCli([
      'tech', 'status-change-id', '--change-id', changeId, '--json'
    ], project);
    expect(checked.code).toBe(0);
    const status = parseEnvelope<{ status: string; changeId: string }>(checked);
    expect(status.ok).toBe(true);
    expect(status.data.status.length).toBeGreaterThan(0);
    expect(status.data.changeId).toBe(changeId);
  });
});

describe('rid-013 add-rd-swarm-dry-run-planner', () => {
  test('returns a non-empty worker task queue for an RD change-id plan', () => {
    const project = makeProject('peaks-rid-013-');
    const planned = runCli([
      'swarm', 'plan-change-id', '--change-id', 'e2e-rd-swarm',
      '--goal', 'Verify the RD swarm dry-run planner', '--json'
    ], project);

    expect(planned.code).toBe(0);
    const envelope = parseEnvelope<{ available: boolean; tasks: unknown[] }>(planned);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.available).toBe(true);
    expect(Array.isArray(envelope.data.tasks)).toBe(true);
    expect(envelope.data.tasks.length).toBeGreaterThan(0);
  });
});

describe('rid-014 add-autonomous-rd-swarm-resume', () => {
  test('returns the autonomous goal package and resumable worker queue', () => {
    const project = makeProject('peaks-rid-014-');
    const planned = runCli([
      'autonomous-swarm', '--change-id', 'e2e-autonomous-swarm',
      '--goal', 'Verify autonomous resume planning', '--mode', 'code',
      '--dry-run', '--json'
    ], project);

    expect(planned.code).toBe(0);
    const envelope = parseEnvelope<{
      goalPackage: { autonomyMode: string };
      workerQueue: unknown[];
      resumeInstructions: { steps: string[] };
    }>(planned);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.goalPackage.autonomyMode).toBe('dry-run');
    expect(envelope.data.workerQueue.length).toBeGreaterThan(0);
    expect(envelope.data.resumeInstructions.steps.length).toBeGreaterThan(0);
  });
});

describe('rid-015 add-slice-topology-multipass', () => {
  test('plans at least two linked slices from the existing picked decomposition', () => {
    const planned = runCli([
      'slice', 'plan', PICKED_RID, '--project', REPO, '--json'
    ], REPO);

    expect(planned.code).toBe(0);
    const envelope = parseEnvelope<{
      parentRid: string;
      plan: Array<{ dependsOn: string[] }>;
      apply: boolean;
    }>(planned);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.parentRid).toBe(PICKED_RID);
    expect(envelope.data.plan.length).toBeGreaterThanOrEqual(2);
    expect(envelope.data.plan[1]?.dependsOn.length).toBeGreaterThan(0);
    expect(envelope.data.apply).toBe(false);
  });
});
