/**
 * P1-7 — `peaks sub-agent dispatch rd` integration test (business-capability
 * verification).
 *
 * The unit suite (`tests/unit/dispatch/*`) covers the envelope's
 * shape in isolation, but the end-to-end proof is "spawn the CLI,
 * parse the JSON envelope, AND verify a real dispatch record was
 * written to disk AND the active-dispatches sidecar picked up the
 * batchId". This test is the regression guard for that capability.
 *
 * Strategy:
 *   1. Spawn `node bin/peaks.js sub-agent dispatch rd --prompt <t> --request-id <rid> --json`
 *      against a tmp project root.
 *   2. Parse the JSON envelope. Assert:
 *      - `data.toolCall.name === 'Task'`
 *      - `data.toolCall.args.subagent_type === 'general-purpose'`
 *      - `data.role === 'rd'`
 *      - `data.dispatchRecordPath` is a non-empty string
 *      - `data.batchId` is a non-empty string
 *      - `data.contextImpact.contextWarning === 'normal'`
 *   3. Read `data.dispatchRecordPath` from disk; assert exists + size > 0.
 *   4. Read `.peaks/_sub_agents/<sid>/active-dispatches.json`; assert the
 *      `batchId` from the envelope is present in at least one entry.
 *
 * Karpathy-2 (Simplicity First): no speculative assertions. The five
 * envelope checks above are exactly what P1-7 calls out, plus the two
 * on-disk checks (record file + active-dispatches sidecar) that
 * prove "writes a real dispatch record to disk".
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

const BIN = resolve(__dirname, '../../bin/peaks.js');
const BIN_TIMEOUT_MS = 30_000;

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly code: number;
}

function runCli(args: readonly string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [BIN, 'sub-agent', 'dispatch', ...args], {
      cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: BIN_TIMEOUT_MS
    }).toString('utf8');
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: Buffer | string; stderr?: Buffer | string; status?: number };
    return {
      stdout: (typeof e.stdout === 'string' ? e.stdout : e.stdout?.toString('utf8') ?? ''),
      stderr: (typeof e.stderr === 'string' ? e.stderr : e.stderr?.toString('utf8') ?? ''),
      code: e.status ?? 1
    };
  }
}

const projects: string[] = [];

afterEach(() => {
  for (const root of projects) {
    if (existsSync(root)) rmSync(root, { recursive: true, force: true });
  }
  projects.length = 0;
});

interface SubAgentDispatchEnvelope {
  readonly ok: boolean;
  readonly command: string;
  readonly data: {
    readonly role: string;
    readonly ide: string;
    readonly toolCall: {
      readonly name: string;
      readonly args: {
        readonly subagent_type?: string;
        readonly description?: string;
        readonly prompt?: string;
      };
      readonly toolCallVersion?: string;
    };
    readonly dispatchRecordPath: string;
    readonly batchId: string;
    readonly contextImpact: {
      readonly contextWarning: string;
    };
  };
}

interface ActiveDispatchEntry {
  readonly recordPath: string;
  readonly requestId: string;
  readonly role: string;
  readonly batchId: string;
  readonly createdAt: string;
  readonly status: string;
}

describe('peaks sub-agent dispatch rd (P1-7 e2e)', () => {
  test('produces a valid tool-call envelope AND writes a real dispatch record to disk', () => {
    const project = mkdtempSync(join(tmpdir(), 'peaks-p1-7-dispatch-'));
    projects.push(project);

    const sessionId = '2026-07-25-p1-7-dispatch-e2e';
    const requestId = '2026-07-25-p1-7-sub-agent-dispatch-e2e';
    const prompt = 'p1-7 e2e probe — verify tool-call envelope + on-disk record';

    const r = runCli([
      'rd',
      '--prompt', prompt,
      '--request-id', requestId,
      '--session-id', sessionId,
      '--project', project,
      '--json'
    ], project);

    expect(r.code).toBe(0);
    expect(r.stderr).toBe('');

    // ── 1. Envelope structure ──────────────────────────────────────────────
    const env = JSON.parse(r.stdout) as SubAgentDispatchEnvelope;
    expect(env.ok).toBe(true);
    expect(env.command).toBe('sub-agent.dispatch');
    expect(env.data.toolCall.name).toBe('Task');
    expect(env.data.toolCall.args.subagent_type).toBe('general-purpose');
    expect(env.data.role).toBe('rd');
    expect(env.data.dispatchRecordPath).toBeTypeOf('string');
    expect(env.data.dispatchRecordPath.length).toBeGreaterThan(0);
    expect(env.data.batchId).toBeTypeOf('string');
    expect(env.data.batchId.length).toBeGreaterThan(0);
    expect(env.data.contextImpact.contextWarning).toBe('normal');

    // ── 2. Dispatch record on disk ────────────────────────────────────────
    expect(existsSync(env.data.dispatchRecordPath)).toBe(true);
    const recordStat = statSync(env.data.dispatchRecordPath);
    expect(recordStat.size).toBeGreaterThan(0);

    const recordRaw = JSON.parse(readFileSync(env.data.dispatchRecordPath, 'utf8')) as {
      readonly version: number;
      readonly role: string;
      readonly requestId: string;
      readonly sessionId: string;
      readonly batchId: string;
      readonly toolCall: { readonly name: string };
    };
    expect(recordRaw.version).toBe(2);
    expect(recordRaw.role).toBe('rd');
    expect(recordRaw.requestId).toBe(requestId);
    expect(recordRaw.sessionId).toBe(sessionId);
    expect(recordRaw.batchId).toBe(env.data.batchId);
    expect(recordRaw.toolCall.name).toBe('Task');

    // ── 3. active-dispatches.json sidecar contains the batchId ─────────────
    const sidecarPath = join(project, '.peaks', '_sub_agents', sessionId, 'active-dispatches.json');
    expect(existsSync(sidecarPath)).toBe(true);
    const sidecar = JSON.parse(readFileSync(sidecarPath, 'utf8')) as Record<string, ActiveDispatchEntry>;
    const batchIds = Object.values(sidecar).map((e) => e.batchId);
    expect(batchIds).toContain(env.data.batchId);
  });
});