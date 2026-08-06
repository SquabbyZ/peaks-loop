import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildOcr18Args, OCR_18_LANGUAGES, OCR_18_PACKAGE, runOcr18 } from '../../../../src/services/lint/ocr-multilang-adapter.js';

interface ChildProcessMock {
  spawnSync: ReturnType<typeof vi.fn>;
}

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn()
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
    queueSpawnSequence([{ status: null, stdout: '', error: Object.assign(new Error('spawn npx ENOENT'), { code: 'ENOENT' } as NodeJS.ErrnoException) }]);

    // when: runOcr18 is invoked
    const result = runOcr18({ cwd: process.cwd(), language: 'python' });

    // then: state must be ocr18-missing
    expect(result.state).toBe('ocr18-missing');
    expect(result.findings).toEqual([]);
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
    expect(call[0]).toBe('npx');
    expect(call[1]).toContain('delegate');
    expect(call[1]).toContain('preview');
  });

  it('when language=java and from=main and to=HEAD, should spawn ocr review with filter-language', () => {
    // given: a successful review call
    queueSpawnSequence([{ status: 0, stdout: '{"findings":[]}' }]);

    // when: runOcr18 is invoked with the java route
    runOcr18({ cwd: process.cwd(), language: 'java', from: 'main', to: 'HEAD' });

    // then: the args pin the package, the review command, and the filter-language flag
    const call = childMock.spawnSync.mock.calls[0] as [string, string[]];
    expect(call[1]).toContain(OCR_18_PACKAGE);
    expect(call[1]).toContain('review');
    expect(call[1]).toContain('--filter-language');
    expect(call[1]).toContain('java');
    expect(call[1]).toContain('--from');
    expect(call[1]).toContain('main');
    expect(call[1]).toContain('--to');
    expect(call[1]).toContain('HEAD');
  });

  it('when ocr18 exits 0 with valid JSON findings, should parse and return summary', () => {
    // given: a valid findings payload
    const payload = {
      findings: [
        { file: 'src/main.py', line: 12, rule: 'sql-injection', severity: 'error', message: 'unsafe SQL' },
        { file: 'src/main.py', line: 24, rule: 'npe', severity: 'warn', message: 'missing None check' }
      ]
    };
    queueSpawnSequence([{ status: 0, stdout: JSON.stringify(payload) }]);

    // when: runOcr18 is invoked
    const result = runOcr18({ cwd: process.cwd(), language: 'python' });

    // then: findings and summary are populated
    expect(result.state).toBe('ok');
    expect(result.findings.length).toBe(2);
    expect(result.summary?.bySeverity).toEqual({ error: 1, warn: 1, info: 0 });
    expect(result.summary?.byLanguage.python).toBe(2);
  });

  it('when ocr18 exits 1 with stderr, should return execution-failed', () => {
    // given: ocr 1.8.x exits non-zero with stderr
    queueSpawnSequence([{ status: 1, stdout: '', stderr: 'language filter rejected' }]);

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
    expect(OCR_18_LANGUAGES).toEqual(expect.arrayContaining(['python', 'go', 'java', 'rust', 'cpp', 'csharp', 'ruby', 'php']));
  });
});

describe('buildOcr18Args', () => {
  it('when language is unsupported, should throw with code LANGUAGE_UNSUPPORTED', () => {
    // given: an unsupported language
    // when: buildOcr18Args is called
    // then: the call rejects without spawning
    expect(() => buildOcr18Args({ cwd: process.cwd(), language: 'cobol' })).toThrow(/unsupported language/);
  });
});
