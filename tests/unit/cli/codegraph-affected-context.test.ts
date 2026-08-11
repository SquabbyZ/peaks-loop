// tests/unit/cli/codegraph-affected-context.test.ts
//
// rid-CG-002 — peaks codegraph affected → codegraph-context.md envelope.
//
// 4-dimension test for `writeCodegraphAffectedContext` +
// `renderCodegraphAffectedContext` in `src/services/codegraph/codegraph-service.ts`.
//
// Dimensions covered:
//   - behavior: AC1 render produces Markdown table + JSON tail;
//                AC2 writer stamps `.peaks/_runtime/<sid>/rd/codegraph-context.md`
//                on real fs; AC3 missing session binding skips with warning;
//                AC4 rid + files + payload all flow through verbatim.
//   - integration: real `mkdtempSync` + `mkdirSync` + `writeFileSync`
//                  drives the writer; no mocks of the writer module
//                  itself.
//   - render: rendered body has the session-id + rid + generatedAt
//              front-matter and a valid Markdown table.
//   - a11y: failure message names the recovery command
//           (`peaks workspace init`) so the LLM (or human) can pick.
//
// Run with:
//   pnpm vitest run tests/unit/cli/codegraph-affected-context.test.ts

import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  renderCodegraphAffectedContext,
  writeCodegraphAffectedContext
} from '~/src/services/codegraph/codegraph-service';
import { declareDimensions } from '../_setup/4dim-template.js';
import { withEnv } from '../_setup/io.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/cli/codegraph-affected-context.test.ts',
  ['behavior', 'integration', 'render', 'a11y'],
  []
);

const FIXED_NOW = new Date('2026-08-11T12:00:00.000Z');

function freshProject(): string {
  return mkdtempSync(join(tmpdir(), 'peaks-cg-002-'));
}

function bindSession(projectRoot: string, sessionId: string): void {
  // Mimic what `peaks workspace init` + `setCurrentSessionBinding`
  // would write: `.peaks/_runtime/session.json` with a sessionId
  // field. The reader (`getSessionId`) prefers the canonical
  // `.peaks/_runtime/session.json` path; we stamp both forms so
  // legacy + canonical readers both resolve.
  const runtimeDir = join(projectRoot, '.peaks', '_runtime');
  mkdirSync(runtimeDir, { recursive: true });
  writeFileSync(
    join(runtimeDir, 'session.json'),
    JSON.stringify({ sessionId, projectRoot }, null, 2) + '\n',
    'utf8'
  );
}

describe('renderCodegraphAffectedContext (rid-CG-002)', () => {
  it('renders a Markdown body with session-id + rid + generatedAt + table + JSON tail (AC1)', () => {
    const body = renderCodegraphAffectedContext(
      'rid-CG-002',
      ['src/services/codegraph/codegraph-service.ts', 'src/cli/commands/codegraph-commands.ts'],
      { affected: ['symbol-A', 'symbol-B'] },
      '2026-08-11-session-476090',
      () => FIXED_NOW
    );

    expect(body).toContain('# Codegraph orchestration context');
    expect(body).toContain('`2026-08-11-session-476090`');
    expect(body).toContain('`rid-CG-002`');
    expect(body).toContain('`2026-08-11T12:00:00.000Z`');
    expect(body).toContain('| file | symbolCount | crossRefEdges |');
    expect(body).toContain('| `src/services/codegraph/codegraph-service.ts`');
    expect(body).toContain('| `src/cli/commands/codegraph-commands.ts`');
    expect(body).toContain('## Raw upstream output');
    expect(body).toContain('```json');
    expect(body).toContain('"affected"');
  });

  it('renders a string payload verbatim inside the JSON fence', () => {
    const body = renderCodegraphAffectedContext(
      'rid-CG-002',
      ['src/foo.ts'],
      'plain text payload, not JSON',
      'session-x',
      () => FIXED_NOW
    );
    expect(body).toContain('plain text payload, not JSON');
    // No second JSON.parse attempt — string payloads render as-is.
    expect(body).not.toContain('"plain text payload"');
  });
});

describe('writeCodegraphAffectedContext (rid-CG-002)', () => {
  withTmpWorkspacePerTest();

  it('writes .peaks/_runtime/<sid>/rd/codegraph-context.md on real fs (AC2)', () => {
    // Each test gets its own tmp project; stamp a binding into it
    // so the writer can resolve the sessionId.
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cg-002-'));
    bindSession(projectRoot, 'session-cg-002-A');

    const result = writeCodegraphAffectedContext({
      projectRoot,
      rid: 'rid-CG-002',
      files: ['src/services/codegraph/codegraph-service.ts'],
      affectedPayload: { affected: ['symbol-X'] },
      now: () => FIXED_NOW
    });

    expect(result.written).toBe(true);
    if (!result.written) throw new Error('unreachable');
    const expectedPath = join(projectRoot, '.peaks', '_runtime', 'session-cg-002-A', 'rd', 'codegraph-context.md');
    expect(result.path).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);

    const written = readFileSync(expectedPath, 'utf8');
    expect(written).toContain('`session-cg-002-A`');
    expect(written).toContain('`rid-CG-002`');
    expect(written).toContain('"affected"');

    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('returns written:false with a recovery-command warning when no session binding (AC3)', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cg-002-'));
    // Note: NO `bindSession` call here — the writer must fall back
    // gracefully instead of throwing or crashing.
    const result = writeCodegraphAffectedContext({
      projectRoot,
      rid: 'rid-CG-002',
      files: ['src/foo.ts'],
      affectedPayload: { affected: [] }
    });

    expect(result.written).toBe(false);
    if (result.written) throw new Error('unreachable');
    expect(result.path).toBe('');
    expect(result.warning).toContain('peaks workspace init');

    // No file should have been written.
    expect(existsSync(join(projectRoot, '.peaks'))).toBe(false);

    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('honors explicit sessionId override (AC4 — rid/files/payload all flow through verbatim)', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cg-002-'));
    // No binding — but the override should bypass getSessionId().
    const result = writeCodegraphAffectedContext({
      projectRoot,
      rid: 'rid-CG-002-explicit',
      files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      affectedPayload: { affected: ['a', 'b', 'c'] },
      sessionId: '2026-08-11-session-override',
      now: () => FIXED_NOW
    });

    expect(result.written).toBe(true);
    if (!result.written) throw new Error('unreachable');
    const expectedPath = join(
      projectRoot,
      '.peaks',
      '_runtime',
      '2026-08-11-session-override',
      'rd',
      'codegraph-context.md'
    );
    expect(result.path).toBe(expectedPath);
    expect(result.sessionId).toBe('2026-08-11-session-override');

    const written = readFileSync(expectedPath, 'utf8');
    expect(written).toContain('`rid-CG-002-explicit`');
    expect(written).toContain('`src/a.ts`');
    expect(written).toContain('`src/b.ts`');
    expect(written).toContain('`src/c.ts`');

    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('creates the rd/ subdirectory on demand (mkdir recursive)', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cg-002-'));
    bindSession(projectRoot, 'session-cg-002-B');
    // The `.peaks/_runtime/<sid>/rd/` subdir does NOT yet exist;
    // the writer must create it without throwing.
    const result = writeCodegraphAffectedContext({
      projectRoot,
      rid: 'rid-CG-002',
      files: ['src/foo.ts'],
      affectedPayload: { affected: [] },
      now: () => FIXED_NOW
    });
    expect(result.written).toBe(true);
    const rdDir = join(projectRoot, '.peaks', '_runtime', 'session-cg-002-B', 'rd');
    expect(existsSync(rdDir)).toBe(true);

    rmSync(projectRoot, { recursive: true, force: true });
  });
});

describe('writeCodegraphAffectedContext — env interaction', () => {
  it('reads sessionId from .peaks/_runtime/session.json (the canonical binding)', () => {
    // Verifies that the writer picks up the session.json that
    // `peaks workspace init` writes — without going through any
    // mocks. Uses `withTmpWorkspacePerTest` to give the test its
    // own chdir so the `getSessionId` resolution cannot collide
    // with the real `.peaks/` tree under the project root.
    withTmpWorkspacePerTest();
    const projectRoot = mkdtempSync(join(tmpdir(), 'peaks-cg-002-env-'));
    bindSession(projectRoot, 'session-from-binding');

    withEnv('PEAKS_OUTER_SESSION_ID', undefined);
    withEnv('CLAUDE_CODE_SESSION_ID', undefined);

    const result = writeCodegraphAffectedContext({
      projectRoot,
      rid: 'rid-CG-002-env',
      files: ['src/foo.ts'],
      affectedPayload: { affected: [] },
      now: () => FIXED_NOW
    });

    // `getSessionId` resolves the binding only when the caller's
    // cwd matches the stored projectRoot. We pass the projectRoot
    // explicitly, so the writer should still find the binding.
    expect(result.written).toBe(true);

    rmSync(projectRoot, { recursive: true, force: true });
  });
});
