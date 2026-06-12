import { existsSync } from 'node:fs';
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';

const CLI_BIN = resolve(__dirname, '../../bin/peaks.js');

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-ws-cli-'));
}

function cli(args: string, cwd: string): { stdout: string; stderr: string; code: number } {
  try {
    const stdout = execSync(`node ${CLI_BIN} ${args}`, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { stdout, stderr: '', code: 0 };
  } catch (err: unknown) {
    const e = err as { stdout: string; stderr: string; status: number };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', code: e.status ?? 1 };
  }
}

function touchDir(path: string, ageHours: number): void {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'marker.txt'), 'x', 'utf8');
  const past = new Date(Date.now() - ageHours * 3600 * 1000);
  utimesSync(path, past, past);
  utimesSync(join(path, 'marker.txt'), past, past);
}

describe('peaks workspace clean CLI', () => {
  test('peaks workspace clean --runtime reports JSON envelope with dry-run default', () => {
    const project = makeProject();
    try {
      touchDir(join(project, '.peaks/_runtime/2026-06-10-session-aaa111'), 100);
      const { stdout, code } = cli(`workspace clean --runtime --older-than 1 --json`, project);
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.ok).toBe(true);
      expect(out.data[0].dryRun).toBe(true);
      expect(out.data[0].deleted).toEqual(['2026-06-10-session-aaa111']);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('peaks workspace clean --runtime --apply actually deletes', () => {
    const project = makeProject();
    try {
      const sid = '2026-06-10-session-aaa111';
      touchDir(join(project, '.peaks/_runtime', sid), 100);
      const { stdout, code } = cli(`workspace clean --runtime --older-than 1 --apply --json`, project);
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.data[0].dryRun).toBe(false);
      expect(existsSync(join(project, '.peaks/_runtime', sid))).toBe(false);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('peaks workspace clean --sub-agents --invalid --apply moves bare sids to archive', () => {
    const project = makeProject();
    try {
      mkdirSync(join(project, '.peaks/_sub_agents/sid-3'), { recursive: true });
      const { stdout, code } = cli(`workspace clean --sub-agents --invalid --apply --json`, project);
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.data[0].moved).toEqual(['sid-3']);
      expect(existsSync(join(project, '.peaks/_sub_agents/sid-3'))).toBe(false);
      expect(existsSync(join(project, '.peaks/_archive/invalid-sids/sid-3'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('peaks workspace archive CLI', () => {
  test('peaks workspace archive moves _runtime/<sid>/ to _archive/<yyyy-mm>/<sid>/', () => {
    const project = makeProject();
    try {
      const sid = '2026-06-10-session-aaa111';
      mkdirSync(join(project, '.peaks/_runtime', sid, 'rd'), { recursive: true });
      writeFileSync(join(project, '.peaks/_runtime', sid, 'rd/tech-doc.md'), '# tech', 'utf8');
      const { code } = cli(`workspace archive --session ${sid} --apply --json`, project);
      expect(code).toBe(0);
      expect(existsSync(join(project, '.peaks/_runtime', sid))).toBe(false);
      expect(existsSync(join(project, '.peaks/_archive/2026-06', sid, 'rd/tech-doc.md'))).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
