import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const REPO = resolve(__dirname, '../..');
const BIN_TIMEOUT_MS = 120_000;
const EXISTING_RID = '2026-07-25-p1-7-sub-agent-dispatch-e2e';
const EXISTING_SESSION = '2026-07-25-session-6da9d9';

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
      timeout: BIN_TIMEOUT_MS,
      env: { ...process.env, PEAKS_CALLER_ID: 'business-capability-e2e' }
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

function parseEnvelope(result: RunResult): Record<string, any> {
  return JSON.parse(result.stdout) as Record<string, any>;
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

describe('peaks hooks install --ide claude-code (P1-2 e2e)', () => {
  test('installs one managed PreToolUse gate idempotently and uninstalls idempotently', () => {
    const project = makeProject('peaks-p1-2-hooks-');
    const install = runCli(['hooks', 'install', '--project', project, '--ide', 'claude-code', '--json'], project);
    expect(install.code).toBe(0);
    const installed = parseEnvelope(install);
    expect(installed.ok).toBe(true);
    expect(installed.data.applied).toBe(true);
    expect(existsSync(installed.data.settingsPath as string)).toBe(true);

    const settingsPath = join(project, '.claude', 'settings.json');
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as {
      hooks?: { PreToolUse?: Array<{ hooks?: Array<{ command?: string }> }> };
    };
    const managed = settings.hooks?.PreToolUse?.filter((entry) =>
      entry.hooks?.some((hook) => hook.command?.includes('peaks gate enforce'))
    ) ?? [];
    expect(managed).toHaveLength(1);

    const reinstall = parseEnvelope(runCli(['hooks', 'install', '--project', project, '--ide', 'claude-code', '--json'], project));
    expect(reinstall.data.applied).toBe(false);
    const afterReinstall = readFileSync(settingsPath, 'utf8');
    expect((afterReinstall.match(/peaks gate enforce/g) ?? [])).toHaveLength(1);

    const uninstall = parseEnvelope(runCli(['hooks', 'uninstall', '--project', project, '--ide', 'claude-code', '--json'], project));
    expect(uninstall.data.removed).toBe(true);
    expect(readFileSync(settingsPath, 'utf8')).not.toContain('peaks gate enforce');
    const secondUninstall = parseEnvelope(runCli(['hooks', 'uninstall', '--project', project, '--ide', 'claude-code', '--json'], project));
    expect(secondUninstall.data.removed).toBe(false);
  });
});

describe('peaks request transition state machine (P1-3 e2e)', () => {
  test('walks an RD request from spec-locked through handed-off', () => {
    const project = makeProject('peaks-p1-3-request-');
    const workspace = parseEnvelope(runCli(['workspace', 'init', '--project', project, '--json'], project));
    expect(workspace.ok).toBe(true);
    const sessionId = workspace.data.sessionId as string;
    expect(sessionId.length).toBeGreaterThan(0);

    const requestId = '2026-07-25-p1-3-fake';
    const initialized = parseEnvelope(runCli([
      'request', 'init', '--role', 'rd', '--id', requestId, '--project', project,
      '--session-id', sessionId, '--apply', '--json'
    ], project));
    expect(initialized.data.applied).toBe(true);

    // A synthetic project intentionally lacks the full RD/QA evidence tree.
    // --allow-incomplete keeps this test focused on persistence of the state walk.
    for (const state of ['spec-locked', 'implemented', 'qa-handoff', 'handed-off']) {
      const transitioned = runCli([
        'request', 'transition', requestId, '--role', 'rd', '--state', state,
        '--project', project, '--session-id', sessionId, '--confirm', '--allow-incomplete',
        '--reason', 'synthetic state-machine integration fixture', '--json'
      ], project);
      expect(transitioned.code).toBe(0);
      expect(parseEnvelope(transitioned).data.state).toBe(state);
    }

    const shown = parseEnvelope(runCli([
      'request', 'show', requestId, '--role', 'rd', '--project', project,
      '--session-id', sessionId, '--json'
    ], project));
    expect(shown.data.state).toBe('handed-off');
  });
});

describe('workspace init + project context + code detect-job (P1-4 e2e)', () => {
  test('onboards a new TypeScript project and records its LLM-supplied job shape', () => {
    const project = makeProject('peaks-p1-4-onboard-');
    mkdirSync(join(project, 'src'));
    writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'tmp-e2e-p1-4' }));
    writeFileSync(join(project, 'src', 'index.ts'), "export const hello = 'world';\n");

    const workspace = parseEnvelope(runCli(['workspace', 'init', '--project', project, '--json'], project));
    expect(workspace.ok).toBe(true);
    expect(workspace.data.bound).toBe(true);
    const sessionId = workspace.data.sessionId as string;
    expect(sessionId.length).toBeGreaterThan(0);

    const context = parseEnvelope(runCli(['project', 'context', '--project', project, '--json'], project));
    expect(context.ok).toBe(true);
    expect(context.data.path).toBe(join(project, '.peaks', 'PROJECT.md'));
    expect(context.data.projectScan).toBeDefined();

    const job = runCli([
      'code', 'detect-job', '--project', project, '--session-id', sessionId,
      '--is-job', 'false', '--rationale', 'Single tiny onboarding fixture.',
      '--suggested-job-id', 'tmp-e2e-p1-4', '--confidence', 'high', '--json'
    ], project);
    expect(job.code).toBe(0);
    const jobEnvelope = parseEnvelope(job);
    expect(jobEnvelope.ok).toBe(true);
    expect(jobEnvelope.data.decision.isJob).toBe(false);
  });
});

describe('peaks slice check --rid (P1-5 e2e)', () => {
  test('rejects a missing rid and returns structured stages for a valid rid', () => {
    const missing = runCli(['slice', 'check', '--project', REPO, '--json', '--skip-tests'], REPO);
    expect(missing.code).not.toBe(0);
    const missingEnvelope = parseEnvelope(missing);
    expect(missingEnvelope.ok).toBe(false);
    expect(`${missingEnvelope.message} ${JSON.stringify(missingEnvelope.nextActions)}`).toMatch(/rid/i);

    const checked = runCli([
      'slice', 'check', '--rid', EXISTING_RID, '--project', REPO, '--json', '--skip-tests'
    ], REPO);
    const checkedEnvelope = parseEnvelope(checked);
    expect(checkedEnvelope.command).toBe('slice.check');
    expect(Array.isArray(checkedEnvelope.data.stages)).toBe(true);
    expect(checkedEnvelope.data.stages.length).toBeGreaterThan(0);
    expect(checked.code === 0 || checkedEnvelope.data.boundaryReady === false).toBe(true);
  }, BIN_TIMEOUT_MS);
});

describe('peaks workflow plan + verify-pipeline (P1-6 e2e)', () => {
  test('detects the slice plan trigger then returns a linked structured gate report', () => {
    // `workflow plan` is a command group; detect-trigger is its rid-linked planning operation.
    const planned = runCli([
      'workflow', 'plan', 'detect-trigger', '--rid', EXISTING_RID, '--project', REPO,
      '--session-id', EXISTING_SESSION, '--json'
    ], REPO);
    expect(planned.code).toBe(0);
    const planEnvelope = parseEnvelope(planned);
    expect(planEnvelope.ok).toBe(true);
    expect(planEnvelope.command).toBe('workflow.plan.detect-trigger');

    const verified = runCli([
      'workflow', 'verify-pipeline', '--rid', EXISTING_RID, '--project', REPO,
      '--session-id', EXISTING_SESSION, '--json'
    ], REPO);
    const verifyEnvelope = parseEnvelope(verified);
    expect(verifyEnvelope.command).toBe('workflow.verify-pipeline');
    expect(verifyEnvelope.data).toBeDefined();
    expect(Array.isArray(verifyEnvelope.data.violations)).toBe(true);
    expect(verified.code === 0 || verifyEnvelope.code === 'PIPELINE_INCOMPLETE').toBe(true);
  });
});
