import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { SUBPROCESS_TEST_TIMEOUT_MS } from '../_setup/subprocess-timeouts.js';
import { checkDesign } from '../../../src/services/design/design-check.js';
import { evaluateG2 } from '../../../src/services/design/design-check-g2.js';
import { runDesignlang, readGradeEvidence } from '../../../src/services/design/designlang.js';
import {
  CLEAN_JSON,
  DEFAULT_URL,
  UNAVAILABLE,
  createAdoptedApp,
  disposeFixtures,
  fakeEngine,
  fakeStartServer,
  isAlive,
  runResult,
  setStartCommand,
  waitUntil,
  writeFakeScript
} from './_fake-designlang.js';

declareDimensions('tests/unit/design/design-check-g2-wiring.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

afterEach(() => {
  disposeFixtures();
});

const input = (root: string, extra: Record<string, unknown> = {}) => ({
  projectRoot: root,
  changedFiles: ['src/routes/a.tsx'],
  ...extra
});

/** Replace the machine-owned engine.json with an arbitrary (possibly broken) body. */
function writeEngineFile(root: string, engine: unknown): void {
  writeFileSync(join(root, 'design', 'engine.json'), JSON.stringify(engine), 'utf8');
}

/** The merged engine contract a direct evaluateG2 call needs. */
function engineContract(
  render: Partial<
    import('../../../src/services/design/engine-contract.js').EngineContractFile['render']
  > = {}
): import('../../../src/services/design/engine-contract.js').EngineContractFile {
  return {
    schemaVersion: 1,
    contractVersion: null,
    engine: { name: 'designlang', supportedMajor: 13 },
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

describe('Scenario: behavior — configured pages and start wiring', () => {
  it('when no --pages is given, should render every page recorded in engine.json', async () => {
    // given: engine.json recording two render.pages and no input.pages
    // when: check runs
    // then: both recorded pages are resolved against the base URL
    const root = await createAdoptedApp();
    writeEngineFile(root, { render: { pages: ['/', '/about'] } });
    const result = await checkDesign(input(root), fakeEngine());
    expect(result.checks.g2_render).toEqual({
      status: 'pass',
      pages: 2,
      evidence: [
        `drift ${DEFAULT_URL}`,
        `verify-ui ${DEFAULT_URL}`,
        `drift ${DEFAULT_URL}about`,
        `verify-ui ${DEFAULT_URL}about`
      ]
    });
  });

  it('when --pages is an empty array, should fall back to the recorded pages', async () => {
    // given: engine.json recording two pages and an explicit empty --pages
    // when: check runs
    // then: the empty list is treated as absent, not as "render nothing"
    const root = await createAdoptedApp();
    writeEngineFile(root, { render: { pages: ['/', '/about'] } });
    const result = await checkDesign(input(root, { pages: [] }), fakeEngine());
    expect(result.checks.g2_render).toEqual({
      status: 'pass',
      pages: 2,
      evidence: [
        `drift ${DEFAULT_URL}`,
        `verify-ui ${DEFAULT_URL}`,
        `drift ${DEFAULT_URL}about`,
        `verify-ui ${DEFAULT_URL}about`
      ]
    });
  });

  it('when the recorded start command is only whitespace, should block as missing', async () => {
    // given: engine.json whose startCommand is spaces
    // when: check runs with --start
    // then: a blank command is missing, not spawnable
    const root = await createAdoptedApp();
    setStartCommand(root, '   ');
    const result = await checkDesign(input(root, { start: true }), fakeEngine());
    expect(result.checks.g2_render).toEqual({
      status: 'blocked',
      code: 'DESIGN_START_COMMAND_MISSING'
    });
  });

  it('when no session id is given, should write the grade under the local session', async () => {
    // given: a grade reader call with no --session-id
    // when: check runs and grade writes its report
    // then: the default local session dir is used and the pass stands
    const root = await createAdoptedApp();
    const result = await checkDesign(
      input(root),
      fakeEngine({
        readGrade: readGradeEvidence,
        run: async (kind, request) => {
          if (kind !== 'grade') return runResult();
          const outDir = request.args[request.args.indexOf('--out') + 1];
          if (outDir !== undefined) {
            writeFileSync(
              join(outDir, 'run.grade.json'),
              JSON.stringify({ overall: 'A', generatedAt: new Date().toISOString() })
            );
          }
          return runResult({ stdout: '' });
        }
      })
    );
    expect(result.verdict).toBe('pass');
    expect((result.warnings ?? []).join(' ')).not.toContain('grade');
  });

  it('when engine.json records an empty path and pages, should fall back to /', async () => {
    // given: an engine.json whose render.path is empty and pages is empty
    // when: check runs
    // then: the single page is the root URL, never an empty string
    const root = await createAdoptedApp();
    writeEngineFile(root, { render: { path: '', pages: [] } });
    const result = await checkDesign(input(root), fakeEngine());
    expect(result.checks.g2_render).toEqual({
      status: 'pass',
      pages: 1,
      evidence: [`drift ${DEFAULT_URL}`, `verify-ui ${DEFAULT_URL}`]
    });
  });

  it('when --start is given without a starter dep, should fall back to probing', async () => {
    // given: a start command recorded and a deps record with no startServer
    // when: check runs with --start
    // then: the probe decides reachability and the matrix still passes
    const root = await createAdoptedApp();
    setStartCommand(root, 'node server.mjs');
    const result = await checkDesign(input(root, { start: true }), fakeEngine());
    expect(result.verdict).toBe('pass');
    expect(result.checks.g2_render.status).toBe('pass');
  });

  it('when a starter reports a refusal, should block with that code and message', async () => {
    // given: a starter returning its own blocked code
    // when: check runs with --start
    // then: the starter's code and message become the G2 verdict
    const root = await createAdoptedApp();
    setStartCommand(root, 'node server.mjs');
    const result = await checkDesign(
      input(root, { start: true }),
      fakeEngine({
        startServer: async () => ({
          ok: false,
          code: 'DESIGN_START_COMMAND_EXITED',
          message: 'the command died'
        })
      })
    );
    expect(result.checks.g2_render).toEqual({
      status: 'blocked',
      code: 'DESIGN_START_COMMAND_EXITED'
    });
    expect(result.message).toBe('the command died');
  });

  it('when the checks fail after a server started, should still stop the server', async () => {
    // given: a starter that records stop calls and a drift that fails
    // when: check runs with --start
    // then: the finally block reaps the started server
    const root = await createAdoptedApp();
    setStartCommand(root, 'node server.mjs');
    let stops = 0;
    const result = await checkDesign(
      input(root, { start: true }),
      fakeEngine({
        startServer: async () => ({
          ok: true,
          server: {
            url: DEFAULT_URL,
            stop: async () => {
              stops += 1;
            }
          }
        }),
        run: async (kind) => (kind === 'drift' ? runResult({ exitCode: 1 }) : runResult())
      })
    );
    expect(result.verdict).toBe('fail');
    expect(stops).toBe(1);
  });

  it('when an availability record has no codes, should block with the engine default', async () => {
    // given: an unavailable engine whose codes array is empty
    // when: check runs
    // then: the missing code falls back to DESIGN_ENGINE_UNAVAILABLE
    const root = await createAdoptedApp();
    const result = await checkDesign(
      input(root),
      fakeEngine({ availability: { ...UNAVAILABLE, codes: [] } })
    );
    expect(result.checks.g2_render).toEqual({
      status: 'blocked',
      code: 'DESIGN_ENGINE_UNAVAILABLE'
    });
  });

  it('when the session id is whitespace, should block as invalid', async () => {
    // given: a session id of spaces
    // when: check runs
    // then: the id is refused before any render check
    const root = await createAdoptedApp();
    const result = await checkDesign(input(root, { sessionId: '   ' }), fakeEngine());
    expect(result.checks.g2_render).toEqual({
      status: 'blocked',
      code: 'DESIGN_SESSION_ID_INVALID'
    });
  });
});

describe('Scenario: behavior — the two-page matrix', () => {
  it('when both pages pass, should count both and record four evidence rows', async () => {
    // given: two configured pages and clean evidence for each
    // when: the matrix renders both
    // then: the pass counts two pages and names every check
    const root = await createAdoptedApp();
    const result = await checkDesign(input(root, { pages: ['/', '/about'] }), fakeEngine());
    expect(result.checks.g2_render).toEqual({
      status: 'pass',
      pages: 2,
      evidence: [
        `drift ${DEFAULT_URL}`,
        `verify-ui ${DEFAULT_URL}`,
        `drift ${DEFAULT_URL}about`,
        `verify-ui ${DEFAULT_URL}about`
      ]
    });
  });

  it('when only the second page fails drift, should fail and name that page', async () => {
    // given: two pages and a drift defect only on the second
    // when: the matrix renders both
    // then: the verdict fails and the reason names only the failing page
    const root = await createAdoptedApp();
    const result = await checkDesign(
      input(root, { pages: ['/', '/broken'] }),
      fakeEngine({
        run: async (kind, request) =>
          kind === 'drift' && request.args.includes(`${DEFAULT_URL}broken`)
            ? runResult({ exitCode: 1, stdout: '' })
            : runResult()
      })
    );
    expect(result.verdict).toBe('fail');
    const g2 = result.checks.g2_render;
    expect(g2.status).toBe('fail');
    if (g2.status !== 'fail') throw new Error('expected a fail outcome');
    expect(g2.reason).toContain(`${DEFAULT_URL}broken`);
    expect(g2.reason).not.toContain(`for ${DEFAULT_URL} `);
  });
});

describe('Scenario: render — the direct G2 outcome document', () => {
  it('when every check passes, should return an empty message and no warnings', async () => {
    // given: an available engine and one clean page through injected deps
    // when: evaluateG2 runs directly
    // then: the pass outcome has empty message and warnings, and names both checks
    const outcome = await evaluateG2(
      { projectRoot: '.', designRoot: join('.', 'design'), engine: engineContract(), pages: ['/'] },
      fakeEngine()
    );
    expect(outcome).toEqual({
      check: {
        status: 'pass',
        pages: 1,
        evidence: [`drift ${DEFAULT_URL}`, `verify-ui ${DEFAULT_URL}`]
      },
      warnings: [],
      message: ''
    });
  });
});

describe('Scenario: integration — real entries through the wrapper', () => {
  it(
    'when a real entry prints JSON or exits nonzero, should classify each check',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: two temp entries, one printing evidence and one exiting 1
      // when: the real designlang wrapper runs each check
      // then: printed evidence passes and the nonzero drift fails
      const root = await createAdoptedApp();
      const clean = writeFakeScript('clean', { stdout: CLEAN_JSON });
      const failing = writeFakeScript('failing', { exitCode: 1 });
      const failed = await checkDesign(
        input(root),
        fakeEngine({
          run: (kind, request) =>
            runDesignlang({ entryPath: kind === 'drift' ? failing : clean, args: request.args })
        })
      );
      expect(failed.verdict).toBe('fail');
      const passed = await checkDesign(
        input(root),
        fakeEngine({
          run: (_kind, request) => runDesignlang({ entryPath: clean, args: request.args })
        })
      );
      expect(passed.verdict).toBe('pass');
    }
  );

  it(
    'when --start succeeds, should stop the server and reap its child',
    { timeout: SUBPROCESS_TEST_TIMEOUT_MS },
    async () => {
      // given: a recorded start command and a real fake server child
      // when: check runs with --start and every check passes
      // then: the check stops the server and the child pid is gone
      const root = await createAdoptedApp();
      setStartCommand(root, 'node server.mjs');
      const starter = fakeStartServer(DEFAULT_URL);
      const result = await checkDesign(
        input(root, { start: true }),
        fakeEngine({ startServer: starter.start })
      );
      expect(result.verdict).toBe('pass');
      expect(starter.stopped()).toBe(true);
      const pid = starter.pid();
      if (pid === null) throw new Error('the start command was never spawned');
      await waitUntil(() => !isAlive(pid));
      expect(isAlive(pid)).toBe(false);
    }
  );
});

describe('Scenario: render — the full result document', () => {
  it('when G2 passes, should publish every DesignCheckResult field', async () => {
    // given: a clean adopted app and clean engine evidence
    // when: check runs
    // then: the result carries the g2 pass, the G1 findings, and coverage
    const root = await createAdoptedApp();
    const result = await checkDesign(input(root), fakeEngine());
    expect(Object.keys(result).sort()).toEqual([
      'checks',
      'coverage',
      'findings',
      'rid',
      'schemaVersion',
      'surface',
      'verdict'
    ]);
    expect(result.schemaVersion).toBe(1);
    expect(result.rid).toBeNull();
    expect(result.verdict).toBe('pass');
    expect(result.surface).toEqual({ isUi: true, reasons: ['changed: src/routes/a.tsx'] });
    expect(result.checks.g1_source).toEqual({ status: 'pass', findings: [] });
    expect(result.checks.g2_render).toEqual({
      status: 'pass',
      pages: 1,
      evidence: [`drift ${DEFAULT_URL}`, `verify-ui ${DEFAULT_URL}`]
    });
    expect(result.findings).toEqual([]);
    expect(result.coverage).toEqual({ covered: 0, total: 0, ratio: 1 });
    expect(result.errorCode).toBeUndefined();
  });
});
