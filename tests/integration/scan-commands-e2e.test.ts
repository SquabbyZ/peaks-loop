import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { z } from 'zod';
import { parseCliEnvelopeWith } from '../../src/cli/cli-envelope.js';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const REPO = resolve(__dirname, '../..');
const BIN_TIMEOUT_MS = 120_000;

// The `data` payloads this file reads at depth >= 2, one per scan verb. The
// local `parseEnvelope<T>` these replace promised each shape with a type
// parameter and delivered it with `JSON.parse(result.stdout) as
// CliEnvelope<T>` — a claim about a check that never ran. `parseCliEnvelopeWith`
// runs these schemas instead. (S15.)
const archetypePayload = z.looseObject({
  archetype: z.string(),
  confidence: z.string(),
  signals: z.array(z.looseObject({ name: z.string(), matched: z.boolean(), detail: z.string() })),
  detected: z.looseObject({ hasPackageJson: z.boolean() })
});
const librariesPayload = z.looseObject({
  libraries: z.array(
    z.looseObject({
      name: z.string(),
      version: z.string(),
      scope: z.string(),
      ecosystem: z.string()
    })
  ),
  totalCount: z.number(),
  byScope: z.record(z.string(), z.number())
});
const apiSurfacePayload = z.looseObject({
  counts: z.looseObject({
    cli: z.number(),
    service: z.number(),
    type: z.number(),
    constant: z.number()
  }),
  cli: z.array(z.unknown()),
  service: z.array(z.unknown()),
  type: z.array(z.unknown()),
  constant: z.array(z.unknown())
});
const requestTypeSanityPayload = z.looseObject({
  declaredType: z.string(),
  gitAvailable: z.boolean(),
  changedFiles: z.array(z.string()),
  breakdown: z.array(z.unknown()),
  suggestedTypes: z.array(z.string()),
  consistent: z.boolean(),
  rationale: z.string()
});
const orphanPayload = z.looseObject({
  scope: z.string(),
  counts: z.looseObject({
    export: z.number(),
    import: z.number(),
    cliSubcommand: z.number(),
    docEndpoint: z.number()
  }),
  exportOrphans: z.array(z.unknown()),
  importOrphans: z.array(z.unknown()),
  cliSubcommandOrphans: z.array(z.unknown()),
  docEndpointOrphans: z.array(z.unknown())
});
const diffVsScopePayload = z.looseObject({
  ok: z.boolean(),
  rdArtifactPath: z.string(),
  changedFiles: z.array(z.unknown()),
  violations: z.array(z.unknown()),
  unclassified: z.array(z.unknown()),
  gitAvailable: z.boolean(),
  patternsDeclared: z.boolean()
});
const complexityEstimatePayload = z.looseObject({
  projectRoot: z.string(),
  report: z.looseObject({
    files: z.array(
      z.looseObject({
        file: z.string(),
        lines: z.number(),
        exports: z.number(),
        hasAsync: z.boolean(),
        tier: z.string()
      })
    ),
    overall: z.string(),
    summary: z.looseObject({ trivial: z.number(), simple: z.number(), complex: z.number() })
  })
});

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function runCli(args: readonly string[], cwd: string = REPO): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
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
      stdout:
        typeof caught.stdout === 'string' ? caught.stdout : (caught.stdout?.toString('utf8') ?? ''),
      stderr:
        typeof caught.stderr === 'string' ? caught.stderr : (caught.stderr?.toString('utf8') ?? ''),
      code: typeof caught.status === 'number' ? caught.status : 1
    };
  }
}

const projects: string[] = [];

afterEach(() => {
  for (const project of projects) {
    rmSync(project, { recursive: true, force: true });
  }
  projects.length = 0;
});

/**
 * Build the git-backed tmp project `scan diff-vs-scope` needs, holding the
 * session-scoped RD artifact it resolves.
 *
 * The previous fixture pointed at
 * `.peaks/_runtime/2026-07-25-session-6da9d9/rd/requests/001-…md` inside THIS
 * repository: `.gitignore:9` excludes that tree, the session had been pruned,
 * and CI never has it — so the test was red for a reason no product change
 * could fix. Everything here is created by the test. `git init` + one commit is
 * what makes `gitAvailable` true, and the artifact is written by the product's
 * own `request init --apply` rather than hand-built, so the fixture cannot
 * drift from the artifact layout.
 */
function seedDiffVsScopeFixture(): {
  readonly project: string;
  readonly rid: string;
  readonly sessionId: string;
} {
  const project = mkdtempSync(join(tmpdir(), 'peaks-scan-diff-scope-'));
  projects.push(project);
  const git = (args: readonly string[]): void => {
    execFileSync('git', [...args], { cwd: project, stdio: 'ignore', windowsHide: true });
  };
  git(['init']);
  git([
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'user.name=fixture',
    'commit',
    '--allow-empty',
    '-m',
    'fixture'
  ]);

  const rid = 'scan-diff-vs-scope-fixture';
  const sessionId = '2026-09-13-session-fixture0';
  const bound = runCli(
    ['workspace', 'init', '--project', project, '--session-id', sessionId, '--json'],
    project
  );
  expect(bound.code).toBe(0);
  const created = runCli(
    [
      'request',
      'init',
      '--role',
      'rd',
      '--id',
      rid,
      '--project',
      project,
      '--session-id',
      sessionId,
      '--apply',
      '--json'
    ],
    project
  );
  expect(created.code).toBe(0);
  return { project, rid, sessionId };
}

describe('peaks scan archetype', () => {
  test(
    'reports the real repository archetype and detection signals',
    () => {
      const result = runCli(['scan', 'archetype', '--project', REPO, '--json']);
      expect(result.code).toBe(0);

      const envelope = parseCliEnvelopeWith(result.stdout, archetypePayload);
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('scan.archetype');
      expect(envelope.data.archetype).toMatch(/\S/);
      expect(envelope.data.signals.length).toBeGreaterThan(0);
      expect(envelope.data.detected.hasPackageJson).toBe(true);
    },
    BIN_TIMEOUT_MS
  );
});

describe('peaks scan libraries', () => {
  test(
    'reports named and versioned dependencies from the real monorepo',
    () => {
      const result = runCli(['scan', 'libraries', '--project', REPO, '--json']);
      expect(result.code).toBe(0);

      const envelope = parseCliEnvelopeWith(result.stdout, librariesPayload);
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('scan.libraries');
      expect(envelope.data.libraries.length).toBeGreaterThan(0);
      expect(envelope.data.totalCount).toBe(envelope.data.libraries.length);
      expect(
        envelope.data.libraries.every(({ name, version }) => name.length > 0 && version.length > 0)
      ).toBe(true);
    },
    BIN_TIMEOUT_MS
  );
});

describe('peaks scan api-surface', () => {
  test(
    'returns the structured API inventory envelope for the real repository',
    () => {
      const result = runCli([
        'scan',
        'api-surface',
        '--project',
        REPO,
        '--format',
        'json',
        '--json'
      ]);
      expect(result.code).toBe(0);

      const envelope = parseCliEnvelopeWith(result.stdout, apiSurfacePayload);
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('scan.api-surface');
      expect(Object.values(envelope.data.counts).every(Number.isInteger)).toBe(true);
      expect(
        [
          envelope.data.cli,
          envelope.data.service,
          envelope.data.type,
          envelope.data.constant
        ].every(Array.isArray)
      ).toBe(true);
    },
    BIN_TIMEOUT_MS
  );
});

describe('peaks scan request-type-sanity', () => {
  test(
    'reports consistency and preserves its documented verdict exit code',
    () => {
      const result = runCli([
        'scan',
        'request-type-sanity',
        '--project',
        REPO,
        '--type',
        'feature',
        '--json'
      ]);
      const envelope = parseCliEnvelopeWith(result.stdout, requestTypeSanityPayload);

      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('scan.request-type-sanity');
      expect(envelope.data.declaredType).toBe('feature');
      expect(envelope.data.gitAvailable).toBe(true);
      expect(Array.isArray(envelope.data.breakdown)).toBe(true);
      // A mismatch is a successful scan verdict with exit 1, not an envelope failure.
      expect(result.code).toBe(envelope.data.consistent ? 0 : 1);
    },
    BIN_TIMEOUT_MS
  );
});

describe('peaks scan orphan', () => {
  test(
    'returns all four orphan categories for the real working tree',
    () => {
      const result = runCli([
        'scan',
        'orphan',
        '--project',
        REPO,
        '--format',
        'json',
        '--scope',
        'working-tree',
        '--json'
      ]);
      expect(result.code).toBe(0);

      const envelope = parseCliEnvelopeWith(result.stdout, orphanPayload);
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('scan.orphan');
      expect(envelope.data.scope).toBe('working-tree');
      expect(Object.values(envelope.data.counts).every(Number.isInteger)).toBe(true);
      expect(
        [
          envelope.data.exportOrphans,
          envelope.data.importOrphans,
          envelope.data.cliSubcommandOrphans,
          envelope.data.docEndpointOrphans
        ].every(Array.isArray)
      ).toBe(true);
    },
    BIN_TIMEOUT_MS
  );
});

describe('peaks scan diff-vs-scope', () => {
  test(
    'returns a structured scope verdict for a self-constructed RD request',
    () => {
      const { project, rid, sessionId } = seedDiffVsScopeFixture();
      const result = runCli(
        [
          'scan',
          'diff-vs-scope',
          '--rid',
          rid,
          '--project',
          project,
          '--session-id',
          sessionId,
          '--json'
        ],
        project
      );
      const envelope = parseCliEnvelopeWith(result.stdout, diffVsScopePayload);

      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('scan.diff-vs-scope');
      expect(envelope.data.rdArtifactPath).toContain(rid);
      expect(envelope.data.gitAvailable).toBe(true);
      expect(Array.isArray(envelope.data.changedFiles)).toBe(true);
      expect(Array.isArray(envelope.data.violations)).toBe(true);
      // Out-of-scope or unclassified files produce a successful verdict envelope with exit 1.
      expect(result.code).toBe(envelope.data.ok ? 0 : 1);
    },
    BIN_TIMEOUT_MS
  );
});

describe('peaks complexity-estimate (replacement for missing scan complexity)', () => {
  test(
    'returns per-file and aggregate tiers through the registered real CLI surface',
    () => {
      const result = runCli([
        'complexity-estimate',
        '--files',
        'tests/integration/business-capability-e2e.test.ts',
        '--project',
        REPO,
        '--json'
      ]);
      expect(result.code).toBe(0);

      const envelope = parseCliEnvelopeWith(result.stdout, complexityEstimatePayload);
      expect(envelope.ok).toBe(true);
      expect(envelope.command).toBe('complexity-estimate');
      expect(envelope.data.report.files).toHaveLength(1);
      expect(envelope.data.report.files[0]?.lines).toBeGreaterThan(0);
      expect(envelope.data.report.overall).toMatch(/^(trivial|simple|complex)$/);
    },
    BIN_TIMEOUT_MS
  );
});
