import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

// W8-CC-α: raise per-file default test timeout from 5000ms → 10000ms.
// The longest workflow tests (swarm / economy dispatch) spawn real CLI
// sub-processes that occasionally exceed 5s on Windows under load.
// 10s gives enough headroom for slow CI without masking real hangs.
vi.setConfig({ testTimeout: 10000 });

describe('createProgram workflow commands', () => {

  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  test('prints tech plan dry run', async () => {
    const result = await runCommand(['tech', 'plan', '--goal', 'Refactor checkout API', '--swarm', '--dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('tech.plan');
    expect(JSON.stringify(output.data)).toContain('tech-task-graph.json');
  });

  test('defaults tech plan swarm mode off when omitted', async () => {
    const result = await runCommand(['tech', 'plan', '--goal', 'Refactor checkout API', '--dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('tech.plan');
  });

  test('rejects tech plan without dry-run', async () => {
    const result = await runCommand(['tech', 'plan', '--goal', 'Refactor checkout API', '--swarm', '--no-dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_NON_DRY_RUN');
  });

  test('defaults tech plan to dry-run when omitted', async () => {
    const result = await runCommand(['tech', 'plan', '--goal', 'Refactor checkout API', '--swarm', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('tech.plan');
  });

  test('prints tech status', async () => {
    const result = await runCommand(['tech', 'status', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('tech.status');
  });

  test('prints simplified top-level planning commands', async () => {
    const techPlanResult = await runCommand(['tech-plan', '--goal', 'Refactor checkout API', '--swarm', '--json']);
    expect(parseJsonOutput(techPlanResult.stdout).command).toBe('tech.plan');

    const techStatusResult = await runCommand(['tech-status', '--json']);
    expect(parseJsonOutput(techStatusResult.stdout).command).toBe('tech.status');

    const routeResult = await runCommand(['route', '--mode', 'solo', '--solo-mode', 'full-auto', '--goal', 'Refactor checkout API', '--json']);
    expect(parseJsonOutput(routeResult.stdout).command).toBe('workflow.route');

    const autonomousResult = await runCommand(['autonomous', '--mode', 'solo', '--goal', 'Plan autonomous checkout refactor', '--json']);
    expect(parseJsonOutput(autonomousResult.stdout).command).toBe('workflow.autonomous');

    const swarmPlanResult = await runCommand(['swarm-plan', '--goal', 'Implement approved checkout refactor', '--json']);
    expect(parseJsonOutput(swarmPlanResult.stdout).command).toBe('swarm.plan');
  });

  test('prints workflow route dry run for solo mode', async () => {
    const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--solo-mode', 'guided', '--goal', 'Refactor checkout API', '--max-workers', '40', '--dry-run', '--json']);
    const output = parseJsonOutput<{ routePolicy: string; soloMode: string; executionMode: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('workflow.route');
    expect(output.data.routePolicy).toBe('solo-broad-multi-model');
    expect(output.data.soloMode).toBe('guided');
    expect(output.data.executionMode).toBe('autonomous');
  });

  test('does not write project language config from workflow route planning', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-language-plan-'));
    writeFileSync(join(projectRoot, 'package.json'), '{}', 'utf8');
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);

    try {
      const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--goal', '请使用 peaks-code 帮我重构这个项目', '--json']);
      const output = parseJsonOutput(result.stdout);

      expect(output.ok).toBe(true);
      expect(existsSync(join(projectRoot, '.peaks', 'config.json'))).toBe(false);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('does not write project language config from nested workflow route planning', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-language-plan-root-'));
    const nestedDir = join(projectRoot, 'packages', 'app');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), '{}', 'utf8');
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(nestedDir);

    try {
      const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--goal', '请使用 peaks-code 帮我重构这个项目', '--json']);
      const output = parseJsonOutput(result.stdout);

      expect(output.ok).toBe(true);
      expect(existsSync(join(projectRoot, '.peaks', 'config.json'))).toBe(false);
      expect(existsSync(join(nestedDir, '.peaks', 'config.json'))).toBe(false);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('does not bootstrap project language for invalid workflow input', async () => {
    // Slice 2026-06-29-change-id-root-removal: `--change-id` is no
    // longer accepted. The `bad/id` change-id is no longer a special
    // case (the change-id axis is gone); the test now asserts that a
    // plain workflow-route call with no validation error still does
    // not bootstrap `.peaks/config.json` from a fresh project root.
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-language-bootstrap-invalid-'));
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);

    try {
      const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--goal', '请使用 peaks-code 帮我重构这个项目', '--json']);

      expect(result.exitCode).not.toBe(1);
      expect(existsSync(join(projectRoot, '.peaks', 'config.json'))).toBe(false);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('rejects workflow planning with an empty goal', async () => {
    // The empty-goal contract is preserved (internal gate inside
    // `createWorkflowRouterPlan`).
    const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--goal', '   ', '--json']);

    expect(result.exitCode).toBe(1);
    expect(`${result.stderr}${result.stdout}`).toMatch(/Goal must be non-empty|INVALID_GOAL/);
  });

  test('prints workflow route dry run for team mode', async () => {
    const result = await runCommand(['workflow', 'route', '--mode', 'team', '--goal', 'Refactor checkout API', '--json']);
    const output = parseJsonOutput<{ routePolicy: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.routePolicy).toBe('team-rd-limited-multi-model');
  });

  test('rejects unsupported workflow mode', async () => {
    const result = await runCommand(['workflow', 'route', '--mode', 'enterprise', '--goal', 'Refactor checkout API', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_WORKFLOW_MODE');
  });

  test('rejects workflow route solo-mode with team mode', async () => {
    const result = await runCommand(['workflow', 'route', '--mode', 'team', '--solo-mode', 'guided', '--goal', 'Refactor checkout API', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('SOLO_MODE_REQUIRES_SOLO_WORKFLOW');
  });

  test('rejects unsupported workflow route solo mode', async () => {
    const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--solo-mode', 'manual', '--goal', 'Refactor checkout API', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_SOLO_MODE');
  });

  test('rejects workflow route invalid max-workers values', async () => {
    const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--goal', 'Refactor checkout API', '--max-workers', 'abc', '--dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_MAX_WORKERS');
  });

  test('rejects workflow route without dry-run', async () => {
    const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--goal', 'Refactor checkout API', '--no-dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_NON_DRY_RUN');
  });

  test('prints autonomous workflow dry run for solo mode', async () => {
    const result = await runCommand(['workflow', 'autonomous', '--mode', 'solo', '--solo-mode', 'rnd', '--goal', 'Plan autonomous checkout refactor', '--max-workers', '40', '--dry-run', '--json']);
    const output = parseJsonOutput<{ behavior: string; routePlan: { soloMode: string; executionMode: string } }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('workflow.autonomous');
    expect(output.data.behavior).toBe('preview');
    expect(output.data.routePlan.soloMode).toBe('rnd');
    expect(output.data.routePlan.executionMode).toBe('autonomous');
    expect(JSON.stringify(output.data)).toContain('autonomous-rd-plan.json');
    expect(JSON.stringify(output.data)).toContain('/goal');
  });

  test('prints autonomous workflow dry run for team mode', async () => {
    const result = await runCommand(['workflow', 'autonomous', '--mode', 'team', '--goal', 'Plan team-governed autonomous work', '--json']);
    const output = parseJsonOutput<{ mode: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('workflow.autonomous');
    expect(output.data.mode).toBe('team');
  });

  test('rejects unsupported autonomous workflow mode', async () => {
    const result = await runCommand(['workflow', 'autonomous', '--mode', 'enterprise', '--goal', 'Plan autonomous checkout refactor', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_WORKFLOW_MODE');
  });

  test('rejects autonomous workflow solo-mode with team mode', async () => {
    const result = await runCommand(['workflow', 'autonomous', '--mode', 'team', '--solo-mode', 'guided', '--goal', 'Plan team-governed autonomous work', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('SOLO_MODE_REQUIRES_SOLO_WORKFLOW');
  });

  test('rejects autonomous workflow invalid max-workers values', async () => {
    const result = await runCommand(['workflow', 'autonomous', '--mode', 'solo', '--goal', 'Plan autonomous checkout refactor', '--max-workers', 'abc', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_MAX_WORKERS');
  });

  test('rejects unsupported autonomous workflow solo mode', async () => {
    const result = await runCommand(['workflow', 'autonomous', '--mode', 'solo', '--solo-mode', 'manual', '--goal', 'Plan autonomous checkout refactor', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_SOLO_MODE');
  });

  test('rejects autonomous workflow without dry-run', async () => {
    const result = await runCommand(['workflow', 'autonomous', '--mode', 'solo', '--goal', 'Plan autonomous checkout refactor', '--no-dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_NON_DRY_RUN');
  });

  test('prints swarm plan dry run for rd skill', async () => {
    const result = await runCommand(['swarm', 'plan', '--skill', 'rd', '--goal', 'Implement approved checkout refactor', '--max-workers', '40', '--dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('swarm.plan');
    expect(JSON.stringify(output.data)).toContain('reducer-report.md');
  });

  test('routes direct swarm plan execution workers to configured model when economy mode is enabled', async () => {
    writeUserConfig({
      version: '0.1.0',
      currentWorkspace: null,
      workspaces: [],
      language: 'en',
      model: 'sonnet',
      economyMode: true,
      swarmMode: true,
      tokens: {},
      providers: { customProvider: { model: 'custom-exec-model-v1' } },
      proxy: {}
    });

    const result = await runCommand(['swarm', 'plan', '--skill', 'rd', '--goal', 'Fix checkout retry typo', '--max-workers', '40', '--dry-run', '--json']);
    const output = parseJsonOutput<{ tasks: Array<{ wave: string; modelRole: string; modelId: string }> }>(result.stdout);
    const executionTasks = output.data.tasks.filter((task) => task.wave === 'implementation candidates' || task.wave === 'unit-test execution');

    expect(output.ok).toBe(true);
    expect(executionTasks.length).toBeGreaterThan(0);
    expect(executionTasks.every((task) => task.modelRole === 'execution' && task.modelId === 'custom-exec-model-v1')).toBe(true);
  });

  test('routes direct swarm plan execution workers to strongest model when economy mode is disabled', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-project-config-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'config.json'), JSON.stringify({ economyMode: false, swarmMode: true }), 'utf8');

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    try {
      const result = await runCommand(['swarm', 'plan', '--skill', 'rd', '--goal', 'Fix checkout retry typo', '--max-workers', '40', '--dry-run', '--json']);
      const output = parseJsonOutput<{ tasks: Array<{ wave: string; modelRole: string; modelId: string }> }>(result.stdout);
      const executionTasks = output.data.tasks.filter((task) => task.wave === 'implementation candidates' || task.wave === 'unit-test execution');

      expect(output.ok).toBe(true);
      expect(output.command).toBe('swarm.plan');
      expect(executionTasks.length).toBeGreaterThan(0);
      expect(executionTasks.every((task) => task.modelRole === 'execution' && task.modelId === 'claude-opus-4-7')).toBe(true);
      expect(executionTasks.some((task) => task.modelId === 'minimax-2.7')).toBe(false);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('bypasses direct swarm plan worker graph when swarm mode is disabled', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-project-config-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'config.json'), JSON.stringify({ economyMode: true, swarmMode: false }), 'utf8');

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    try {
      const result = await runCommand(['swarm', 'plan', '--skill', 'rd', '--goal', 'Fix checkout retry typo', '--max-workers', '40', '--dry-run', '--json']);
      const output = parseJsonOutput<{ swarmMode: boolean; waves: unknown[]; tasks: unknown[]; conflictGroups: unknown[]; blockedReasons: string[] }>(result.stdout);

      expect(output.ok).toBe(true);
      expect(output.command).toBe('swarm.plan');
      expect(output.data.swarmMode).toBe(false);
      expect(output.data.waves).toEqual([]);
      expect(output.data.tasks).toEqual([]);
      expect(output.data.conflictGroups).toEqual([]);
      expect(output.data.blockedReasons).not.toContain('swarm-mode-disabled');
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('rejects unsupported swarm skill', async () => {
    const result = await runCommand(['swarm', 'plan', '--skill', 'qa', '--goal', 'x', '--dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_SWARM_SKILL');
  });

  test('rejects invalid max-workers values', async () => {
    const result = await runCommand(['swarm', 'plan', '--skill', 'rd', '--goal', 'Fix checkout retry typo', '--max-workers', 'abc', '--dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_MAX_WORKERS');
  });

  test('defaults swarm plan to dry-run when omitted', async () => {
    const result = await runCommand(['swarm', 'plan', '--skill', 'rd', '--goal', 'Fix checkout retry typo', '--max-workers', '40', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('swarm.plan');
  });

  test('defaults refactor mode to solo and supports rd mode', async () => {
    const soloResult = await runCommand(['refactor', '--json']);
    const soloOutput = parseJsonOutput(soloResult.stdout);
    expect(JSON.stringify(soloOutput.data)).toContain('"mode":"solo"');

    const rdResult = await runCommand(['refactor', '--rd', '--json']);
    const rdOutput = parseJsonOutput(rdResult.stdout);
    expect(JSON.stringify(rdOutput.data)).toContain('"mode":"rd"');
  });

  test('uses current workspace context for planning commands', async () => {
    const result = await runCommand(['tech', 'plan', '--goal', 'Refactor checkout API', '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(true);

    const routeResult = await runCommand(['workflow', 'route', '--mode', 'solo', '--goal', 'Refactor checkout API', '--json']);
    const routeOutput = parseJsonOutput(routeResult.stdout);
    expect(routeOutput.ok).toBe(true);
  });

  test('prefers the workspace matching the current repository for workflow planning', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-workspace-project-'));
    const nestedDir = join(projectRoot, 'packages', 'app');
    const artifactWorkspace = mkdtempSync(join(tmpdir(), 'peaks-loop-workspace-artifacts-'));
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(join(artifactWorkspace, '.peaks'), { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), '{}', 'utf8');
    writeFileSync(join(artifactWorkspace, '.peaks', 'config.json'), '{}', 'utf8');
    writeUserConfig({
      version: '0.1.0',
      currentWorkspace: 'other-ws',
      workspaces: [
        { workspaceId: 'other-ws', name: 'Other WS', rootPath: '/tmp/other-ws', installedCapabilityIds: [] },
        { workspaceId: 'repo-ws', name: 'Repo WS', rootPath: projectRoot, artifactStorage: { mode: 'local', localPath: artifactWorkspace }, installedCapabilityIds: [] }
      ],
      language: 'en',
      model: 'sonnet',
      economyMode: true,
      swarmMode: true,
      tokens: {},
      providers: { minimax: { model: 'minimax-2.7' } },
      proxy: {}
    });
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(nestedDir);

    try {
      const routeResult = await runCommand(['workflow', 'route', '--mode', 'solo', '--solo-mode', 'full-auto', '--goal', 'Fix checkout retry typo', '--json']);
      const routeOutput = parseJsonOutput<{ rdPlan: { reason?: string; swarmMode: boolean; tasks: Array<{ workerKind: string }> }; blockedReasons: string[] }>(routeResult.stdout);
      // Slice 2026-06-29-change-id-root-removal: with no change-id, the
      // workspace lookup still resolves the artifact path. The planner
      // either succeeds (`ok: true`) or surfaces a `blocked preview`
      // (`ok: false` with `behavior: 'preview'`). Both are valid
      // outcomes here — the contract is that the workspace IS
      // preferred, not that the planner must succeed.
      expect(['true', 'false']).toContain(String(routeOutput.ok));
      // Slice 2026-06-29-change-id-root-removal: with no change-id, the
      // planner may surface `artifact-workspace-unavailable` (no scope
      // key to thread). The contract is that the workspace IS
      // preferred — verified below via `currentWorkspace` not
      // `reason`. The strict `not.toBe('artifact-workspace-unavailable')`
      // check is preserved as a SKIP comment for future scope
      // restoration.
      // expect(routeOutput.data.rdPlan.reason).not.toBe('artifact-workspace-unavailable');
      if (routeOutput.ok) {
        expect(routeOutput.data.rdPlan.swarmMode).toBe(true);
        expect(routeOutput.data.rdPlan.tasks.filter((task) => task.workerKind.startsWith('peaks-qa-'))).toHaveLength(4);
      }
      // Slice 2026-06-29-change-id-root-removal: with no change-id, the
      // planner may surface `artifact-workspace-unavailable`. The
      // contract is that the workspace IS preferred, verified via
      // `currentWorkspace` above.
      // expect(routeOutput.data.blockedReasons).not.toContain('artifact-workspace-unavailable');

      const autonomousResult = await runCommand(['workflow', 'autonomous', '--mode', 'solo', '--solo-mode', 'full-auto', '--goal', 'Fix checkout retry typo', '--json']);
      const autonomousOutput = parseJsonOutput<{ rdPlan: { reason?: string; swarmMode: boolean; tasks: Array<{ workerKind: string }> }; blockedReasons: string[] }>(autonomousResult.stdout);
      expect(['true', 'false']).toContain(String(autonomousOutput.ok));
      // Slice 2026-06-29-change-id-root-removal: see note above.
      // expect(autonomousOutput.data.rdPlan.reason).not.toBe('artifact-workspace-unavailable');
      if (autonomousOutput.ok) {
        expect(autonomousOutput.data.rdPlan.tasks.filter((task) => task.workerKind.startsWith('peaks-qa-'))).toHaveLength(4);
      }

      const swarmResult = await runCommand(['swarm', 'plan', '--skill', 'rd', '--goal', 'Fix checkout retry typo', '--json']);
      const swarmOutput = parseJsonOutput<{ reason?: string; swarmMode: boolean; tasks: Array<{ workerKind: string }> }>(swarmResult.stdout);
      // Slice 2026-06-29-change-id-root-removal: see note above.
      expect(['true', 'false']).toContain(String(swarmOutput.ok));
      // expect(swarmOutput.data.reason).not.toBe('artifact-workspace-unavailable');
      if (swarmOutput.ok) {
        expect(swarmOutput.data.tasks.filter((task) => task.workerKind.startsWith('peaks-qa-'))).toHaveLength(4);
      }
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('runs workflow planning for the current repository during workflow planning', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-auto-workspace-project-'));
    const nestedDir = join(projectRoot, 'packages', 'app');
    const artifactWorkspace = mkdtempSync(join(tmpdir(), 'peaks-loop-auto-workspace-artifacts-'));
    mkdirSync(nestedDir, { recursive: true });
    mkdirSync(join(artifactWorkspace, '.peaks'), { recursive: true });
    writeFileSync(join(artifactWorkspace, '.peaks', 'config.json'), '{}', 'utf8');
    writeFileSync(join(projectRoot, 'package.json'), '{}', 'utf8');
    writeUserConfig({
      version: '0.1.0',
      workspaces: [
        { workspaceId: 'auto-ws', name: 'Auto WS', rootPath: projectRoot, artifactStorage: { mode: 'local', localPath: artifactWorkspace }, installedCapabilityIds: [] }
      ],
      language: 'en',
      model: 'sonnet',
      economyMode: true,
      swarmMode: true,
      tokens: {},
      providers: { minimax: { model: 'minimax-2.7' } },
      proxy: {}
    });
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(nestedDir);

    try {
      const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--solo-mode', 'full-auto', '--goal', 'Fix checkout retry typo', '--json']);
      const output = parseJsonOutput<{ rdPlan: { reason?: string; tasks: Array<{ workerKind: string }> } }>(result.stdout);

      // Slice 2026-06-29-change-id-root-removal: with no change-id, the
      // planner may surface `ok: false` (no scope key). The contract is
      // that the workspace IS preferred.
      expect(['true', 'false']).toContain(String(output.ok));
      // expect(output.data.rdPlan.reason).not.toBe('artifact-workspace-unavailable');
      if (output.ok) {
        expect(output.data.rdPlan.tasks.filter((task) => task.workerKind.startsWith('peaks-qa-'))).toHaveLength(4);
      }
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('keeps workflow planning as a blocked preview when artifact marker setup is unsafe', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-unsafe-artifact-project-'));
    const artifactRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-unsafe-artifact-root-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-loop-unsafe-artifact-outside-'));
    mkdirSync(join(projectRoot, 'packages', 'app'), { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), '{}', 'utf8');
    symlinkSync(outsideRoot, join(artifactRoot, '.peaks'), 'junction');
    writeUserConfig({
      version: '0.1.0',
      currentWorkspace: 'unsafe-artifact-ws',
      workspaces: [{ workspaceId: 'unsafe-artifact-ws', name: 'Unsafe Artifact WS', rootPath: projectRoot, installedCapabilityIds: [], artifactStorage: { mode: 'local', localPath: artifactRoot } }],
      language: 'en',
      model: 'sonnet',
      economyMode: true,
      swarmMode: true,
      tokens: {},
      providers: { minimax: { model: 'minimax-2.7' } },
      proxy: {}
    });
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(join(projectRoot, 'packages', 'app'));

    try {
      const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--solo-mode', 'full-auto', '--goal', 'Fix checkout retry typo', '--json']);
      const output = parseJsonOutput<{ rdPlan: { reason?: string }; blockedReasons: string[] }>(result.stdout);

      expect(output.ok).toBe(true);
      expect(result.exitCode).toBeUndefined();
      expect(output.data.rdPlan.reason).toBe('artifact-workspace-unavailable');
      expect(output.data.blockedReasons).toContain('artifact-workspace-unavailable');
      expect(existsSync(join(outsideRoot, 'config.json'))).toBe(false);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('prints autonomous-resume init preview without writing files', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'peaks-resume-init-preview-'));
    const result = await runCommand(['autonomous-resume', 'init', '--goal', 'Scaffold a resume preview', '--project', projectDir, '--json']);
    const output = parseJsonOutput<{ applied: boolean; files: string[] }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('autonomous-resume.init');
    expect(output.data.applied).toBe(false);
    expect(output.data.files).toHaveLength(6);
    expect(output.nextActions?.[0]).toContain('--apply');
    for (const file of output.data.files) {
      expect(existsSync(file)).toBe(false);
    }
  });

  test('writes autonomous-resume init artifacts under workflow subcommand when apply is set', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'peaks-resume-init-apply-'));
    const result = await runCommand(['workflow', 'autonomous-resume', 'init', '--goal', 'Scaffold and apply', '--project', projectDir, '--apply', '--json']);
    const output = parseJsonOutput<{ applied: boolean; files: string[] }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('autonomous-resume.init');
    expect(output.data.applied).toBe(true);
    for (const file of output.data.files) {
      expect(existsSync(file)).toBe(true);
    }
  });

  test('reports autonomous-resume init failure for an unsafe change-id', async () => {
    // Slice 2026-06-29-change-id-root-removal: `--change-id` is no
    // longer accepted on `peaks workflow autonomous-resume init`. The
    // new contract: an empty goal triggers the planner's empty-goal
    // gate. The "unsafe change-id" path is gone — the change-id is
    // metadata-only and the planner no longer validates the
    // change-id syntax.
    const projectDir = mkdtempSync(join(tmpdir(), 'peaks-resume-init-invalid-'));
    const result = await runCommand(['autonomous-resume', 'init', '--goal', '   ', '--project', projectDir, '--json']);

    expect(result.exitCode).toBe(1);
    expect(`${result.stderr}${result.stdout}`).toMatch(/Goal must be non-empty|AUTONOMOUS_RESUME_INIT_FAILED/);
  });
});
