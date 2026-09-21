import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { parseCliEnvelopeWith } from '../../src/cli/cli-envelope.js';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const REPO = resolve(__dirname, '../..');
const BIN_TIMEOUT_MS = 120_000;
const PICKED_RID = '2026-06-13-slice-decompose-impl';

// The `data` payloads this file reads at depth >= 2, one per invocation. The
// previous local helper `parseEnvelope<T>` promised each of these with a type
// parameter and delivered it with `JSON.parse(...) as CliEnvelope<T>` — a
// claim about a check that never ran. `parseCliEnvelopeWith` runs the schema
// instead, so the type is derived rather than asserted. (S15.)
const techPlanPayload = z.looseObject({ available: z.boolean(), changeId: z.string() });
const techStatusPayload = z.looseObject({ status: z.string(), changeId: z.string() });
const swarmPlanPayload = z.looseObject({ available: z.boolean(), tasks: z.array(z.unknown()) });
const autonomousPayload = z.looseObject({
  goalPackage: z.looseObject({ autonomyMode: z.string() }),
  workerQueue: z.array(z.unknown()),
  resumeInstructions: z.looseObject({ steps: z.array(z.string()) })
});
const slicePlanPayload = z.looseObject({
  parentRid: z.string(),
  plan: z.array(z.looseObject({ dependsOn: z.array(z.string()) })),
  apply: z.boolean()
});

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function runCli(args: readonly string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: BIN_TIMEOUT_MS,
      env: { ...process.env, PEAKS_CALLER_ID: 'five-new-rids-e2e' }
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (error: unknown) {
    const caught = error as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout:
        typeof caught.stdout === 'string' ? caught.stdout : (caught.stdout?.toString('utf8') ?? ''),
      stderr:
        typeof caught.stderr === 'string' ? caught.stderr : (caught.stderr?.toString('utf8') ?? ''),
      code: caught.status ?? 1
    };
  }
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
  test('skips then restores the JSON-safe node wrapper (now a script invocation)', () => {
    const project = makeProject('peaks-rid-010-');
    const settingsPath = join(project, '.claude', 'settings.local.json');
    const sessionArgs = ['--session-id', '2026-07-25-rid010-e2e'] as const;

    const skipped = runCli(
      [
        'workspace',
        'init',
        '--project',
        project,
        ...sessionArgs,
        '--install-hooks',
        'skip',
        '--no-claude-hooks',
        '--no-project-scan-bootstrap',
        '--json'
      ],
      project
    );
    expect(skipped.code).toBe(0);
    expect(existsSync(settingsPath)).toBe(false);

    const restored = runCli(
      [
        'workspace',
        'init',
        '--project',
        project,
        ...sessionArgs,
        '--install-hooks',
        'skip',
        '--no-project-scan-bootstrap',
        '--json'
      ],
      project
    );
    expect(restored.code).toBe(0);

    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks?: { PreToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    const commands = (settings.hooks?.PreToolUse ?? [])
      .flatMap((entry) => entry.hooks ?? [])
      .map((hook) => hook.command ?? '');
    // TEMPLATE_VERSION 1.8.0: no handler may be invoked as `node "<absolute
    // path>"`. The command carried an absolute path resolved from the
    // installing module's own location — which, for a global install, is a
    // Node VERSION directory (`…/nvm/v24.14.0/node_modules/peaks-loop/…`), so
    // `nvm use` switched `node` on PATH while the path stayed put. The
    // retired handler was the only such command; this pins that none returns,
    // rather than pinning that the one is present.
    expect(commands.some((command) => /^node\s+"/.test(command))).toBe(false);
    expect(commands.some((command) => command.includes('process.argv[1]'))).toBe(false);
  });
});

describe('rid-012 add-tech-dry-run-gate', () => {
  test('plans and reports a change-id-keyed technical gate', () => {
    const project = makeProject('peaks-rid-012-');
    const changeId = 'e2e-tech-dry-run';

    const planned = runCli(
      [
        'tech',
        'plan-change-id',
        '--change-id',
        changeId,
        '--goal',
        'Verify the technical dry-run gate',
        '--json'
      ],
      project
    );
    expect(planned.code).toBe(0);
    const plan = parseCliEnvelopeWith(planned.stdout, techPlanPayload);
    expect(plan.ok).toBe(true);
    expect(plan.data.available).toBe(true);
    expect(plan.data.changeId).toBe(changeId);

    const checked = runCli(
      ['tech', 'status-change-id', '--change-id', changeId, '--json'],
      project
    );
    expect(checked.code).toBe(0);
    const status = parseCliEnvelopeWith(checked.stdout, techStatusPayload);
    expect(status.ok).toBe(true);
    expect(status.data.status.length).toBeGreaterThan(0);
    expect(status.data.changeId).toBe(changeId);
  });
});

describe('rid-013 add-rd-swarm-dry-run-planner', () => {
  test('returns a non-empty worker task queue for an RD change-id plan', () => {
    const project = makeProject('peaks-rid-013-');
    const planned = runCli(
      [
        'swarm',
        'plan-change-id',
        '--change-id',
        'e2e-rd-swarm',
        '--goal',
        'Verify the RD swarm dry-run planner',
        '--json'
      ],
      project
    );

    expect(planned.code).toBe(0);
    const envelope = parseCliEnvelopeWith(planned.stdout, swarmPlanPayload);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.available).toBe(true);
    expect(Array.isArray(envelope.data.tasks)).toBe(true);
    expect(envelope.data.tasks.length).toBeGreaterThan(0);
  });
});

describe('rid-014 add-autonomous-rd-swarm-resume', () => {
  test('returns the autonomous goal package and resumable worker queue', () => {
    const project = makeProject('peaks-rid-014-');
    const planned = runCli(
      [
        'autonomous-swarm',
        '--change-id',
        'e2e-autonomous-swarm',
        '--goal',
        'Verify autonomous resume planning',
        '--mode',
        'code',
        '--dry-run',
        '--json'
      ],
      project
    );

    expect(planned.code).toBe(0);
    const envelope = parseCliEnvelopeWith(planned.stdout, autonomousPayload);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.goalPackage.autonomyMode).toBe('dry-run');
    expect(envelope.data.workerQueue.length).toBeGreaterThan(0);
    expect(envelope.data.resumeInstructions.steps.length).toBeGreaterThan(0);
  });
});

describe('rid-015 add-slice-topology-multipass', () => {
  test('plans at least two linked slices from the existing picked decomposition', () => {
    const planned = runCli(['slice', 'plan', PICKED_RID, '--project', REPO, '--json'], REPO);

    expect(planned.code).toBe(0);
    const envelope = parseCliEnvelopeWith(planned.stdout, slicePlanPayload);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.parentRid).toBe(PICKED_RID);
    expect(envelope.data.plan.length).toBeGreaterThanOrEqual(2);
    expect(envelope.data.plan[1]?.dependsOn.length).toBeGreaterThan(0);
    expect(envelope.data.apply).toBe(false);
  });
});
