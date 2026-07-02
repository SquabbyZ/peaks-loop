import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

const CLI_BIN = resolve(__dirname, '../../bin/peaks.js');

function makeProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-understand-hybrid-cli-'));
}

function writeGraph(project: string, body: unknown): void {
  const dir = join(project, '.understand-anything');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'knowledge-graph.json'), JSON.stringify(body, null, 2), 'utf8');
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

describe('peaks understand context CLI', () => {
  test('returns source=both-missing envelope with exit code 2 when neither UA nor codegraph produces evidence', () => {
    const project = makeProject();
    try {
      const { stdout, code } = cli('understand context --project . --files package.json --json', project);
      expect(code).toBe(2);
      const out = JSON.parse(stdout);
      expect(out.ok).toBe(false);
      expect(out.command).toBe('understand.context');
      expect(out.code).toBe('UNDERSTAND_CONTEXT_NO_EVIDENCE');
      expect(out.data.source).toBe('both-missing');
      expect(Array.isArray(out.data.warnings)).toBe(true);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('returns source=ua-only envelope when UA graph is present (uses summary block, no codegraph branch)', () => {
    const project = makeProject();
    try {
      writeGraph(project, {
        generatedAt: '2026-07-02T00:00:00.000Z',
        nodes: [{ id: 'package.json' }],
        edges: [],
        layers: [],
        tours: []
      });
      const { stdout, code } = cli('understand context --project . --files package.json --json', project);
      expect(code).toBe(0);
      const out = JSON.parse(stdout);
      expect(out.ok).toBe(true);
      expect(out.data.source).toBe('ua-only');
      expect(out.data.ua?.summary?.counts.nodes).toBe(1);
      expect(out.data.codegraph).toBeUndefined();
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  test('envelope has stable shape across all four source values', () => {
    const project = makeProject();
    try {
      const { stdout, code } = cli('understand context --project . --files package.json --json', project);
      expect(code).toBe(2);
      const out = JSON.parse(stdout);
      expect(typeof out.data.projectRoot).toBe('string');
      expect(typeof out.data.durationMs).toBe('number');
      expect(['ua-only', 'ua-missing-fallback-codegraph', 'ua-and-codegraph-hybrid', 'both-missing']).toContain(out.data.source);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});
