import { describe, expect, test, vi } from 'vitest';
import {
  createShadcnInvocation,
  executeShadcnInvocation,
  type ShadcnProcessRunner,
  testInternals
} from '../../src/services/shadcn/shadcn-service.js';

describe('shadcn service', () => {
  test('assembles invocation through the pinned local shadcn dependency', () => {
    const invocation = createShadcnInvocation({ args: ['init', '--preset', 'example', '--template', 'vite'], cwd: '/tmp/project' });

    expect(invocation.executable).toBe(process.execPath);
    expect(invocation.args[0]).toMatch(/node_modules[\\/]shadcn[\\/].*dist[\\/]index\.js$/);
    expect(invocation.args.slice(1)).toEqual(['init', '--preset', 'example', '--template', 'vite']);
    expect(invocation.cwd).toBe('/tmp/project');
    expect(invocation.packageName).toBe('shadcn');
    expect(invocation.packageVersion).toBe('4.7.0');
  });

  test('rejects empty and dash-prefixed forwarded commands', () => {
    expect(() => createShadcnInvocation({ args: [] })).toThrow('shadcn arguments are required');
    expect(() => createShadcnInvocation({ args: ['--help'] })).toThrow('shadcn command must not start with -');
  });

  test('creates a minimal environment for the forwarded process', () => {
    const environment = testInternals.createShadcnEnvironment({
      PATH: '/usr/bin',
      HOME: '/tmp/home',
      NPM_TOKEN: 'secret',
      NODE_OPTIONS: '--require ./hook.js',
      npm_config_registry: 'https://registry.example.test'
    });

    expect(environment).toEqual({ PATH: '/usr/bin', HOME: '/tmp/home' });
  });

  test('executes through an injectable runner for CLI tests', async () => {
    const invocation = createShadcnInvocation({ args: ['init', '--preset', 'example'] });
    const runner: ShadcnProcessRunner = vi.fn(async (input) => ({
      exitCode: 0,
      stdout: `ran ${input.args.join(' ')}`,
      stderr: ''
    }));

    const result = await executeShadcnInvocation(invocation, runner);

    expect(runner).toHaveBeenCalledWith(invocation);
    expect(result.stdout).toMatch(/ran .*node_modules[\\/]shadcn[\\/].*dist[\\/]index\.js init --preset example$/);
  });
});
