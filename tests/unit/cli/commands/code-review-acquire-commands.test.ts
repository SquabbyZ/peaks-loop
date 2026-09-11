// tests/unit/cli/commands/code-review-acquire-commands.test.ts
//
// `peaks code-review acquire-ocr-18`, driven through the real commander program
// against the acquisition seam replaced at the module boundary.
//
// What is under test is the WIRING, not the installer: that the verb reaches
// the seam at all, that it does NOT reach it when there is nothing to fetch,
// and what it does with each outcome. `detect-ocr-18` is mocked too, because
// the interesting states (missing-now / still-missing-after) cannot be produced
// on a machine whose npm cache is outside the test's control.
//
// The pair under one roof is the point: an acquisition that exits 0 without
// landing the package must NOT be reported as success — that is the same R7
// trap `peaks web install` closes by re-probing instead of trusting the exit
// code.
//
// Dimensions covered:
//   - render:      the JSON envelope on stdout, and the shell note inside it
//   - behavior:    the no-op shortcut, and the re-probe after a successful install
//   - a11y:        the exit code on every non-ready outcome
//   - integration: not applicable (every outside boundary is a module seam here)

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';

declareDimensions('tests/unit/cli/commands/code-review-acquire-commands.test.ts', [
  'render',
  'behavior',
  'a11y',
], [{ dim: 'integration', reason: 'both outside boundaries (npm exec, the npx probe) are module seams here' }]);

/**
 * The seam: `acquireOcr18` really spawns `npx --package … -- ocr version`,
 * which installs a package from the network and is nobody's test side effect.
 * The constants beside it stay REAL — the warning under test is the shipped one.
 */
const seam = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
  outcome: null as unknown,
}));

const detectSeam = vi.hoisted(() => ({ states: [] as string[], calls: 0 }));

vi.mock('../../../../src/services/lint/ocr-18-acquire.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/services/lint/ocr-18-acquire.js')>();
  return {
    ...actual,
    acquireOcr18: (options: Record<string, unknown>) => {
      seam.calls.push(options);
      return Promise.resolve(seam.outcome);
    },
  };
});

vi.mock('../../../../src/services/lint/detect-ocr-18.js', () => ({
  detectOcr18: () => {
    detectSeam.calls += 1;
    const state = detectSeam.states.shift() ?? 'ready';
    return {
      state,
      npxAvailable: true,
      package: '@alibaba-group/open-code-review@1.8.9',
      warnings: state === 'ready' ? [] : ['could not resolve @alibaba-group/open-code-review@1.8.9'],
      nextActions: state === 'ready' ? [] : ['Run `peaks code-review acquire-ocr-18` to fetch the reviewer.'],
    };
  },
}));

import { registerCodeReviewCommands } from '../../../../src/cli/commands/code-review-commands.js';
import { ACQUIRE_NETWORK_WARNING } from '../../../../src/services/lint/ocr-18-acquire.js';

const SHELL = {
  kind: 'powershell',
  path: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  note: 'PowerShell: C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe — Git Bash is absent on this host',
};

interface Envelope {
  ok: boolean;
  code?: string;
  data: Record<string, unknown>;
  warnings: string[];
  nextActions: string[];
}

function envelope(captured: ReturnType<typeof makeCapturedIo>): Envelope {
  return JSON.parse(captured.captured.text()) as Envelope;
}

async function acquire(asJson = true): Promise<ReturnType<typeof makeCapturedIo>> {
  const captured = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerCodeReviewCommands(program, captured.io);
  await program.parseAsync(['code-review', 'acquire-ocr-18', ...(asJson ? ['--json'] : [])], {
    from: 'user',
  });
  return captured;
}

beforeEach(() => {
  seam.calls.length = 0;
  seam.outcome = {
    ok: true,
    code: '',
    message: '',
    shell: SHELL,
    durationMs: 12,
    warnings: [ACQUIRE_NETWORK_WARNING],
  };
  detectSeam.states.length = 0;
  detectSeam.calls = 0;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = 0;
});

describe('behavior — nothing to fetch', () => {
  it('should report a no-op without reaching the installer when the package already resolves', async () => {
    // given: the probe already says ready
    detectSeam.states.push('ready');

    // when: the verb runs
    const captured = await acquire();

    // then: the envelope says nothing was acquired, and the installer was never
    // called — acquisition is not a tax paid on every invocation
    const body = envelope(captured);
    expect(body.ok).toBe(true);
    expect(body.data['acquired']).toBe(false);
    expect(seam.calls).toEqual([]);
    expect(body.warnings).toEqual([]);
  });
});

describe('render — the acquisition envelope', () => {
  it('should report the shell that ran it, and what was fetched', async () => {
    // given: missing before the install, ready after it
    detectSeam.states.push('ocr18-missing', 'ready');

    // when: the verb runs
    const captured = await acquire();

    // then: the outcome is on the envelope
    const body = envelope(captured);
    expect(body.ok).toBe(true);
    expect(body.data['acquired']).toBe(true);
    expect(body.data['state']).toBe('ready');
    // then: which shell ran it is REPORTED — a silent substitute is the failure
    // mode this verb exists to avoid
    expect(body.data['shell']).toBe('powershell');
    expect(body.data['shellNote']).toContain('Git Bash is absent');
    expect(body.warnings).toEqual([ACQUIRE_NETWORK_WARNING]);
  });
});

describe('behavior — the JSON flag threaded to the installer', () => {
  it('should tell the installer a JSON envelope is coming, so stdout stays clean', async () => {
    // given: missing before, ready after
    detectSeam.states.push('ocr18-missing', 'ready');

    // when: the verb runs with --json
    await acquire();

    // then: the installer knows npm must not write into that envelope
    expect(seam.calls[0]).toEqual({ asJson: true });
  });

  it('should NOT claim --json when the caller is in human mode', async () => {
    // given: missing before, ready after
    detectSeam.states.push('ocr18-missing', 'ready');

    // when: the verb runs without --json
    await acquire(false);

    // then: the installer keeps its stdout, so a human sees it
    expect(seam.calls[0]).toEqual({ asJson: false });
  });
});

describe('a11y — an acquisition that exits 0 without landing the package', () => {
  it('should re-probe and refuse to call it a success', async () => {
    // given: the installer exits 0, and the package still does not resolve —
    // a filtered registry, or a pin landing in a different cache root
    detectSeam.states.push('ocr18-missing', 'ocr18-missing');

    // when: the verb runs
    const captured = await acquire();

    // then: R7 — the exit code is not evidence; the re-probe is
    const body = envelope(captured);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('OCR18_ACQUIRE_INCOMPLETE');
    expect(process.exitCode).toBe(1);
  });
});

describe('a11y — a failed acquisition', () => {
  it('should pass the installer failure through as a named code and exit non-zero', async () => {
    // given: the lock is held elsewhere
    detectSeam.states.push('ocr18-missing');
    seam.outcome = {
      ok: false,
      code: 'OCR18_ACQUIRE_BUSY',
      message: 'another OCR 1.8.x acquisition is already running on this machine',
      shell: SHELL,
      durationMs: 1,
      warnings: [],
    };

    // when: the verb runs
    const captured = await acquire();

    // then: the code is the installer's own, the shell still rides along, and
    // the caller is handed a next step rather than a stack trace
    const body = envelope(captured);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('OCR18_ACQUIRE_BUSY');
    expect(body.data['shellNote']).toContain('Git Bash is absent');
    expect(body.nextActions.join(' ')).toContain('acquire-ocr-18');
    expect(process.exitCode).toBe(1);
  });
});
