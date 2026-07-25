import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

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

interface CliEnvelope<T> {
  readonly ok: boolean;
  readonly command: string;
  readonly code?: string;
  readonly data: T;
  readonly warnings: readonly unknown[];
  readonly nextActions: readonly string[];
}

function runCli(args: readonly string[]): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd: REPO,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: BIN_TIMEOUT_MS,
      env: { ...process.env, PEAKS_CALLER_ID: 'scan-commands-e2e' }
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (error: unknown) {
    const caught = error as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      status?: number | null;
    };
    return {
      stdout: typeof caught.stdout === 'string' ? caught.stdout : caught.stdout?.toString('utf8') ?? '',
      stderr: typeof caught.stderr === 'string' ? caught.stderr : caught.stderr?.toString('utf8') ?? '',
      code: typeof caught.status === 'number' ? caught.status : 1
    };
  }
}

function parseEnvelope<T>(result: RunResult): CliEnvelope<T> {
  return JSON.parse(result.stdout) as CliEnvelope<T>;
}

describe('peaks scan archetype', () => {
  test('reports the real repository archetype and detection signals', () => {
    const result = runCli(['scan', 'archetype', '--project', REPO, '--json']);
    expect(result.code).toBe(0);

    const envelope = parseEnvelope<{
      archetype: string;
      confidence: string;
      signals: Array<{ name: string; matched: boolean; detail: string }>;
      detected: { hasPackageJson: boolean };
    }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('scan.archetype');
    expect(envelope.data.archetype).toMatch(/\S/);
    expect(envelope.data.signals.length).toBeGreaterThan(0);
    expect(envelope.data.detected.hasPackageJson).toBe(true);
  }, BIN_TIMEOUT_MS);
});

describe('peaks scan libraries', () => {
  test('reports named and versioned dependencies from the real monorepo', () => {
    const result = runCli(['scan', 'libraries', '--project', REPO, '--json']);
    expect(result.code).toBe(0);

    const envelope = parseEnvelope<{
      libraries: Array<{ name: string; version: string; scope: string; ecosystem: string }>;
      totalCount: number;
      byScope: Record<string, number>;
    }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('scan.libraries');
    expect(envelope.data.libraries.length).toBeGreaterThan(0);
    expect(envelope.data.totalCount).toBe(envelope.data.libraries.length);
    expect(envelope.data.libraries.every(({ name, version }) => name.length > 0 && version.length > 0)).toBe(true);
  }, BIN_TIMEOUT_MS);
});

describe('peaks scan api-surface', () => {
  test('returns the structured API inventory envelope for the real repository', () => {
    const result = runCli([
      'scan', 'api-surface', '--project', REPO, '--format', 'json', '--json'
    ]);
    expect(result.code).toBe(0);

    const envelope = parseEnvelope<{
      counts: { cli: number; service: number; type: number; constant: number };
      cli: readonly unknown[];
      service: readonly unknown[];
      type: readonly unknown[];
      constant: readonly unknown[];
    }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('scan.api-surface');
    expect(Object.values(envelope.data.counts).every(Number.isInteger)).toBe(true);
    expect([
      envelope.data.cli,
      envelope.data.service,
      envelope.data.type,
      envelope.data.constant
    ].every(Array.isArray)).toBe(true);
  }, BIN_TIMEOUT_MS);
});

describe('peaks scan request-type-sanity', () => {
  test('reports consistency and preserves its documented verdict exit code', () => {
    const result = runCli([
      'scan', 'request-type-sanity', '--project', REPO, '--type', 'feature', '--json'
    ]);
    const envelope = parseEnvelope<{
      declaredType: string;
      gitAvailable: boolean;
      changedFiles: readonly string[];
      breakdown: readonly unknown[];
      suggestedTypes: readonly string[];
      consistent: boolean;
      rationale: string;
    }>(result);

    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('scan.request-type-sanity');
    expect(envelope.data.declaredType).toBe('feature');
    expect(envelope.data.gitAvailable).toBe(true);
    expect(Array.isArray(envelope.data.breakdown)).toBe(true);
    // A mismatch is a successful scan verdict with exit 1, not an envelope failure.
    expect(result.code).toBe(envelope.data.consistent ? 0 : 1);
  }, BIN_TIMEOUT_MS);
});

describe('peaks scan orphan', () => {
  test('returns all four orphan categories for the real working tree', () => {
    const result = runCli([
      'scan', 'orphan', '--project', REPO, '--format', 'json', '--scope', 'working-tree', '--json'
    ]);
    expect(result.code).toBe(0);

    const envelope = parseEnvelope<{
      scope: string;
      counts: { export: number; import: number; cliSubcommand: number; docEndpoint: number };
      exportOrphans: readonly unknown[];
      importOrphans: readonly unknown[];
      cliSubcommandOrphans: readonly unknown[];
      docEndpointOrphans: readonly unknown[];
    }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('scan.orphan');
    expect(envelope.data.scope).toBe('working-tree');
    expect(Object.values(envelope.data.counts).every(Number.isInteger)).toBe(true);
    expect([
      envelope.data.exportOrphans,
      envelope.data.importOrphans,
      envelope.data.cliSubcommandOrphans,
      envelope.data.docEndpointOrphans
    ].every(Array.isArray)).toBe(true);
  }, BIN_TIMEOUT_MS);
});

describe('peaks scan diff-vs-scope', () => {
  test('returns a structured scope verdict for an existing RD request', () => {
    const result = runCli([
      'scan', 'diff-vs-scope', '--rid', EXISTING_RID, '--project', REPO,
      '--session-id', EXISTING_SESSION, '--json'
    ]);
    const envelope = parseEnvelope<{
      ok: boolean;
      rdArtifactPath: string;
      changedFiles: readonly unknown[];
      violations: readonly unknown[];
      unclassified: readonly unknown[];
      gitAvailable: boolean;
      patternsDeclared: boolean;
    }>(result);

    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('scan.diff-vs-scope');
    expect(envelope.data.rdArtifactPath).toContain(EXISTING_RID);
    expect(envelope.data.gitAvailable).toBe(true);
    expect(Array.isArray(envelope.data.changedFiles)).toBe(true);
    expect(Array.isArray(envelope.data.violations)).toBe(true);
    // Out-of-scope or unclassified files produce a successful verdict envelope with exit 1.
    expect(result.code).toBe(envelope.data.ok ? 0 : 1);
  }, BIN_TIMEOUT_MS);
});

describe('peaks complexity-estimate (replacement for missing scan complexity)', () => {
  test('returns per-file and aggregate tiers through the registered real CLI surface', () => {
    const result = runCli([
      'complexity-estimate', '--files', 'tests/integration/business-capability-e2e.test.ts',
      '--project', REPO, '--json'
    ]);
    expect(result.code).toBe(0);

    const envelope = parseEnvelope<{
      projectRoot: string;
      report: {
        files: Array<{ file: string; lines: number; exports: number; hasAsync: boolean; tier: string }>;
        overall: string;
        summary: { trivial: number; simple: number; complex: number };
      };
    }>(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('complexity-estimate');
    expect(envelope.data.report.files).toHaveLength(1);
    expect(envelope.data.report.files[0]?.lines).toBeGreaterThan(0);
    expect(envelope.data.report.overall).toMatch(/^(trivial|simple|complex)$/);
  }, BIN_TIMEOUT_MS);
});
