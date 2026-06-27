import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { runRetrospectiveSearch } from '../../src/cli/commands/retrospective-commands.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `peaks-retro-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

function writeIndex(payload: unknown): void {
  const peaksDir = join(tmpDir, '.peaks', 'retrospective');
  mkdirSync(peaksDir, { recursive: true });
  writeFileSync(join(peaksDir, 'index.json'), JSON.stringify(payload));
}

const SAMPLE = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'retrospective-index-sample.json'), 'utf8')
);

function createIO() {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout: (text: string) => stdout.push(text),
    stderr: (text: string) => stderr.push(text),
    getStdout: () => stdout.join('\n'),
    getStderr: () => stderr.join('\n'),
  };
}

describe('peaks retrospective search CLI', () => {
  test('happy path: --json returns standard envelope (AC A2)', () => {
    writeIndex(SAMPLE);
    const io = createIO();
    runRetrospectiveSearch(io, { query: 'sub-agent', project: tmpDir, json: true });
    const parsed = JSON.parse(io.getStdout());
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('retrospective.search');
    expect(parsed.data.query).toBe('sub-agent');
    expect(Array.isArray(parsed.data.matches)).toBe(true);
    expect(parsed.data.total).toBe(parsed.data.matches.length);
  });

  test('top match is the sub-agent entry (dogfood AC A2)', () => {
    writeIndex(SAMPLE);
    const io = createIO();
    runRetrospectiveSearch(io, { query: 'sub-agent', project: tmpDir, json: true });
    const parsed = JSON.parse(io.getStdout());
    const ids = parsed.data.matches.map((m: { id: string }) => m.id);
    expect(ids).toContain('2026-06-06-session-517672-sub-agent');
    expect(parsed.data.matches[0]?.score).toBe(1.0);
  });

  test('--type and --outcome compose with AND (AC A4)', () => {
    writeIndex(SAMPLE);
    const io = createIO();
    runRetrospectiveSearch(io, {
      query: 'session',
      project: tmpDir,
      type: 'refactor',
      outcome: 'shipped',
      limit: 6,
      json: true,
    });
    const parsed = JSON.parse(io.getStdout());
    for (const m of parsed.data.matches) {
      expect(m.type).toBe('refactor');
      expect(m.outcome).toBe('shipped');
    }
  });

  test('--limit caps the result count (AC A10)', () => {
    writeIndex(SAMPLE);
    const io = createIO();
    runRetrospectiveSearch(io, { query: 'session', project: tmpDir, limit: 2, json: true });
    const parsed = JSON.parse(io.getStdout());
    expect(parsed.data.matches.length).toBeLessThanOrEqual(2);
  });

  test('INDEX_MISSING: emits ok:false envelope with code INDEX_MISSING + suggestion (AC A5)', () => {
    const io = createIO();
    runRetrospectiveSearch(io, { query: 'anything', project: tmpDir, json: true });
    const parsed = JSON.parse(io.getStdout());
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('INDEX_MISSING');
    expect(parsed.nextActions.some((a: string) => a.includes('retrospective index.json'))).toBe(true);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  test('EMPTY_QUERY: emits ok:false envelope with code EMPTY_QUERY + suggestion (AC A6)', () => {
    writeIndex(SAMPLE);
    const io = createIO();
    runRetrospectiveSearch(io, { query: '', project: tmpDir, json: true });
    const parsed = JSON.parse(io.getStdout());
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('EMPTY_QUERY');
    expect(parsed.nextActions.some((a: string) => a.includes('peaks retrospective index'))).toBe(true);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  test('forgiving invalid --type falls through to unfiltered set', () => {
    writeIndex(SAMPLE);
    const io = createIO();
    runRetrospectiveSearch(io, { query: 'session', project: tmpDir, type: 'no-such-type', json: true });
    const parsed = JSON.parse(io.getStdout());
    expect(parsed.ok).toBe(true);
    // The filter was dropped, so the result includes entries of all types.
    const types = new Set(parsed.data.matches.map((m: { type: string }) => m.type));
    expect(types.size).toBeGreaterThan(1);
  });

  test('determinism: 10x same query returns byte-identical envelope (AC A7)', () => {
    writeIndex(SAMPLE);
    const first = createIO();
    runRetrospectiveSearch(first, { query: 'session', project: tmpDir, json: true });
    const firstOut = first.getStdout();

    for (let i = 0; i < 10; i++) {
      const io = createIO();
      runRetrospectiveSearch(io, { query: 'session', project: tmpDir, json: true });
      expect(io.getStdout()).toBe(firstOut);
    }
  });
});
