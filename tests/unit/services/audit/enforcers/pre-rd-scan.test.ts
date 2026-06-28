/**
 * pre-rd-scan enforcer tests — Slice C Group G3 (v2.14.0).
 * Required ≥5 cases per AC A3.3. Backed by 9 prose-only occurrences in the
 * peaks-cli catalog (rl-pre-rd-scan-001). Removing the DEFERRED_ENFORCERS
 * tag re-classifies these as cli-backed; this file proves the enforcer
 * itself behaves correctly so the tag-removal is well-founded.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkPreRdScan } from '../../../../../src/services/audit/enforcers/pre-rd-scan.js';

let projectRoot: string;
const sessionId = '2026-06-28-test';

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), 'pre-rd-scan-'));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

function ensureDir(relPath: string): void {
  const abs = join(projectRoot, relPath);
  mkdirSync(abs, { recursive: true });
}

describe('checkPreRdScan', () => {
  it('case 1: nothing exists → both flags false', () => {
    const r = checkPreRdScan({ projectRoot, sessionId });
    expect(r.archetypeScanned).toBe(false);
    expect(r.standardsPreflightDone).toBe(false);
    expect(r.archetypeReportPath).toContain('project-scan.md');
    expect(r.standardsReportPath).toContain('standards-preflight.json');
  });

  it('case 2: only archetype report exists → only archetypeScanned=true', () => {
    ensureDir(`.peaks/_runtime/${sessionId}/rd`);
    writeFileSync(join(projectRoot, `.peaks/_runtime/${sessionId}/rd/project-scan.md`), '# scan');
    const r = checkPreRdScan({ projectRoot, sessionId });
    expect(r.archetypeScanned).toBe(true);
    expect(r.standardsPreflightDone).toBe(false);
  });

  it('case 3: only standards preflight exists → only standardsPreflightDone=true', () => {
    ensureDir(`.peaks/_runtime/${sessionId}`);
    writeFileSync(join(projectRoot, `.peaks/_runtime/${sessionId}/standards-preflight.json`), '{}');
    const r = checkPreRdScan({ projectRoot, sessionId });
    expect(r.archetypeScanned).toBe(false);
    expect(r.standardsPreflightDone).toBe(true);
  });

  it('case 4: both exist → both true (the happy path)', () => {
    ensureDir(`.peaks/_runtime/${sessionId}/rd`);
    writeFileSync(join(projectRoot, `.peaks/_runtime/${sessionId}/rd/project-scan.md`), '# scan');
    writeFileSync(join(projectRoot, `.peaks/_runtime/${sessionId}/standards-preflight.json`), '{}');
    const r = checkPreRdScan({ projectRoot, sessionId });
    expect(r.archetypeScanned).toBe(true);
    expect(r.standardsPreflightDone).toBe(true);
  });

  it('case 5: empty projectRoot + empty sessionId → both false (no crash)', () => {
    const r = checkPreRdScan({ projectRoot: projectRoot + '/does-not-exist', sessionId: '' });
    expect(r.archetypeScanned).toBe(false);
    expect(r.standardsPreflightDone).toBe(false);
  });

  it('case 6: reportPath includes session id', () => {
    const r = checkPreRdScan({ projectRoot, sessionId: 'session-XYZ' });
    expect(r.archetypeReportPath).toContain('session-XYZ');
    expect(r.standardsReportPath).toContain('session-XYZ');
  });
});
