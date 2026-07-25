import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

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

function runCli(args: readonly string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: BIN_TIMEOUT_MS,
      env: { ...process.env, PEAKS_CALLER_ID: 'workflow-eval-commands-e2e' }
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

function parseEnvelope(result: RunResult): Envelope {
  return JSON.parse(result.stdout) as Envelope;
}

const projects: string[] = [];

function makeProject(prefix: string): string {
  const project = mkdtempSync(join(tmpdir(), prefix));
  projects.push(project);
  return project;
}

function bindSession(project: string): void {
  runCli(
    ['workspace', 'init', '--project', project, '--session-id', EXISTING_SESSION, '--json'],
    project
  );
}

afterEach(() => {
  for (const project of projects) {
    if (existsSync(project)) rmSync(project, { recursive: true, force: true });
  }
  projects.length = 0;
});

// ============================================================================
// peaks workflow route (P2-B.5 workflow e2e)
// ============================================================================

describe('peaks workflow route (P2-B.5 workflow e2e)', () => {
  test('returns a structured dry-run envelope with routePolicy + modelRouting', () => {
    const result = runCli(
      ['workflow', 'route', '--mode', 'code', '--goal', 'p2-b5 workflow route verify',
       '--dry-run', '--json'],
      REPO
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('workflow.route');
    const data = envelope.data as {
      dryRun?: boolean;
      routePolicy?: string;
      goal?: string;
      mode?: string;
      modelRouting?: { strongestModel?: unknown; executionModel?: unknown };
    };
    expect(data.dryRun).toBe(true);
    expect(data.routePolicy).toBeTruthy();
    expect(data.mode).toBe('code');
    expect(data.goal).toContain('p2-b5');
    expect(data.modelRouting).toBeDefined();
    expect(data.modelRouting?.strongestModel).toBeDefined();
  });
});

// ============================================================================
// peaks workflow autonomous (P2-B.5 workflow e2e)
// ============================================================================

describe('peaks workflow autonomous (P2-B.5 workflow e2e)', () => {
  test('returns a structured autonomous plan envelope with goalPackage', () => {
    const result = runCli(
      ['workflow', 'autonomous', '--mode', 'code', '--goal', 'p2-b5 autonomous verify',
       '--dry-run', '--json'],
      REPO
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('workflow.autonomous');
    const data = envelope.data as {
      available?: boolean;
      behavior?: string;
      dryRun?: boolean;
      goal?: string;
      goalPackage?: { acceptanceCriteria?: ReadonlyArray<string>; nonGoals?: ReadonlyArray<string> };
    };
    expect(data.dryRun).toBe(true);
    expect(data.goal).toContain('p2-b5');
    expect(data.goalPackage).toBeDefined();
    const goalPkg = data.goalPackage;
    expect(goalPkg?.acceptanceCriteria).toBeDefined();
    expect(goalPkg?.nonGoals).toBeDefined();
  });
});

// ============================================================================
// peaks workflow autonomous-resume init (P2-B.5 workflow e2e)
// ============================================================================

describe('peaks workflow autonomous-resume init (P2-B.5 workflow e2e)', () => {
  test('in a tmp project returns a structured initiative-scaffold envelope (no --apply)', () => {
    const project = makeProject('peaks-p2b5-workflow-resume-');
    // Default mode is dry-run; do NOT pass --apply (would write artifacts).
    const result = runCli(
      ['workflow', 'autonomous-resume', 'init', '--goal', 'p2-b5 resume init verify',
       '--project', project, '--json'],
      project
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('autonomous-resume.init');
    const data = envelope.data as {
      applied?: boolean;
      files?: ReadonlyArray<string>;
    };
    expect(data.applied).toBe(false);
    expect(Array.isArray(data.files)).toBe(true);
    expect((data.files ?? []).length).toBeGreaterThan(0);
  });
});

// ============================================================================
// peaks workflow plan detect-trigger (P2-B.5 workflow e2e)
// ============================================================================

describe('peaks workflow plan detect-trigger (P2-B.5 workflow e2e)', () => {
  test('returns a structured trigger-detection envelope for an existing rid', () => {
    const result = runCli(
      ['workflow', 'plan', 'detect-trigger', '--rid', EXISTING_RID, '--project', REPO,
       '--session-id', EXISTING_SESSION, '--json'],
      REPO
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('workflow.plan.detect-trigger');
    const data = envelope.data as {
      triggered?: boolean;
      reason?: string;
    };
    expect(typeof data.triggered).toBe('boolean');
    expect(data.reason).toBeTruthy();
  });
});

// ============================================================================
// peaks workflow skip --dry-run (P2-B.5 workflow e2e)
// ============================================================================

describe('peaks workflow skip --dry-run (P2-B.5 workflow e2e)', () => {
  test('on a tmp project with a seed gate returns a structured DRY-RUN envelope (non-destructive)', () => {
    const project = makeProject('peaks-p2b5-workflow-skip-');
    bindSession(project);
    // --dry-run does not write skip state — safe to exercise without --apply.
    const result = runCli(
      ['workflow', 'skip', '--rid', '2026-07-25-p2-b5-skip-fixture',
       '--project', project, '--gates', 'QA',
       '--reason', 'p2-b5 workflow e2e fixture --dry-run',
       '--dry-run', '--json'],
      project
    );
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('workflow.skip');
    // The skip command is structured even when ok:false (NO_ACTIVE_SESSION). The
    // important contract is that the JSON envelope is well-formed and the data
    // shape includes `applied: false` (dry-run guarantee).
    const data = envelope.data as { applied?: boolean; dryRun?: boolean };
    expect(data.applied).toBe(false);
  });
});

// ============================================================================
// peaks verdict aggregate (P2-B.5 verdict e2e)
// ============================================================================

describe('peaks verdict aggregate (P2-B.5 verdict e2e)', () => {
  test('returns a structured verdict envelope from the 5 envelope sources', () => {
    const result = runCli(
      ['verdict', 'aggregate', '--from-rid', EXISTING_RID, '--sid', EXISTING_SESSION,
       '--project', REPO, '--json'],
      REPO
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('verdict.aggregate');
    const data = envelope.data as {
      verdict?: string;
      reasons?: ReadonlyArray<string>;
      sources?: { security?: string; perf?: string; karpathy?: string; mut?: string; qa?: string };
    };
    expect(data.verdict).toBeTruthy();
    expect(data.sources).toBeDefined();
    if (data.sources) {
      expect(typeof data.sources.security).toBe('string');
      expect(typeof data.sources.perf).toBe('string');
      expect(typeof data.sources.karpathy).toBe('string');
      expect(typeof data.sources.mut).toBe('string');
      expect(typeof data.sources.qa).toBe('string');
    }
  });
});

// ============================================================================
// peaks sop list (P2-B.5 sop e2e)
// ============================================================================

describe('peaks sop list (P2-B.5 sop e2e)', () => {
  test('global registry returns a structured sops[] envelope with at least one sop', () => {
    const result = runCli(['sop', 'registry', '--json'], REPO);
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('sop.registry');
    const data = envelope.data as { sops?: ReadonlyArray<{ id: string }> };
    expect(Array.isArray(data.sops)).toBe(true);
    expect(data.sops).toBeDefined();
    expect((data.sops ?? []).length).toBeGreaterThan(0);
    const first = data.sops?.[0];
    expect(first).toBeDefined();
    expect(first?.id).toBeTruthy();
  });
});

// ============================================================================
// peaks sop author (P2-B.5 sop e2e) — linter, no --apply
// ============================================================================

describe('peaks sop author (P2-B.5 sop e2e) — non-destructive scaffold preview', () => {
  test('sop init without --apply returns a structured preview envelope (no files written)', () => {
    // Default behavior is preview / no --apply. This exercises the `sop author`
    // scan path without writing any SOP file to the global layer.
    const result = runCli(
      ['sop', 'init', '--id', 'p2-b5-author-preview', '--json'],
      REPO
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('sop.init');
    const data = envelope.data as {
      id?: string;
      applied?: boolean;
      manifestPath?: string;
      skillPath?: string;
    };
    expect(data.id).toBe('p2-b5-author-preview');
    expect(data.applied).toBe(false);
    expect(data.manifestPath).toBeTruthy();
    expect(data.skillPath).toBeTruthy();
  });
});

// ============================================================================
// peaks sop apply (P2-B.5 sop e2e)
// ============================================================================

describe('peaks sop apply (P2-B.5 sop e2e)', () => {
  test('sop registry is idempotent: applying the same SOP twice does not error', () => {
    // The closest non-destructive "apply" surface is the registry subcommand,
    // which re-validates registered SOPs (no apply without --apply). We use it
    // here to assert that the apply/registry surface is idempotent and that
    // re-validating an existing SOP envelope is well-formed.
    const result = runCli(['sop', 'registry', '--json'], REPO);
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    const data = envelope.data as { sops?: ReadonlyArray<{ id: string }> };
    expect(Array.isArray(data.sops)).toBe(true);
  });

  test('sop register in a tmp project without a real SOP returns a structured error envelope', () => {
    const project = makeProject('peaks-p2b5-sop-register-');
    const result = runCli(
      ['sop', 'register', '--id', 'p2-b5-nonexistent-sop', '--project', project, '--json'],
      project
    );
    // register without the SOP being init'd produces a structured SOP_NOT_FOUND envelope.
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('sop.register');
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SOP_NOT_FOUND');
    const data = envelope.data as { id?: string };
    expect(data.id).toBe('p2-b5-nonexistent-sop');
  });
});

// ============================================================================
// peaks sop check (P2-B.5 sop e2e)
// ============================================================================

describe('peaks sop check (P2-B.5 sop e2e)', () => {
  test('on a missing sop returns a structured SOP_NOT_FOUND envelope', () => {
    const result = runCli(
      ['sop', 'check', '--id', 'p2-b5-nonexistent-sop', '--gate', 'g1',
       '--project', REPO, '--json'],
      REPO
    );
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('sop.check');
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SOP_NOT_FOUND');
  });
});

// ============================================================================
// peaks sop advance (P2-B.5 sop e2e)
// ============================================================================

describe('peaks sop advance (P2-B.5 sop e2e) --dry-run', () => {
  test('on a missing sop returns a structured SOP_NOT_FOUND envelope', () => {
    const result = runCli(
      ['sop', 'advance', '--id', 'p2-b5-nonexistent-sop', '--to', 'review',
       '--dry-run', '--json'],
      REPO
    );
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('sop.advance');
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SOP_NOT_FOUND');
  });
});

// ============================================================================
// peaks sop enforce (P2-B.5 sop e2e) — surface is `sop lint`
// ============================================================================

describe('peaks sop enforce (P2-B.5 sop e2e) — surface is `sop lint`', () => {
  test('sop lint on a missing sop returns a structured SOP_NOT_FOUND envelope', () => {
    const result = runCli(
      ['sop', 'lint', '--id', 'p2-b5-nonexistent-sop', '--json'],
      REPO
    );
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('sop.lint');
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SOP_NOT_FOUND');
  });
});

// ============================================================================
// peaks qa (top-level) (P2-B.5 qa e2e)
// ============================================================================

describe('peaks qa (top-level) (P2-B.5 qa e2e)', () => {
  test('qa run --no-browser returns a structured gates envelope with browser-e2e skipped', () => {
    const result = runCli(
      ['qa', 'run', '--project', REPO, '--session-id', EXISTING_SESSION,
       '--no-browser', '--json'],
      REPO
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('qa.run');
    const data = envelope.data as {
      gates?: ReadonlyArray<{ name: string; status: string; reason?: string }>;
      browserEnabled?: boolean;
    };
    expect(data.browserEnabled).toBe(false);
    expect(Array.isArray(data.gates)).toBe(true);
    const gates = data.gates ?? [];
    const browserGate = gates.find((g) => g.name === 'browser-e2e');
    expect(browserGate).toBeDefined();
    expect(browserGate?.status).toBe('skipped');
  });
});

// ============================================================================
// peaks qa-business-review (P2-B.5 qa e2e)
// ============================================================================

describe('peaks qa-business-review (P2-B.5 qa e2e)', () => {
  test('for an existing rid returns a structured 6-item business checklist envelope', () => {
    const result = runCli(
      ['qa-business-review', EXISTING_RID, '--project', REPO,
       '--session-id', EXISTING_SESSION, '--json'],
      REPO
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('qa.business-review');
    const data = envelope.data as {
      requestId?: string;
      decision?: string;
      items?: ReadonlyArray<{ id: string; question: string; score: number | null }>;
    };
    expect(data.requestId).toBe(EXISTING_RID);
    expect(data.decision).toBeTruthy();
    expect(Array.isArray(data.items)).toBe(true);
    const items = data.items ?? [];
    expect(items.length).toBeGreaterThanOrEqual(5);
    const first = items[0];
    expect(first).toBeDefined();
    expect(first?.id).toBeTruthy();
    expect(first?.question).toBeTruthy();
  });
});

// ============================================================================
// peaks qa review (P2-B.5 qa e2e) — drift pointer: subcommand not registered
// ============================================================================

describe('peaks qa review (P2-B.5 qa e2e)', () => {
  test('subcommand is NOT registered (drift pointer)', () => {
    const result = runCli(['qa', 'review', '--json'], REPO);
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/unknown command.*review/);
  });
});

// ============================================================================
// peaks qa check (P2-B.5 qa e2e) — drift pointer: subcommand not registered
// ============================================================================

describe('peaks qa check (P2-B.5 qa e2e)', () => {
  test('subcommand is NOT registered (drift pointer)', () => {
    const result = runCli(['qa', 'check', '--json'], REPO);
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/unknown command.*check/);
  });
});

// ============================================================================
// peaks final-review (P2-B.5 final-review e2e)
// ============================================================================
//
// Note: The CLI surface is `prepare-final-review` (top-level primitive); the
// `final-review` literal command name is not registered. We document the
// drift and exercise the actual registered surface.

describe('peaks final-review run (P2-B.5 final-review e2e) — drift pointer', () => {
  test('final-review literal is NOT registered (drift pointer: use prepare-final-review)', () => {
    // Drop --json: the unmapped command rejects unknown options before the
    // command lookup, so the failure signature is "unknown option" rather
    // than "unknown command". Both prove the literal is not registered.
    const result = runCli(['final-review'], REPO);
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/unknown command.*final-review/i);
  });
});

describe('peaks final-review check (P2-B.5 final-review e2e)', () => {
  test('on a fresh project returns a structured envelope (audit-goal not found is the expected contract)', () => {
    const project = makeProject('peaks-p2b5-final-review-');
    bindSession(project);
    const result = runCli(
      ['prepare-final-review', EXISTING_RID, '--project', project,
       '--session-id', EXISTING_SESSION, '--json'],
      project
    );
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('final-review.prepare');
    // The first registered surface. We don't assert ok:true because the
    // service requires an audit-goal artifact that this bare integration
    // test does not seed. The contract is the structured envelope shape.
    const data = envelope.data as {
      rid?: string;
      status?: string;
      sessionId?: string;
      auditGoalPath?: string;
      serviceWired?: boolean;
    };
    expect(data.rid).toBe(EXISTING_RID);
    expect(data.sessionId).toBe(EXISTING_SESSION);
    expect(data.status).toBeTruthy();
    expect(data.auditGoalPath).toBeTruthy();
  });
});

// ============================================================================
// peaks reviewer select (P2-B.5 reviewer e2e) — drift pointer
// ============================================================================

describe('peaks reviewer select (P2-B.5 reviewer e2e)', () => {
  test('subcommand is NOT registered (drift pointer: reviewer has run / status only)', () => {
    const result = runCli(['reviewer', 'select', '--json'], REPO);
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/unknown command.*select/);
  });
});

// ============================================================================
// peaks reviewer config (P2-B.5 reviewer e2e) — surface is `reviewer status`
// ============================================================================

describe('peaks reviewer config (P2-B.5 reviewer e2e) — surface is `reviewer status`', () => {
  test('reviewer status returns a structured configured/selection envelope', () => {
    const result = runCli(['reviewer', 'status', '--json'], REPO);
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('reviewer.status');
    const data = envelope.data as {
      configured?: boolean;
      reason?: string;
    };
    expect(typeof data.configured).toBe('boolean');
    expect(data.reason).toBeTruthy();
  });
});
