import { existsSync } from 'node:fs';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const HELPER_PATH = join(REPO_ROOT, 'scripts', 'peaks-ide-audit-log.mjs');
const SKILL_MD_PATH = join(REPO_ROOT, 'skills', 'peaks-ide', 'SKILL.md');
const REFERENCE_PATH = join(REPO_ROOT, 'skills', 'peaks-ide', 'references', 'audit-log-helper.md');
const GITIGNORE_PATH = join(REPO_ROOT, '.gitignore');

interface HelperResult {
  ok: boolean;
  dryRun?: boolean;
  logPath?: string;
  line?: {
    timestamp: string;
    event: string;
    adapter: string;
    ok: boolean;
    detail?: unknown;
  };
  bytes?: number;
  code?: string;
  message?: string;
}

function runHelper(args: string[]): Promise<{ status: number | null; stdout: string }> {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, [HELPER_PATH, ...args], { cwd: REPO_ROOT });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });
    child.on('error', rejectP);
    child.on('close', (status) => resolveP({ status, stdout: stdout + stderr }));
  });
}

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'peaks-ide-audit-'));
}

describe('peaks-ide audit log helper (G2)', () => {
  test('helper script is at the path the SKILL.md Step 5 documents', () => {
    expect(existsSync(HELPER_PATH)).toBe(true);
    expect(existsSync(REFERENCE_PATH)).toBe(true);
    expect(existsSync(SKILL_MD_PATH)).toBe(true);
  });

  test('writing an install event appends a single JSONL line with timestamp + event + adapter + ok', async () => {
    const project = await makeProject();
    const { status, stdout } = await runHelper([
      '--project', project,
      '--event', 'install',
      '--adapter', 'claude-code',
      '--ok', 'true'
    ]);
    expect(status).toBe(0);
    const result = JSON.parse(stdout.trim()) as HelperResult;
    expect(result.ok).toBe(true);
    expect(result.logPath).toMatch(/\.peaks[\\/]audit[\\/]peaks-ide-\d{4}-\d{2}-\d{2}\.log$/);
    expect(result.line).toBeDefined();
    expect(result.line?.event).toBe('install');
    expect(result.line?.adapter).toBe('claude-code');
    expect(result.line?.ok).toBe(true);
    expect(typeof result.line?.timestamp).toBe('string');
    expect(() => new Date(result.line!.timestamp).toISOString()).not.toThrow();
    const fileContents = await readFile(result.logPath!, 'utf8');
    const lines = fileContents.split('\n').filter((line) => line.length > 0);
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!) as { event: string; adapter: string; ok: boolean; timestamp: string };
    expect(entry.event).toBe('install');
    expect(entry.adapter).toBe('claude-code');
    expect(entry.ok).toBe(true);
    expect(entry.timestamp).toBe(result.line?.timestamp);
  });

  test('the audit log path is excluded from git (gitignore covers .peaks/audit/)', async () => {
    const gitignore = await readFile(GITIGNORE_PATH, 'utf8');
    const coversAudit =
      gitignore.includes('.peaks/audit/') ||
      gitignore.includes('.peaks/audit') ||
      gitignore.includes('*.log');
    expect(coversAudit).toBe(true);
  });

  test('--dry-run returns the would-be line in the envelope without writing', async () => {
    const project = await makeProject();
    const { status, stdout } = await runHelper([
      '--project', project,
      '--event', 'hook-handle',
      '--adapter', 'trae',
      '--ok', 'true',
      '--dry-run'
    ]);
    expect(status).toBe(0);
    const result = JSON.parse(stdout.trim()) as HelperResult;
    expect(result.ok).toBe(true);
    expect(result.dryRun).toBe(true);
    expect(result.line?.event).toBe('hook-handle');
    expect(result.line?.adapter).toBe('trae');
    const date = new Date().toISOString().slice(0, 10);
    const expectedDir = join(project, '.peaks', 'audit');
    const exists = existsSync(expectedDir);
    if (exists) {
      const entries = await readdir(expectedDir);
      expect(entries).toHaveLength(0);
    }
  });
});
