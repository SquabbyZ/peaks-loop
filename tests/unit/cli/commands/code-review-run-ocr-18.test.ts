// tests/unit/cli/commands/code-review-run-ocr-18.test.ts
//
// `peaks code-review run-ocr-18`, driven through the real commander program with
// the two run seams (single-language and multi-language) replaced at their
// module boundaries. The routing table, `parseLanguageSelection` and the option
// parsing stay REAL — the point under test is the surface: which seam a flag
// combination reaches, what the envelope says when it does not reach one, and
// that `--language` keeps working.
//
// Dimensions covered:
//   - render:      the JSON envelope for every outcome, including the "nothing
//                  was reviewed" one that must not read as a clean review
//   - behavior:    flag precedence, alias resolution, delegation refusal
//   - a11y:        not applicable (a hidden machine-facing verb, no terminal UI)
//   - integration: not applicable (the OCR runtime is a module seam here)

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';

declareDimensions(
  'tests/unit/cli/commands/code-review-run-ocr-18.test.ts',
  ['render', 'behavior'],
  [
    { dim: 'a11y', reason: 'hidden machine-facing verb with no terminal UI' },
    {
      dim: 'integration',
      reason: 'the OCR runtime and the git range are module seams here'
    }
  ]
);

/** The two run seams. The constants and the selector parser stay real. */
const seams = vi.hoisted(() => {
  const state: {
    single: Array<Record<string, unknown>>;
    multi: Array<Record<string, unknown>>;
    singleResult: unknown;
    multiImpl: ((options: Record<string, unknown>) => unknown) | null;
  } = { single: [], multi: [], singleResult: null, multiImpl: null };
  return state;
});

const detector = vi.hoisted(() => ({ states: [] as string[], calls: 0 }));

/**
 * Only `runOcr18` is replaced; everything else the command layer reads
 * (`OCR_18_PACKAGE`, which the acquire path also uses) stays real.
 */
vi.mock('../../../../src/services/lint/ocr-multilang-adapter.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../src/services/lint/ocr-multilang-adapter.js'
  );
  return {
    ...actual,
    runOcr18: (options: Record<string, unknown>) => {
      seams.single.push(options);
      return seams.singleResult;
    }
  };
});

vi.mock('../../../../src/services/lint/ocr-18-multi.js', () => ({
  runOcr18Multi: (options: Record<string, unknown>) => {
    seams.multi.push(options);
    return seams.multiImpl?.(options);
  }
}));

vi.mock('../../../../src/services/lint/detect-ocr-18.js', () => ({
  detectOcr18: () => {
    detector.calls += 1;
    const state = detector.states.shift() ?? 'ready';
    return {
      state,
      npxAvailable: true,
      package: '@alibaba-group/open-code-review@1.13.1',
      warnings: state === 'ready' ? [] : ['could not resolve the pinned package'],
      nextActions: state === 'ready' ? [] : ['Run `peaks code-review acquire-ocr-18` to fetch it.']
    };
  }
}));

/**
 * The delegation seams. Phase 1 is its own module (covered by
 * `code-review-ocr-delegate.test.ts`); here the point is which seam a flag
 * combination reaches. The preview verb reads the payload module, so both are
 * replaced rather than allowed to spawn.
 */
const delegation = vi.hoisted(
  (): { packets: Array<Record<string, unknown>>; preview: unknown } => ({
    packets: [],
    preview: null
  })
);

vi.mock('../../../../src/cli/commands/code-review-ocr-delegate.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../src/cli/commands/code-review-ocr-delegate.js'
  );
  return {
    ...actual,
    runDelegatePacket: (_io: unknown, options: Record<string, unknown>) => {
      delegation.packets.push(options);
    }
  };
});

vi.mock('../../../../src/services/lint/ocr-18-delegate-payload.js', async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    '../../../../src/services/lint/ocr-18-delegate-payload.js'
  );
  return {
    ...actual,
    runDelegatePreview: () => delegation.preview
  };
});

import { registerCodeReviewCommands } from '../../../../src/cli/commands/code-review-commands.js';

interface Envelope {
  ok: boolean;
  code?: string;
  message?: string;
  data: Record<string, unknown>;
  warnings: string[];
  nextActions: string[];
}

function envelope(captured: ReturnType<typeof makeCapturedIo>): Envelope {
  return JSON.parse(captured.captured.text()) as Envelope;
}

async function run(args: string[]): Promise<ReturnType<typeof makeCapturedIo>> {
  const captured = makeCapturedIo();
  const program = new Command();
  program.exitOverride();
  registerCodeReviewCommands(program, captured.io);
  await program.parseAsync(['code-review', ...args], { from: 'user' });
  return captured;
}

/** A multi result shaped like the real one, for the envelopes that read it. */
function multiResult(overrides: Record<string, unknown> = {}) {
  return {
    state: 'ok',
    detected: ['go', 'python'],
    languages: [
      { language: 'go', findings: [], count: 0 },
      { language: 'python', findings: [], count: 1 }
    ],
    changedFileCount: 2,
    unsupportedFiles: ['src/c.mts'],
    unroutedFindings: [],
    summary: { total: 1, bySeverity: { error: 1, warn: 0, info: 0 }, byLanguage: {} },
    durationMs: 5,
    rawOutput: '{}',
    ...overrides
  };
}

beforeEach(() => {
  seams.single.length = 0;
  seams.multi.length = 0;
  seams.singleResult = {
    state: 'ok',
    findings: [],
    summary: { total: 0, bySeverity: { error: 0, warn: 0, info: 0 }, byLanguage: {} },
    durationMs: 1,
    rawOutput: '{"comments":[]}'
  };
  seams.multiImpl = () => multiResult();
  delegation.packets.length = 0;
  delegation.preview = {
    ok: true,
    preview: {
      schema_version: '1',
      mode: 'range',
      repository: 'repo',
      total_files: 3,
      reviewable_count: 1,
      excluded_count: 2,
      total_insertions: 9,
      total_deletions: 1,
      reviewable_files: [{ path: 'src/a.ts', status: 'modified', insertions: 9, deletions: 1 }],
      excluded_files: []
    }
  };
  detector.states.length = 0;
  detector.calls = 0;
  process.exitCode = 0;
});

afterEach(() => {
  process.exitCode = 0;
});

describe('behavior — the single-language path is unchanged', () => {
  it('should still reach runOcr18 for --language and report its envelope', async () => {
    // given: a routed language
    // when: the verb runs with --language
    const captured = await run(['run-ocr-18', '--language', 'go', '--json']);

    // then: the single run seam was used, with the language verbatim
    expect(seams.single).toHaveLength(1);
    expect(seams.single[0]).toMatchObject({ language: 'go' });
    expect(seams.multi).toEqual([]);
    expect(envelope(captured).ok).toBe(true);
  });

  it('should refuse an unrouted --language without spawning anything', async () => {
    // given: a language the table does not route
    // when: the verb runs
    const captured = await run(['run-ocr-18', '--language', 'cobol', '--json']);

    // then: it is refused and neither seam is reached
    const body = envelope(captured);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('LANGUAGE_UNSUPPORTED');
    expect(seams.single).toEqual([]);
  });
});

describe('behavior — flag precedence', () => {
  it('should refuse --language together with --languages, naming both', async () => {
    // given: both selectors at once
    // when: the verb runs
    const captured = await run(['run-ocr-18', '--language', 'go', '--languages', 'auto', '--json']);

    // then: the refusal says which pair conflicted, and nothing was reviewed
    const body = envelope(captured);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('LANGUAGE_FLAGS_CONFLICT');
    expect(body.message).toContain('--language');
    expect(body.message).toContain('--languages');
    expect(seams.single).toEqual([]);
    expect(seams.multi).toEqual([]);
  });

  it('should route --delegate --languages auto to the packet phase, not the review path', async () => {
    // given: the documented packet invocation
    // when: the verb runs
    await run(['run-ocr-18', '--delegate', '--languages', 'auto', '--json']);

    // then: delegation owns the run — neither review seam is reached
    expect(delegation.packets).toHaveLength(1);
    expect(delegation.packets[0]).toMatchObject({ languages: 'auto', delegate: true });
    expect(seams.multi).toEqual([]);
    expect(seams.single).toEqual([]);
  });

  it('should refuse an unknown language token, naming it', async () => {
    // given: a token that is neither a language nor an extension
    // when: the verb runs
    const captured = await run(['run-ocr-18', '--languages', 'go,cobol', '--json']);

    // then: the refusal names the token and the seam is never reached
    const body = envelope(captured);
    expect(body.code).toBe('LANGUAGE_UNSUPPORTED');
    expect(body.message).toContain('cobol');
    expect(seams.multi).toEqual([]);
  });
});

describe('render — the multi-language envelopes', () => {
  it('should auto-detect from the range and pass the range through', async () => {
    // given: the documented auto invocation
    // when: the verb runs
    const captured = await run([
      'run-ocr-18',
      '--languages',
      'auto',
      '--from',
      'main',
      '--to',
      'HEAD',
      '--json'
    ]);

    // then: auto means no explicit list, and the range is forwarded
    expect(seams.multi).toHaveLength(1);
    expect(seams.multi[0]).toMatchObject({ from: 'main', to: 'HEAD' });
    expect(seams.multi[0]).not.toHaveProperty('languages');
    // then: per-language counts are on the envelope
    const body = envelope(captured);
    expect(body.ok).toBe(true);
    expect(body.data['languages']).toBeDefined();
    expect(body.data['detected']).toEqual(['go', 'python']);
    expect(body.data['unsupportedFiles']).toEqual(['src/c.mts']);
  });

  it('should resolve the short explicit list through the routing table', async () => {
    // given: `ts,js,go` — the documented shape
    // when: the verb runs
    await run(['run-ocr-18', '--languages', 'ts,js,go', '--json']);

    // then: each token is a real language name by the time it reaches the seam
    expect(seams.multi[0]).toMatchObject({ languages: ['typescript', 'javascript', 'go'] });
  });

  it('should say nothing was reviewed when the range has no routed language', async () => {
    // given: a range whose only files are unreviewable
    seams.multiImpl = () =>
      multiResult({
        state: 'no-routed-language',
        detected: [],
        languages: [],
        changedFileCount: 3,
        unsupportedFiles: ['README.md', 'src/a.mts', 'src/b.yaml'],
        summary: null
      });

    // when: the verb runs
    const captured = await run(['run-ocr-18', '--languages', 'auto', '--json']);

    // then: it is not an error, but it says in words that no review happened
    const body = envelope(captured);
    expect(body.ok).toBe(true);
    expect(body.data['state']).toBe('no-routed-language');
    expect(body.warnings.join(' ')).toContain('No routed language');
    expect(body.warnings.join(' ')).toContain('not a clean review');
  });

  it('should report OCR unavailable with the detector state, never as a zero', async () => {
    // given: the review could not run, and the detector says the binary is missing
    seams.multiImpl = () =>
      multiResult({ state: 'ocr18-missing', languages: [], summary: null, rawOutput: 'ENOENT' });
    detector.states.push('binary-missing');

    // when: the verb runs
    const captured = await run(['run-ocr-18', '--languages', 'auto', '--json']);

    // then: a failure envelope carries the detector's own state …
    const body = envelope(captured);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('OCR18_MISSING');
    expect(body.data['detector']).toMatchObject({ state: 'binary-missing' });
    // … and says plainly that nothing was reviewed
    expect(body.nextActions.join(' ')).toContain('Nothing was reviewed');
  });

  it('should report an unreadable git range as a failure, not as nothing to review', async () => {
    // given: detection throws
    seams.multiImpl = () => {
      throw new Error('git diff --name-only failed: fatal: not a git repository');
    };

    // when: the verb runs
    const captured = await run(['run-ocr-18', '--languages', 'auto', '--json']);

    // then: the failure is named, and no zero is implied
    const body = envelope(captured);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('OCR18_DETECT_FAILED');
    expect(body.message).toContain('not a git repository');
  });
});

describe('behavior — the delegation preview is a selection preview', () => {
  it('should print the parsed selection and never reach the review seam', async () => {
    // given: a delegation preview
    // when: the preview verb runs
    const captured = await run(['ocr-18-delegate-preview', '--json']);

    // then: the review seam is not reached, and the selection is on the envelope
    expect(seams.single).toEqual([]);
    const body = envelope(captured);
    expect(body.ok).toBe(true);
    expect(body.data['reviewable_count']).toBe(1);
    expect(body.nextActions.join(' ')).toContain('no review ran');
  });

  it('should report a non-preview payload as a failure, not as a clean zero', async () => {
    // given: the CLI emitted something that is not a delegation spec
    delegation.preview = {
      ok: false,
      state: 'execution-failed',
      rawOutput: 'no reviewable_files[]'
    };

    // when: the preview verb runs
    const captured = await run(['ocr-18-delegate-preview', '--json']);

    // then: it is a failure naming the state, with the raw reason kept
    const body = envelope(captured);
    expect(body.ok).toBe(false);
    expect(body.code).toBe('EXECUTION_FAILED');
    expect(body.data['rawOutput']).toContain('reviewable_files');
  });
});
