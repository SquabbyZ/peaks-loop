/**
 * Integration tests for `peaks workflow plan *` (slice 025).
 *
 * Gated on `PEAKS_BUILD_AVAILABLE=1` so PR-time vitest runs (which do
 * not build the dist) skip these tests cleanly. The dogfood pass runs
 * with PEAKS_BUILD_AVAILABLE=1 and the dist rebuilt.
 *
 * Coverage (mirrors the QA test-cases T-101..T-105b):
 *   - read security / perf returns the expected envelope
 *   - refresh security / perf --apply is idempotent (re-run → same hash)
 *   - detect-trigger returns the correct verdict
 *   - manual --refresh flag → reason "manual-override"
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const CLI = resolve(__dirname, '../../../bin/peaks.js');

const BUILD_AVAILABLE = process.env.PEAKS_BUILD_AVAILABLE === '1';

interface CliResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

async function runPeaks(args: string[], cwd: string): Promise<CliResult> {
  try {
    const { stdout, stderr } = await execFileAsync('node', [CLI, ...args], { cwd, env: { ...process.env, NO_COLOR: '1' } });
    return { stdout, stderr, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      code: typeof e.code === 'number' ? e.code : 1
    };
  }
}

const it_build = BUILD_AVAILABLE ? it : it.skip;

describe('peaks workflow plan * — integration (gated on PEAKS_BUILD_AVAILABLE=1)', () => {
  let projectRoot: string;
  let sessionId: string;

  beforeAll(() => {
    if (!BUILD_AVAILABLE) {
      // eslint-disable-next-line no-console
      console.warn('PEAKS_BUILD_AVAILABLE not set; integration tests deferred to post-build');
    }
  });

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'peaks-plan-cli-'));
    sessionId = '2026-06-10-session-c4a2be';
    // Scaffold a minimal `.peaks/_runtime/<sessionId>` so the CLI can
    // resolve the session id without going through workspace init.
    mkdirSync(join(projectRoot, '.peaks', '_runtime', sessionId, 'qa'), { recursive: true });
    writeFileSync(join(projectRoot, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: {} }, null, 2), 'utf8');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it_build('T-101: workflow plan read security returns the expected envelope (exists:false on first run)', async () => {
    const r = await runPeaks(['workflow', 'plan', 'read', '--type', 'security', '--project', projectRoot, '--session-id', sessionId, '--json'], projectRoot);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json.ok).toBe(true);
    expect(json.data.exists).toBe(false);
    expect(json.data.path).toBe(join('.peaks', '_runtime', sessionId, 'qa', 'security-test-plan.md'));
  });

  it_build('T-102: workflow plan read perf returns the expected envelope (exists:false on first run)', async () => {
    const r = await runPeaks(['workflow', 'plan', 'read', '--type', 'perf', '--project', projectRoot, '--session-id', sessionId, '--json'], projectRoot);
    expect(r.code).toBe(0);
    const json = JSON.parse(r.stdout);
    expect(json.ok).toBe(true);
    expect(json.data.exists).toBe(false);
    expect(json.data.path).toBe(join('.peaks', '_runtime', sessionId, 'qa', 'perf-baseline.md'));
  });

  it_build('T-103: workflow plan refresh security --apply writes file and is idempotent', async () => {
    const r1 = await runPeaks(['workflow', 'plan', 'refresh', '--type', 'security', '--project', projectRoot, '--session-id', sessionId, '--apply', '--json'], projectRoot);
    expect(r1.code).toBe(0);
    const j1 = JSON.parse(r1.stdout);
    expect(j1.ok).toBe(true);
    expect(j1.data.dryRun).toBe(false);
    const target = join(projectRoot, '.peaks', '_runtime', sessionId, 'qa', 'security-test-plan.md');
    expect(existsSync(target)).toBe(true);
    const bytes1 = readFileSync(target, 'utf8');

    const r2 = await runPeaks(['workflow', 'plan', 'refresh', '--type', 'security', '--project', projectRoot, '--session-id', sessionId, '--apply', '--json'], projectRoot);
    expect(r2.code).toBe(0);
    const j2 = JSON.parse(r2.stdout);
    expect(j2.data.hash).toBe(j1.data.hash);
    const bytes2 = readFileSync(target, 'utf8');
    expect(Buffer.compare(Buffer.from(bytes1, 'utf8'), Buffer.from(bytes2, 'utf8'))).toBe(0);
  });

  it_build('T-104: workflow plan refresh perf --apply writes file and is idempotent', async () => {
    const r1 = await runPeaks(['workflow', 'plan', 'refresh', '--type', 'perf', '--project', projectRoot, '--session-id', sessionId, '--apply', '--json'], projectRoot);
    expect(r1.code).toBe(0);
    const j1 = JSON.parse(r1.stdout);
    expect(j1.ok).toBe(true);
    const target = join(projectRoot, '.peaks', '_runtime', sessionId, 'qa', 'perf-baseline.md');
    expect(existsSync(target)).toBe(true);

    const r2 = await runPeaks(['workflow', 'plan', 'refresh', '--type', 'perf', '--project', projectRoot, '--session-id', sessionId, '--apply', '--json'], projectRoot);
    const j2 = JSON.parse(r2.stdout);
    expect(j2.data.hash).toBe(j1.data.hash);
  });

  it_build('T-105: workflow plan detect-trigger returns triggered:false on a no-change repo', async () => {
    const r = await runPeaks(['workflow', 'plan', 'detect-trigger', '--project', projectRoot, '--session-id', sessionId, '--rid', '025-2026-06-10', '--json'], projectRoot);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.ok).toBe(true);
    expect(j.data.triggered).toBe(false);
    expect(j.data.reason).toBe('no-triggering-change');
  });

  it_build('T-105b: workflow plan detect-trigger with --refresh returns reason "manual-override"', async () => {
    const r = await runPeaks(['workflow', 'plan', 'detect-trigger', '--project', projectRoot, '--session-id', sessionId, '--rid', '025-2026-06-10', '--refresh', '--json'], projectRoot);
    expect(r.code).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.data.triggered).toBe(true);
    expect(j.data.reason).toBe('manual-override');
  });
});
