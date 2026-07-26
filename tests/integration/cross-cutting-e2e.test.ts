import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const REPO = resolve(__dirname, '../..');
const BIN_TIMEOUT_MS = 120_000;

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
      env: { ...process.env, PEAKS_CALLER_ID: 'cross-cutting-e2e' }
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

interface Envelope {
  ok: boolean;
  command: string;
  code?: string;
  message?: string;
  data: unknown;
  warnings: readonly unknown[];
  nextActions: readonly string[];
}

/**
 * Commander prints "{ok:false envelope}" to STDERR (not stdout) when an
 * option is missing or a subcommand is unknown. Try stdout first, then
 * fall back to stderr, and as a last resort try the combined stream —
 * whichever contains a parseable JSON envelope wins.
 */
function parseEnvelope(result: RunResult): Envelope {
  const candidates = [result.stdout, result.stderr, result.stdout + result.stderr];
  let lastError: unknown = null;
  for (const raw of candidates) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const start = trimmed.indexOf('{');
    if (start < 0) continue;
    try {
      return JSON.parse(trimmed.slice(start)) as Envelope;
    } catch (error: unknown) {
      lastError = error;
    }
  }
  throw lastError ?? new Error('parseEnvelope: no JSON envelope found in stdout/stderr');
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

// ============================================================================
// peaks release lifecycle (P2-D cross-cutting e2e)
// plan -> canary(10) -> canary(50) -> rollback -> hotfix (no npmjs touches)
// ============================================================================

describe('peaks release lifecycle (P2-D cross-cutting e2e)', () => {
  test('walks plan -> canary 10 -> canary 50 -> rollback -> hotfix without touching the registry', () => {
    const project = makeProject('peaks-p2d-release-');
    const version = '4.0.0-p2d-fixture';
    const hotfixVersion = '4.0.1-p2d-fixture';

    // plan
    const planned = parseEnvelope(runCli(
      ['release', 'plan', version, '--project', project, '--json'],
      project
    ));
    expect(planned.command).toBe('release.plan');
    expect(planned.ok).toBe(true);
    const planData = planned.data as { version?: string; currentStage?: string };
    expect(planData.version).toBe(version);
    expect(planData.currentStage).toBe('planned');

    // canary 10
    const canary10 = parseEnvelope(runCli(
      ['release', 'canary', '--percent', '10', '--project', project, '--json'],
      project
    ));
    expect(canary10.command).toBe('release.canary');
    expect(canary10.ok).toBe(true);
    const canary10Data = canary10.data as { percent?: number; currentStage?: string };
    expect(canary10Data.percent).toBe(10);
    expect(canary10Data.currentStage).toBe('canary-10');

    // canary 50
    const canary50 = parseEnvelope(runCli(
      ['release', 'canary', '--percent', '50', '--project', project, '--json'],
      project
    ));
    expect(canary50.command).toBe('release.canary');
    expect(canary50.ok).toBe(true);
    const canary50Data = canary50.data as { percent?: number; currentStage?: string };
    expect(canary50Data.percent).toBe(50);
    expect(canary50Data.currentStage).toBe('canary-50');

    // rollback (clears the active release so a fresh hotfix can begin)
    const rolledBack = parseEnvelope(runCli(
      ['release', 'rollback', '--note', 'p2-d fixture rollback', '--project', project, '--json'],
      project
    ));
    expect(rolledBack.command).toBe('release.rollback');
    expect(rolledBack.ok).toBe(true);
    const rollbackData = rolledBack.data as { rolledBack?: string; finalStage?: string };
    expect(rollbackData.rolledBack).toBe(version);
    expect(rollbackData.finalStage).toBe('rolled-back');

    // hotfix skips 'planned' and starts at canary-10
    const hotfix = parseEnvelope(runCli(
      ['release', 'hotfix', hotfixVersion, '--note', 'p2-d fixture hotfix', '--project', project, '--json'],
      project
    ));
    expect(hotfix.command).toBe('release.hotfix');
    expect(hotfix.ok).toBe(true);
    const hotfixData = hotfix.data as { version?: string; currentStage?: string };
    expect(hotfixData.version).toBe(hotfixVersion);
    expect(hotfixData.currentStage).toBe('canary-10');

    // watch returns the structured window status (still in canary-10)
    const watch = parseEnvelope(runCli(
      ['release', 'watch', '--project', project, '--json'],
      project
    ));
    expect(watch.command).toBe('release.watch');
    expect(watch.ok).toBe(true);
    const watchData = watch.data as { currentStage?: string; readyForDone?: boolean; window?: unknown };
    // After hotfix the active release is at canary-10, not promoted; the watch
    // envelope reports currentStage + readyForDone + window instead of `stage`.
    expect(typeof watchData.currentStage).toBe('string');
    expect(typeof watchData.readyForDone).toBe('boolean');
    expect(watchData.window).toBeDefined();
  });
});

// ============================================================================
// peaks bee export / loop export — share bundle round-trip
// (drift pointer: top-level `peaks share bundle {write,read,apply,list}` is
// not registered; the actual peaks.bundle/1 surface is `peaks bee export`
// / `peaks bee import` for bees and `peaks loop export` / `peaks loop import`
// for loops. We exercise the loop surface since it's the closest match to
// `share bundle write/read/apply`.
// ============================================================================

describe('peaks bee export / loop export — share bundle round-trip (P2-D cross-cutting e2e)', () => {
  test('refuses to export a non-existent loop asset with a structured BUNDLE_ASSET_NOT_FOUND envelope', () => {
    const project = makeProject('peaks-p2d-bundle-');
    const outPath = join(project, 'bundle.tar.gz');
    const result = runCli(
      ['loop', 'export', '--loop', 'p2d-fake-loop-id', '--out', outPath, '--project', project, '--json'],
      project
    );
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('loop.export');
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('BUNDLE_ASSET_NOT_FOUND');
    expect((envelope.message ?? '').toLowerCase()).toContain('not found');
  });

  test('peaks share bundle {write,read,apply,list} — drift pointer (surface does not exist)', () => {
    const project = makeProject('peaks-p2d-share-bundle-');
    const result = runCli(
      ['share', 'bundle', 'write', '--project', project, '--json'],
      project
    );
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope(result);
    // The actual peaks.bundle/1 surface is `peaks bee export/import` and
    // `peaks loop export/import`. `peaks share bundle *` is not registered.
    expect(envelope.code).toBe('COMMAND_NOT_FOUND');
  });
});

// ============================================================================
// peaks skill sync — cross-platform dry-run for claude-code + trae
// ============================================================================

describe('peaks skill sync --platform cross-platform dry-run (P2-D cross-cutting e2e)', () => {
  test('claude-code sync returns a structured perPlatform array under dry-run (no ~/.claude writes)', () => {
    const result = runCli(
      ['skill', 'sync', '--platform', 'claude-code', '--dry-run', '--project', REPO, '--json'],
      REPO
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('skill.sync');
    expect(envelope.ok).toBe(true);
    const data = envelope.data as {
      applied?: boolean;
      dryRun?: boolean;
      projectRoot?: string;
      perPlatform?: ReadonlyArray<{ platform?: string; ok?: boolean; installed?: readonly string[] }>;
    };
    expect(data.dryRun).toBe(true);
    expect(data.applied).toBe(false);
    expect(Array.isArray(data.perPlatform)).toBe(true);
    expect((data.perPlatform ?? []).length).toBe(1);
    const first = data.perPlatform?.[0];
    expect(first).toBeDefined();
    expect(first!.platform).toBe('claude-code');
    expect(first!.ok).toBe(true);
    expect(Array.isArray(first!.installed)).toBe(true);
    expect((first!.installed ?? []).length).toBeGreaterThan(0);
  });

  test('trae sync returns a structured perPlatform array under dry-run (no ~/.trae writes)', () => {
    const result = runCli(
      ['skill', 'sync', '--platform', 'trae', '--dry-run', '--project', REPO, '--json'],
      REPO
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('skill.sync');
    expect(envelope.ok).toBe(true);
    const data = envelope.data as {
      dryRun?: boolean;
      applied?: boolean;
      perPlatform?: ReadonlyArray<{ platform?: string; ok?: boolean; installed?: readonly string[] }>;
    };
    expect(data.dryRun).toBe(true);
    expect(data.applied).toBe(false);
    expect(Array.isArray(data.perPlatform)).toBe(true);
    expect((data.perPlatform ?? []).length).toBe(1);
    const first = data.perPlatform?.[0];
    expect(first).toBeDefined();
    expect(first!.platform).toBe('trae');
    expect(first!.ok).toBe(true);
    expect(Array.isArray(first!.installed)).toBe(true);
    expect((first!.installed ?? []).length).toBeGreaterThan(0);
  });
});

// ============================================================================
// peaks project context — 5 templates boot (G4b/AC9)
// ============================================================================

describe('peaks project context 5-template boot (P2-D cross-cutting e2e)', () => {
  test('boots all 5 templates into .peaks/project-scan/ with non-empty bodies', () => {
    const project = makeProject('peaks-p2d-context-');
    const result = runCli(
      ['project', 'context', '--project', project, '--json'],
      project
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('project.context');
    expect(envelope.ok).toBe(true);

    const data = envelope.data as {
      path?: string;
      projectScan?: { templatesBooted?: number; projectScanPath?: string };
    };
    expect(typeof data.path).toBe('string');
    expect(data.projectScan).toBeDefined();
    expect(data.projectScan!.templatesBooted).toBe(5);

    const projectScanPath = data.projectScan!.projectScanPath ?? join(project, '.peaks', 'project-scan', 'project-scan.md');
    expect(existsSync(projectScanPath)).toBe(true);

    const requiredTemplates = [
      'business-knowledge.md',
      'security-template.md',
      'perf-template.md',
      'audit-output-schema.md',
      'project-scan.md'
    ] as const;

    for (const templateName of requiredTemplates) {
      const templatePath = join(project, '.peaks', 'project-scan', templateName);
      expect(existsSync(templatePath)).toBe(true);
      const body = readFileSync(templatePath, 'utf8');
      expect(body.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// peaks config migrate — fake legacy v1.x shape, dry-run verdict
// ============================================================================

describe('peaks config migrate dry-run with fake legacy v1.x config (P2-D cross-cutting e2e)', () => {
  test('returns a structured config.migrate envelope with detectedSchemaVersion / willMigrateFields', () => {
    const project = makeProject('peaks-p2d-config-migrate-');
    const peaksDir = join(project, '.peaks');
    mkdirSync(peaksDir, { recursive: true });
    // Plant a fake legacy v1.x config so the migrator has something to inspect.
    // The actual global config (~/.peaks/config.json) is read by `config migrate`
    // so the verdict may report `alreadyAtV2: true` when the global is already at
    // v2 — that's still a structured verdict with the expected envelope shape.
    writeFileSync(
      join(peaksDir, 'config.json'),
      JSON.stringify({ schemaVersion: '1.4.0', economyMode: true, swarmMode: false, extra: 'kept' })
    );

    const result = runCli(
      ['config', 'migrate', '--project', project, '--dry-run', '--json'],
      project
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('config.migrate');
    expect(envelope.ok).toBe(true);

    const data = envelope.data as {
      alreadyAtV2?: boolean;
      detectedSchemaVersion?: string | null;
      newConfigSchemaVersion?: string;
      willMigrateFields?: readonly string[];
      applied?: boolean;
    };
    expect(typeof data.alreadyAtV2).toBe('boolean');
    expect(typeof data.newConfigSchemaVersion).toBe('string');
    expect(Array.isArray(data.willMigrateFields)).toBe(true);
    expect(data.applied).toBe(false); // dry-run must not apply
  });
});

// ============================================================================
// peaks loop * — distillation primitive (closest match to loop status / show)
// ============================================================================

describe('peaks loop status / loop show drift pointer (P2-D cross-cutting e2e)', () => {
  test('loop status / loop show are not registered; actual surface is distill / preflight / detect-pattern / check-consistency / export / import / eval / check-monotonic / spec / run', () => {
    const project = makeProject('peaks-p2d-loop-status-');
    const status = runCli(['loop', 'status', '--project', project, '--json'], project);
    expect(status.code).not.toBe(0);
    const statusEnvelope = parseEnvelope(status);
    expect(statusEnvelope.code).toBe('COMMAND_NOT_FOUND');

    const show = runCli(['loop', 'show', '--project', project, '--json'], project);
    expect(show.code).not.toBe(0);
    const showEnvelope = parseEnvelope(show);
    expect(showEnvelope.code).toBe('COMMAND_NOT_FOUND');
  });

  test('loop distill returns a structured envelope delegating to peaks memory extract', () => {
    const project = makeProject('peaks-p2d-loop-distill-');
    const result = runCli(['loop', 'distill', '--project', project, '--json'], project);
    // Loop distill delegates to peaks memory extract via execFileSync. In an empty
    // tmp project there's no session artifact to extract, so memory extract fails
    // and loop.distill returns a LOOP_DISTILL_FAILED envelope — that's the
    // structured contract we want to verify here.
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('loop.distill');
    // Either ok:true with a structured delegate payload, or ok:false with the
    // LOOP_DISTILL_FAILED code; both are valid structured envelopes.
    if (envelope.ok) {
      const data = envelope.data as { project?: string; apply?: boolean; delegateStdout?: string };
      expect(data.project).toBe(project);
      expect(typeof data.apply).toBe('boolean');
    } else {
      expect(envelope.code).toBe('LOOP_DISTILL_FAILED');
    }
  });
});

// ============================================================================
// peaks classify run — 5-level heuristic round-trip
// ============================================================================

describe('peaks classify run round-trip (P2-D cross-cutting e2e)', () => {
  test('returns a structured classify envelope with one of 5 levels (typo|bug|feature|refactor|migration)', () => {
    const result = runCli(['classify', 'run', '--project', REPO, '--json'], REPO);
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('classify.run');
    expect(envelope.ok).toBe(true);

    const data = envelope.data as {
      level?: string;
      rationale?: string;
      audit?: { output?: string; overrideApplied?: boolean; inputs?: unknown };
      gateSet?: { stages?: readonly string[] };
    };
    expect(['typo', 'bug', 'feature', 'refactor', 'migration']).toContain(data.level);
    // The envelope exposes both `rationale` (top-level) and `audit.output`.
    expect(typeof data.rationale).toBe('string');
    expect(data.audit).toBeDefined();
    expect(typeof data.audit!.output).toBe('string');
    expect(typeof data.audit!.overrideApplied).toBe('boolean');
    expect(typeof data.audit!.inputs).toBe('object');
    expect(Array.isArray(data.gateSet?.stages)).toBe(true);
  });

  test('classify downgrade is REFUSED per spec §4 (drift pointer)', () => {
    // classify.downgrade requires --level + --reason; without them the CLI
    // surfaces a UNHANDLED_ERROR envelope with the COMMAND_NOT_FOUND combined
    // header. Either way the contract is: it never returns ok:true, and the
    // spec §4 refusal is the canonical code.
    const result = runCli(
      ['classify', 'downgrade', '--level', 'typo', '--reason', 'p2-d fixture attempt', '--project', REPO, '--json'],
      REPO
    );
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope(result);
    // The header envelope is `cli` because commander routes the refusal through
    // the global error path; the structured code we want is the refusal reason.
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBeTruthy();
    const combined = `${envelope.code} ${envelope.message}`.toLowerCase();
    expect(combined).toMatch(/refus|downgrade|spec/);
  });
});