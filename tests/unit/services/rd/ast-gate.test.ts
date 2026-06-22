import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAstGate } from '../../../../src/services/rd/ast-gate.js';

let workdir: string;
beforeEach(() => { workdir = mkdtempSync(join(tmpdir(), 'peaks-astgate-')); });
afterEach(() => { rmSync(workdir, { recursive: true, force: true }); });

describe('runAstGate (★ load-bearing)', () => {
  it('passes when external API call uses the locked version', async () => {
    mkdirSync(join(workdir, 'src'), { recursive: true });
    writeFileSync(join(workdir, 'src', 'oauth.ts'), `
      import { handleCallback } from 'oauth-client';
      handleCallback({ code: 'x' });
    `);
    const result = await runAstGate({
      project: workdir,
      changedFiles: ['src/oauth.ts'],
      context: {
        deps: { 'oauth-client': { version: '2.4.0', source: 'package.json', resolved: '' } },
        docSummaries: [
          { dep: 'oauth-client', version: '2.4.0', apis: ['handleCallback', 'init'] },
        ],
      },
    });
    expect(result.passed).toBe(true);
  });

  it('FAILS when external API call uses a non-locked version (★ core gate)', async () => {
    mkdirSync(join(workdir, 'src'), { recursive: true });
    writeFileSync(join(workdir, 'src', 'oauth.ts'), `
      import { handleCallbackV3 } from 'oauth-client';
      handleCallbackV3({ code: 'x' });
    `);
    const result = await runAstGate({
      project: workdir,
      changedFiles: ['src/oauth.ts'],
      context: {
        deps: { 'oauth-client': { version: '2.4.0', source: 'package.json', resolved: '' } },
        docSummaries: [
          { dep: 'oauth-client', version: '2.4.0', apis: ['handleCallback', 'init'] },
        ],
      },
    });
    expect(result.passed).toBe(false);
    expect(result.violations.length).toBeGreaterThan(0);
    expect(result.violations[0]).toMatchObject({
      api: 'handleCallbackV3',
      expectedVersion: '2.4.0',
    });
  });

  it('passes when no external API calls (pure local code)', async () => {
    mkdirSync(join(workdir, 'src'), { recursive: true });
    writeFileSync(join(workdir, 'src', 'util.ts'), `
      export const add = (a: number, b: number) => a + b;
    `);
    const result = await runAstGate({
      project: workdir,
      changedFiles: ['src/util.ts'],
      context: { deps: {}, docSummaries: [] },
    });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  // R2-W1: pin current behavior — nonexistent changedFile is silently skipped
  // (gate continues, no violation raised). This is a design choice:
  // changedFiles comes from git diff output which may include deleted files;
  // a missing path is not a gate failure, just "no work to do here".
  it('silently skips nonexistent changedFile (design choice, R2-W1)', async () => {
    const result = await runAstGate({
      project: workdir,
      changedFiles: ['src/does-not-exist.ts'],
      context: { deps: {}, docSummaries: [] },
    });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  // Companion to R2-W1: when one file exists and one does not, the existing
  // file's violations must still surface (silent-skip must not mask failures).
  it('does not mask violations when one changedFile is missing', async () => {
    mkdirSync(join(workdir, 'src'), { recursive: true });
    writeFileSync(join(workdir, 'src', 'real.ts'), `
      import { handleCallbackV3 } from 'oauth-client';
      handleCallbackV3({ code: 'x' });
    `);
    const result = await runAstGate({
      project: workdir,
      changedFiles: ['src/missing.ts', 'src/real.ts'],
      context: {
        deps: { 'oauth-client': { version: '2.4.0', source: 'package.json', resolved: '' } },
        docSummaries: [
          { dep: 'oauth-client', version: '2.4.0', apis: ['handleCallback'] },
        ],
      },
    });
    expect(result.passed).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]?.file).toBe('src/real.ts');
  });

  // R2-W3: pin v1 regex limitation — namespace import (`import * as ns`)
  // and default import (`import dep from`) are NOT extracted by IMPORT_RE.
  // Calls inside such files are NOT linked to a dep, so they pass the gate.
  // This is a known v1 limitation; production slice migrates to TS Compiler API.
  // Test exists to surface the gap loudly if v1 ever silently widens behavior.
  it('v1 passes namespace import (limitation, R2-W3)', async () => {
    mkdirSync(join(workdir, 'src'), { recursive: true });
    writeFileSync(join(workdir, 'src', 'ns.ts'), `
      import * as oauth from 'oauth-client';
      oauth.handleCallbackV3({ code: 'x' });
    `);
    const result = await runAstGate({
      project: workdir,
      changedFiles: ['src/ns.ts'],
      context: {
        deps: { 'oauth-client': { version: '2.4.0', source: 'package.json', resolved: '' } },
        docSummaries: [
          { dep: 'oauth-client', version: '2.4.0', apis: ['handleCallback'] },
        ],
      },
    });
    // v1: namespace import passes through; v2 should tighten and flag this.
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  // R2-W3 follow-up: default import form also untracked by v1 regex.
  it('v1 passes default import (limitation, R2-W3)', async () => {
    mkdirSync(join(workdir, 'src'), { recursive: true });
    writeFileSync(join(workdir, 'src', 'def.ts'), `
      import oauth from 'oauth-client';
      oauth.handleCallbackV3({ code: 'x' });
    `);
    const result = await runAstGate({
      project: workdir,
      changedFiles: ['src/def.ts'],
      context: {
        deps: { 'oauth-client': { version: '2.4.0', source: 'package.json', resolved: '' } },
        docSummaries: [
          { dep: 'oauth-client', version: '2.4.0', apis: ['handleCallback'] },
        ],
      },
    });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  // R2-EXTRA: side-effect-only import boundary (round-2 JSON boundary_coverage).
  // Not part of R2-W1..W5; surfaces the gap loudly if v1 ever silently widens
  // to flag side-effect imports as violations.
  it('side-effect-only import produces no false violations', async () => {
    mkdirSync(join(workdir, 'src'), { recursive: true });
    writeFileSync(join(workdir, 'src', 'side.ts'), `
      import 'oauth-client';
      export const x = 1;
    `);
    const result = await runAstGate({
      project: workdir,
      changedFiles: ['src/side.ts'],
      context: {
        deps: { 'oauth-client': { version: '2.4.0', source: 'package.json', resolved: '' } },
        docSummaries: [
          { dep: 'oauth-client', version: '2.4.0', apis: ['handleCallback'] },
        ],
      },
    });
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });
});
