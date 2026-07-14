import { Command } from 'commander';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import type { ProgramIO } from '../../src/cli/cli-helpers.js';

const branchState = vi.hoisted(() => ({
  addWorkspace: vi.fn(),
  getConfig: vi.fn(),
  getCurrentWorkspaceConfig: vi.fn(),
  removeWorkspace: vi.fn(),
  runDoctor: vi.fn(),
  setConfig: vi.fn(),
  setCurrentWorkspace: vi.fn(),
  setMiniMaxProviderConfig: vi.fn()
}));

const standardsState = vi.hoisted(() => ({
  executeProjectStandardsUpdate: vi.fn(),
  summarizeProjectStandardsUpdateResult: vi.fn()
}));

vi.mock('../../src/services/doctor/doctor-service.js', () => ({
  runDoctor: branchState.runDoctor
}));

vi.mock('../../src/services/standards/project-standards-service.js', () => ({
  executeProjectStandardsUpdate: standardsState.executeProjectStandardsUpdate,
  summarizeProjectStandardsUpdateResult: standardsState.summarizeProjectStandardsUpdateResult
}));

vi.mock('../../src/services/config/config-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/config/config-service.js')>();
  return {
    ...actual,
    addWorkspace: branchState.addWorkspace,
    getConfig: branchState.getConfig,
    getCurrentWorkspaceConfig: branchState.getCurrentWorkspaceConfig,
    removeWorkspace: branchState.removeWorkspace,
    setConfig: branchState.setConfig,
    setCurrentWorkspace: branchState.setCurrentWorkspace,
    setMiniMaxProviderConfig: branchState.setMiniMaxProviderConfig
  };
});

function createHarness(register: (program: Command, io: ProgramIO) => void) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const program = new Command();
  program.exitOverride();
  register(program, { stdout: (text) => stdout.push(text), stderr: (text) => stderr.push(text) });
  return { program, stdout, stderr };
}

async function runRegisteredCommand(register: (program: Command, io: ProgramIO) => void, args: string[]) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  const harness = createHarness(register);
  await harness.program.parseAsync(['node', 'peaks', ...args], { from: 'node' });
  const exitCode = process.exitCode;
  process.exitCode = previousExitCode;
  return { ...harness, exitCode };
}

function parseJsonOutput(stdout: string[]) {
  return JSON.parse(stdout.join('\n')) as { ok: boolean; command: string; code?: string; data?: unknown };
}

describe('cli command branch handling', () => {
  beforeEach(() => {
    branchState.runDoctor.mockReset();
    branchState.setConfig.mockReset();
    branchState.setMiniMaxProviderConfig.mockReset();
    standardsState.executeProjectStandardsUpdate.mockReset();
    standardsState.summarizeProjectStandardsUpdateResult.mockReset();
  });

  test('reports failed doctor and skill doctor checks', async () => {
    const report = {
      summary: { ok: false },
      checks: [
        { id: 'skill.registry', ok: false },
        { id: 'node.version', ok: true }
      ]
    };
    branchState.runDoctor.mockResolvedValue(report);
    const { registerCoreAndArtifactCommands } = await import('../../src/cli/commands/core-artifact-commands.js');

    const doctorResult = await runRegisteredCommand(registerCoreAndArtifactCommands, ['doctor', '--json']);
    expect(parseJsonOutput(doctorResult.stdout).code).toBe('DOCTOR_FAILED');
    expect(doctorResult.exitCode).toBe(1);

    const skillResult = await runRegisteredCommand(registerCoreAndArtifactCommands, ['skill', 'doctor', '--json']);
    const skillOutput = parseJsonOutput(skillResult.stdout);
    expect(skillOutput.command).toBe('skill.doctor');
    expect(skillResult.exitCode).toBe(1);
  // Slice 016f — bumped 30s → 60s after the user-facing pnpm test:full
  // run still hit this cliff (517 sibling files driving cumulative
  // FS / heartbeat contention pushed it past 30s on Windows; observed
  // 31-40s under contention). 60s gives 2x headroom. Same rationale as
  // slice-016b: budget, not swallow. See slice-016f memory for the
  // full diagnostic grid + the parallel slice-017 plan (slow-lane
  // split) that targets the cumulative-contention class of flake at
  // its source.
  }, 60_000);

  test('covers config get and set default layer branches', async () => {
    const { registerConfigCommands } = await import('../../src/cli/commands/config-commands.js');

    branchState.getConfig.mockReturnValueOnce({ language: 'en' });
    const getResult = await runRegisteredCommand(registerConfigCommands, ['config', 'get', '--json']);
    const getOutput = parseJsonOutput(getResult.stdout);
    expect(getOutput.ok).toBe(true);
    expect(getOutput.command).toBe('config.get');
    expect(branchState.getConfig).toHaveBeenCalledWith({});

    branchState.setConfig.mockImplementationOnce(() => {
      throw new Error('Unexpected write failure');
    });
    const setResult = await runRegisteredCommand(registerConfigCommands, ['config', 'set', '--key', 'language', '--value', '"en"', '--json']);
    expect(parseJsonOutput(setResult.stdout).code).toBe('CONFIG_SET_FAILED');
    expect(branchState.setConfig).toHaveBeenCalledWith({ key: 'language', value: 'en', layer: 'user' });
  });

  test('covers workflow route without a workspace context', async () => {
    const { registerWorkflowCommands } = await import('../../src/cli/commands/workflow-commands.js');
    branchState.getCurrentWorkspaceConfig.mockReturnValueOnce(null);

    const harness = createHarness(registerWorkflowCommands);
    await harness.program.parseAsync(['node', 'peaks', 'workflow', 'route', '--mode', 'code', '--goal', 'Refactor checkout API', '--json'], { from: 'node' });

    const output = parseJsonOutput(harness.stdout);
    expect(output.ok).toBe(true);
    expect(output.command).toBe('workflow.route');
  });

  test('returns standards update branch failures as JSON envelopes', async () => {
    const { registerCoreAndArtifactCommands } = await import('../../src/cli/commands/core-artifact-commands.js');

    const invalidFlagsResult = await runRegisteredCommand(registerCoreAndArtifactCommands, ['standards', 'update', '--project', '/tmp/project', '--dry-run', '--apply', '--json']);
    expect(parseJsonOutput(invalidFlagsResult.stdout).code).toBe('INVALID_STANDARDS_UPDATE_FLAGS');
    expect(invalidFlagsResult.exitCode).toBe(1);

    standardsState.executeProjectStandardsUpdate.mockImplementationOnce(() => {
      throw new Error('Unexpected standards update failure');
    });
    const failedResult = await runRegisteredCommand(registerCoreAndArtifactCommands, ['standards', 'update', '--project', '/tmp/project', '--json']);
    expect(parseJsonOutput(failedResult.stdout).code).toBe('STANDARDS_UPDATE_FAILED');
    expect(failedResult.exitCode).toBe(1);

    standardsState.executeProjectStandardsUpdate.mockReturnValueOnce({
      apply: true,
      projectRoot: '/tmp/project',
      language: 'typescript',
      source: { sourceId: 'everything-claude-code', url: 'https://github.com/affaan-m/everything-claude-code', usage: 'curated-baseline-reference' },
      skillPreflight: { appliesTo: ['peaks-rd', 'peaks-qa', 'peaks-code'], summary: 'summary' },
      plannedWrites: [],
      writtenFiles: [],
      appendedFiles: [],
      reviewSuggestions: ['manual review needed'],
      claudeMd: { relativePath: 'CLAUDE.md', status: 'review', reviewSuggestions: ['manual review needed'] }
    });
    standardsState.summarizeProjectStandardsUpdateResult.mockImplementationOnce((result) => result);
    const reviewResult = await runRegisteredCommand(registerCoreAndArtifactCommands, ['standards', 'update', '--project', '/tmp/project', '--json']);
    const reviewOutput = parseJsonOutput(reviewResult.stdout);

    expect(reviewOutput.ok).toBe(false);
    expect(reviewOutput.code).toBe('STANDARDS_UPDATE_REVIEW_REQUIRED');
    expect(reviewOutput.data).toBeDefined();
    expect(reviewResult.exitCode).toBe(1);

    standardsState.executeProjectStandardsUpdate.mockReturnValueOnce({
      apply: true,
      projectRoot: '/tmp/project',
      language: 'typescript',
      source: { sourceId: 'everything-claude-code', url: 'https://github.com/affaan-m/everything-claude-code', usage: 'curated-baseline-reference' },
      skillPreflight: { appliesTo: ['peaks-rd', 'peaks-qa', 'peaks-code'], summary: 'summary' },
      plannedWrites: [],
      writtenFiles: [],
      appendedFiles: [],
      reviewSuggestions: [],
      claudeMd: { relativePath: 'CLAUDE.md', status: 'existing', reviewSuggestions: [] }
    });
    standardsState.summarizeProjectStandardsUpdateResult.mockImplementationOnce((result) => result);
    const successResult = await runRegisteredCommand(registerCoreAndArtifactCommands, ['standards', 'update', '--project', '/tmp/project', '--language', 'typescript', '--json']);
    const successOutput = parseJsonOutput(successResult.stdout);

    expect(successOutput.ok).toBe(true);
    expect(successOutput.command).toBe('standards.update');
    expect(successResult.exitCode).toBeUndefined();
  });

  test('covers workflow route with a workspace context', async () => {
    const { registerWorkflowCommands } = await import('../../src/cli/commands/workflow-commands.js');
    branchState.getCurrentWorkspaceConfig.mockReturnValueOnce({
      workspaceId: 'branch-workspace',
      name: 'Branch Workspace',
      rootPath: '/tmp/branch-workspace',
      installedCapabilityIds: []
    });

    const harness = createHarness(registerWorkflowCommands);
    await harness.program.parseAsync(['node', 'peaks', 'workflow', 'route', '--mode', 'code', '--goal', 'Refactor checkout API', '--json'], { from: 'node' });

    const output = parseJsonOutput(harness.stdout);
    expect(output.ok).toBe(true);
    expect(output.command).toBe('workflow.route');
  });

  test('maps config set and provider set service errors', async () => {
    const { registerConfigCommands } = await import('../../src/cli/commands/config-commands.js');

    branchState.setConfig.mockImplementationOnce(() => {
      throw new Error('Project config not found');
    });
    const projectResult = await runRegisteredCommand(registerConfigCommands, ['config', 'set', '--key', 'language', '--value', '"en"', '--json']);
    expect(parseJsonOutput(projectResult.stdout).code).toBe('PROJECT_CONFIG_NOT_FOUND');

    branchState.setConfig.mockImplementationOnce(() => {
      throw new Error('MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials');
    });
    const invalidMiniMaxResult = await runRegisteredCommand(registerConfigCommands, ['config', 'set', '--key', 'language', '--value', '"en"', '--json']);
    expect(parseJsonOutput(invalidMiniMaxResult.stdout).code).toBe('INVALID_MINIMAX_BASE_URL');

    branchState.setConfig.mockImplementationOnce(() => {
      throw new Error('Unexpected write failure');
    });
    const genericResult = await runRegisteredCommand(registerConfigCommands, ['config', 'set', '--key', 'language', '--value', '"en"', '--json']);
    expect(parseJsonOutput(genericResult.stdout).code).toBe('CONFIG_SET_FAILED');

    const previousMiniMaxApiKey = process.env.MINIMAX_API_KEY;
    delete process.env.MINIMAX_API_KEY;
    try {
      const missingProviderValuesResult = await runRegisteredCommand(registerConfigCommands, ['config', 'provider', 'minimax', 'set', '--json']);
      expect(parseJsonOutput(missingProviderValuesResult.stdout).code).toBe('MINIMAX_PROVIDER_NO_VALUES');
      expect(branchState.setMiniMaxProviderConfig).not.toHaveBeenCalled();
    } finally {
      if (previousMiniMaxApiKey === undefined) {
        delete process.env.MINIMAX_API_KEY;
      } else {
        process.env.MINIMAX_API_KEY = previousMiniMaxApiKey;
      }
    }

    branchState.setMiniMaxProviderConfig.mockImplementationOnce(() => {
      throw new Error('MiniMax base URL must be the MiniMax HTTPS endpoint without embedded credentials');
    });
    const invalidProviderResult = await runRegisteredCommand(registerConfigCommands, ['config', 'provider', 'minimax', 'set', '--base-url', 'https://api.minimaxi.com/anthropic', '--json']);
    expect(parseJsonOutput(invalidProviderResult.stdout).code).toBe('INVALID_MINIMAX_BASE_URL');

    branchState.setMiniMaxProviderConfig.mockImplementationOnce(() => {
      throw new Error('Unexpected provider write failure');
    });
    const genericProviderResult = await runRegisteredCommand(registerConfigCommands, ['config', 'provider', 'minimax', 'set', '--base-url', 'https://api.minimaxi.com/anthropic', '--json']);
    expect(parseJsonOutput(genericProviderResult.stdout).code).toBe('MINIMAX_PROVIDER_SET_FAILED');
  });
});
