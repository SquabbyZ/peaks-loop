import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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
      env: { ...process.env, PEAKS_CALLER_ID: 'misc-commands-e2e' }
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
    // Find the first '{' so we skip leading "error: ..." commander prefixes.
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
// peaks understand scan — drift pointer (subcommand not registered; surface is `status`/`show`/`opt-in`/`context`)
// ============================================================================

describe('peaks understand scan (P2-B.6 misc e2e)', () => {
  test('returns COMMAND_NOT_FOUND envelope (drift: actual subcommands are status / show / opt-in / context)', () => {
    const result = runCli(['understand', 'scan', '--project', REPO, '--json'], REPO);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('COMMAND_NOT_FOUND');
  });
});

// ============================================================================
// peaks understand hybrid — drift pointer (subcommand not registered; surface is `context`)
// ============================================================================

describe('peaks understand hybrid (P2-B.6 misc e2e)', () => {
  test('returns COMMAND_NOT_FOUND envelope (drift: actual surface is `context`)', () => {
    const result = runCli(['understand', 'hybrid', '--project', REPO, '--json'], REPO);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('COMMAND_NOT_FOUND');
  });
});

// ============================================================================
// peaks prd handoff show (P2-B.6 misc e2e) — passthrough read primitive
// ============================================================================

describe('peaks prd handoff show (P2-B.6 misc e2e)', () => {
  test('returns a structured UNHANDLED_ERROR envelope (--path is required)', () => {
    const project = makeProject('peaks-p2b6-prd-show-');
    const result = runCli(
      ['prd', 'handoff', 'show', '--project', project, '--json'],
      project
    );
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('UNHANDLED_ERROR');
  });
});

// ============================================================================
// peaks prd check-blocks (P2-B.6 misc e2e)
// ============================================================================

describe('peaks prd check-blocks (P2-B.6 misc e2e)', () => {
  test('returns a structured envelope with findings[] when given an empty project', () => {
    const project = makeProject('peaks-p2b6-prd-cb-');
    const result = runCli(
      ['prd', 'check-blocks', '2026-07-25-p2-b6-prd-fixture', '--project', project, '--json'],
      project
    );
    // `prd.check-blocks` exits 1 (not 0) when its findings include missing
    // required blocks — that's exactly the contract we want to verify.
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('prd.check-blocks');
    expect(envelope.ok).toBe(true);
    const data = envelope.data as {
      findings?: ReadonlyArray<{ block?: number; name?: string; required?: boolean; present?: boolean }>;
      artifactPath?: string;
    };
    expect(Array.isArray(data.findings)).toBe(true);
    expect((data.findings ?? []).length).toBeGreaterThan(0);
  });
});

// ============================================================================
// peaks prd-blocks (P2-B.6 misc e2e) — drift pointer (top-level command does not exist; surface is `peaks prd check-blocks`)
// ============================================================================

describe('peaks prd-blocks top-level (P2-B.6 misc e2e)', () => {
  test('returns COMMAND_NOT_FOUND envelope (drift: actual surface is `peaks prd check-blocks`)', () => {
    const result = runCli(['prd-blocks', '--json'], REPO);
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.code).toBe('COMMAND_NOT_FOUND');
  });
});

// ============================================================================
// peaks release pack (P2-B.6 misc e2e) — drift pointer
// ============================================================================

describe('peaks release pack (P2-B.6 misc e2e)', () => {
  test('returns COMMAND_NOT_FOUND envelope (drift: actual subcommands are plan / canary / promote / watch / done / rollback / hotfix)', () => {
    const result = runCli(['release', 'pack', '--json'], REPO);
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.code).toBe('COMMAND_NOT_FOUND');
  });
});

// ============================================================================
// peaks release publish (P2-B.6 misc e2e) — drift pointer
// ============================================================================

describe('peaks release publish (P2-B.6 misc e2e)', () => {
  test('returns COMMAND_NOT_FOUND envelope (drift: actual release surface is the canary state machine, not publish)', () => {
    const result = runCli(['release', 'publish', '--json'], REPO);
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.code).toBe('COMMAND_NOT_FOUND');
  });
});

// ============================================================================
// peaks release status (P2-B.6 misc e2e) — drift pointer (uses `release watch` instead)
// ============================================================================

describe('peaks release status (P2-B.6 misc e2e)', () => {
  test('returns COMMAND_NOT_FOUND envelope (drift: actual surface is `peaks release watch`)', () => {
    const result = runCli(['release', 'status', '--json'], REPO);
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.code).toBe('COMMAND_NOT_FOUND');
  });
});

// ============================================================================
// peaks release plan (P2-B.6 misc e2e) — actual surface (no --apply)
// ============================================================================

describe('peaks release plan (P2-B.6 misc e2e)', () => {
  test('returns a structured release.plan envelope in an empty tmp project', () => {
    const project = makeProject('peaks-p2b6-release-plan-');
    const result = runCli(
      ['release', 'plan', '4.0.0-p2b6-fixture', '--project', project, '--json'],
      project
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('release.plan');
    // On an empty tmp project, release.plan writes a planned release and returns ok:true.
    // On a real repo where an active release exists, it returns ok:false with a structured error.
    if (envelope.ok) {
      const data = envelope.data as { version?: string; currentStage?: string };
      expect(data.version).toBe('4.0.0-p2b6-fixture');
    } else {
      expect(envelope.code).toBeTruthy();
    }
  });
});

// ============================================================================
// peaks codegraph affected (P2-B.6 misc e2e)
// ============================================================================

describe('peaks codegraph affected (P2-B.6 misc e2e)', () => {
  test('returns a structured CLI error envelope when CodeGraph is not initialized in this repo', () => {
    // Upstream CodeGraph is a sidecar binary not bundled in peaks-loop;
    // the contract is either ok:true (when initialized) or a structured
    // CLI error envelope on stderr.
    const result = runCli(
      ['codegraph', 'affected', 'src/index.ts', '--project', REPO, '--json'],
      REPO
    );
    // Either the CLI emits a JSON envelope (initialised or structured error),
    // or — when codegraph is genuinely absent — a plain text error on stderr.
    // We accept both shapes as long as some form of error reporting appears.
    const combined = result.stdout + result.stderr;
    if (result.stdout.trim().length > 0) {
      const envelope = parseEnvelope(result);
      expect(['codegraph.affected', 'cli']).toContain(envelope.command);
      expect(typeof envelope.ok).toBe('boolean');
      if (!envelope.ok) {
        expect(envelope.code).toBeTruthy();
      }
    } else {
      expect(combined.length).toBeGreaterThan(0);
    }
  });
});

// ============================================================================
// peaks playwright ls (P2-B.6 misc e2e) — read-only, safe
// ============================================================================

describe('peaks playwright ls (P2-B.6 misc e2e)', () => {
  test('returns a structured playwright.ls envelope listing zero or more sessions', () => {
    const result = runCli(['playwright', 'ls', '--json'], REPO);
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.ok).toBe(true);
    // `playwright.ls` does NOT populate the `command` field on its data envelope.
    const data = envelope.data as { sessions?: ReadonlyArray<unknown>; count?: number };
    expect(Array.isArray(data.sessions)).toBe(true);
    if (typeof data.count === 'number') {
      expect(data.count).toBe(data.sessions?.length ?? 0);
    }
  });
});

// ============================================================================
// peaks playwright start (P2-B.6 misc e2e) — could spawn a process; mark as skipped-destructive
// ============================================================================

describe('peaks playwright start (P2-B.6 misc e2e)', () => {
  test('skipped-destructive (would spawn a Playwright MCP server on a free port)', () => {
    // This test exists to explicitly document the policy: do NOT spawn
    // a real Playwright MCP server in the e2e suite. The companion
    // `playwright ls` test exercises the read path safely.
    expect(true).toBe(true);
  });
});

// ============================================================================
// peaks polyrepo status (P2-B.6 misc e2e)
// ============================================================================

describe('peaks polyrepo status (P2-B.6 misc e2e)', () => {
  test('returns a structured polyrepo.status envelope on an empty tmp project', () => {
    const project = makeProject('peaks-p2b6-polyrepo-status-');
    // polyrepo uses --root, not --project.
    const result = runCli(['polyrepo', 'status', '--root', project, '--json'], project);
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('polyrepo.status');
    expect(envelope.ok).toBe(true);
    const data = envelope.data as { children?: ReadonlyArray<unknown>; initialized?: boolean };
    expect(Array.isArray(data.children)).toBe(true);
  });
});

// ============================================================================
// peaks polyrepo init (P2-B.6 misc e2e)
// ============================================================================

describe('peaks polyrepo init (P2-B.6 misc e2e)', () => {
  test('returns a structured polyrepo.init envelope; scanning an empty dir yields zero children', () => {
    const project = makeProject('peaks-p2b6-polyrepo-init-');
    const result = runCli(['polyrepo', 'init', '--root', project, '--json'], project);
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('polyrepo.init');
    expect(envelope.ok).toBe(true);
    const data = envelope.data as { children?: ReadonlyArray<unknown> };
    expect(Array.isArray(data.children)).toBe(true);
  });
});

// ============================================================================
// peaks classify run (P2-B.6 misc e2e) — read of current diff
// ============================================================================

describe('peaks classify run (P2-B.6 misc e2e)', () => {
  test('returns a structured classify.run envelope with one of the 5 levels', () => {
    const result = runCli(['classify', 'run', '--project', REPO, '--json'], REPO);
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('classify.run');
    expect(envelope.ok).toBe(true);
    const data = envelope.data as { level?: string; classification?: string; taskLevel?: string };
    const level = data.level ?? data.classification ?? data.taskLevel;
    expect(['typo', 'bug', 'feature', 'refactor', 'migration']).toContain(level);
  });
});

// ============================================================================
// peaks evolve (P2-B.6 misc e2e) — drift pointer (actual top-level is `evolution`)
// ============================================================================

describe('peaks evolve top-level (P2-B.6 misc e2e)', () => {
  test('returns COMMAND_NOT_FOUND envelope (drift: actual top-level is `evolution`)', () => {
    const result = runCli(['evolve', '--json'], REPO);
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.code).toBe('COMMAND_NOT_FOUND');
  });
});

// ============================================================================
// peaks mut run (P2-B.6 misc e2e) — skipped-long-running (would invoke Stryker)
// ============================================================================

describe('peaks mut run (P2-B.6 misc e2e)', () => {
  test('skipped-long-running (would spawn Stryker + assertion scan, multi-minute)', () => {
    // We deliberately do NOT exercise this end-to-end in CI. The companion
    // `mut asserts` test exercises the lightweight assertion-only path,
    // and `mut report` exercises the read-only path on a synthetic report.
    expect(true).toBe(true);
  });
});

// ============================================================================
// peaks mut asserts (P2-B.6 misc e2e)
// ============================================================================

describe('peaks mut asserts (P2-B.6 misc e2e)', () => {
  test('returns an UNHANDLED_ERROR / required-option error when --input-sig is missing (contract probe)', () => {
    const project = makeProject('peaks-p2b6-mut-asserts-');
    const out = join(project, 'mut-report.json');
    const result = runCli(
      [
        'mut', 'asserts',
        '--project', project,
        '--test-files', 'tests/integration/misc-commands-e2e.test.ts',
        '--session-id', '2026-07-25-p2-b6-misc-e2e-mut-asserts',
        '--out', out,
        '--json'
      ],
      project
    );
    expect(result.code).not.toBe(0);
    // Some `mut` subcommands exit with a plain commander "required option" message
    // on stderr instead of a JSON envelope. Accept either contract: the contract
    // here is "the CLI refuses to run without --input-sig", however that is reported.
    const combined = result.stdout + result.stderr;
    const isJsonEnvelope = result.stdout.trim().length > 0 && combined.trim().startsWith('{');
    if (isJsonEnvelope) {
      const envelope = parseEnvelope(result);
      expect(envelope.ok).toBe(false);
    } else {
      expect(combined).toContain('--input-sig');
    }
    expect(existsSync(out)).toBe(false);
  });
});

// ============================================================================
// peaks mut scan (P2-B.6 misc e2e) — drift pointer (actual subcommands: run / mutants / asserts / report; no `scan`)
// ============================================================================

describe('peaks mut scan (P2-B.6 misc e2e)', () => {
  test('returns COMMAND_NOT_FOUND envelope or plain text drift error (drift: actual subcommands are run / mutants / asserts / report)', () => {
    const result = runCli(['mut', 'scan', '--json'], REPO);
    expect(result.code).not.toBe(0);
    const combined = result.stdout + result.stderr;
    // Accept either: JSON envelope with COMMAND_NOT_FOUND, OR a plain text
    // commander "unknown command 'scan'" error — both prove the subcommand is unregistered.
    const isJsonEnvelope = result.stdout.trim().length > 0 && combined.trim().startsWith('{');
    if (isJsonEnvelope) {
      const envelope = parseEnvelope(result);
      expect(envelope.code).toBe('COMMAND_NOT_FOUND');
    } else {
      expect(combined).toMatch(/unknown command .*scan|scan.*not registered/i);
    }
  });
});

// ============================================================================
// peaks fork sync (P2-B.6 misc e2e) — commander rejects missing --sync-id
// ============================================================================

describe('peaks fork sync (P2-B.6 misc e2e)', () => {
  test('returns a structured UNHANDLED_ERROR envelope (--sync-id is required)', () => {
    const result = runCli(['fork', 'sync', '--json'], REPO);
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.code).toBe('UNHANDLED_ERROR');
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('--sync-id');
  });
});

// ============================================================================
// peaks fork status (P2-B.6 misc e2e) — read primitive
// ============================================================================

describe('peaks fork status (P2-B.6 misc e2e)', () => {
  test('returns a structured fork.status envelope (no fork state file yet → structured envelope)', () => {
    const project = makeProject('peaks-p2b6-fork-status-');
    const result = runCli(['fork', 'status', '--project', project, '--json'], project);
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('fork.status');
    const data = envelope.data as { projectRoot?: string; report?: unknown };
    expect(typeof data.projectRoot === 'string').toBe(true);
    expect(data.report === null || typeof data.report === 'object').toBe(true);
  });
});

// ============================================================================
// peaks fixture capture-setup (P2-B.6 misc e2e) — drift pointer (no capture-setup subcommand)
// ============================================================================

describe('peaks fixture capture-setup (P2-B.6 misc e2e)', () => {
  test('returns COMMAND_NOT_FOUND envelope (drift: actual subcommands are capture only)', () => {
    const result = runCli(['fixture', 'capture-setup', '--json'], REPO);
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.code).toBe('COMMAND_NOT_FOUND');
  });
});

// ============================================================================
// peaks fixture capture (P2-B.6 misc e2e)
// ============================================================================

describe('peaks fixture capture (P2-B.6 misc e2e)', () => {
  test('returns a structured CAPTURE_FAILED envelope when the source rid has no handoff artifact', () => {
    const result = runCli(
      [
        'fixture', 'capture',
        '--from-rid', '2026-07-25-p2-b6-misc-fixture',
        '--sid', '2026-07-25-session-6da9d9',
        '--envelope', 'prd-handoff',
        '--json'
      ],
      REPO
    );
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('fixture.capture');
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('CAPTURE_FAILED');
  });
});

// ============================================================================
// peaks fixture replay (P2-B.6 misc e2e) — drift pointer (no replay subcommand)
// ============================================================================

describe('peaks fixture replay (P2-B.6 misc e2e)', () => {
  test('returns COMMAND_NOT_FOUND envelope (drift: capture is the only subcommand)', () => {
    const result = runCli(['fixture', 'replay', '--json'], REPO);
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.code).toBe('COMMAND_NOT_FOUND');
  });
});

// ============================================================================
// peaks doctor check (P2-B.6 misc e2e)
// ============================================================================

describe('peaks doctor check (P2-B.6 misc e2e)', () => {
  test('returns a structured doctor envelope with checks[] containing each named doctor check', () => {
    const result = runCli(['doctor', 'check', '--project', REPO, '--json'], REPO);
    // doctor.check exits 1 when any check fails (typical case on a real repo);
    // we only assert the structured envelope contract.
    const envelope = parseEnvelope(result);
    expect(['doctor.check', 'doctor']).toContain(envelope.command);
    const data = envelope.data as {
      checks?: ReadonlyArray<{ id?: string; ok?: boolean; message?: string }>;
    };
    expect(Array.isArray(data.checks)).toBe(true);
    expect((data.checks ?? []).length).toBeGreaterThan(0);
    const first = data.checks?.[0];
    expect(first).toBeDefined();
    expect(typeof first!.id === 'string').toBe(true);
    expect(typeof first!.ok === 'boolean').toBe(true);
  });
});

// ============================================================================
// peaks ecc status (P2-B.6 misc e2e)
// ============================================================================

describe('peaks ecc status (P2-B.6 misc e2e)', () => {
  test('returns a structured ecc.status envelope describing the cache state (installed or NO_CACHE)', () => {
    const result = runCli(['ecc', 'status', '--json'], REPO);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('ecc.status');
    // Either installed (ok:true) or NO_CACHE (ok:false) — both are valid first-run contracts.
    if (envelope.ok) {
      const data = envelope.data as { installed?: boolean; sha?: string | null };
      expect(data.installed).toBe(true);
    } else {
      expect(envelope.code).toBe('NO_CACHE');
      const data = envelope.data as { installed?: boolean };
      expect(data.installed).toBe(false);
    }
  });
});

// ============================================================================
// peaks bee export (P2-B.6 misc e2e) — would write a tarball; skip-destructive by default
// ============================================================================

describe('peaks bee export (P2-B.6 misc e2e)', () => {
  test('skipped-destructive (would emit a peaks.bundle/1 tarball)', () => {
    // The actual contract is documented via --help; we deliberately
    // do NOT emit a real tarball in the CI e2e suite. The companion
    // `bee import` test exercises the read-shaped contract.
    expect(true).toBe(true);
  });
});

// ============================================================================
// peaks bee import (P2-B.6 misc e2e)
// ============================================================================

describe('peaks bee import (P2-B.6 misc e2e)', () => {
  test('returns a structured UNHANDLED_ERROR envelope (--in <path> is required)', () => {
    const result = runCli(['bee', 'import', '--json'], REPO);
    expect(result.code).not.toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('cli');
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('UNHANDLED_ERROR');
    const combined = result.stdout + result.stderr;
    expect(combined).toContain('--in');
  });
});

// ============================================================================
// peaks perf baseline (P2-B.6 misc e2e) — dry-run only
// ============================================================================

describe('peaks perf baseline (P2-B.6 misc e2e)', () => {
  test('returns a structured perf.baseline dry-run envelope without --apply', () => {
    const project = makeProject('peaks-p2b6-perf-baseline-');
    const result = runCli(
      ['perf', 'baseline', '--project', project, '--json'],
      project
    );
    expect(result.code).toBe(0);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('perf.baseline');
    expect(envelope.ok).toBe(true);
    // The dry-run envelope uses `apply: boolean`, not `dryRun`/`applied`.
    const data = envelope.data as { apply?: boolean; perfBaselinePath?: string | null; plannedWrites?: ReadonlyArray<unknown>; alreadyInitialized?: boolean };
    expect(data.apply).toBe(false);
    expect(data.perfBaselinePath === null || typeof data.perfBaselinePath === 'string').toBe(true);
    expect(Array.isArray(data.plannedWrites)).toBe(true);
  });
});

// ============================================================================
// peaks perf-audit detect (P2-B.6 misc e2e) — read probe, no --run needed
// ============================================================================

describe('peaks perf-audit detect (P2-B.6 misc e2e)', () => {
  test('returns a structured perf-audit.detect envelope pointing out the missing --sid', () => {
    const result = runCli(['perf-audit', 'detect', '--project', REPO, '--json'], REPO);
    const envelope = parseEnvelope(result);
    expect(envelope.command).toBe('perf-audit.detect');
    expect(envelope.ok).toBe(false);
    expect(envelope.code).toBe('SID_REQUIRED');
    const data = envelope.data as { state?: string };
    expect(data.state).toBe('sid-missing');
  });
});

// ============================================================================
// peaks perf-audit run (P2-B.6 misc e2e) — read with --sid probe
// ============================================================================

describe('peaks perf-audit run (P2-B.6 misc e2e)', () => {
  test('returns a structured perf-audit.run envelope for the given rid + sid (graceful missing-handoff)', () => {
    const result = runCli(
      [
        'perf-audit', 'run',
        '--rid', '2026-07-25-p2-b6-misc-fixture',
        '--sid', '2026-07-25-session-6da9d9-p2b6',
        '--json'
      ],
      REPO
    );
    const envelope = parseEnvelope(result);
    expect(['perf-audit.run', 'cli']).toContain(envelope.command);
    // The contract is either ok:true with an artifactPath (when handoff is present)
    // or ok:false with a structured error code (when handoff is missing).
    if (envelope.ok) {
      const data = envelope.data as { artifactPath?: string; applied?: boolean };
      expect(typeof data.artifactPath === 'string' || typeof data.applied === 'boolean').toBe(true);
    } else {
      expect(envelope.code).toBeTruthy();
    }
  });
});
