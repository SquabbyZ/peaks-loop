import { beforeEach, describe, expect, test, vi } from 'vitest';

const shadcnMocks = vi.hoisted(() => ({
  executeShadcnInvocation: vi.fn(),
  createShadcnInvocation: vi.fn((options: { args: string[] }) => ({
    executable: process.execPath,
    args: ['/mock/node_modules/shadcn/dist/index.js', ...options.args],
    cwd: process.cwd(),
    packageName: 'shadcn',
    packageVersion: '4.7.0'
  }))
}));

vi.mock('../../src/services/shadcn/shadcn-service.js', () => shadcnMocks);

const { resetCliProgramMocks, runCommand, writeUserConfig } = await import('./cli-program-test-utils.js');

describe('shadcn CLI command', () => {
  beforeEach(() => {
    process.exitCode = undefined;
    resetCliProgramMocks();
    writeUserConfig();
    shadcnMocks.createShadcnInvocation.mockClear();
    shadcnMocks.executeShadcnInvocation.mockReset();
    shadcnMocks.executeShadcnInvocation.mockResolvedValue({ exitCode: 0, stdout: 'shadcn ok', stderr: '' });
  });

  test('forwards arguments to the pinned shadcn launcher', async () => {
    const result = await runCommand(['shadcn', 'init', '--preset', 'example', '--template', 'vite']);

    expect(shadcnMocks.createShadcnInvocation).toHaveBeenCalledWith({ args: ['init', '--preset', 'example', '--template', 'vite'] });
    expect(shadcnMocks.executeShadcnInvocation).toHaveBeenCalled();
    expect(result.stdout).toContain('shadcn ok');
    expect(result.exitCode).toBeUndefined();
  });

  test('forwards upstream help flags instead of showing wrapper help', async () => {
    const result = await runCommand(['shadcn', 'init', '--help']);

    expect(shadcnMocks.createShadcnInvocation).toHaveBeenCalledWith({ args: ['init', '--help'] });
    expect(result.stdout).toContain('shadcn ok');
    expect(result.exitCode).toBeUndefined();
  });

  test('redacts sensitive upstream failures', async () => {
    shadcnMocks.executeShadcnInvocation.mockResolvedValueOnce({ exitCode: 2, stdout: '', stderr: 'token=super-secret-token-value' });

    const result = await runCommand(['shadcn', 'init', '--preset', 'example']);

    expect(result.stderr.join('\n')).toContain('[redacted]');
    expect(result.stderr.join('\n')).not.toContain('super-secret-token-value');
    expect(result.exitCode).toBe(2);
  });
});
