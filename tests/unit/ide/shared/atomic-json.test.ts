import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ATOMIC_JSON_FILE_MODE, atomicWriteJson, readJsonObjectFile } from '../../../../src/services/ide/shared/atomic-json.js';

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-atomic-json-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe('readJsonObjectFile', () => {
  test('returns an empty object when the file does not exist', () => {
    expect(readJsonObjectFile(join(tmpRoot, 'absent.json'))).toEqual({});
  });

  test('returns an empty object when the file is empty', () => {
    const path = join(tmpRoot, 'empty.json');
    writeFileSync(path, '', 'utf8');
    expect(readJsonObjectFile(path)).toEqual({});
  });

  test('returns the parsed object when the file contains a JSON object', () => {
    const path = join(tmpRoot, 'settings.json');
    writeFileSync(path, JSON.stringify({ a: 1, b: { c: 2 } }), 'utf8');
    expect(readJsonObjectFile<{ a: number; b: { c: number } }>(path)).toEqual({ a: 1, b: { c: 2 } });
  });

  test('throws when the file contains a JSON array', () => {
    const path = join(tmpRoot, 'arr.json');
    writeFileSync(path, '[]', 'utf8');
    expect(() => readJsonObjectFile(path)).toThrow(/must contain a JSON object/);
  });

  test('throws when the file contains a JSON primitive', () => {
    const path = join(tmpRoot, 'prim.json');
    writeFileSync(path, '42', 'utf8');
    expect(() => readJsonObjectFile(path)).toThrow(/must contain a JSON object/);
  });

  test('throws when the file is malformed JSON', () => {
    const path = join(tmpRoot, 'bad.json');
    writeFileSync(path, '{ not valid', 'utf8');
    expect(() => readJsonObjectFile(path)).toThrow();
  });
});

describe('atomicWriteJson', () => {
  test('creates the parent directory and writes the JSON file', () => {
    const path = join(tmpRoot, 'sub', 'settings.json');
    atomicWriteJson(path, { hello: 'world' });
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ hello: 'world' });
  });

  test('overwrites an existing file with the new contents', () => {
    const path = join(tmpRoot, 'settings.json');
    writeFileSync(path, '{"old": true}', 'utf8');
    atomicWriteJson(path, { new: true });
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ new: true });
  });

  test('uses the documented file mode constant (0o600)', () => {
    expect(ATOMIC_JSON_FILE_MODE).toBe(0o600);
  });

  test('writes pretty-printed JSON with a trailing newline', () => {
    const path = join(tmpRoot, 'pretty.json');
    atomicWriteJson(path, { a: 1 });
    const raw = readFileSync(path, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('  '); // 2-space indent from JSON.stringify(x, null, 2)
  });

  test('leaves no temp files behind on success', () => {
    const path = join(tmpRoot, 'settings.json');
    atomicWriteJson(path, { ok: true });
    // Sanity: the parent dir contains exactly the target file (no `.settings.*.tmp` leftover).
    expect(readdirSync(tmpRoot).sort()).toEqual(['settings.json']);
  });

  test('cleans up the temp file when rename fails (e.g. target is a non-empty dir)', () => {
    // Pre-create a directory at the target path so renameSync fails
    // (you cannot rename over a non-empty directory on POSIX).
    const path = join(tmpRoot, 'settings.json');
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, 'contents'), 'x', 'utf8');
    expect(() => atomicWriteJson(path, { ok: true })).toThrow();
    // The temp file in the parent dir should have been removed by the
    // best-effort cleanup in the catch block.
    const leftover = readdirSync(tmpRoot).filter((f) => f.startsWith('.settings.') && f.endsWith('.tmp'));
    expect(leftover).toEqual([]);
  });
});
