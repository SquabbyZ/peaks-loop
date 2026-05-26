import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

describe('createProgram workflow commands', () => {

  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  test('prints tech plan dry run', async () => {
    const result = await runCommand(['tech', 'plan', '--change-id', 'checkout-refactor', '--goal', 'Refactor checkout API', '--swarm', '--dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('tech.plan');
    expect(JSON.stringify(output.data)).toContain('tech-task-graph.json');
  });

  test('defaults tech plan swarm mode off when omitted', async () => {
    const result = await runCommand(['tech', 'plan', '--change-id', 'checkout-refactor', '--goal', 'Refactor checkout API', '--dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('tech.plan');
  });

  test('rejects tech plan without dry-run', async () => {
    const result = await runCommand(['tech', 'plan', '--change-id', 'checkout-refactor', '--goal', 'Refactor checkout API', '--swarm', '--no-dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_NON_DRY_RUN');
  });

  test('defaults tech plan to dry-run when omitted', async () => {
    const result = await runCommand(['tech', 'plan', '--change-id', 'checkout-refactor', '--goal', 'Refactor checkout API', '--swarm', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('tech.plan');
  });

  test('prints tech status', async () => {
    const result = await runCommand(['tech', 'status', '--change-id', 'checkout-refactor', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('tech.status');
  });

  test('prints simplified top-level planning commands', async () => {
    const techPlanResult = await runCommand(['tech-plan', '--change-id', 'checkout-refactor', '--goal', 'Refactor checkout API', '--swarm', '--json']);
    expect(parseJsonOutput(techPlanResult.stdout).command).toBe('tech.plan');

    const techStatusResult = await runCommand(['tech-status', '--change-id', 'checkout-refactor', '--json']);
    expect(parseJsonOutput(techStatusResult.stdout).command).toBe('tech.status');

    const routeResult = await runCommand(['route', '--mode', 'solo', '--solo-mode', 'full-auto', '--change-id', 'checkout-refactor', '--goal', 'Refactor checkout API', '--json']);
    expect(parseJsonOutput(routeResult.stdout).command).toBe('workflow.route');

    const autonomousResult = await runCommand(['autonomous', '--mode', 'solo', '--change-id', 'autonomous-checkout', '--goal', 'Plan autonomous checkout refactor', '--json']);
    expect(parseJsonOutput(autonomousResult.stdout).command).toBe('workflow.autonomous');

    const swarmPlanResult = await runCommand(['swarm-plan', '--change-id', 'checkout-refactor', '--goal', 'Implement approved checkout refactor', '--json']);
    expect(parseJsonOutput(swarmPlanResult.stdout).command).toBe('swarm.plan');
  });

  test('prints workflow route dry run for solo mode', async () => {
    const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--solo-mode', 'guided', '--change-id', 'checkout-refactor', '--goal', 'Refactor checkout API', '--max-workers', '40', '--dry-run', '--json']);
    const output = parseJsonOutput<{ routePolicy: string; soloMode: string; executionMode: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('workflow.route');
    expect(output.data.routePolicy).toBe('solo-broad-multi-model');
    expect(output.data.soloMode).toBe('guided');
    expect(output.data.executionMode).toBe('autonomous');
  });

  test('does not write project language config from workflow route planning', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-language-plan-'));
    writeFileSync(join(projectRoot, 'package.json'), '{}', 'utf8');
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);

    try {
      const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--change-id', 'language-plan', '--goal', '请使用 peaks-solo 帮我重构这个项目', '--json']);
      const output = parseJsonOutput(result.stdout);

      expect(output.ok).toBe(true);
      expect(existsSync(join(projectRoot, '.peaks', 'config.json'))).toBe(false);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('does not write project language config from nested workflow route planning', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-language-plan-root-'));
    const nestedDir = join(projectRoot, 'packages', 'app');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), '{}', 'utf8');
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(nestedDir);

    try {
      const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--change-id', 'nested-language-plan', '--goal', '请使用 peaks-solo 帮我重构这个项目', '--json']);
      const output = parseJsonOutput(result.stdout);

      expect(output.ok).toBe(true);
      expect(existsSync(join(projectRoot, '.peaks', 'config.json'))).toBe(false);
      expect(existsSync(join(nestedDir, '.peaks', 'config.json'))).toBe(false);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('does not bootstrap project language for invalid workflow input', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-language-bootstrap-invalid-'));
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);

    try {
      const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--change-id', 'bad/id', '--goal', '请使用 peaks-solo 帮我重构这个项目', '--json']);
      const output = parseJsonOutput(result.stdout);

      expect(output.ok).toBe(false);
      expect(output.code).toBe('INVALID_CHANGE_ID_OR_GOAL');
      expect(existsSync(join(projectRoot, '.peaks', 'config.json'))).toBe(false);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('rejects workflow planning with an empty goal', async () => {
    const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--change-id', 'empty-goal', '--goal', '   ', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_CHANGE_ID_OR_GOAL');
    expect(result.exitCode).toBe(1);
  });

  test('prints workflow route dry run for team mode', async () => {
    const result = await runCommand(['workflow', 'route', '--mode', 'team', '--change-id', 'checkout-refactor', '--goal', 'Refactor checkout API', '--json']);
    const output = parseJsonOutput<{ routePolicy: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.data.routePolicy).toBe('team-rd-limited-multi-model');
  });

  test('rejects unsupported workflow mode', async () => {
    const result = await runCommand(['workflow', 'route', '--mode', 'enterprise', '--change-id', 'checkout-refactor', '--goal', 'Refactor checkout API', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_WORKFLOW_MODE');
  });

  test('rejects workflow route solo-mode with team mode', async () => {
    const result = await runCommand(['workflow', 'route', '--mode', 'team', '--solo-mode', 'guided', '--change-id', 'checkout-refactor', '--goal', 'Refactor checkout API', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('SOLO_MODE_REQUIRES_SOLO_WORKFLOW');
  });

  test('rejects unsupported workflow route solo mode', async () => {
    const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--solo-mode', 'manual', '--change-id', 'checkout-refactor', '--goal', 'Refactor checkout API', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_SOLO_MODE');
  });

  test('rejects workflow route invalid max-workers values', async () => {
    const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--change-id', 'checkout-refactor', '--goal', 'Refactor checkout API', '--max-workers', 'abc', '--dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_MAX_WORKERS');
  });

  test('rejects workflow route without dry-run', async () => {
    const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--change-id', 'checkout-refactor', '--goal', 'Refactor checkout API', '--no-dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_NON_DRY_RUN');
  });

  test('prints autonomous workflow dry run for solo mode', async () => {
    const result = await runCommand(['workflow', 'autonomous', '--mode', 'solo', '--solo-mode', 'rnd', '--change-id', 'autonomous-checkout', '--goal', 'Plan autonomous checkout refactor', '--max-workers', '40', '--dry-run', '--json']);
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
    const result = await runCommand(['workflow', 'autonomous', '--mode', 'team', '--change-id', 'team-autonomous', '--goal', 'Plan team-governed autonomous work', '--json']);
    const output = parseJsonOutput<{ mode: string }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('workflow.autonomous');
    expect(output.data.mode).toBe('team');
  });

  test('rejects unsupported autonomous workflow mode', async () => {
    const result = await runCommand(['workflow', 'autonomous', '--mode', 'enterprise', '--change-id', 'autonomous-checkout', '--goal', 'Plan autonomous checkout refactor', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_WORKFLOW_MODE');
  });

  test('rejects autonomous workflow solo-mode with team mode', async () => {
    const result = await runCommand(['workflow', 'autonomous', '--mode', 'team', '--solo-mode', 'guided', '--change-id', 'team-autonomous', '--goal', 'Plan team-governed autonomous work', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('SOLO_MODE_REQUIRES_SOLO_WORKFLOW');
  });

  test('rejects autonomous workflow invalid max-workers values', async () => {
    const result = await runCommand(['workflow', 'autonomous', '--mode', 'solo', '--change-id', 'autonomous-checkout', '--goal', 'Plan autonomous checkout refactor', '--max-workers', 'abc', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_MAX_WORKERS');
  });

  test('rejects unsupported autonomous workflow solo mode', async () => {
    const result = await runCommand(['workflow', 'autonomous', '--mode', 'solo', '--solo-mode', 'manual', '--change-id', 'autonomous-checkout', '--goal', 'Plan autonomous checkout refactor', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_SOLO_MODE');
  });

  test('rejects autonomous workflow without dry-run', async () => {
    const result = await runCommand(['workflow', 'autonomous', '--mode', 'solo', '--change-id', 'autonomous-checkout', '--goal', 'Plan autonomous checkout refactor', '--no-dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_NON_DRY_RUN');
  });

  test('prints swarm plan dry run for rd skill', async () => {
    const result = await runCommand(['swarm', 'plan', '--skill', 'rd', '--change-id', 'checkout-refactor', '--goal', 'Implement approved checkout refactor', '--max-workers', '40', '--dry-run', '--json']);
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

    const result = await runCommand(['swarm', 'plan', '--skill', 'rd', '--change-id', 'cli-economy-swarm', '--goal', 'Fix checkout retry typo', '--max-workers', '40', '--dry-run', '--json']);
    const output = parseJsonOutput<{ tasks: Array<{ wave: string; modelRole: string; modelId: string }> }>(result.stdout);
    const executionTasks = output.data.tasks.filter((task) => task.wave === 'implementation candidates' || task.wave === 'unit-test execution');

    expect(output.ok).toBe(true);
    expect(executionTasks.length).toBeGreaterThan(0);
    expect(executionTasks.every((task) => task.modelRole === 'execution' && task.modelId === 'custom-exec-model-v1')).toBe(true);
  });

  test('routes direct swarm plan execution workers to strongest model when economy mode is disabled', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-project-config-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'config.json'), JSON.stringify({ economyMode: false, swarmMode: true }), 'utf8');

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    try {
      const result = await runCommand(['swarm', 'plan', '--skill', 'rd', '--change-id', 'cli-no-economy-swarm', '--goal', 'Fix checkout retry typo', '--max-workers', '40', '--dry-run', '--json']);
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
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-project-config-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'config.json'), JSON.stringify({ economyMode: true, swarmMode: false }), 'utf8');

    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    try {
      const result = await runCommand(['swarm', 'plan', '--skill', 'rd', '--change-id', 'cli-no-swarm', '--goal', 'Fix checkout retry typo', '--max-workers', '40', '--dry-run', '--json']);
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
    const result = await runCommand(['swarm', 'plan', '--skill', 'qa', '--change-id', 'checkout-refactor', '--goal', 'x', '--dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_SWARM_SKILL');
  });

  test('rejects invalid max-workers values', async () => {
    const result = await runCommand(['swarm', 'plan', '--skill', 'rd', '--change-id', 'checkout-refactor', '--goal', 'Fix checkout retry typo', '--max-workers', 'abc', '--dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_MAX_WORKERS');
  });

  test('defaults swarm plan to dry-run when omitted', async () => {
    const result = await runCommand(['swarm', 'plan', '--skill', 'rd', '--change-id', 'checkout-refactor', '--goal', 'Fix checkout retry typo', '--max-workers', '40', '--json']);
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
    await runCommand(['config', 'workspace', 'add', '--id', 'workflow-ws', '--name', 'Workflow WS', '--path', '/tmp/workflow-ws', '--json']);
    await runCommand(['config', 'workspace', 'switch', '--id', 'workflow-ws', '--json']);

    const result = await runCommand(['tech', 'plan', '--change-id', 'checkout-refactor', '--goal', 'Refactor checkout API', '--json']);
    const output = parseJsonOutput(result.stdout);
    expect(output.ok).toBe(true);

    const routeResult = await runCommand(['workflow', 'route', '--mode', 'solo', '--change-id', 'checkout-refactor', '--goal', 'Refactor checkout API', '--json']);
    const routeOutput = parseJsonOutput(routeResult.stdout);
    expect(routeOutput.ok).toBe(true);

    await runCommand(['config', 'workspace', 'remove', '--id', 'workflow-ws', '--json']);
  });

  test('prefers the workspace matching the current repository for workflow planning', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-workspace-project-'));
    const nestedDir = join(projectRoot, 'packages', 'app');
    const artifactWorkspace = mkdtempSync(join(tmpdir(), 'peaks-cli-workspace-artifacts-'));
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
      const routeResult = await runCommand(['workflow', 'route', '--mode', 'solo', '--solo-mode', 'full-auto', '--change-id', 'repo-workspace-route', '--goal', 'Fix checkout retry typo', '--json']);
      const routeOutput = parseJsonOutput<{ rdPlan: { reason?: string; swarmMode: boolean; tasks: Array<{ workerKind: string }> }; blockedReasons: string[] }>(routeResult.stdout);
      expect(routeOutput.ok).toBe(true);
      expect(routeOutput.data.rdPlan.reason).not.toBe('artifact-workspace-unavailable');
      expect(routeOutput.data.rdPlan.swarmMode).toBe(true);
      expect(routeOutput.data.rdPlan.tasks.filter((task) => task.workerKind.startsWith('peaks-qa-'))).toHaveLength(4);
      expect(routeOutput.data.blockedReasons).not.toContain('artifact-workspace-unavailable');

      const autonomousResult = await runCommand(['workflow', 'autonomous', '--mode', 'solo', '--solo-mode', 'full-auto', '--change-id', 'repo-workspace-auto', '--goal', 'Fix checkout retry typo', '--json']);
      const autonomousOutput = parseJsonOutput<{ rdPlan: { reason?: string; swarmMode: boolean; tasks: Array<{ workerKind: string }> }; blockedReasons: string[] }>(autonomousResult.stdout);
      expect(autonomousOutput.ok).toBe(true);
      expect(autonomousOutput.data.rdPlan.reason).not.toBe('artifact-workspace-unavailable');
      expect(autonomousOutput.data.rdPlan.tasks.filter((task) => task.workerKind.startsWith('peaks-qa-'))).toHaveLength(4);

      const swarmResult = await runCommand(['swarm', 'plan', '--skill', 'rd', '--change-id', 'repo-workspace-swarm', '--goal', 'Fix checkout retry typo', '--json']);
      const swarmOutput = parseJsonOutput<{ reason?: string; swarmMode: boolean; tasks: Array<{ workerKind: string }> }>(swarmResult.stdout);
      expect(swarmOutput.ok).toBe(true);
      expect(swarmOutput.data.reason).not.toBe('artifact-workspace-unavailable');
      expect(swarmOutput.data.tasks.filter((task) => task.workerKind.startsWith('peaks-qa-'))).toHaveLength(4);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('bootstraps a global workspace for the current repository during workflow planning', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-auto-workspace-project-'));
    const nestedDir = join(projectRoot, 'packages', 'app');
    mkdirSync(nestedDir, { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), '{}', 'utf8');
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(nestedDir);

    try {
      const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--solo-mode', 'full-auto', '--change-id', 'auto-workspace-route', '--goal', 'Fix checkout retry typo', '--json']);
      const output = parseJsonOutput<{ rdPlan: { reason?: string; tasks: Array<{ workerKind: string }> } }>(result.stdout);
      const workspaceListResult = await runCommand(['config', 'workspace', 'list', '--json']);
      const workspaceList = parseJsonOutput<{ currentWorkspace: string | null; workspaces: Array<{ workspaceId: string; rootPath: string; artifactStorage?: { localPath?: string } }> }>(workspaceListResult.stdout);
      const workspace = workspaceList.data.workspaces.find((item) => item.workspaceId.startsWith('peaks-cli-auto-workspace-project-'));

      expect(output.ok).toBe(true);
      expect(output.data.rdPlan.reason).not.toBe('artifact-workspace-unavailable');
      expect(output.data.rdPlan.tasks.filter((task) => task.workerKind.startsWith('peaks-qa-'))).toHaveLength(4);
      expect(workspace).toBeDefined();
      expect(workspaceList.data.currentWorkspace).toBe(workspace?.workspaceId);
      expect(workspace?.artifactStorage?.localPath).toBeDefined();
      expect(existsSync(join(workspace?.artifactStorage?.localPath ?? '', '.peaks', 'config.json'))).toBe(true);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('keeps workflow planning as a blocked preview when artifact marker setup is unsafe', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-unsafe-artifact-project-'));
    const artifactRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-unsafe-artifact-root-'));
    const outsideRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-unsafe-artifact-outside-'));
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
      const result = await runCommand(['workflow', 'route', '--mode', 'solo', '--solo-mode', 'full-auto', '--change-id', 'unsafe-artifact-route', '--goal', 'Fix checkout retry typo', '--json']);
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
    const result = await runCommand(['autonomous-resume', 'init', '--change-id', 'resume-cli-preview', '--goal', 'Scaffold a resume preview', '--project', projectDir, '--json']);
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
    const result = await runCommand(['workflow', 'autonomous-resume', 'init', '--change-id', 'resume-cli-apply', '--goal', 'Scaffold and apply', '--project', projectDir, '--apply', '--json']);
    const output = parseJsonOutput<{ applied: boolean; files: string[] }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('autonomous-resume.init');
    expect(output.data.applied).toBe(true);
    for (const file of output.data.files) {
      expect(existsSync(file)).toBe(true);
    }
  });

  test('reports autonomous-resume init failure for an unsafe change-id', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'peaks-resume-init-invalid-'));
    const result = await runCommand(['autonomous-resume', 'init', '--change-id', '../escape', '--goal', 'Unsafe', '--project', projectDir, '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('AUTONOMOUS_RESUME_INIT_FAILED');
    expect(output.message).toMatch(/Invalid change-id/);
    expect(result.exitCode).toBe(1);
  });
});
