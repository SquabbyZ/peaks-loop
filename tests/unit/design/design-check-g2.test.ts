import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { checkDesign } from '../../../src/services/design/design-check.js';
import { readGradeEvidence } from '../../../src/services/design/designlang.js';
import {
  DEFAULT_URL,
  UNAVAILABLE,
  createAdoptedApp,
  disposeFixtures,
  fakeEngine,
  runResult,
  setStartCommand,
  setStartPolicy
} from './_fake-designlang.js';

declareDimensions('tests/unit/design/design-check-g2.test.ts', [
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

describe('Scenario: behavior — every render page URL is trusted', () => {
  it('when a page escapes the base origin, should block before any check or start', async () => {
    // given: absolute, protocol-relative, and private-network page entries
    // when: check runs with --start and counting deps
    // then: each page is refused as untrusted and nothing is spawned
    const root = await createAdoptedApp();
    let calls = 0;
    for (const page of ['https://evil.example/x', '//evil.example/x', 'http://192.168.1.5:3000/']) {
      const result = await checkDesign(
        input(root, { start: true, pages: [page] }),
        fakeEngine({
          run: async () => {
            calls += 1;
            return runResult();
          },
          startServer: async () => {
            calls += 1;
            return { ok: true, server: { url: DEFAULT_URL, stop: async () => {} } };
          }
        })
      );
      expect(result.checks.g2_render, page).toEqual({
        status: 'blocked',
        code: 'DESIGN_URL_UNTRUSTED'
      });
    }
    expect(calls).toBe(0);
  });
});

describe('Scenario: behavior — the recorded start policy gates --start', () => {
  it('when startPolicy is never, should block --start before spawning anything', async () => {
    // given: a recorded start command whose engine.json still says never
    // when: check runs with --start
    // then: the policy refuses the start and no server is launched
    const root = await createAdoptedApp();
    setStartCommand(root, 'node server.mjs');
    setStartPolicy(root, 'never');
    let starts = 0;
    const result = await checkDesign(
      input(root, { start: true }),
      fakeEngine({
        startServer: async () => {
          starts += 1;
          return { ok: true, server: { url: DEFAULT_URL, stop: async () => {} } };
        }
      })
    );
    expect(result.checks.g2_render).toEqual({
      status: 'blocked',
      code: 'DESIGN_START_NOT_ALLOWED'
    });
    expect(starts).toBe(0);
  });
});

describe('Scenario: behavior — a malformed contract blocks instead of throwing', () => {
  it('when engine.json or the session id is malformed, should block with the matching code', async () => {
    // given: wrong field types in engine.json and session ids with separators
    // when: each check runs
    // then: each input is a blocked value, never a crash or a usage exit
    const root = await createAdoptedApp();
    writeEngineFile(root, { engine: { supportedMajor: '13' }, render: { pages: null } });
    const broken = await checkDesign(input(root), fakeEngine());
    expect(broken.errorCode).toBe('DESIGN_CONTRACT_INVALID');
    expect(broken.checks.g2_render).toEqual({
      status: 'blocked',
      code: 'DESIGN_CONTRACT_INVALID'
    });
    for (const sessionId of ['../escape', 'a/b', 'a\\b']) {
      const sessionRoot = await createAdoptedApp();
      const session = await checkDesign(input(sessionRoot, { sessionId }), fakeEngine());
      expect(session.checks.g2_render, sessionId).toEqual({
        status: 'blocked',
        code: 'DESIGN_SESSION_ID_INVALID'
      });
    }
  });
});

describe('Scenario: behavior — the G2 unavailability matrix', () => {
  it('when the engine is unavailable, should block with the engine code', async () => {
    // given: an adopted app and an engine that did not resolve
    // when: check runs with the fake deps
    // then: G2 is blocked before any URL or process is touched
    const root = await createAdoptedApp();
    const result = await checkDesign(input(root), fakeEngine({ availability: UNAVAILABLE }));
    expect(result.verdict).toBe('blocked');
    expect(result.checks.g2_render).toEqual({
      status: 'blocked',
      code: 'DESIGN_ENGINE_UNAVAILABLE'
    });
  });

  it('when the URL is missing, should block with DESIGN_RENDER_URL_MISSING', async () => {
    // given: an engine and no resolvable render URL
    // when: check runs
    // then: the missing URL blocks instead of rendering
    const root = await createAdoptedApp();
    const resolveUrl = () =>
      ({ ok: false, code: 'DESIGN_RENDER_URL_MISSING', message: 'none' }) as const;
    const result = await checkDesign(input(root), fakeEngine({ resolveUrl }));
    expect(result.checks.g2_render).toEqual({
      status: 'blocked',
      code: 'DESIGN_RENDER_URL_MISSING'
    });
  });

  it('when the URL is untrusted, should block with DESIGN_URL_UNTRUSTED', async () => {
    // given: an engine and a URL outside the trust boundary
    // when: check runs
    // then: the trust refusal is the G2 verdict
    const root = await createAdoptedApp();
    const resolveUrl = () => ({ ok: false, code: 'DESIGN_URL_UNTRUSTED', message: 'no' }) as const;
    const result = await checkDesign(input(root), fakeEngine({ resolveUrl }));
    expect(result.checks.g2_render).toEqual({
      status: 'blocked',
      code: 'DESIGN_URL_UNTRUSTED'
    });
  });

  it('when the URL does not answer, should block with DESIGN_RENDER_UNREACHABLE', async () => {
    // given: a trusted URL that refuses the probe
    // when: check runs without --start
    // then: the probe failure blocks
    const root = await createAdoptedApp();
    const result = await checkDesign(input(root), fakeEngine({ probe: async () => false }));
    expect(result.checks.g2_render).toEqual({
      status: 'blocked',
      code: 'DESIGN_RENDER_UNREACHABLE'
    });
  });
});

describe('Scenario: behavior — the G2 verdict matrix', () => {
  it('when drift exits nonzero, should fail', async () => {
    // given: a reachable page whose drift check exits 1
    // when: check runs
    // then: the nonzero drift is a fail
    const root = await createAdoptedApp();
    const result = await checkDesign(
      input(root),
      fakeEngine({
        run: async (kind) => (kind === 'drift' ? runResult({ exitCode: 1 }) : runResult())
      })
    );
    expect(result.verdict).toBe('fail');
    expect(result.checks.g2_render.status).toBe('fail');
  });

  it('when verify-ui exits nonzero, should fail', async () => {
    // given: a reachable page whose verify-ui check exits 2
    // when: check runs
    // then: the nonzero verify-ui is a fail
    const root = await createAdoptedApp();
    const result = await checkDesign(
      input(root),
      fakeEngine({
        run: async (kind) => (kind === 'verify-ui' ? runResult({ exitCode: 2 }) : runResult())
      })
    );
    expect(result.verdict).toBe('fail');
    expect(result.checks.g2_render.status).toBe('fail');
  });

  it('when slop exits nonzero, should stay a pass with a warning', async () => {
    // given: clean drift and verify-ui with a nonzero slop
    // when: check runs
    // then: slop is advisory and never flips the verdict
    const root = await createAdoptedApp();
    const result = await checkDesign(
      input(root),
      fakeEngine({
        run: async (kind) =>
          kind === 'slop' ? runResult({ exitCode: 1, stdout: '' }) : runResult()
      })
    );
    expect(result.verdict).toBe('pass');
    expect(result.checks.g2_render).toEqual({
      status: 'pass',
      pages: 1,
      evidence: [`drift ${DEFAULT_URL}`, `verify-ui ${DEFAULT_URL}`]
    });
    expect(result.warnings?.join(' ')).toContain('slop');
  });

  it('when a check exits 0 with no evidence, should block', async () => {
    // given: drift exiting 0 with JSON, then verify-ui exiting 0 with nothing
    // when: each check runs
    // then: the JSON page passes and the silent page is no evidence
    const root = await createAdoptedApp();
    const pass = await checkDesign(input(root), fakeEngine());
    expect(pass.verdict).toBe('pass');
    const silent = await checkDesign(
      input(root),
      fakeEngine({
        run: async (kind) =>
          kind === 'verify-ui' ? runResult({ stdout: 'not json' }) : runResult()
      })
    );
    expect(silent.verdict).toBe('blocked');
    expect(silent.checks.g2_render).toEqual({
      status: 'blocked',
      code: 'DESIGN_RENDER_NO_EVIDENCE'
    });
  });

  it('when drift prints an empty pages list, should block as no evidence', async () => {
    // given: drift exiting 0 with a document whose only stamp is pages: []
    // when: check runs
    // then: the empty stamp never becomes positive evidence
    const root = await createAdoptedApp();
    const result = await checkDesign(
      input(root),
      fakeEngine({
        run: async (kind) =>
          kind === 'drift' ? runResult({ stdout: '{"pages":[]}' }) : runResult()
      })
    );
    expect(result.verdict).toBe('blocked');
    expect(result.checks.g2_render).toEqual({
      status: 'blocked',
      code: 'DESIGN_RENDER_NO_EVIDENCE'
    });
  });
});

describe('Scenario: integration — the advisory grade artifact', () => {
  it('when the grade report is written, should pass without a grade warning', async () => {
    // given: a grade run that writes its report into the out dir
    // when: check reads the evidence with the real reader
    // then: the advisory grade is silent and the pass stands
    const root = await createAdoptedApp();
    const result = await checkDesign(
      input(root, { sessionId: 'session-grade' }),
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

  it('when no grade report is written, should pass and warn that grade is silent', async () => {
    // given: a grade run that exits 0 and writes nothing
    // when: check reads the evidence with the real reader
    // then: the absent report is a warning, never a verdict
    const root = await createAdoptedApp();
    const result = await checkDesign(
      input(root, { sessionId: 'session-silent' }),
      fakeEngine({
        readGrade: readGradeEvidence,
        run: async (kind) => (kind === 'grade' ? runResult({ stdout: '' }) : runResult())
      })
    );
    expect(result.verdict).toBe('pass');
    expect((result.warnings ?? []).join(' ')).toContain('grade produced no evidence');
  });

  it('when the grade run exits nonzero, should skip the advisory warning entirely', async () => {
    // given: a grade run exiting 3 with no report written
    // when: check reads the evidence
    // then: a failed grade run is silent, not a missing-evidence warning
    const root = await createAdoptedApp();
    const result = await checkDesign(
      input(root, { sessionId: 'session-grade-failed' }),
      fakeEngine({
        readGrade: readGradeEvidence,
        run: async (kind) =>
          kind === 'grade' ? runResult({ exitCode: 3, stdout: '' }) : runResult()
      })
    );
    expect(result.verdict).toBe('pass');
    expect((result.warnings ?? []).join(' ')).not.toContain('grade');
  });

  it('when the grade reader throws, should pass with the unreadable warning', async () => {
    // given: a grade run that exits 0 and a reader that throws
    // when: check reads the evidence
    // then: the throw becomes an advisory warning, never a verdict change
    const root = await createAdoptedApp();
    const result = await checkDesign(
      input(root, { sessionId: 'session-grade-throws' }),
      fakeEngine({
        readGrade: async () => {
          throw new Error('EACCES');
        },
        run: async (kind) => (kind === 'grade' ? runResult({ stdout: '' }) : runResult())
      })
    );
    expect(result.verdict).toBe('pass');
    expect((result.warnings ?? []).join(' ')).toContain('could not be read');
  });
});

describe('Scenario: behavior — source-only can never pass', () => {
  it('when --source-only is given, should skip G2 as source-only and block', async () => {
    // given: a clean adopted app and an engine that is unavailable
    // when: check runs with the diagnostic flag
    // then: G2 is skipped(source-only), never pass, and the engine is not consulted
    const root = await createAdoptedApp();
    const result = await checkDesign(
      input(root, { sourceOnly: true }),
      fakeEngine({ availability: UNAVAILABLE })
    );
    expect(result.verdict).toBe('blocked');
    expect(result.checks.g2_render).toEqual({ status: 'skipped', reason: 'source-only' });
  });

  it('when --allow-source-only carries the note, should keep the S1 pass', async () => {
    // given: a clean adopted app and an engine that would block
    // when: the acceptance is supplied
    // then: the S1 path wins, passes, and records the explicit acceptance
    const root = await createAdoptedApp();
    const result = await checkDesign(
      input(root, {
        allowSourceOnly: true,
        acceptNote: 'I accept source-only for this pilot',
        sessionId: 'session-1'
      }),
      fakeEngine({ availability: UNAVAILABLE })
    );
    expect(result.verdict).toBe('pass');
    expect(result.checks.g2_render).toEqual({
      status: 'skipped',
      reason: 'explicitly-accepted'
    });
  });
});

describe('Scenario: integration — --start needs a recorded command', () => {
  it('when --start has no startCommand, should block before starting anything', async () => {
    // given: an adopted app whose engine.json records no start command
    // when: check runs with --start
    // then: the missing command blocks and startServer is never called
    const root = await createAdoptedApp();
    setStartCommand(root, null);
    let starts = 0;
    const result = await checkDesign(
      input(root, { start: true }),
      fakeEngine({
        startServer: async () => {
          starts += 1;
          return { ok: true, server: { url: DEFAULT_URL, stop: async () => {} } };
        }
      })
    );
    expect(result.checks.g2_render).toEqual({
      status: 'blocked',
      code: 'DESIGN_START_COMMAND_MISSING'
    });
    expect(starts).toBe(0);
  });
});
