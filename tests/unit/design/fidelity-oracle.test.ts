// The fidelity oracle's scoring half. Dimensions:
//   - render:   the artifact pair and its gate-readable markers;
//   - behavior: pairing, the three assertions and the per-viewport verdict;
//   - integration: covered in fidelity-oracle-binding.test.ts (the artifact write
//     and the loopback static server);
//   - a11y:     covered in fidelity-oracle-binding.test.ts (exit codes, refusals).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  IMPLEMENTATION_URL,
  PROTOTYPE_URL,
  SESSION,
  TOKENS,
  baseGeometry,
  captureBoth,
  captureIo,
  disposeProjects,
  envelopeOf,
  markdownAt,
  roomierGeometry,
  tempProject,
  withoutObject,
  type FidelityData
} from './_fidelity-fixtures.js';
import { runDesignFidelity } from '../../../src/cli/commands/design-fidelity-command.js';

declareDimensions(
  'tests/unit/design/fidelity-oracle.test.ts',
  ['render', 'behavior'],
  [
    {
      dim: 'integration',
      reason: 'artifact writes and the static server live in the binding test'
    },
    { dim: 'a11y', reason: 'exit codes and refusal text live in the binding test' }
  ]
);

let savedExitCode: string | number | null | undefined;

beforeEach(() => {
  savedExitCode = process.exitCode;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = savedExitCode;
  disposeProjects();
});

describe('(render) the fidelity artifact', () => {
  it('when the implementation is reused as the prototype, should pass every viewport at 100%', async () => {
    // given: one page captured twice and the same loopback URL for both inputs
    // when: the fidelity command runs at two viewports
    // then: every viewport scores 1 and the artifact carries the pass marker and a sha256
    expect(TOKENS.length).toBeGreaterThanOrEqual(3);
    const root = tempProject();
    const capture = captureIo();
    await runDesignFidelity(
      {
        project: root,
        route: '/',
        prototype: IMPLEMENTATION_URL,
        implementation: IMPLEMENTATION_URL,
        viewport: '390x844,1280x800',
        json: true,
        sessionId: SESSION
      },
      capture.io,
      captureBoth(
        IMPLEMENTATION_URL,
        () => baseGeometry(),
        () => baseGeometry()
      ).capture
    );
    const envelope = envelopeOf(capture.out());
    expect(envelope.ok).toBe(true);
    const data = envelope.data as FidelityData;
    expect(data.verdict).toBe('pass');
    expect(data.reason).toBeNull();
    expect(data.viewports).toHaveLength(2);
    for (const viewport of data.viewports) {
      expect(viewport.verdict).toBe('pass');
      expect(viewport.score).toBe(1);
      expect(viewport.anchorScore).toBe(1);
      expect(viewport.tokenScore).toBe(1);
      expect(viewport.paired).toBe(3);
      expect(viewport.missing).toBe(0);
      expect(viewport.extra).toBe(0);
    }
    const markdown = markdownAt(root);
    expect(markdown).toContain('schemaVersion: 1');
    expect(markdown).toContain('## Fidelity');
    expect(markdown).toContain('design-fidelity: pass');
    expect(markdown).toMatch(/sha256: [0-9a-f]{64}/);
    expect(process.exitCode).toBe(0);
  });
});

describe('(behavior) pairing and the three assertions', () => {
  it('when one spacing token changes, should name the token mismatch and fail', async () => {
    // given: a 16px-parent prototype and a 24px-parent implementation
    // when: the fidelity command runs
    // then: the token score collapses, a named mismatch is recorded and the route fails
    const root = tempProject();
    const capture = captureIo();
    await runDesignFidelity(
      {
        project: root,
        route: '/',
        prototype: PROTOTYPE_URL,
        implementation: IMPLEMENTATION_URL,
        viewport: '390x844',
        json: true,
        sessionId: SESSION
      },
      capture.io,
      captureBoth(
        IMPLEMENTATION_URL,
        () => baseGeometry(),
        () => roomierGeometry()
      ).capture
    );
    const data = envelopeOf(capture.out()).data as FidelityData;
    expect(data.verdict).toBe('fail');
    const viewport = data.viewports[0];
    expect(viewport?.verdict).toBe('fail');
    expect(viewport?.tokenScore).toBe(0);
    expect(viewport?.score).toBe(0.5);
    expect(data.failures).toContainEqual({
      viewport: '390x844',
      failureClass: 'token-mismatch',
      objectId: 'title',
      property: 'spacing-token',
      expected: 'space.md',
      actual: 'space.roomy'
    });
    expect(markdownAt(root)).toContain('design-fidelity: fail');
    expect(markdownAt(root)).toContain('token-mismatch');
    expect(process.exitCode).toBe(1);
  });

  it('when the implementation drops one object marker, should name the missing object', async () => {
    // given: a prototype with three objects and an implementation missing the body marker
    // when: the fidelity command runs
    // then: the missing object is a named failure and the route fails with no averaging
    const root = tempProject();
    const capture = captureIo();
    await runDesignFidelity(
      {
        project: root,
        route: '/',
        prototype: PROTOTYPE_URL,
        implementation: IMPLEMENTATION_URL,
        viewport: '390x844',
        json: true,
        sessionId: SESSION
      },
      capture.io,
      captureBoth(
        IMPLEMENTATION_URL,
        () => baseGeometry(),
        () => withoutObject(baseGeometry(), 'body')
      ).capture
    );
    const data = envelopeOf(capture.out()).data as FidelityData;
    expect(data.verdict).toBe('fail');
    expect(data.viewports[0]?.missing).toBe(1);
    expect(data.failures).toContainEqual({
      viewport: '390x844',
      failureClass: 'missing-object',
      objectId: 'body',
      property: 'data-peaks-object',
      expected: 'present',
      actual: 'absent'
    });
    expect(process.exitCode).toBe(1);
  });
});
