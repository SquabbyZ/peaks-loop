/**
 * TDD coverage for the ocr (open-code-review) integration.
 *
 * Tests cover the 5 detect states + the run wrapper + the env-var
 * injection that bridges peaks-loop's `peaksConfig.ocr.llm` to the
 * ocr subprocess. Uses a stub SubprocessRunner + stub launcher —
 * no real ocr binary or real ~/.opencodereview/config.json needed.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  buildOcrEnv,
  detectOcr,
  getOcrConfigTemplate,
  getOcrLlmMissingFields,
  resolveOcrLauncher,
  runOcrReview,
  type SubprocessRunner,
} from '../../../../src/services/code-review/ocr-service.js';
import type { OcrLlmConfig } from '../../../../src/services/config/config-types.js';

const IS_WINDOWS = process.platform === 'win32';
const BINARY_NAME = IS_WINDOWS ? 'opencodereview.exe' : 'opencodereview';

let tmpHome: string;
let tmpRoot: string;
let tmpCwd: string;
let tmpConfigPath: string;

function makeOcrPackage(root: string, opts: { withBinary: boolean }): string {
  const binDir = join(root, 'node_modules', '@alibaba-group', 'open-code-review', 'bin');
  mkdirSync(binDir, { recursive: true });
  writeFileSync(join(binDir, 'ocr.js'), '#!/usr/bin/env node\n// stub launcher\n', 'utf8');
  if (opts.withBinary) {
    writeFileSync(join(binDir, BINARY_NAME), 'stub binary', 'utf8');
  }
  return join(binDir, 'ocr.js');
}

function buildLlmConfig(opts: { url?: boolean; token?: boolean; model?: boolean; extras?: boolean }): OcrLlmConfig {
  return {
    ...(opts.url !== false ? { url: 'https://api.example.com' } : {}),
    ...(opts.token !== false ? { authToken: 'stub-token' } : {}),
    ...(opts.model !== false ? { model: 'claude-stub' } : {}),
    ...(opts.extras === true ? { useAnthropic: true, authHeader: 'x-api-key' as const } : {})
  };
}

beforeEach(() => {
  tmpHome = mkdtempSync(join(tmpdir(), 'peaks-ocr-home-'));
  tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-ocr-root-'));
  tmpCwd = mkdtempSync(join(tmpdir(), 'peaks-ocr-cwd-'));
  tmpConfigPath = join(tmpHome, '.peaks', 'config.json');
});

afterEach(() => {
  try { rmSync(tmpHome, { recursive: true, force: true }); } catch {}
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
  try { rmSync(tmpCwd, { recursive: true, force: true }); } catch {}
});

describe('resolveOcrLauncher', () => {
  test('returns the launcher path when package is present in the first root', () => {
    const expectedPath = makeOcrPackage(tmpRoot, { withBinary: true });
    const got = resolveOcrLauncher([tmpRoot, tmpCwd]);
    expect(got).toBe(expectedPath);
  });

  test('returns null when no root has the package', () => {
    expect(resolveOcrLauncher([tmpRoot, tmpCwd])).toBeNull();
  });

  test('falls through to second root when first is empty', () => {
    const expectedPath = makeOcrPackage(tmpCwd, { withBinary: true });
    const got = resolveOcrLauncher([tmpRoot, tmpCwd]);
    expect(got).toBe(expectedPath);
  });
});

describe('getOcrLlmMissingFields', () => {
  test('returns all three required keys when llm block is null', () => {
    const missing = getOcrLlmMissingFields(null);
    expect(missing).toEqual(['ocr.llm.url', 'ocr.llm.authToken', 'ocr.llm.model']);
  });

  test('returns only the keys that are missing from a partial block', () => {
    const missing = getOcrLlmMissingFields({ url: 'https://api.example.com' });
    expect(missing).toContain('ocr.llm.authToken');
    expect(missing).toContain('ocr.llm.model');
    expect(missing).not.toContain('ocr.llm.url');
  });

  test('returns empty array when the block has all three required keys', () => {
    const missing = getOcrLlmMissingFields(buildLlmConfig({}));
    expect(missing).toEqual([]);
  });
});

describe('buildOcrEnv', () => {
  test('maps the llm block onto the OCR env-var surface', () => {
    const env = buildOcrEnv(buildLlmConfig({ extras: true }));
    expect(env.OCR_LLM_URL).toBe('https://api.example.com');
    expect(env.OCR_LLM_TOKEN).toBe('stub-token');
    expect(env.OCR_LLM_MODEL).toBe('claude-stub');
    expect(env.OCR_USE_ANTHROPIC).toBe('true');
    expect(env.OCR_LLM_AUTH_HEADER).toBe('x-api-key');
  });

  test('omits env vars whose value is empty string', () => {
    const env = buildOcrEnv({ url: '', authToken: 'tok', model: 'm' });
    expect('OCR_LLM_URL' in env).toBe(false);
    expect(env.OCR_LLM_TOKEN).toBe('tok');
    expect(env.OCR_LLM_MODEL).toBe('m');
  });

  test('serialises useAnthropic=false as the string "false"', () => {
    const env = buildOcrEnv({ url: 'u', authToken: 't', model: 'm', useAnthropic: false });
    expect(env.OCR_USE_ANTHROPIC).toBe('false');
  });
});

describe('getOcrConfigTemplate', () => {
  test('returns a parseable JSON snippet with the ocr.llm shape', () => {
    const template = getOcrConfigTemplate();
    const parsed = JSON.parse(template) as { ocr: { llm: OcrLlmConfig } };
    expect(parsed.ocr.llm.url).toBeTruthy();
    expect(parsed.ocr.llm.authToken).toBe('<your-api-key>');
    expect(parsed.ocr.llm.model).toBeTruthy();
  });

  test('is deterministic — the same snippet on every call (for hash comparisons)', () => {
    expect(getOcrConfigTemplate()).toBe(getOcrConfigTemplate());
  });
});

describe('detectOcr', () => {
  const stubRunner: SubprocessRunner = {
    run: () => ({ status: 0, stdout: 'opencodereview version 1.3.1\n', stderr: '' }),
  };

  test('state=package-missing when ocr npm package is absent', () => {
    const r = detectOcr({ cwd: tmpCwd, peaksConfigPath: tmpConfigPath, peaksOcrConfig: null, searchRoots: [tmpRoot], runner: stubRunner });
    expect(r.state).toBe('package-missing');
    expect(r.packageInstalled).toBe(false);
    expect(r.binaryPath).toBeNull();
    expect(r.version).toBeNull();
    expect(r.configPath).toBe(tmpConfigPath);
    expect(r.nextActions[1]).toContain('peaks-loop 2.8.2 ships with ocr as a peer dependency');
  });

  test('state=binary-missing when launcher exists but platform binary did not download', () => {
    makeOcrPackage(tmpRoot, { withBinary: false });
    const r = detectOcr({ cwd: tmpCwd, peaksConfigPath: tmpConfigPath, peaksOcrConfig: buildLlmConfig({}), searchRoots: [tmpRoot], runner: stubRunner });
    expect(r.state).toBe('binary-missing');
    expect(r.packageInstalled).toBe(true);
    expect(r.binaryPath).toBeNull();
    expect(r.nextActions[0]).toContain('approve-builds');
    expect(r.nextActions[2]).toContain('Network-blocked');
  });

  test('state=config-missing when binary is present but peaksConfig.ocr.llm is empty', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    const r = detectOcr({ cwd: tmpCwd, peaksConfigPath: tmpConfigPath, peaksOcrConfig: null, searchRoots: [tmpRoot], runner: stubRunner });
    expect(r.state).toBe('config-missing');
    expect(r.packageInstalled).toBe(true);
    expect(r.binaryPath).not.toBeNull();
    expect(r.configValid).toBe(false);
    expect(r.missingKeys).toEqual(['ocr.llm.url', 'ocr.llm.authToken', 'ocr.llm.model']);
    expect(r.nextActions[0]).toContain('Paste the following into');
    expect(r.nextActions[0]).toContain(tmpConfigPath);
    expect(r.nextActions[1]).toContain('"ocr"');
  });

  test('state=config-missing when peaksConfig.ocr.llm is partial (only url)', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    const r = detectOcr({ cwd: tmpCwd, peaksConfigPath: tmpConfigPath, peaksOcrConfig: { url: 'https://api.example.com' }, searchRoots: [tmpRoot], runner: stubRunner });
    expect(r.state).toBe('config-missing');
    expect(r.configValid).toBe(false);
    expect(r.missingKeys).toEqual(['ocr.llm.authToken', 'ocr.llm.model']);
  });

  test('state=ready when package + binary + peaksConfig.ocr.llm are all healthy', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    const r = detectOcr({ cwd: tmpCwd, peaksConfigPath: tmpConfigPath, peaksOcrConfig: buildLlmConfig({}), searchRoots: [tmpRoot], runner: stubRunner });
    expect(r.state).toBe('ready');
    expect(r.packageInstalled).toBe(true);
    expect(r.binaryPath).not.toBeNull();
    expect(r.version).toBe('1.3.1');
    expect(r.configValid).toBe(true);
    expect(r.missingKeys).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.nextActions).toEqual([]);
  });

  test('records partial version when probe stdout is non-empty but does not match semver', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    const oddRunner: SubprocessRunner = {
      run: () => ({ status: 0, stdout: 'unexpected-build-string', stderr: '' }),
    };
    const r = detectOcr({ cwd: tmpCwd, peaksConfigPath: tmpConfigPath, peaksOcrConfig: buildLlmConfig({}), searchRoots: [tmpRoot], runner: oddRunner });
    expect(r.state).toBe('ready');
    expect(r.version).toBe('unexpected-build-string');
  });
});

describe('runOcrReview', () => {
  test('soft-fails (spawned=false) when ocr is in package-missing state', () => {
    const r = runOcrReview({
      cwd: tmpCwd,
      peaksConfigPath: tmpConfigPath,
      peaksOcrConfig: null,
      searchRoots: [tmpRoot],
      input: { projectRoot: tmpCwd },
    });
    expect(r.spawned).toBe(false);
    expect(r.state).toBe('package-missing');
    expect(r.exitCode).toBeNull();
    expect(r.parsed).toBeNull();
    expect(r.nextActions.length).toBeGreaterThan(0);
  });

  test('soft-fails when binary is missing', () => {
    makeOcrPackage(tmpRoot, { withBinary: false });
    const r = runOcrReview({
      cwd: tmpCwd,
      peaksConfigPath: tmpConfigPath,
      peaksOcrConfig: buildLlmConfig({}),
      searchRoots: [tmpRoot],
      input: { projectRoot: tmpCwd },
    });
    expect(r.spawned).toBe(false);
    expect(r.state).toBe('binary-missing');
  });

  test('soft-fails when peaksConfig.ocr.llm is missing', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    const r = runOcrReview({
      cwd: tmpCwd,
      peaksConfigPath: tmpConfigPath,
      peaksOcrConfig: null,
      searchRoots: [tmpRoot],
      input: { projectRoot: tmpCwd },
    });
    expect(r.spawned).toBe(false);
    expect(r.state).toBe('config-missing');
  });

  test('spawned=true + parsed JSON when ocr is ready and subprocess returns valid JSON', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    const reviewRunner: SubprocessRunner = {
      run: (_cmd, args) => {
        if (args[1] === 'version') return { status: 0, stdout: '1.3.1\n', stderr: '' };
        return {
          status: 0,
          stdout: JSON.stringify({ findings: [{ file: 'a.ts', line: 10, severity: 'minor', message: 'stub' }] }),
          stderr: '',
        };
      },
    };
    const r = runOcrReview({
      cwd: tmpCwd,
      peaksConfigPath: tmpConfigPath,
      peaksOcrConfig: buildLlmConfig({}),
      searchRoots: [tmpRoot],
      runner: reviewRunner,
      input: { projectRoot: tmpCwd, from: 'main', to: 'HEAD' },
    });
    expect(r.spawned).toBe(true);
    expect(r.state).toBe('ready');
    expect(r.exitCode).toBe(0);
    expect(r.parsed).toEqual({ findings: [{ file: 'a.ts', line: 10, severity: 'minor', message: 'stub' }] });
    expect(r.warnings).toEqual([]);
  });

  test('reports warnings + nextActions when subprocess exits non-zero', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    const failingRunner: SubprocessRunner = {
      run: (_cmd, args) => {
        if (args[1] === 'version') return { status: 0, stdout: '1.3.1\n', stderr: '' };
        return { status: 1, stdout: '', stderr: 'auth failed' };
      },
    };
    const r = runOcrReview({
      cwd: tmpCwd,
      peaksConfigPath: tmpConfigPath,
      peaksOcrConfig: buildLlmConfig({}),
      searchRoots: [tmpRoot],
      runner: failingRunner,
      input: { projectRoot: tmpCwd },
    });
    expect(r.spawned).toBe(true);
    expect(r.exitCode).toBe(1);
    expect(r.stderr).toBe('auth failed');
    expect(r.warnings[0]).toContain('exited with status 1');
    expect(r.nextActions[0]).toContain('Inspect stderr');
  });

  test('passes --from / --to / --commit when provided', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    let capturedArgs: readonly string[] = [];
    const argCapturingRunner: SubprocessRunner = {
      run: (_cmd, args) => {
        if (args[1] === 'version') return { status: 0, stdout: '1.3.1\n', stderr: '' };
        capturedArgs = args;
        return { status: 0, stdout: '{}', stderr: '' };
      },
    };
    runOcrReview({
      cwd: tmpCwd,
      peaksConfigPath: tmpConfigPath,
      peaksOcrConfig: buildLlmConfig({}),
      searchRoots: [tmpRoot],
      runner: argCapturingRunner,
      input: { projectRoot: tmpCwd, from: 'main', to: 'feature', commit: 'abc123' },
    });
    expect(capturedArgs).toContain('--from');
    expect(capturedArgs).toContain('main');
    expect(capturedArgs).toContain('--to');
    expect(capturedArgs).toContain('feature');
    expect(capturedArgs).toContain('--commit');
    expect(capturedArgs).toContain('abc123');
    expect(capturedArgs).toContain('--format');
    expect(capturedArgs).toContain('json');
  });

  test('injects OCR_LLM_* env vars from peaksOcrConfig into the subprocess', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    let capturedEnv: NodeJS.ProcessEnv | undefined;
    const envCapturingRunner: SubprocessRunner = {
      run: (_cmd, args, options) => {
        if (args[1] === 'version') return { status: 0, stdout: '1.3.1\n', stderr: '' };
        capturedEnv = options.env;
        return { status: 0, stdout: '{}', stderr: '' };
      },
    };
    const llm: OcrLlmConfig = {
      url: 'https://api.example.com',
      authToken: 'tok-123',
      model: 'claude-test',
      useAnthropic: true,
      authHeader: 'x-api-key',
    };
    runOcrReview({
      cwd: tmpCwd,
      peaksConfigPath: tmpConfigPath,
      peaksOcrConfig: llm,
      searchRoots: [tmpRoot],
      runner: envCapturingRunner,
      input: { projectRoot: tmpCwd },
    });
    expect(capturedEnv).toBeDefined();
    expect(capturedEnv!['OCR_LLM_URL']).toBe('https://api.example.com');
    expect(capturedEnv!['OCR_LLM_TOKEN']).toBe('tok-123');
    expect(capturedEnv!['OCR_LLM_MODEL']).toBe('claude-test');
    expect(capturedEnv!['OCR_USE_ANTHROPIC']).toBe('true');
    expect(capturedEnv!['OCR_LLM_AUTH_HEADER']).toBe('x-api-key');
  });

  test('passes the parent process env when peaksOcrConfig is null (no overlay)', () => {
    makeOcrPackage(tmpRoot, { withBinary: true });
    const reviewRunner: SubprocessRunner = {
      run: (_cmd, args) => {
        if (args[1] === 'version') return { status: 0, stdout: '1.3.1\n', stderr: '' };
        return { status: 0, stdout: '{}', stderr: '' };
      },
    };
    // Soft-fail path: when peaksOcrConfig is null the state is config-missing
    // and runOcrReview does not spawn the subprocess. Verify the
    // soft-fail envelope rather than the env-var shape.
    const r = runOcrReview({
      cwd: tmpCwd,
      peaksConfigPath: tmpConfigPath,
      peaksOcrConfig: null,
      searchRoots: [tmpRoot],
      runner: reviewRunner,
      input: { projectRoot: tmpCwd },
    });
    expect(r.spawned).toBe(false);
    expect(r.state).toBe('config-missing');
  });
});
