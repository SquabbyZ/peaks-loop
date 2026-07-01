import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFileSync } from 'node:fs';
import { runMemorySearch } from '../../src/cli/commands/memory-commands.js';

let tmpDir: string;

beforeEach(() => {
  tmpDir = join(tmpdir(), `peaks-mem-cli-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(tmpDir, { recursive: true });
});

afterEach(() => {
  if (existsSync(tmpDir)) {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});

function writeIndex(payload: unknown): void {
  const peaksDir = join(tmpDir, '.peaks', 'memory');
  mkdirSync(peaksDir, { recursive: true });
  writeFileSync(join(peaksDir, 'index.json'), JSON.stringify(payload));
}

const SAMPLE = JSON.parse(
  readFileSync(join(__dirname, '..', 'fixtures', 'memory-index-sample.json'), 'utf8')
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

describe('peaks memory search CLI', () => {
  test('happy path: --json returns the standard envelope', async () => {
    writeIndex(SAMPLE);
    const io = createIO();
    await runMemorySearch(io, { query: 'wechat', project: tmpDir, json: true });
    const parsed = JSON.parse(io.getStdout());
    expect(parsed.ok).toBe(true);
    expect(parsed.command).toBe('memory.search');
    expect(parsed.data.query).toBe('wechat');
    expect(Array.isArray(parsed.data.matches)).toBe(true);
    expect(parsed.data.total).toBe(parsed.data.matches.length);
  });

  test('top match is the wechat-post-sop entry (dogfood AC A1)', async () => {
    writeIndex(SAMPLE);
    const io = createIO();
    await runMemorySearch(io, { query: 'wechat', project: tmpDir, json: true });
    const parsed = JSON.parse(io.getStdout());
    expect(parsed.data.matches[0]?.name).toBe('wechat-post-sop-dogfood');
    expect(parsed.data.matches[0]?.score).toBe(1.0);
  });

  test('--kind filter applies (AC A3)', async () => {
    writeIndex(SAMPLE);
    const io = createIO();
    await runMemorySearch(io, { query: 'peaks', project: tmpDir, kind: 'feedback', limit: 6, json: true });
    const parsed = JSON.parse(io.getStdout());
    for (const m of parsed.data.matches) {
      expect(m.kind).toBe('feedback');
    }
    expect(parsed.data.matches.length).toBeLessThanOrEqual(6);
  });

  test('--limit caps the result count (AC A10)', async () => {
    writeIndex(SAMPLE);
    const io = createIO();
    await runMemorySearch(io, { query: 'peaks', project: tmpDir, limit: 2, json: true });
    const parsed = JSON.parse(io.getStdout());
    expect(parsed.data.matches.length).toBeLessThanOrEqual(2);
  });

  test('INDEX_MISSING: emits ok:false envelope with code INDEX_MISSING + suggestion (AC A5)', async () => {
    const io = createIO();
    await runMemorySearch(io, { query: 'anything', project: tmpDir, json: true });
    const parsed = JSON.parse(io.getStdout());
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('INDEX_MISSING');
    expect(parsed.nextActions.some((a: string) => a.includes('peaks memory extract --apply'))).toBe(true);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0; // reset for next test
  });

  test('EMPTY_QUERY: emits ok:false envelope with code EMPTY_QUERY + suggestion (AC A6)', async () => {
    writeIndex(SAMPLE);
    const io = createIO();
    await runMemorySearch(io, { query: '', project: tmpDir, json: true });
    const parsed = JSON.parse(io.getStdout());
    expect(parsed.ok).toBe(false);
    expect(parsed.code).toBe('EMPTY_QUERY');
    expect(parsed.nextActions.some((a: string) => a.includes('peaks memory index'))).toBe(true);
    expect(process.exitCode).toBe(1);
    process.exitCode = 0;
  });

  test('non-JSON mode: prints data JSON to stdout (no envelope wrapper)', async () => {
    writeIndex(SAMPLE);
    const io = createIO();
    await runMemorySearch(io, { query: 'wechat', project: tmpDir, json: false });
    const parsed = JSON.parse(io.getStdout());
    // In non-JSON mode, peaks-loop prints only result.data (not the
    // {ok,command,data} envelope) so humans can read the payload
    // directly. The top match must still be the wechat entry.
    expect(parsed.matches[0]?.name).toBe('wechat-post-sop-dogfood');
    expect(parsed.query).toBe('wechat');
  });

  test('determinism: 10x same query returns byte-identical envelope (AC A7)', async () => {
    writeIndex(SAMPLE);
    const first = createIO();
    await runMemorySearch(first, { query: 'peaks', project: tmpDir, json: true });
    const firstOut = first.getStdout();

    for (let i = 0; i < 10; i++) {
      const io = createIO();
      await runMemorySearch(io, { query: 'peaks', project: tmpDir, json: true });
      expect(io.getStdout()).toBe(firstOut);
    }
  });
});
