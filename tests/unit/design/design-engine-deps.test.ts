// The production wiring behind `peaks design check` (rid peaks-design-s2).
//
// `design-engine-deps` is the only place the real `DesignEngineDeps` is built,
// so its seams are pinned here instead of through a full check run: the URL
// precedence, the resolved URL handed to `startRenderServer`, the recorded
// `supportedMajor` handed to `resolveEngine`, the "no command → no starter"
// rule, and the rule that a null entry path NEVER becomes `node ''`.
//
// What is mocked: the three side-effect modules (engine-status, designlang,
// render-server). The URL resolver, the contract reader and the fs stay real.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import type { EngineContractFile } from '../../../src/services/design/engine-contract.js';
import type { EngineAvailability } from '../../../src/services/design/engine-status.js';

declareDimensions('tests/unit/design/design-engine-deps.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const mocks = vi.hoisted(() => ({
  resolveEngine: vi.fn(),
  runDesignlang: vi.fn(),
  buildDesignlangArgs: vi.fn(),
  startRenderServer: vi.fn(),
  readGradeEvidence: vi.fn()
}));

vi.mock('../../../src/services/design/engine-status.js', () => ({
  resolveEngine: mocks.resolveEngine
}));
vi.mock('../../../src/services/design/designlang.js', () => ({
  runDesignlang: mocks.runDesignlang,
  readGradeEvidence: mocks.readGradeEvidence,
  buildDesignlangArgs: mocks.buildDesignlangArgs,
  // page-capture derives the identity budget from this real export.
  DEFAULT_RUN_TIMEOUT_MS: 120_000
}));
vi.mock('../../../src/services/design/render-server.js', () => ({
  startRenderServer: mocks.startRenderServer
}));

import {
  buildEngineDeps,
  readEngineContract
} from '../../../src/services/design/design-engine-deps.js';

const PROJECT_ROOT = '/repo';
const RENDER_URL = 'http://127.0.0.1:4321/';

const AVAILABLE: EngineAvailability = {
  available: true,
  version: '13.4.1',
  entryPath: '/opt/designlang/bin/design-extract.js',
  browserReady: true,
  browserKind: 'system-chrome',
  codes: []
};

const UNAVAILABLE: EngineAvailability = {
  available: false,
  version: null,
  entryPath: null,
  browserReady: false,
  browserKind: null,
  codes: ['DESIGN_ENGINE_UNAVAILABLE']
};

function engineWith(
  render: Partial<EngineContractFile['render']> = {},
  supportedMajor = 13
): EngineContractFile {
  return {
    schemaVersion: 1,
    contractVersion: null,
    engine: { name: 'designlang', supportedMajor },
    render: {
      startCommand: null,
      cwd: '.',
      port: 4321,
      path: '/',
      pages: [],
      startPolicy: 'never',
      url: null,
      ...render
    },
    archetypes: []
  };
}

const roots: string[] = [];
beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolveEngine.mockReturnValue(AVAILABLE);
});
afterEach(() => {
  while (roots.length) rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe('Scenario: behavior — the URL precedence reaches the real resolver', () => {
  it('when --url and the env var are both set, should prefer the flag', () => {
    // given: a flag URL, an env URL, and a recorded URL
    // when: the deps resolve the render URL
    // then: the flag wins and keeps its provenance
    const deps = buildEngineDeps({
      projectRoot: PROJECT_ROOT,
      engine: engineWith({ url: 'http://127.0.0.1:9999/' }),
      url: 'http://127.0.0.1:4321/',
      env: { PEAKS_DESIGN_URL: 'http://127.0.0.1:5555/' }
    });
    const resolved = deps.resolveUrl();
    expect(resolved).toEqual({ ok: true, url: 'http://127.0.0.1:4321/', source: 'flag' });
  });

  it('when neither a flag nor an env var exists, should hand the engine to the real resolver', () => {
    // given: an engine recording a port and no URL from the caller
    // when: the deps resolve the render URL
    // then: the real resolver derives the loopback URL from that engine
    const deps = buildEngineDeps({ projectRoot: PROJECT_ROOT, engine: engineWith({ port: 4321 }) });
    expect(deps.resolveUrl()).toEqual({
      ok: true,
      url: 'http://127.0.0.1:4321/',
      source: 'derived'
    });
  });

  it('when only the env var and the recorded URL exist, should prefer the env var', () => {
    // given: an env URL and a recorded URL
    // when: the deps resolve the render URL
    // then: the env candidate beats the recorded one
    const deps = buildEngineDeps({
      projectRoot: PROJECT_ROOT,
      engine: engineWith({ url: 'http://127.0.0.1:9999/' }),
      env: { PEAKS_DESIGN_URL: 'http://127.0.0.1:5555/' }
    });
    const resolved = deps.resolveUrl();
    expect(resolved).toEqual({ ok: true, url: 'http://127.0.0.1:5555/', source: 'env' });
  });
});

describe('Scenario: integration — the production wiring hands every value through', () => {
  it('when the resolved URL is started, should hand it and the recorded command through', async () => {
    // given: a recorded start command and a mocked starter
    // when: the resolved URL is passed to the deps starter
    // then: the starter receives the project, cwd, command, and that exact URL
    mocks.startRenderServer.mockResolvedValue({
      ok: true,
      server: { url: RENDER_URL, stop: async () => {} }
    });
    const deps = buildEngineDeps({
      projectRoot: PROJECT_ROOT,
      engine: engineWith({ startCommand: 'node server.mjs', startPolicy: 'on-request' })
    });
    const resolved = deps.resolveUrl();
    if (!resolved.ok) throw new Error(resolved.message);
    await deps.startServer?.(resolved.url);
    expect(mocks.startRenderServer).toHaveBeenCalledWith({
      projectRoot: PROJECT_ROOT,
      cwd: '.',
      command: 'node server.mjs',
      url: resolved.url
    });
  });

  it('when a command is blank, should not build a starter at all', () => {
    // given: engine.json start commands that are null, empty, and whitespace
    // when: the deps are built for each
    // then: none of them produces a starter
    for (const command of [null, '', '   ']) {
      const deps = buildEngineDeps({
        projectRoot: PROJECT_ROOT,
        engine: engineWith({ startCommand: command, startPolicy: 'on-request' })
      });
      expect(deps.startServer, String(command)).toBeUndefined();
    }
  });

  it('when the entry resolved, should spawn that exact entry with the given args', async () => {
    // given: an available engine and a recorded args vector
    // when: a check is dispatched through the deps
    // then: the wrapper receives the resolved entry and the args unchanged
    const args = ['drift', RENDER_URL, '--json'];
    mocks.runDesignlang.mockResolvedValue({
      exitCode: 0,
      stdout: '{}',
      stderr: '',
      timedOut: false
    });
    const deps = buildEngineDeps({ projectRoot: PROJECT_ROOT, engine: engineWith() });
    const result = await deps.run('drift', { args });
    expect(mocks.runDesignlang).toHaveBeenCalledWith({ entryPath: AVAILABLE.entryPath, args });
    expect(result).toEqual({ exitCode: 0, stdout: '{}', stderr: '', timedOut: false });
  });

  it('when grade evidence is read, should forward the out dir to the real reader', async () => {
    // given: a mocked grade reader and an out dir
    // when: the deps read the grade evidence
    // then: the reader receives that exact directory
    const evidence = { ok: true as const, pages: 1, raw: { overall: 'A' } };
    mocks.readGradeEvidence.mockResolvedValue(evidence);
    const deps = buildEngineDeps({ projectRoot: PROJECT_ROOT, engine: engineWith() });
    await expect(deps.readGrade?.('/out/grade')).resolves.toEqual(evidence);
    expect(mocks.readGradeEvidence).toHaveBeenCalledWith('/out/grade');
  });

  it('when the entry path did not resolve, should refuse without spawning anything', async () => {
    // given: an unavailable engine whose entry path is null
    // when: a check is dispatched through the deps
    // then: no designlang spawn happens and the failure record is complete
    mocks.resolveEngine.mockReturnValue(UNAVAILABLE);
    const deps = buildEngineDeps({ projectRoot: PROJECT_ROOT, engine: engineWith() });
    const result = await deps.run('drift', { args: ['drift', RENDER_URL, '--json'] });
    expect(mocks.runDesignlang).not.toHaveBeenCalled();
    expect(result).toEqual({
      exitCode: -1,
      stdout: '',
      stderr: 'designlang is not available: its entry path did not resolve; G2 must block first.',
      timedOut: false
    });
  });

  it('when engine.json records a supported major, should NOT hand it to the version gate', () => {
    // given: an engine.json that records major 99 (a value a user edits freely)
    // when: the deps resolve the installed engine
    // then: the adapter constant is the gate, so engine.json cannot widen it
    buildEngineDeps({ projectRoot: PROJECT_ROOT, engine: engineWith({}, 99) });
    expect(mocks.resolveEngine).toHaveBeenCalledWith();
    expect(mocks.resolveEngine).not.toHaveBeenCalledWith({ supportedMajor: 99 });
  });

  it('when the entry path did not resolve, should refuse without spawning anything', async () => {
    // given: an unavailable engine whose entry path is null
    // when: a check is dispatched through the deps
    // then: no designlang spawn happens and the result is a failure
    mocks.resolveEngine.mockReturnValue(UNAVAILABLE);
    const deps = buildEngineDeps({ projectRoot: PROJECT_ROOT, engine: engineWith() });
    const result = await deps.run('drift', { args: ['drift', RENDER_URL, '--json'] });
    expect(mocks.runDesignlang).not.toHaveBeenCalled();
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('entry path');
  });
});

describe('Scenario: render — the engine reader fills the contract defaults', () => {
  it('when the file is empty, should reproduce every documented default exactly', () => {
    // given: an engine.json holding an empty object
    // when: the contract is read
    // then: the full default contract is returned field for field
    const designRoot = mkdtempSync(join(tmpdir(), 'peaks-engine-deps-'));
    roots.push(designRoot);
    writeFileSync(join(designRoot, 'engine.json'), '{}', 'utf8');
    const read = readEngineContract(designRoot);
    expect(read).toEqual({
      ok: true,
      contract: {
        schemaVersion: 1,
        contractVersion: null,
        engine: { name: 'designlang', supportedMajor: 13 },
        render: {
          startCommand: null,
          cwd: '.',
          port: 0,
          path: '/',
          pages: [],
          startPolicy: 'never',
          url: null
        },
        archetypes: []
      }
    });
  });

  it('when the file holds only a render block, should merge every missing default', () => {
    // given: an engine.json that records only a port and a path
    // when: the contract is read
    // then: the defaults fill every other field and the read succeeds
    const designRoot = mkdtempSync(join(tmpdir(), 'peaks-engine-deps-'));
    roots.push(designRoot);
    writeFileSync(
      join(designRoot, 'engine.json'),
      JSON.stringify({ render: { port: 4321, path: '/app' } }),
      'utf8'
    );
    const read = readEngineContract(designRoot);
    expect(read.ok).toBe(true);
    if (!read.ok) throw new Error(read.message);
    expect(read.contract.render.port).toBe(4321);
    expect(read.contract.render.path).toBe('/app');
    expect(read.contract.render.pages).toEqual([]);
    expect(read.contract.render.startPolicy).toBe('never');
    expect(read.contract.engine.supportedMajor).toBe(13);
  });
});

describe('Scenario: integration — a malformed engine.json is a value, not a throw', () => {
  it('when a field has the wrong type, should return the blocked contract code', () => {
    // given: engine.json whose pages is null
    // when: the contract is read
    // then: the refusal is a value carrying DESIGN_CONTRACT_INVALID
    const designRoot = mkdtempSync(join(tmpdir(), 'peaks-engine-deps-'));
    roots.push(designRoot);
    writeFileSync(
      join(designRoot, 'engine.json'),
      JSON.stringify({ render: { pages: null } }),
      'utf8'
    );
    const read = readEngineContract(designRoot);
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error('expected an invalid contract');
    expect(read.code).toBe('DESIGN_CONTRACT_INVALID');
    expect(read.message).toContain('design/tokens.json');
    expect(read.message).toContain('design/engine.json');
    expect(read.message).toContain('render.pages must be an array of strings');
  });
});

describe('Scenario: a11y — the invalid-engine message names the file and the fix', () => {
  it('when the file is unparseable, should name design/engine.json and the refresh verb', () => {
    // given: an engine.json that is not JSON
    // when: the contract is read
    // then: the message tells the user which file and which command
    const designRoot = mkdtempSync(join(tmpdir(), 'peaks-engine-deps-'));
    roots.push(designRoot);
    mkdirSync(designRoot, { recursive: true });
    writeFileSync(join(designRoot, 'engine.json'), '{ oops', 'utf8');
    const read = readEngineContract(designRoot);
    expect(read.ok).toBe(false);
    if (read.ok) throw new Error('expected an invalid contract');
    expect(read.code).toBe('DESIGN_CONTRACT_INVALID');
    expect(read.message).toContain('design/engine.json');
    expect(read.message).toContain('design/tokens.json');
    expect(read.message).toContain('peaks design init --refresh');
  });
});
