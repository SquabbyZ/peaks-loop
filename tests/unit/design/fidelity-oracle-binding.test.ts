// The fidelity oracle's binding and refusal half. Dimensions:
//   - integration: the session artifact write and the loopback static server;
//   - a11y:        exit codes and the named refusal / not-applicable text;
//   - render:      covered in fidelity-oracle.test.ts (the artifact markers);
//   - behavior:    covered in fidelity-oracle.test.ts (pairing and scoring).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import {
  IMPLEMENTATION_URL,
  PROTOTYPE_URL,
  SESSION,
  baseGeometry,
  captureBoth,
  captureIo,
  disposeProjects,
  envelopeOf,
  jsonAt,
  markdownAt,
  tempProject,
  writePrototype,
  type FidelityData
} from './_fidelity-fixtures.js';
import { runDesignFidelity } from '../../../src/cli/commands/design-fidelity-command.js';

declareDimensions(
  'tests/unit/design/fidelity-oracle-binding.test.ts',
  ['integration', 'a11y'],
  [
    { dim: 'render', reason: 'artifact markers are asserted in fidelity-oracle.test.ts' },
    { dim: 'behavior', reason: 'pairing and scoring are asserted in fidelity-oracle.test.ts' }
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

type RunOptions = Parameters<typeof runDesignFidelity>[0];
type ExtraOptions = { prototype?: string; implementation?: string };

function optionsOf(root: string, extra: ExtraOptions = {}): RunOptions {
  return {
    project: root,
    route: '/',
    viewport: '390x844',
    json: true,
    sessionId: SESSION,
    ...extra
  };
}

describe('(integration) the prototype binding', () => {
  it('when the prototype file changes, should refuse the earlier pass as stale', async () => {
    // given: a file prototype recorded by a passing run, then rewritten
    // when: the fidelity command runs again
    // then: the change is stale, no capture runs and the artifact says blocked
    const root = tempProject();
    const prototypePath = writePrototype(root, '<html>version one</html>');
    const first = captureBoth(
      IMPLEMENTATION_URL,
      () => baseGeometry(),
      () => baseGeometry()
    );
    const firstIo = captureIo();
    await runDesignFidelity(
      optionsOf(root, { prototype: prototypePath, implementation: IMPLEMENTATION_URL }),
      firstIo.io,
      first.capture
    );
    const firstData = envelopeOf(firstIo.out()).data as FidelityData;
    expect(firstData.verdict).toBe('pass');
    expect(firstData.prototype?.sha256).toMatch(/^[0-9a-f]{64}$/);
    writePrototype(root, '<html>version two</html>');
    const second = captureBoth(
      IMPLEMENTATION_URL,
      () => baseGeometry(),
      () => baseGeometry()
    );
    const secondIo = captureIo();
    await runDesignFidelity(
      optionsOf(root, { prototype: prototypePath, implementation: IMPLEMENTATION_URL }),
      secondIo.io,
      second.capture
    );
    const secondData = envelopeOf(secondIo.out()).data as FidelityData;
    expect(secondData.verdict).toBe('blocked');
    expect(secondData.reason).toContain('stale');
    expect(second.calls()).toBe(0);
    expect(markdownAt(root)).toContain('design-fidelity: blocked');
    expect(process.exitCode).toBe(2);
  });

  it('when the prior record is not valid JSON, should name the reason and still run', async () => {
    // given: a corrupt artifact where this route's prior record would be
    // when: the fidelity command runs
    // then: it is not blocked, and the run names the unreadable record instead of dropping it
    const root = tempProject();
    const priorPath = join(root, '.peaks', '_runtime', SESSION, 'design', 'fidelity', 'root.json');
    mkdirSync(dirname(priorPath), { recursive: true });
    writeFileSync(priorPath, '{ not json', 'utf8');
    const capture = captureIo();
    await runDesignFidelity(
      optionsOf(root, { prototype: PROTOTYPE_URL, implementation: IMPLEMENTATION_URL }),
      capture.io,
      captureBoth(
        IMPLEMENTATION_URL,
        () => baseGeometry(),
        () => baseGeometry()
      ).capture
    );
    const data = envelopeOf(capture.out()).data as FidelityData;
    expect(data.verdict).toBe('pass');
    expect(data.reason).toContain('prior record is not valid JSON');
    expect(markdownAt(root)).toContain('prior record is not valid JSON');
    expect(process.exitCode).toBe(0);
  });

  it('when a local prototype file is served, should record the loopback service', async () => {
    // given: a prototype file and a running implementation URL
    // when: the fidelity command runs
    // then: the artifact records which loopback URL served the file and that it was loopback
    const root = tempProject();
    const prototypePath = writePrototype(root, '<html>served</html>');
    const capture = captureIo();
    await runDesignFidelity(
      optionsOf(root, { prototype: prototypePath, implementation: IMPLEMENTATION_URL }),
      capture.io,
      captureBoth(
        IMPLEMENTATION_URL,
        () => baseGeometry(),
        () => baseGeometry()
      ).capture
    );
    const document = jsonAt(root) as unknown as FidelityData;
    expect(document.prototype?.served?.loopback).toBe(true);
    expect(document.prototype?.served?.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
  });
});

describe('(a11y) the verdict is a value, never a crash', () => {
  it('when no prototype is supplied, should record not-applicable and exit zero', async () => {
    // given: a route with no prototype
    // when: the fidelity command runs without --prototype
    // then: it writes a not-applicable artifact and exits zero instead of crashing
    const root = tempProject();
    const capture = captureIo();
    await runDesignFidelity(optionsOf(root), capture.io, () => {
      throw new Error('no capture may run for a not-applicable route');
    });
    const envelope = envelopeOf(capture.out());
    expect(envelope.ok).toBe(true);
    expect((envelope.data as FidelityData).verdict).toBe('not-applicable');
    expect(markdownAt(root)).toContain('design-fidelity: not-applicable');
    expect(process.exitCode).toBe(0);
  });

  it('when the implementation is not http(s), should refuse with a named reason', async () => {
    // given: an http(s) prototype but an ftp implementation URL
    // when: the fidelity command runs
    // then: it records blocked with the protocol rule and never captures
    const root = tempProject();
    const capture = captureIo();
    await runDesignFidelity(
      optionsOf(root, { prototype: PROTOTYPE_URL, implementation: 'ftp://127.0.0.1/reports' }),
      capture.io,
      () => {
        throw new Error('no capture may run for an invalid URL');
      }
    );
    const data = envelopeOf(capture.out()).data as FidelityData;
    expect(data.verdict).toBe('blocked');
    expect(data.reason).toContain('http or https');
    expect(markdownAt(root)).toContain('design-fidelity: blocked');
    expect(process.exitCode).toBe(2);
  });
});
