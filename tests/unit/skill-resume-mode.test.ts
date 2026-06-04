import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = resolve(__dirname, '..', 'fixtures', 'skill-resume-mode-detect.sh');

let tmpRoot: string;

beforeEach(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'peaks-resume-test-'));
});

afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

function writeArtifact(rel: string, state: string): void {
  const full = join(tmpRoot, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, `# Test\n- state: ${state}\n`);
}

function classify(sid: string): string {
  return execFileSync('bash', [SCRIPT_PATH, sid, tmpRoot], { encoding: 'utf8' }).trim();
}

describe('resume-mode detection (Step 0.7)', () => {
  test('fresh session: no .peaks/<sid>/ → "fresh"', () => {
    expect(classify('2026-06-04-session-aaaaaa')).toBe('fresh');
  });

  test('fresh session: .peaks/<sid>/ exists but empty → "fresh"', () => {
    mkdirSync(join(tmpRoot, '2026-06-04-session-aaaaaa'), { recursive: true });
    expect(classify('2026-06-04-session-aaaaaa')).toBe('fresh');
  });

  test('PRD handed-off, no RD → "resume:rd-planning"', () => {
    writeArtifact('2026-06-04-session-aaaaaa/prd/requests/001.md', 'handed-off');
    expect(classify('2026-06-04-session-aaaaaa')).toBe('resume:rd-planning');
  });

  test('RD qa-handoff, no QA → "resume:qa-validation"', () => {
    writeArtifact('2026-06-04-session-aaaaaa/prd/requests/001.md', 'handed-off');
    writeArtifact('2026-06-04-session-aaaaaa/rd/requests/001.md', 'qa-handoff');
    expect(classify('2026-06-04-session-aaaaaa')).toBe('resume:qa-validation');
  });

  test('QA verdict-issued, no TXT → "resume:txt-handoff"', () => {
    writeArtifact('2026-06-04-session-aaaaaa/prd/requests/001.md', 'handed-off');
    writeArtifact('2026-06-04-session-aaaaaa/rd/requests/001.md', 'qa-handoff');
    writeArtifact('2026-06-04-session-aaaaaa/qa/requests/001.md', 'verdict-issued');
    expect(classify('2026-06-04-session-aaaaaa')).toBe('resume:txt-handoff');
  });

  test('TXT handoff present → "complete"', () => {
    writeArtifact('2026-06-04-session-aaaaaa/prd/requests/001.md', 'handed-off');
    writeArtifact('2026-06-04-session-aaaaaa/rd/requests/001.md', 'qa-handoff');
    writeArtifact('2026-06-04-session-aaaaaa/qa/requests/001.md', 'verdict-issued');
    writeArtifact('2026-06-04-session-aaaaaa/txt/handoff.md', 'complete');
    expect(classify('2026-06-04-session-aaaaaa')).toBe('complete');
  });

  test('in-flight RD: state=running → in-flight marker', () => {
    writeArtifact('2026-06-04-session-aaaaaa/prd/requests/001.md', 'handed-off');
    writeArtifact('2026-06-04-session-aaaaaa/rd/requests/001.md', 'running');
    expect(classify('2026-06-04-session-aaaaaa')).toBe('in-flight:running');
  });

  test('determinism: same fixture twice → same classification', () => {
    writeArtifact('2026-06-04-session-aaaaaa/prd/requests/001.md', 'handed-off');
    writeArtifact('2026-06-04-session-aaaaaa/rd/requests/001.md', 'qa-handoff');
    const first = classify('2026-06-04-session-aaaaaa');
    const second = classify('2026-06-04-session-aaaaaa');
    expect(first).toBe(second);
  });
});
