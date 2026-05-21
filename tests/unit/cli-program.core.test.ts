import { existsSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { parseJsonOutput, resetCliProgramMocks, runCommand, writeUserConfig } from './cli-program-test-utils.js';

describe('createProgram', () => {

  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
  });

  test('prints skill list as JSON envelope', async () => {
    const result = await runCommand(['skill', 'list', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('skill.list');
    expect(JSON.stringify(output.data)).toContain('peaks-solo');
  });

  test('prints doctor as JSON envelope', async () => {
    const result = await runCommand(['doctor', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('doctor');
  });

  test('prints profile list', async () => {
    const result = await runCommand(['profile', 'list', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(JSON.stringify(output.data)).toContain('strict-refactor');
  });

  test('prints proxy validation errors', async () => {
    const result = await runCommand(['proxy', 'test', '--proxy', '127.0.0.1:58309', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_PROXY');
    expect(result.exitCode).toBe(1);
  });

  test('rejects non-dry-run proxy tests', async () => {
    const result = await runCommand(['proxy', 'test', '--proxy', 'http://127.0.0.1:58309', '--no-dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_NON_DRY_RUN');
    expect(result.exitCode).toBe(1);
  });

  test('prints GitLab artifact init dry-run', async () => {
    const result = await runCommand(['artifacts', 'init', '--provider', 'gitlab', '--name', 'artifacts', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(JSON.stringify(output.data)).toContain('gitlab');
  });

  test('rejects unsupported artifact provider', async () => {
    const result = await runCommand(['artifacts', 'init', '--provider', 'gitea', '--name', 'artifacts', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_ARTIFACT_PROVIDER');
  });

  test('rejects non-dry-run artifact init', async () => {
    const result = await runCommand(['artifacts', 'init', '--provider', 'gitlab', '--name', 'artifacts', '--no-dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_NON_DRY_RUN');
  });

  test('prints refactor hard gates', async () => {
    const result = await runCommand(['refactor', '--solo', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(JSON.stringify(output.data)).toContain('Require UT coverage >= 95%');
  });

  test('prints standards init dry-run as JSON envelope', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-standards-'));
    const result = await runCommand(['standards', 'init', '--project', projectRoot, '--language', 'typescript', '--json']);
    const output = parseJsonOutput<{ apply: boolean; language: string; skillPreflight: { appliesTo: string[] }; plannedWrites: Array<{ relativePath: string; status: string }> }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('standards.init');
    expect(output.data.apply).toBe(false);
    expect(output.data.language).toBe('typescript');
    expect(output.data.skillPreflight.appliesTo).toEqual(['peaks-rd', 'peaks-qa', 'peaks-solo']);
    expect(output.data.plannedWrites.map((write) => write.relativePath)).toContain('.claude/rules/common/security.md');
  });

  test('applies standards init with detected language when language is omitted', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-standards-apply-'));
    writeFileSync(join(projectRoot, 'tsconfig.json'), '{}', 'utf8');

    const result = await runCommand(['standards', 'init', '--project', projectRoot, '--apply', '--json']);
    const output = parseJsonOutput<{ apply: boolean; language: string; writtenFiles: string[] }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('standards.init');
    expect(output.data.apply).toBe(true);
    expect(output.data.language).toBe('typescript');
    expect(output.data.writtenFiles).toContain('CLAUDE.md');
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(true);
  });

  test('rejects conflicting standards init dry-run and apply flags', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-standards-conflict-'));
    const result = await runCommand(['standards', 'init', '--project', projectRoot, '--dry-run', '--apply', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('INVALID_STANDARDS_INIT_FLAGS');
    expect(result.exitCode).toBe(1);
    expect(existsSync(join(projectRoot, 'CLAUDE.md'))).toBe(false);
  });

  test('rejects invalid standards language', async () => {
    const result = await runCommand(['standards', 'init', '--project', process.cwd(), '--language', 'type/script', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('STANDARDS_INIT_FAILED');
    expect(result.exitCode).toBe(1);
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

  test('prints non-json profile output', async () => {
    const result = await runCommand(['profile', 'list']);

    expect(result.stdout.join('\n')).toContain('strict-refactor');
  });

  test('prints non-json proxy errors to stderr', async () => {
    const result = await runCommand(['proxy', 'test', '--proxy', 'bad']);

    expect(result.stderr.join('\n')).toContain('INVALID_PROXY');
  });

  test('prints skill doctor checks', async () => {
    const result = await runCommand(['skill', 'doctor', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.command).toBe('skill.doctor');
  });

  test('rejects conflicting refactor modes', async () => {
    const result = await runCommand(['refactor', '--solo', '--rd', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('CONFLICTING_REFACTOR_MODE');
  });

  test('rejects non-dry-run refactor', async () => {
    const result = await runCommand(['refactor', '--no-dry-run', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_NON_DRY_RUN');
  });

  test('prints recommendation plan as JSON envelope', async () => {
    const result = await runCommand(['recommend', '--workflow', 'code-refactor', '--language', 'zh-CN', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('recommend');
    expect(JSON.stringify(output.data)).toContain('code-refactor');
    expect(JSON.stringify(output.data)).toContain('zh-CN');
  });

  test('uses stored config language for recommendation reports when omitted', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-project-'));
    mkdirSync(join(projectRoot, '.peaks'), { recursive: true });
    writeFileSync(join(projectRoot, '.peaks', 'config.json'), JSON.stringify({ language: 'zh-CN' }), 'utf8');
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);

    try {
      const result = await runCommand(['recommend', '--workflow', 'code-refactor', '--json']);
      const output = parseJsonOutput<{ presentation: { language: string; summary: string } }>(result.stdout);

      expect(output.ok).toBe(true);
      expect(output.data.presentation.language).toBe('zh-CN');
      expect(output.data.presentation.summary).toContain('代码重构');
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('rejects unsupported recommendation workflow', async () => {
    const result = await runCommand(['recommend', '--workflow', 'unknown', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_RECOMMENDATION_WORKFLOW');
  });

  test('prints capability status as JSON envelope', async () => {
    const result = await runCommand(['capability', 'status', '--json']);
    const output = parseJsonOutput(result.stdout);
    const serializedData = JSON.stringify(output.data);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('capability.status');
    expect(serializedData).toContain('everything-claude-code.code-review-agent');
    expect(serializedData).toContain('"sources":[{"sourceId":"ruflo-access-repo"');
  });

  test('prints capability map through top-level and compatibility commands', async () => {
    const result = await runCommand(['capabilities', '--json']);
    const output = parseJsonOutput<{ proxyPolicy?: { httpProxy: string }; sources: Array<{ sourceGroup: string }>; constraints: string[]; availability: Array<{ capabilityId: string; status: string }> }>(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('capabilities.map');
    expect(output.data.proxyPolicy).toBeUndefined();
    expect(output.data.constraints.join('\n')).not.toContain('HTTP proxy');
    expect(output.data.sources.some((source) => source.sourceGroup === 'access-repo')).toBe(true);
    expect(output.data.sources.some((source) => source.sourceGroup === 'mcp-server')).toBe(true);
    expect(output.data.availability.find((item) => item.capabilityId === 'context7.docs-lookup')?.status).toBe('unknown');

    writeUserConfig({ proxy: { httpProxy: 'https://proxy.example:8443' } });
    const configuredResult = await runCommand(['capabilities', '--json']);
    const configuredOutput = parseJsonOutput<{ proxyPolicy?: { httpProxy: string } }>(configuredResult.stdout);
    expect(configuredOutput.data.proxyPolicy?.httpProxy).toBe('https://proxy.example:8443');

    const nestedResult = await runCommand(['capability', 'map', '--source', 'mcp-server', '--json']);
    const nestedOutput = parseJsonOutput<{ proxyPolicy?: { httpProxy: string }; sources: Array<{ sourceGroup: string }> }>(nestedResult.stdout);
    expect(nestedOutput.command).toBe('capabilities.map');
    expect(nestedOutput.data.proxyPolicy?.httpProxy).toBe('https://proxy.example:8443');
    expect(nestedOutput.data.sources.every((source) => source.sourceGroup === 'mcp-server')).toBe(true);

    const plainResult = await runCommand(['capability', 'map', '--source', 'access-repo']);
    expect(plainResult.stdout.join('\n')).not.toContain('http://127.0.0.1:58309');
    expect(plainResult.stdout.join('\n')).toContain('https://proxy.example:8443');
  });

  test('rejects unsupported capability map source', async () => {
    const result = await runCommand(['capabilities', '--source', 'unknown', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(false);
    expect(output.code).toBe('UNSUPPORTED_CAPABILITY_SOURCE');
    expect(result.exitCode).toBe(1);
  });

  test('prints config get as JSON envelope', async () => {
    const result = await runCommand(['config', 'get', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('config.get');
  });

  test('prints config get with specific key', async () => {
    const result = await runCommand(['config', 'get', '--key', 'language', '--json']);
    const output = parseJsonOutput(result.stdout);

    expect(output.ok).toBe(true);
    expect(output.command).toBe('config.get');

    const layeredResult = await runCommand(['config', 'get', '--key', 'language', '--layer', 'user', '--json']);
    const layeredOutput = parseJsonOutput(layeredResult.stdout);
    expect(layeredOutput.ok).toBe(true);
  });

  test('prints config set validation failures as JSON envelopes', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-config-set-'));
    const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(projectRoot);
    try {
      const invalidJsonResult = await runCommand(['config', 'set', '--key', 'language', '--value', '{bad', '--json']);
      expect(parseJsonOutput(invalidJsonResult.stdout).code).toBe('INVALID_JSON');
      expect(invalidJsonResult.exitCode).toBe(1);

      const sensitiveLayerResult = await runCommand(['config', 'set', '--key', 'providers.minimax.apiKey', '--value', '"secret"', '--layer', 'project', '--json']);
      expect(parseJsonOutput(sensitiveLayerResult.stdout).code).toBe('SECRET_CONFIG_REQUIRES_USER_LAYER');
      expect(sensitiveLayerResult.exitCode).toBe(1);

      const invalidLayerResult = await runCommand(['config', 'set', '--key', 'language', '--value', '"zh"', '--layer', 'workspace', '--json']);
      expect(parseJsonOutput(invalidLayerResult.stdout).code).toBe('INVALID_CONFIG_LAYER');
      expect(invalidLayerResult.exitCode).toBe(1);

      const invalidMiniMaxResult = await runCommand(['config', 'set', '--key', 'providers.minimax.baseUrl', '--value', '"http://example.com"', '--json']);
      expect(parseJsonOutput(invalidMiniMaxResult.stdout).code).toBe('INVALID_MINIMAX_BASE_URL');
      expect(invalidMiniMaxResult.exitCode).toBe(1);
    } finally {
      cwdSpy.mockRestore();
    }
  });

  test('validates artifact repo options when adding workspaces', async () => {
    const partialResult = await runCommand(['config', 'workspace', 'add', '--id', 'partial-artifacts', '--name', 'Partial Artifacts', '--path', '/tmp/partial-artifacts', '--provider', 'github', '--json']);
    expect(parseJsonOutput(partialResult.stdout).code).toBe('INVALID_ARTIFACT_REPO_CONFIG');
    expect(partialResult.exitCode).toBe(1);

    const unsupportedResult = await runCommand(['config', 'workspace', 'add', '--id', 'bad-provider', '--name', 'Bad Provider', '--path', '/tmp/bad-provider', '--provider', 'gitea', '--repo-owner', 'owner', '--repo-name', 'repo', '--json']);
    expect(parseJsonOutput(unsupportedResult.stdout).code).toBe('UNSUPPORTED_ARTIFACT_PROVIDER');
    expect(unsupportedResult.exitCode).toBe(1);

    const unsafeSegmentResult = await runCommand(['config', 'workspace', 'add', '--id', 'unsafe-artifacts', '--name', 'Unsafe Artifacts', '--path', '/tmp/unsafe-artifacts', '--provider', 'github', '--repo-owner', '../owner', '--repo-name', 'repo', '--json']);
    expect(parseJsonOutput(unsafeSegmentResult.stdout).code).toBe('INVALID_ARTIFACT_REPO_CONFIG');
    expect(unsafeSegmentResult.exitCode).toBe(1);

    const validResult = await runCommand(['config', 'workspace', 'add', '--id', 'valid-artifacts', '--name', 'Valid Artifacts', '--path', '/tmp/valid-artifacts', '--provider', 'gitlab', '--repo-owner', 'owner.name', '--repo-name', 'repo-name', '--json']);
    const validOutput = parseJsonOutput<{ artifactRepo?: { provider: string; owner: string; name: string } }>(validResult.stdout);
    expect(validOutput.ok).toBe(true);
    expect(validOutput.data.artifactRepo).toEqual({ provider: 'gitlab', owner: 'owner.name', name: 'repo-name' });
  });

  test('prints artifact status and accepts valid setup steps', async () => {
    const statusResult = await runCommand(['artifacts', 'status', '--json']);
    const statusOutput = parseJsonOutput(statusResult.stdout);
    expect(statusOutput.ok).toBe(true);
    expect(statusOutput.command).toBe('artifacts.status');

    const setupResult = await runCommand(['artifacts', 'setup', '--step', 'configure', '--json']);
    const setupOutput = parseJsonOutput<{ step: string }>(setupResult.stdout);
    expect(setupOutput.ok).toBe(true);
    expect(setupOutput.data.step).toBe('configure');
  });

  test('plans project memory extraction and backup as JSON envelopes', async () => {
    const { mkdirSync, mkdtempSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-memory-project-'));
    const artifactWorkspace = mkdtempSync(join(tmpdir(), 'peaks-cli-memory-artifacts-'));
    mkdirSync(join(projectRoot, '.peaks', 'changes'), { recursive: true });
    const artifactPath = join(projectRoot, '.peaks', 'changes', 'rd.md');
    writeFileSync(artifactPath, [
      '<!-- peaks-memory:start -->',
      'title: Skill lifecycle rule',
      'kind: project',
      '---',
      'Skill must go personal -> team -> marketplace.',
      '<!-- peaks-memory:end -->'
    ].join('\n'), 'utf8');

    const extractResult = await runCommand(['memory', 'extract', '--project', projectRoot, '--artifact', artifactPath, '--json']);
    const extractOutput = parseJsonOutput<{ primaryMemoryDir: string; extractedCount: number; plannedWrites: Array<{ filePath: string; title: string }> }>(extractResult.stdout);
    expect(extractOutput.ok).toBe(true);
    expect(extractOutput.command).toBe('memory.extract');
    expect(extractOutput.data.primaryMemoryDir).toBe(join(projectRoot, '.claude', 'memory'));
    expect(extractOutput.data.extractedCount).toBe(1);
    expect(extractOutput.data.plannedWrites[0]?.filePath).toBe(join(projectRoot, '.claude', 'memory', 'skill-lifecycle-rule.md'));
    expect(extractResult.stdout.join('\n')).not.toContain('Skill must go personal -> team -> marketplace.');

    const backupResult = await runCommand(['memory', 'sync', '--project', projectRoot, '--workspace', artifactWorkspace, '--json']);
    const backupOutput = parseJsonOutput<{ backupMemoryDir: string }>(backupResult.stdout);
    expect(backupOutput.ok).toBe(true);
    expect(backupOutput.command).toBe('memory.sync');
    expect(backupOutput.data.backupMemoryDir).toBe(join(artifactWorkspace, '.peaks', 'memory-backups', 'project-memory-primary'));
  });

  test('prints project memory command failures as JSON envelopes', async () => {
    const { mkdirSync, mkdtempSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { tmpdir } = await import('node:os');
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cli-memory-fail-project-'));
    const missingArtifact = join(projectRoot, 'missing.md');

    const extractResult = await runCommand(['memory', 'extract', '--project', projectRoot, '--artifact', missingArtifact, '--json']);
    const extractOutput = parseJsonOutput(extractResult.stdout);
    expect(extractOutput.ok).toBe(false);
    expect(extractOutput.command).toBe('memory.extract');
    expect(extractOutput.code).toBe('MEMORY_EXTRACT_FAILED');
    expect(extractResult.exitCode).toBe(1);

    const artifactWorkspace = join(projectRoot, '.peaks-artifacts');
    mkdirSync(artifactWorkspace, { recursive: true });
    const syncResult = await runCommand(['memory', 'sync', '--project', projectRoot, '--workspace', artifactWorkspace, '--json']);
    const syncOutput = parseJsonOutput(syncResult.stdout);
    expect(syncOutput.ok).toBe(false);
    expect(syncOutput.command).toBe('memory.sync');
    expect(syncOutput.code).toBe('MEMORY_SYNC_FAILED');
    expect(syncResult.exitCode).toBe(1);
  });

  test('rejects invalid tech workflow and swarm inputs', async () => {
    const techPlanResult = await runCommand(['tech', 'plan', '--change-id', 'bad/id', '--goal', 'Refactor checkout API', '--json']);
    expect(parseJsonOutput(techPlanResult.stdout).code).toBe('INVALID_CHANGE_ID_OR_GOAL');

    const techStatusResult = await runCommand(['tech', 'status', '--change-id', 'bad/id', '--json']);
    expect(parseJsonOutput(techStatusResult.stdout).code).toBe('INVALID_CHANGE_ID');

    const routeResult = await runCommand(['workflow', 'route', '--mode', 'solo', '--change-id', 'bad/id', '--goal', 'Refactor checkout API', '--json']);
    expect(parseJsonOutput(routeResult.stdout).code).toBe('INVALID_CHANGE_ID_OR_GOAL');

    const autonomousResult = await runCommand(['workflow', 'autonomous', '--mode', 'solo', '--change-id', 'bad/id', '--goal', 'Refactor checkout API', '--json']);
    expect(parseJsonOutput(autonomousResult.stdout).code).toBe('INVALID_CHANGE_ID_OR_GOAL');

    const swarmDryRunResult = await runCommand(['swarm', 'plan', '--skill', 'rd', '--change-id', 'checkout-refactor', '--goal', 'Fix checkout retry typo', '--no-dry-run', '--json']);
    expect(parseJsonOutput(swarmDryRunResult.stdout).code).toBe('UNSUPPORTED_NON_DRY_RUN');

    const swarmInvalidResult = await runCommand(['swarm', 'plan', '--skill', 'rd', '--change-id', 'bad/id', '--goal', 'Fix checkout retry typo', '--json']);
    expect(parseJsonOutput(swarmInvalidResult.stdout).code).toBe('INVALID_CHANGE_ID_OR_GOAL');
  });

  test('prints sc command envelopes', async () => {
    const statusResult = await runCommand(['sc', 'status', '--json']);
    expect(parseJsonOutput(statusResult.stdout).command).toBe('sc.status');

    const helpJsonResult = await runCommand(['sc', 'help', '--json']);
    expect(parseJsonOutput(helpJsonResult.stdout).command).toBe('sc.help');

    const helpResult = await runCommand(['sc', 'help']);
    expect(helpResult.stdout.join('\n')).toContain('Change traceability workflow integration');

    const plainImpactResult = await runCommand(['sc', 'impact', '--change-id', 'checkout-refactor', '--json']);
    expect(parseJsonOutput(plainImpactResult.stdout).command).toBe('sc.impact');

    const impactResult = await runCommand(['sc', 'impact', '--change-id', 'checkout-refactor', '--module', 'client', '--file', 'src/app.ts', '--json']);
    expect(parseJsonOutput(impactResult.stdout).command).toBe('sc.impact');

    const plainRetentionResult = await runCommand(['sc', 'retention', '--slice-id', 'slice-1', '--json']);
    expect(parseJsonOutput(plainRetentionResult.stdout).command).toBe('sc.retention');

    const retentionResult = await runCommand(['sc', 'retention', '--slice-id', 'slice-1', '--prd', 'prd.md', '--rd', 'rd.md', '--qa', 'qa.md', '--coverage', 'coverage.json', '--review', 'review.md', '--code', 'src/app.ts', '--json']);
    expect(parseJsonOutput(retentionResult.stdout).command).toBe('sc.retention');

    const validateResult = await runCommand(['sc', 'validate', '--slice-id', 'slice-1', '--json']);
    expect(parseJsonOutput(validateResult.stdout).command).toBe('sc.validate');

    const plainBoundaryResult = await runCommand(['sc', 'boundary', '--slice-id', 'slice-1', '--json']);
    expect(parseJsonOutput(plainBoundaryResult.stdout).command).toBe('sc.boundary');

    const boundaryResult = await runCommand(['sc', 'boundary', '--slice-id', 'slice-1', '--artifact', 'artifact.md', '--code', 'src/app.ts', '--json']);
    expect(parseJsonOutput(boundaryResult.stdout).command).toBe('sc.boundary');
  });

});
