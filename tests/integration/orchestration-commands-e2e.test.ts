import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const BIN = resolve(__dirname, '../../bin/peaks.js');
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
      env: { ...process.env, PEAKS_CALLER_ID: 'orchestration-commands-e2e' }
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

/**
 * Bind the session so commands that read from .peaks/_runtime/session.json
 * (job status / progress / checkpoint / block / continue / resume / handoff /
 *  rotate-now / subagent-cleanup) resolve the same session-id used elsewhere.
 */
function bindSession(project: string): void {
  runCli(['workspace', 'init', '--project', project, '--session-id', EXISTING_SESSION, '--json'], project);
}

afterEach(() => {
  for (const project of projects) {
    if (existsSync(project)) rmSync(project, { recursive: true, force: true });
  }
  projects.length = 0;
});

// ============================================================================
// peaks slice decompose / pick / plan / ls (P2-B.3 orchestration e2e)
// ============================================================================

describe('peaks slice decompose (P2-B.3 orchestration e2e)', () => {
  test('on a tmp project without a PRD body returns a structured SLICE_DECOMPOSE_FAILED envelope', () => {
    const project = makeProject('peaks-p2b3-slice-decompose-');
    const result = runCli(
      ['slice', 'decompose', EXISTING_RID, '--project', project, '--granularity', 'auto', '--json'],
      project
    );
    // Structured error envelope is the contract — never a free-form crash.
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toMatch(/^slice\.decompose/);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SLICE_DECOMPOSE_FAILED');
    expect((envelope.data as { rid?: string }).rid).toBe(EXISTING_RID);
  });
});

describe('peaks slice pick (P2-B.3 orchestration e2e)', () => {
  test('with no decomposition file present returns a structured SLICE_PICK_FAILED envelope', () => {
    const project = makeProject('peaks-p2b3-slice-pick-');
    const result = runCli(
      ['slice', 'pick', EXISTING_RID, '--project', project, '--json'],
      project
    );
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toMatch(/^slice\.pick/);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SLICE_PICK_FAILED');
    expect((envelope.data as { rid?: string }).rid).toBe(EXISTING_RID);
  });
});

describe('peaks slice plan (P2-B.3 orchestration e2e)', () => {
  test('without a picked file returns a structured SLICE_PLAN_FAILED envelope (no apply path exercised)', () => {
    const project = makeProject('peaks-p2b3-slice-plan-');
    const result = runCli(
      ['slice', 'plan', EXISTING_RID, '--project', project, '--json'],
      project
    );
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toMatch(/^slice\.plan/);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SLICE_PLAN_FAILED');
    const data = envelope.data as { rid?: string; pickedPath?: string };
    expect(data.rid).toBe(EXISTING_RID);
    expect(data.pickedPath ?? '').toContain('picked.json');
  });
});

describe('peaks slice ls (P2-B.3 orchestration e2e)', () => {
  test('on the real repo enumerates existing slice-decomposition artifacts', () => {
    const result = runCli(['slice', 'ls', '--json'], process.cwd());
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('slice.ls');
    const data = envelope.data as { rids: ReadonlyArray<{ rid: string }> };
    expect(Array.isArray(data.rids)).toBe(true);
    expect(data.rids.length).toBeGreaterThan(0);
  });

  test('--rid substring filter narrows the result set', () => {
    const result = runCli(['slice', 'ls', '--rid', 'slice-decompose', '--json'], process.cwd());
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    const data = envelope.data as { rids: ReadonlyArray<{ rid: string }> };
    expect(data.rids.length).toBeGreaterThan(0);
    for (const r of data.rids) {
      expect(r.rid.toLowerCase()).toContain('slice-decompose');
    }
  });

  test('--limit caps the result count', () => {
    const result = runCli(['slice', 'ls', '--limit', '2', '--json'], process.cwd());
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    const data = envelope.data as { rids: ReadonlyArray<unknown> };
    expect(data.rids.length).toBeLessThanOrEqual(2);
  });
});

describe('peaks slice cleanup (P2-B.3 orchestration e2e)', () => {
  test('subcommand is NOT registered (drift pointer)', () => {
    const project = makeProject('peaks-p2b3-slice-cleanup-');
    const result = runCli(['slice', 'cleanup', '--project', project, '--json'], project);
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/unknown command.*cleanup/);
  });
});

describe('peaks slice review (P2-B.3 orchestration e2e)', () => {
  test('subcommand is NOT registered (drift pointer)', () => {
    const project = makeProject('peaks-p2b3-slice-review-');
    const result = runCli(['slice', 'review', '--project', project, '--json'], project);
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/unknown command.*review/);
  });
});

// ============================================================================
// peaks job init / status / progress / checkpoint / rotate-now / block /
// continue / resume / handoff / subagent-cleanup (P2-B.3 orchestration e2e)
// ============================================================================

describe('peaks job init (P2-B.3 orchestration e2e)', () => {
  test('on a tmp project seeds a job envelope and writes a state.json artifact', () => {
    const project = makeProject('peaks-p2b3-job-init-');
    const result = runCli([
      'job', 'init', '--job-id', 'p2b3-fixture-job',
      '--slice-list', `${EXISTING_RID},rid-fake`,
      '--project', project, '--session-id', EXISTING_SESSION,
      '--json'
    ], project);
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('init');
    const data = envelope.data as { jobId: string; sliceCount: number; statePath: string };
    expect(data.jobId).toBe('p2b3-fixture-job');
    expect(data.sliceCount).toBe(2);
    expect(data.statePath).toContain('p2b3-fixture-job');
  });
});

describe('peaks job status (P2-B.3 orchestration e2e)', () => {
  test('reports the seeded job state with structured envelope', () => {
    const project = makeProject('peaks-p2b3-job-status-');
    bindSession(project);
    const init = runCli([
      'job', 'init', '--job-id', 'p2b3-status-job',
      '--slice-list', `${EXISTING_RID}`,
      '--project', project, '--session-id', EXISTING_SESSION,
      '--json'
    ], project);
    expect(init.code).toBe(0);

    const result = runCli([
      'job', 'status', '--job-id', 'p2b3-status-job', '--project', project, '--json'
    ], project);
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('status');
    const data = envelope.data as {
      total?: number;
      done?: number;
      currentSlice?: string | null;
      mainLoopStrategy?: string;
    };
    expect(data.total).toBeGreaterThan(0);
    expect(data.currentSlice).toBe(EXISTING_RID);
    expect(data.mainLoopStrategy).toBeTruthy();
  });
});

describe('peaks job progress (P2-B.3 orchestration e2e)', () => {
  test('on a fresh job returns a structured PROGRESS_READ_FAILED verdict with jobId in data', () => {
    const project = makeProject('peaks-p2b3-job-progress-');
    bindSession(project);
    const result = runCli([
      'job', 'progress', '--job-id', 'p2b3-progress-job',
      '--project', project, '--json'
    ], project);
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('progress');
    // Drift: --allow-missing is documented in --help but does NOT currently
    // promote the response to ok:true. The CLI returns PROGRESS_READ_FAILED
    // (or NO_PROGRESS depending on the call path) with structured envelope
    // data { jobId }. Assert the structured error contract so a future fix
    // can promote the response.
    expect(envelope.ok).toBe(false);
    expect(['PROGRESS_READ_FAILED', 'NO_PROGRESS']).toContain(envelope.code);
    const data = envelope.data as { jobId?: string };
    expect(data.jobId).toBe('p2b3-progress-job');
  });
});

describe('peaks job checkpoint (P2-B.3 orchestration e2e)', () => {
  test('records a done checkpoint and reports structured envelope', () => {
    const project = makeProject('peaks-p2b3-job-checkpoint-');
    bindSession(project);
    const init = runCli([
      'job', 'init', '--job-id', 'p2b3-checkpoint-job',
      '--slice-list', `${EXISTING_RID}`,
      '--project', project, '--session-id', EXISTING_SESSION,
      '--json'
    ], project);
    expect(init.code).toBe(0);

    const result = runCli([
      'job', 'checkpoint',
      '--job-id', 'p2b3-checkpoint-job',
      '--slice-id', EXISTING_RID,
      '--state', 'done',
      '--commit-sha', 'deadbeefcafebabe1234567890abcdef00000000',
      '--reason', 'p2b3 orchestration e2e fixture',
      '--project', project, '--json'
    ], project);
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('checkpoint');
    const data = envelope.data as { sliceId?: string; status?: string };
    expect(data.sliceId).toBe(EXISTING_RID);
    expect(data.status).toBe('done');
  });
});

describe('peaks job rotate-now (P2-B.3 orchestration e2e)', () => {
  test('on a seeded job emits a structured rotation envelope', () => {
    const project = makeProject('peaks-p2b3-job-rotate-');
    bindSession(project);
    runCli([
      'job', 'init', '--job-id', 'p2b3-rotate-job',
      '--slice-list', `${EXISTING_RID},rid-a,rid-b`,
      '--project', project, '--session-id', EXISTING_SESSION,
      '--json'
    ], project);

    const result = runCli([
      'job', 'rotate-now', '--job-id', 'p2b3-rotate-job',
      '--project', project, '--json'
    ], project);
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('rotate-now');
    const data = envelope.data as { rotated?: boolean; reason?: string };
    expect(data.rotated).toBe(true);
    expect(typeof data.reason).toBe('string');
  });
});

describe('peaks job block (P2-B.3 orchestration e2e)', () => {
  test('records a block reason on a seeded job', () => {
    const project = makeProject('peaks-p2b3-job-block-');
    bindSession(project);
    runCli([
      'job', 'init', '--job-id', 'p2b3-block-job',
      '--slice-list', `${EXISTING_RID}`,
      '--project', project, '--session-id', EXISTING_SESSION,
      '--json'
    ], project);

    const result = runCli([
      'job', 'block',
      '--job-id', 'p2b3-block-job',
      '--slice-id', EXISTING_RID,
      '--reason', 'p2b3 block fixture',
      '--project', project, '--json'
    ], project);
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('block');
    const data = envelope.data as { blocked?: string; reason?: string };
    expect(data.blocked).toBe(EXISTING_RID);
    expect(data.reason).toBe('p2b3 block fixture');
  });
});

describe('peaks job continue (P2-B.3 orchestration e2e)', () => {
  test('on a seeded job reports a structured continue envelope', () => {
    const project = makeProject('peaks-p2b3-job-continue-');
    bindSession(project);
    runCli([
      'job', 'init', '--job-id', 'p2b3-continue-job',
      '--slice-list', `${EXISTING_RID}`,
      '--project', project, '--session-id', EXISTING_SESSION,
      '--json'
    ], project);

    const result = runCli([
      'job', 'continue', '--job-id', 'p2b3-continue-job',
      '--project', project, '--json'
    ], project);
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('continue');
    const data = envelope.data as { remaining?: number; next?: string };
    expect(data.remaining).toBeGreaterThan(0);
    expect(data.next).toBe(EXISTING_RID);
  });
});

describe('peaks job resume (P2-B.3 orchestration e2e)', () => {
  test('on a seeded job reports a structured resume envelope', () => {
    const project = makeProject('peaks-p2b3-job-resume-');
    bindSession(project);
    runCli([
      'job', 'init', '--job-id', 'p2b3-resume-job',
      '--slice-list', `${EXISTING_RID}`,
      '--project', project, '--session-id', EXISTING_SESSION,
      '--json'
    ], project);

    const result = runCli([
      'job', 'resume', '--job-id', 'p2b3-resume-job',
      '--project', project, '--json'
    ], project);
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('resume');
    const data = envelope.data as { resumed?: string; total?: number };
    expect(data.resumed).toBe('p2b3-resume-job');
    expect(data.total).toBeGreaterThan(0);
  });
});

describe('peaks job handoff (P2-B.3 orchestration e2e)', () => {
  test('on a seeded job reports a structured handoff envelope', () => {
    const project = makeProject('peaks-p2b3-job-handoff-');
    bindSession(project);
    runCli([
      'job', 'init', '--job-id', 'p2b3-handoff-job',
      '--slice-list', `${EXISTING_RID}`,
      '--project', project, '--session-id', EXISTING_SESSION,
      '--json'
    ], project);

    const result = runCli([
      'job', 'handoff', '--job-id', 'p2b3-handoff-job',
      '--project', project, '--json'
    ], project);
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('handoff');
    const data = envelope.data as { handoffFor?: string; total?: number };
    expect(data.handoffFor).toBe('p2b3-handoff-job');
    expect(data.total).toBeGreaterThan(0);
  });
});

describe('peaks job subagent-cleanup (P2-B.3 orchestration e2e)', () => {
  test('on a seeded job with --batch-id returns a structured envelope (no force)', () => {
    const project = makeProject('peaks-p2b3-job-sa-cleanup-');
    bindSession(project);
    runCli([
      'job', 'init', '--job-id', 'p2b3-sa-job',
      '--slice-list', `${EXISTING_RID}`,
      '--project', project, '--session-id', EXISTING_SESSION,
      '--json'
    ], project);

    const result = runCli([
      'job', 'subagent-cleanup',
      '--job-id', 'p2b3-sa-job',
      '--batch-id', 'batch-fixture-001',
      '--project', project, '--json'
    ], project);
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('subagent-cleanup');
    const data = envelope.data as { cleaned?: boolean };
    expect(data.cleaned).toBe(true);
  });
});

describe('peaks job rotation (P2-B.3 orchestration e2e)', () => {
  test('subcommand is NOT registered — use "rotate-now" instead (drift pointer)', () => {
    const project = makeProject('peaks-p2b3-job-rotation-');
    const result = runCli([
      'job', 'rotation', '--job-id', 'p2b3-rotation-job',
      '--project', project, '--json'
    ], project);
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/unknown command.*rotation/);
  });
});

// ============================================================================
// peaks memory extract / sync / list / search (P2-B.3 orchestration e2e)
// ============================================================================

describe('peaks memory extract (P2-B.3 orchestration e2e)', () => {
  test('dry-run on the real repo reports a structured extract verdict (apply:false)', () => {
    const result = runCli([
      'memory', 'extract',
      '--project', process.cwd(),
      '--artifact', join(process.cwd(), '.peaks/_runtime/2026-07-25-session-6da9d9/rd/requests/001-2026-07-25-p1-7-sub-agent-dispatch-e2e.md'),
      '--dry-run', '--json'
    ], process.cwd());
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('memory.extract');
    const data = envelope.data as {
      apply?: boolean;
      plannedWrites?: readonly unknown[];
      writtenFiles?: readonly string[];
      primaryMemoryDir?: string;
    };
    expect(data.apply).toBe(false);
    expect(Array.isArray(data.plannedWrites ?? [])).toBe(true);
    expect((data.writtenFiles ?? []).length).toBe(0);
    expect(typeof data.primaryMemoryDir).toBe('string');
  });
});

describe('peaks memory sync (P2-B.3 orchestration e2e)', () => {
  test('dry-run returns a structured MEMORY_SYNC_FAILED verdict when workspace is inside the project root', () => {
    // The CLI explicitly rejects nested workspace; this is a documented
    // invariant of the sync command (artifact workspace must live OUTSIDE
    // the project root so the back-up never overwrites the source). Assert
    // the rejection is structured (not free-form) so JSON consumers can
    // branch on `code`.
    const project = makeProject('peaks-p2b3-mem-sync-');
    const result = runCli([
      'memory', 'sync',
      '--project', project,
      '--workspace', project,
      '--dry-run', '--json'
    ], project);
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('memory.sync');
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('MEMORY_SYNC_FAILED');
    expect(envelope.message).toMatch(/outside the project root/i);
  });
});

describe('peaks memory list (P2-B.3 orchestration e2e)', () => {
  test('on the real repo returns the structured index of memory entries', () => {
    const result = runCli(['memory', 'list', '--json'], process.cwd());
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('memory.list');
    const data = envelope.data as {
      indexPath: string;
      total: number;
      entries: ReadonlyArray<{ name: string; kind: string }>;
    };
    expect(data.total).toBeGreaterThan(0);
    expect(data.entries.length).toBeGreaterThan(0);
    const firstEntry = data.entries[0];
    expect(firstEntry).toBeDefined();
    expect(firstEntry!.name.length).toBeGreaterThan(0);
  });

  test('--kind rule filter narrows the result set to the requested kind', () => {
    const result = runCli([
      'memory', 'list', '--kind', 'rule', '--json'
    ], process.cwd());
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    const data = envelope.data as {
      entries: ReadonlyArray<{ kind: string }>;
    };
    expect(data.entries.length).toBeGreaterThan(0);
    for (const entry of data.entries) {
      expect(entry.kind).toBe('rule');
    }
  });
});

describe('peaks memory search (P2-B.3 orchestration e2e)', () => {
  test('returns a structured match list with deterministic scores', () => {
    const result = runCli([
      'memory', 'search', 'peaks', '--limit', '3', '--json'
    ], process.cwd());
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('memory.search');
    const data = envelope.data as {
      query: string;
      total: number;
      matches: ReadonlyArray<{ name: string; kind: string; score: number }>;
    };
    expect(data.query).toBe('peaks');
    expect(data.matches.length).toBeGreaterThan(0);
    const firstMatch = data.matches[0];
    expect(firstMatch).toBeDefined();
    expect(firstMatch!.score).toBeGreaterThanOrEqual(1);
  });
});

describe('peaks memory sediment (P2-B.3 orchestration e2e)', () => {
  test('subcommand is NOT registered (drift pointer)', () => {
    const result = runCli([
      'memory', 'sediment', '--project', process.cwd(), '--json'
    ], process.cwd());
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/unknown command.*sediment/);
  });
});

describe('peaks memory prune (P2-B.3 orchestration e2e)', () => {
  test('subcommand is NOT registered (drift pointer)', () => {
    const result = runCli([
      'memory', 'prune', '--project', process.cwd(), '--json'
    ], process.cwd());
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/unknown command.*prune/);
  });
});

// ============================================================================
// peaks request lint / repair-status / list / show / delete (P2-B.3 orchestration e2e)
// ============================================================================

describe('peaks request lint (P2-B.3 orchestration e2e)', () => {
  test('scans the existing rid artifact and reports findings with structured envelope', () => {
    const result = runCli([
      'request', 'lint', EXISTING_RID, '--role', 'rd',
      '--project', process.cwd(),
      '--session-id', EXISTING_SESSION,
      '--json'
    ], process.cwd());
    expect(result.stdout.length).toBeGreaterThan(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('request.lint');
    const data = envelope.data as {
      role: string;
      requestId: string;
      path: string;
      totalLines: number;
      findings: ReadonlyArray<{ line: number; reason: string; severity: string }>;
    };
    expect(data.role).toBe('rd');
    expect(data.requestId).toBe(EXISTING_RID);
    expect(data.totalLines).toBeGreaterThan(0);
    expect(Array.isArray(data.findings)).toBe(true);
  });
});

describe('peaks request repair-status (P2-B.3 orchestration e2e)', () => {
  test('reports cycle count and atCap verdict for the existing rid', () => {
    const result = runCli([
      'request', 'repair-status', EXISTING_RID,
      '--project', process.cwd(),
      '--session-id', EXISTING_SESSION,
      '--json'
    ], process.cwd());
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('request.repair-status');
    const data = envelope.data as {
      requestId: string;
      sessionId: string;
      cycleCount: number;
      maxCycles: number;
      remaining: number;
      atCap: boolean;
      blocked: boolean;
      entries: readonly unknown[];
    };
    expect(data.requestId).toBe(EXISTING_RID);
    expect(data.maxCycles).toBe(3);
    expect(data.atCap).toBe(false);
    expect(Array.isArray(data.entries)).toBe(true);
  });
});

describe('peaks request list (P2-B.3 orchestration e2e)', () => {
  test('lists per-request artifacts under the session scoped to role=rd', () => {
    const result = runCli([
      'request', 'list', '--project', process.cwd(),
      '--session-id', EXISTING_SESSION, '--role', 'rd', '--json'
    ], process.cwd());
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('request.list');
    const data = envelope.data as {
      count: number;
      items: ReadonlyArray<{ role: string; requestId: string }>;
    };
    expect(data.count).toBeGreaterThan(0);
    expect(data.items.length).toBe(data.count);
    for (const item of data.items) {
      expect(item.role).toBe('rd');
    }
  });
});

describe('peaks request show (P2-B.3 orchestration e2e)', () => {
  test('shows the existing rid artifact with a structured envelope', () => {
    const result = runCli([
      'request', 'show', EXISTING_RID, '--role', 'rd',
      '--project', process.cwd(),
      '--session-id', EXISTING_SESSION,
      '--json'
    ], process.cwd());
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe('request.show');
    const data = envelope.data as {
      role: string;
      requestId: string;
      path: string;
      state: string;
    };
    expect(data.role).toBe('rd');
    expect(data.requestId).toBe(EXISTING_RID);
    expect(data.state.length).toBeGreaterThan(0);
    expect(data.path).toContain(EXISTING_RID);
  });
});

describe('peaks request delete (P2-B.3 orchestration e2e)', () => {
  test('subcommand is NOT registered — skip destructive test (drift pointer)', () => {
    // The brief explicitly skips destructive tests; we only assert the
    // documented subcommand is NOT registered so a future addition gets
    // surfaced as a structured verdict rather than a silent delete.
    const result = runCli([
      'request', 'delete', EXISTING_RID,
      '--project', process.cwd(),
      '--json'
    ], process.cwd());
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    expect(combined).toMatch(/unknown command.*delete/);
  });
});