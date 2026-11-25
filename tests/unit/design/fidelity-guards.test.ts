import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { AVAILABLE } from './_fake-designlang.js';
import { runDesignlang } from '../../../src/services/design/designlang.js';
import {
  buildFidelityDeps,
  type FidelityDeps,
  type RunFidelityInput,
  runFidelity
} from '../../../src/services/design/fidelity.js';

declareDimensions('tests/unit/design/fidelity-guards.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const BASELINE = 'http://127.0.0.1:4311/';
const CANDIDATE = 'http://127.0.0.1:4312/';
const REPORT = { overall: 92, visual: 91, motion: 94, grade: 'A' };

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-fidelity-guards-'));
  roots.push(root);
  return root;
}

/** A stand-in designlang entry that records its argv and writes a report. */
function fakeEngine(root: string, recordArgs: string): string {
  const path = join(root, 'engine.mjs');
  const lines = [
    "import { writeFileSync } from 'node:fs';",
    'const argv = process.argv.slice(2);',
    "const out = argv[argv.indexOf('-o') + 1];",
    `writeFileSync(${JSON.stringify(recordArgs)}, JSON.stringify(argv));`,
    `writeFileSync(out + '/fidelity.json', ${JSON.stringify(JSON.stringify(REPORT))});`,
    'process.exit(0);'
  ];
  writeFileSync(path, lines.join('\n'), 'utf8');
  return path;
}

function depsFor(entryPath: string, overrides: Partial<FidelityDeps> = {}): FidelityDeps {
  return {
    availability: { ...AVAILABLE, entryPath },
    isTrusted: () => true,
    probeStatus: async () => 200,
    run: (input) =>
      runDesignlang({ entryPath: input.entryPath, args: input.args, timeoutMs: input.timeoutMs }),
    ...overrides
  };
}

function inputFor(
  root: string,
  entryPath: string,
  overrides: Partial<RunFidelityInput> = {}
): RunFidelityInput {
  return {
    projectRoot: root,
    appRoot: root,
    sessionId: 'sid-1',
    baselineUrl: BASELINE,
    candidateUrl: CANDIDATE,
    deps: depsFor(entryPath),
    ...overrides
  };
}

describe('Scenario: behavior — a page cannot be compared with itself', () => {
  it('when both URLs normalise to one address, should refuse before spawning', async () => {
    // given: two spellings of the same URL and a fake engine that would record its argv
    // when: the fidelity run is requested
    // then: it is refused as a self-compare and no engine is spawned
    const root = makeRoot();
    const recordArgs = join(root, 'argv.json');
    const entry = fakeEngine(root, recordArgs);

    const result = await runFidelity(
      inputFor(root, entry, { baselineUrl: BASELINE, candidateUrl: 'http://127.0.0.1:4311' })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DESIGN_FIDELITY_SELF_COMPARE');
      expect(result.message).toContain('compared with itself');
    }
    expect(existsSync(recordArgs)).toBe(false);
  });
});

describe('Scenario: integration — the trust contract follows the resolved app root', () => {
  it('when the app lives in web/, should trust loopback from web/design/engine.json', () => {
    // given: a repository root with no design contract and an app contract under web/
    // when: the real deps are built from the resolved app root
    // then: loopback is trusted and the repository-root read is the control that fails
    const root = makeRoot();
    mkdirSync(join(root, 'web', 'design'), { recursive: true });
    writeFileSync(
      join(root, 'web', 'design', 'engine.json'),
      JSON.stringify({ schemaVersion: 1 }),
      'utf8'
    );

    const fromApp = buildFidelityDeps(join(root, 'web'));
    const fromRepo = buildFidelityDeps(root);

    expect(fromApp.isTrusted(BASELINE)).toBe(true);
    expect(fromApp.isTrusted('https://example.com/')).toBe(false);
    expect(fromRepo.isTrusted(BASELINE)).toBe(false);
  });
});

describe('Scenario: render — the run directory is the only write before a spawn', () => {
  it('when a self-compare is refused, should leave no run directory behind', async () => {
    // given: a same-URL pair under a session runtime root
    // when: the run is refused
    // then: no fidelity run directory was created
    const root = makeRoot();
    const entry = fakeEngine(root, join(root, 'argv.json'));

    await runFidelity(
      inputFor(root, entry, { baselineUrl: BASELINE, candidateUrl: 'http://127.0.0.1:4311/' })
    );

    expect(existsSync(join(root, '.peaks', '_runtime', 'sid-1', 'design', 'fidelity'))).toBe(false);
  });
});

describe('Scenario: a11y — a refusal never echoes URL credentials', () => {
  it('when a credentialed URL is untrusted, should name the URL without its userinfo', async () => {
    // given: a URL carrying a username and password that the trust boundary refuses
    // when: the refusal message is composed
    // then: it keeps host and port but drops both credentials
    const root = makeRoot();
    const entry = fakeEngine(root, join(root, 'argv.json'));

    const result = await runFidelity(
      inputFor(root, entry, {
        baselineUrl: 'http://alice:s3cret@127.0.0.1:4311/',
        deps: depsFor(entry, { isTrusted: () => false })
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain('http://127.0.0.1:4311/');
      expect(result.message).not.toContain('s3cret');
      expect(result.message).not.toContain('alice');
    }
  });

  it('when a credentialed URL does not answer, should redact it in the probe refusal', async () => {
    // given: a credentialed URL whose probe answers a non-200 status
    // when: the reachability refusal is composed
    // then: the message names the URL without its userinfo
    const root = makeRoot();
    const entry = fakeEngine(root, join(root, 'argv.json'));

    const result = await runFidelity(
      inputFor(root, entry, {
        baselineUrl: 'http://alice:s3cret@127.0.0.1:4311/',
        deps: depsFor(entry, { probeStatus: async () => 503 })
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DESIGN_FIDELITY_URL_UNREACHABLE');
      expect(result.message).toContain('http://127.0.0.1:4311/');
      expect(result.message).not.toContain('s3cret');
    }
  });

  it('when an untrusted URL carries an ESC sequence, should drop the sequence tail', async () => {
    // given: an untrusted URL whose path carries a CSI clear-screen sequence
    // when: the trust refusal is composed
    // then: the echoed URL loses the whole sequence, not just the ESC byte
    const root = makeRoot();
    const entry = fakeEngine(root, join(root, 'argv.json'));

    const result = await runFidelity(
      inputFor(root, entry, {
        baselineUrl: 'http://192.168.1.5:4311/\u001b[2J',
        deps: depsFor(entry, { isTrusted: () => false })
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DESIGN_URL_UNTRUSTED');
      expect(result.message).not.toContain('[2J');
      expect(result.message).toContain('http://192.168.1.5:4311/');
    }
  });

  it('when an unreachable URL carries an ESC sequence, should drop the sequence tail', async () => {
    // given: a URL whose path carries a CSI sequence and a probe answering 503
    // when: the reachability refusal is composed
    // then: the echoed URL loses the whole sequence, not just the ESC byte
    const root = makeRoot();
    const entry = fakeEngine(root, join(root, 'argv.json'));

    const result = await runFidelity(
      inputFor(root, entry, {
        baselineUrl: 'http://127.0.0.1:4311/\u001b[2J',
        deps: depsFor(entry, { probeStatus: async () => 503 })
      })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DESIGN_FIDELITY_URL_UNREACHABLE');
      expect(result.message).not.toContain('[2J');
      expect(result.message).toContain('http://127.0.0.1:4311/');
    }
  });

  it('when a self-compare URL is very long, should cap the echoed URL', async () => {
    // given: one 300-character URL passed as both the baseline and the candidate
    // when: the self-compare refusal is composed
    // then: the echoed URL is bounded to the evidence-snippet cap
    const root = makeRoot();
    const entry = fakeEngine(root, join(root, 'argv.json'));
    const longUrl = `http://127.0.0.1:4311/${'a'.repeat(300)}`;

    const result = await runFidelity(
      inputFor(root, entry, { baselineUrl: longUrl, candidateUrl: longUrl })
    );

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('DESIGN_FIDELITY_SELF_COMPARE');
      expect(result.message).not.toContain('a'.repeat(150));
      expect(result.message).toContain('…');
    }
  });
});
