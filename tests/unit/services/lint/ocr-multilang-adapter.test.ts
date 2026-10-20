import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildOcr18Args,
  LANGUAGE_EXTENSIONS,
  OCR_18_LANGUAGES,
  OCR_18_PACKAGE,
  runOcr18
} from '../../../../src/services/lint/ocr-multilang-adapter.js';

interface ChildProcessMock {
  spawnSync: ReturnType<typeof vi.fn>;
}

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn()
}));

/**
 * The npx resolver is mocked to a sentinel so the regression this guards —
 * spawning the bare `npx` PATH shim instead of the resolved invocation — is
 * observable on every platform, not only on Windows.
 */
const { SENTINEL_COMMAND, SENTINEL_PREFIX } = vi.hoisted(() => ({
  SENTINEL_COMMAND: '/sentinel/node',
  SENTINEL_PREFIX: ['/sentinel/npx-cli.js']
}));

vi.mock('../../../../src/services/lint/npx-resolver.js', () => ({
  resolveNpxInvocation: (npxArgs: readonly string[]) => ({
    command: SENTINEL_COMMAND,
    args: [...SENTINEL_PREFIX, ...npxArgs],
    baseEnv: {}
  }),
  resolveNpmInvocation: (npmArgs: readonly string[]) => ({
    command: SENTINEL_COMMAND,
    args: [...SENTINEL_PREFIX, ...npmArgs],
    baseEnv: {}
  })
}));

const { spawnSync } = await import('node:child_process');
const childMock = { spawnSync } as unknown as ChildProcessMock;

type SpawnResult = {
  status: number | null;
  stdout: string;
  stderr?: string;
  signal?: NodeJS.Signals;
  error?: NodeJS.ErrnoException;
};

function queueSpawnSequence(results: SpawnResult[]): void {
  const queue = [...results];
  childMock.spawnSync.mockImplementation(() => {
    if (queue.length === 0) {
      return { status: 0, stdout: '', stderr: '' } as SpawnResult;
    }
    return queue.shift() as SpawnResult;
  });
}

describe('runOcr18', () => {
  beforeEach(() => {
    childMock.spawnSync.mockReset();
  });

  afterEach(() => {
    childMock.spawnSync.mockReset();
  });

  it('when ocr18 is missing, should return state ocr18-missing', () => {
    // given: npx fails to spawn the ocr package
    queueSpawnSequence([
      {
        status: null,
        stdout: '',
        error: Object.assign(new Error('spawn npx ENOENT'), {
          code: 'ENOENT'
        } as NodeJS.ErrnoException)
      }
    ]);

    // when: runOcr18 is invoked
    const result = runOcr18({ cwd: process.cwd(), language: 'python' });

    // then: state must be ocr18-missing
    expect(result.state).toBe('ocr18-missing');
    expect(result.findings).toEqual([]);
  });

  it('when the spawn itself fails, should keep the launch error in rawOutput', () => {
    // given: the launch fails before ocr produces any output at all
    queueSpawnSequence([
      {
        status: null,
        stdout: '',
        stderr: '',
        error: Object.assign(new Error('spawn EINVAL'), { code: 'EINVAL' } as NodeJS.ErrnoException)
      }
    ]);

    // when: runOcr18 is invoked
    const result = runOcr18({ cwd: process.cwd(), language: 'ruby' });

    // then: the reason is never silently dropped (stdout/stderr are both empty)
    expect(result.rawOutput).toContain('spawn EINVAL');
  });

  it('when runOcr18 spawns ocr, should go through the npx resolver (never the bare shim)', () => {
    // given: a successful review call
    queueSpawnSequence([{ status: 0, stdout: '{"comments":[]}' }]);

    // when: runOcr18 is invoked
    runOcr18({ cwd: process.cwd(), language: 'go' });

    // then: the resolved invocation is used, with the ocr argv appended to it
    const call = childMock.spawnSync.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(call[0]).toBe(SENTINEL_COMMAND);
    expect(call[0]).not.toBe('npx');
    expect(call[1].slice(0, SENTINEL_PREFIX.length)).toEqual(SENTINEL_PREFIX);
    expect(call[1]).toEqual(
      expect.arrayContaining(['--package', OCR_18_PACKAGE, '--', 'ocr', 'review'])
    );
    // then: the console window is hidden — an `ocr review` can run for minutes
    expect(call[2]).toMatchObject({ encoding: 'utf8', windowsHide: true });
  });

  it('when language is unsupported (e.g. cobol), should return language-unsupported', () => {
    // given: an unsupported language

    // when: runOcr18 is invoked
    const result = runOcr18({ cwd: process.cwd(), language: 'cobol' });

    // then: the wrapper refuses without spawning npx
    expect(result.state).toBe('language-unsupported');
    expect(childMock.spawnSync).not.toHaveBeenCalled();
  });

  it('when language=python and delegate=true, should spawn ocr delegate preview', () => {
    // given: a successful delegate-preview call
    queueSpawnSequence([{ status: 0, stdout: '{}' }]);

    // when: runOcr18 is invoked in delegation mode
    runOcr18({ cwd: process.cwd(), language: 'python', delegate: true });

    // then: the args include delegate preview
    const call = childMock.spawnSync.mock.calls[0] as [string, string[]];
    expect(call[0]).not.toBe('npx');
    expect(call[1]).toContain('delegate');
    expect(call[1]).toContain('preview');
  });

  it('when language=java and from=main and to=HEAD, should spawn ocr review without a language flag', () => {
    // given: a successful review call
    queueSpawnSequence([{ status: 0, stdout: '{"comments":[]}' }]);

    // when: runOcr18 is invoked with the java route
    runOcr18({ cwd: process.cwd(), language: 'java', from: 'main', to: 'HEAD' });

    // then: the args pin the package, the review command, and the range flags
    const call = childMock.spawnSync.mock.calls[0] as [string, string[]];
    expect(call[1]).toContain(OCR_18_PACKAGE);
    expect(call[1]).toContain('review');
    expect(call[1]).toContain('--from');
    expect(call[1]).toContain('main');
    expect(call[1]).toContain('--to');
    expect(call[1]).toContain('HEAD');
    expect(call[1]).toContain('--format');
    expect(call[1]).toContain('json');
    // then: the real binary has no `--filter-language` flag — emitting it made
    // every non-delegate run fail with `Error: unknown flag`
    expect(call[1]).not.toContain('--filter-language');
  });

  it('when ocr18 emits the real 1.13.1 envelope, should map comments onto findings', () => {
    // given: a verbatim `ocr review --format json` payload from 1.13.1
    const payload = {
      status: 'success',
      llm: { provider: 'anthropic', model: 'claude-opus-4-6' },
      trace_id: 'trace-1',
      summary: { files_reviewed: 3, total_tokens: 900 },
      tool_calls: { total: 4, failed: 0 },
      comments: [
        {
          path: 'src/app/main.py',
          content: 'SQL string concatenation',
          start_line: 12,
          end_line: 14,
          severity: 'critical',
          category: 'security'
        },
        {
          path: 'src/app/legacy.py',
          content: 'Deep nesting',
          start_line: 3,
          end_line: 40,
          severity: 'high',
          category: 'maintainability'
        },
        {
          path: 'src/app/util.py',
          content: 'Missing None check',
          start_line: 24,
          end_line: 24,
          severity: 'medium',
          category: 'bug'
        },
        {
          path: 'src/app/old.py',
          content: 'Magic number',
          start_line: 7,
          end_line: 7,
          severity: 'low'
        },
        {
          path: 'src/app/handler.ts',
          content: 'Unchecked cast',
          start_line: 9,
          end_line: 9,
          severity: 'high',
          category: 'bug'
        }
      ],
      warnings: [],
      session_id: 'session-1'
    };
    queueSpawnSequence([{ status: 0, stdout: JSON.stringify(payload) }]);

    // when: runOcr18 is invoked for python
    const result = runOcr18({ cwd: process.cwd(), language: 'python' });

    // then: only the requested language's extensions survive, mapped onto Ocr18Finding
    expect(result.state).toBe('ok');
    expect(result.findings).toEqual([
      {
        filePath: 'src/app/main.py',
        line: 12,
        ruleId: 'security',
        severity: 'error',
        message: 'SQL string concatenation'
      },
      {
        filePath: 'src/app/legacy.py',
        line: 3,
        ruleId: 'maintainability',
        severity: 'error',
        message: 'Deep nesting'
      },
      {
        filePath: 'src/app/util.py',
        line: 24,
        ruleId: 'bug',
        severity: 'warn',
        message: 'Missing None check'
      },
      {
        filePath: 'src/app/old.py',
        line: 7,
        ruleId: null,
        severity: 'info',
        message: 'Magic number'
      }
    ]);
    expect(result.summary?.total).toBe(4);
    expect(result.summary?.bySeverity).toEqual({ error: 2, warn: 1, info: 1 });
    expect(result.summary?.byLanguage.python).toBe(4);
  });

  it('when comments is absent or not an array, should report zero findings rather than fail', () => {
    // given: one run with a non-array comments value, one with no comments key
    queueSpawnSequence([
      { status: 0, stdout: '{"status":"success","comments":"nope"}' },
      { status: 0, stdout: '{"status":"success","summary":{}}' }
    ]);

    // when: runOcr18 is invoked twice
    const notArray = runOcr18({ cwd: process.cwd(), language: 'go' });
    const absent = runOcr18({ cwd: process.cwd(), language: 'go' });

    // then: neither is a parse failure — both are a clean review
    expect(notArray.state).toBe('ok');
    expect(notArray.findings).toEqual([]);
    expect(absent.state).toBe('ok');
    expect(absent.findings).toEqual([]);
    expect(absent.summary?.total).toBe(0);
  });

  it('when stdout is not valid JSON, should return execution-failed with the raw output', () => {
    // given: stdout that cannot be parsed, and no stderr to fall back on
    queueSpawnSequence([{ status: 0, stdout: 'not json', stderr: '' }]);

    // when: runOcr18 is invoked
    const result = runOcr18({ cwd: process.cwd(), language: 'php' });

    // then: the parse failure stays visible as execution-failed
    expect(result.state).toBe('execution-failed');
    expect(result.findings).toEqual([]);
    expect(result.rawOutput).toContain('not json');
  });

  it('when ocr18 exits 1 with stderr, should return execution-failed', () => {
    // given: the pinned ocr exits non-zero with stderr
    queueSpawnSequence([{ status: 1, stdout: '', stderr: 'review rejected' }]);

    // when: runOcr18 is invoked
    const result = runOcr18({ cwd: process.cwd(), language: 'go' });

    // then: state must be execution-failed
    expect(result.state).toBe('execution-failed');
    expect(result.findings).toEqual([]);
  });
});

describe('OCR_18_LANGUAGES', () => {
  it('when enumerated, should expose all 8 supported languages', () => {
    // given: the supported language list
    // when: its length is computed
    // then: it must cover the 8 PRD-mandated languages
    expect(OCR_18_LANGUAGES.length).toBe(8);
    expect(OCR_18_LANGUAGES).toEqual(
      expect.arrayContaining(['python', 'go', 'java', 'rust', 'cpp', 'csharp', 'ruby', 'php'])
    );
  });
});

describe('language routing table', () => {
  it('when OCR_18_LANGUAGES and LANGUAGE_EXTENSIONS are compared, should cover exactly the same set', () => {
    // given: the supported language list and the exported routing table
    const supported = [...OCR_18_LANGUAGES].sort();
    const routed = (
      Object.keys(LANGUAGE_EXTENSIONS) as Array<keyof typeof LANGUAGE_EXTENSIONS>
    ).sort();
    const entryCounts = supported.map((language) => LANGUAGE_EXTENSIONS[language].length);

    // when: both key sets and the entry counts are inspected

    // then: a language cannot be added without an extension entry, and the
    // table cannot carry a key OCR_18_LANGUAGES does not know
    expect(routed).toEqual(supported);
    expect(entryCounts.every((count) => count > 0)).toBe(true);
  });

  it.each(OCR_18_LANGUAGES)(
    'when language=%s, should keep every own extension and drop a foreign file',
    (language) => {
      // given: one comment per extension of this language, one upper-case path,
      // and one comment on another language's file
      const extensions = LANGUAGE_EXTENSIONS[language];
      const foreignLanguage =
        OCR_18_LANGUAGES.find((candidate) => candidate !== language) ?? 'python';
      const foreignExtension = LANGUAGE_EXTENSIONS[foreignLanguage][0] ?? '.zzz';
      const ownPaths = extensions.map((extension, index) => `src/own-${String(index)}${extension}`);
      const firstExtension = extensions[0] ?? '.missing';
      const upperPath = `src/Upper${firstExtension.toUpperCase()}`;
      const foreignPath = `src/foreign${foreignExtension}`;
      const comments = [
        ...ownPaths.map((path) => ({
          path,
          content: `issue in ${path}`,
          start_line: 1,
          end_line: 1,
          severity: 'low',
          category: 'style'
        })),
        {
          path: upperPath,
          content: 'upper-case extension',
          start_line: 2,
          end_line: 2,
          severity: 'low',
          category: 'style'
        },
        {
          path: foreignPath,
          content: 'foreign language file',
          start_line: 3,
          end_line: 3,
          severity: 'critical',
          category: 'bug'
        }
      ];
      queueSpawnSequence([{ status: 0, stdout: JSON.stringify({ status: 'success', comments }) }]);

      // when: runOcr18 routes the payload to this language
      const result = runOcr18({ cwd: process.cwd(), language });

      // then: every own extension (and the upper-case one) is kept, the foreign
      // file is dropped, and the count belongs to the requested language
      expect(result.state).toBe('ok');
      expect(result.findings.map((finding) => finding.filePath)).toEqual([...ownPaths, upperPath]);
      expect(result.findings.map((finding) => finding.filePath)).not.toContain(foreignPath);
      expect(result.summary?.byLanguage[language]).toBe(ownPaths.length + 1);
    }
  );
});

describe('buildOcr18Args', () => {
  it('when language is unsupported, should throw with code LANGUAGE_UNSUPPORTED', () => {
    // given: an unsupported language
    // when: buildOcr18Args is called
    // then: the call rejects without spawning
    expect(() => buildOcr18Args({ cwd: process.cwd(), language: 'cobol' })).toThrow(
      /unsupported language/
    );
  });
});
