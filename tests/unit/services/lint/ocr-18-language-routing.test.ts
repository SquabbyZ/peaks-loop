import { describe, expect, it, vi } from 'vitest';
import { runOcr18 } from '../../../../src/services/lint/ocr-multilang-adapter.js';
import {
  LANGUAGE_EXTENSIONS,
  languageForPath,
  OCR_18_LANGUAGES,
  parseLanguageSelection
} from '../../../../src/services/lint/ocr-18-language-routing.js';
import {
  OCR_18_ALLOWLIST_V1_13_1,
  OCR_18_EXCLUDED_EXTENSIONS
} from '../../../../src/services/lint/ocr-18-allowlist.js';

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

describe('OCR_18_LANGUAGES', () => {
  it('when derived, should carry every language the PRD names plus the runtime’s own set', () => {
    // given: the routed language list derived from LANGUAGE_EXTENSIONS
    // when: it is inspected
    // then: it covers the PRD-mandated languages …
    expect(OCR_18_LANGUAGES).toEqual(
      expect.arrayContaining([
        'typescript',
        'javascript',
        'python',
        'go',
        'java',
        'kotlin',
        'rust',
        'c',
        'cpp',
        'csharp',
        'ruby',
        'php',
        'swift'
      ])
    );
    // … and it IS the table's key set, so a language cannot be routed without
    // an extension entry (the two used to be parallel lists).
    expect([...OCR_18_LANGUAGES].sort()).toEqual(Object.keys(LANGUAGE_EXTENSIONS).sort());
  });
});

describe('language routing table', () => {
  const routedExtensions = Object.values(LANGUAGE_EXTENSIONS).flatMap((extensions) => extensions);

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

  it('when every routed extension is compared with the pinned allowlist, should be a subset of it', () => {
    // given: the extensions this adapter routes
    const allowlist = new Set(OCR_18_ALLOWLIST_V1_13_1);

    // when: each is looked up in the vendored snapshot of the pinned runtime

    // then: routing an extension the CLI does not review would report a
    // language the review never actually looked at
    expect(routedExtensions.filter((extension) => !allowlist.has(extension))).toEqual([]);
  });

  it('when the allowlist is compared with routed + excluded, should be partitioned exactly', () => {
    // given: the allowlist, this adapter's routed extensions, and the documented exclusions
    const excluded = Object.keys(OCR_18_EXCLUDED_EXTENSIONS);
    const accounted = new Set([...routedExtensions, ...excluded]);

    // when: the allowlist is filtered to what neither list covers

    // then: nothing is silently ignored — an upstream addition reddens here
    // instead of vanishing from routing
    expect(OCR_18_ALLOWLIST_V1_13_1.filter((extension) => !accounted.has(extension))).toEqual([]);
    // then: an exclusion cannot name an extension the runtime never reviews
    const allowlist = new Set(OCR_18_ALLOWLIST_V1_13_1);
    expect(excluded.filter((extension) => !allowlist.has(extension))).toEqual([]);
  });

  it('when the table is scanned for duplicates, should route each extension to one language', () => {
    // given: every routed extension
    // when: duplicates are collected
    const duplicates = routedExtensions.filter(
      (extension, index) => routedExtensions.indexOf(extension) !== index
    );

    // then: an extension routes to exactly one language
    expect(duplicates).toEqual([]);
  });

  it('when .mts and .cts are looked up, should stay unrouted — a documented divergence', () => {
    // The PRD names `.mts` / `.cts` as TypeScript extensions, but the pinned
    // 1.13.1 allowlist omits both and `ocr review --preview` classifies them
    // `unsupported_ext`. Routing them would report "typescript: 0 findings" for
    // files the CLI never read, so they must surface as unsupported files.
    expect(languageForPath('src/a.mts')).toBeNull();
    expect(languageForPath('src/a.cts')).toBeNull();
    expect(OCR_18_ALLOWLIST_V1_13_1).not.toContain('.mts');
    expect(OCR_18_ALLOWLIST_V1_13_1).not.toContain('.cts');
  });

  it.each([
    ['src/a.ts', 'typescript'],
    ['src/a.TSX', 'typescript'],
    ['src/a.mjs', 'javascript'],
    ['src/a.py', 'python'],
    ['src/a.pyi', 'python'],
    ['src/a.go', 'go'],
    ['src/a.h', 'cpp'],
    ['src/a.hpp', 'cpp'],
    ['src/a.cmake', 'cmake'],
    ['src/a.tf', 'terraform'],
    ['src/a.proto', 'protobuf'],
    ['src/a.yaml', null],
    ['Makefile', null],
    ['src/a.mts', null]
  ])('when the path is %s, should route to %s', (filePath, expected) => {
    // given: a path
    // when: it is resolved through the routing table
    // then: the extension decides, case-insensitively, and unrouted formats are null
    expect(languageForPath(filePath)).toBe(expected);
  });

  it('when a .h header is routed, should stay under cpp — the surface inherited from 194eccf5', () => {
    // given: `.h` is ambiguous between C and C++, and `--language cpp` matched it
    // before this slice; moving it would silently change a preserved result
    // when / then: the single assignment is cpp, case-insensitively …
    expect(languageForPath('src/a.h')).toBe('cpp');
    expect(languageForPath('src/deep/a.H')).toBe('cpp');
    expect(languageForPath('src/a.c')).toBe('c');

    // … and `--language c` does not match it, so a header-only diff is reported
    // under cpp rather than vanishing from the C result
    queueSpawnSequence([
      {
        status: 0,
        stdout: JSON.stringify({
          status: 'success',
          comments: [
            { path: 'src/a.h', content: 'issue', start_line: 1, end_line: 1, severity: 'low' }
          ]
        })
      }
    ]);
    const asC = runOcr18({ cwd: process.cwd(), language: 'c' });
    expect(asC.state).toBe('ok');
    expect(asC.findings).toEqual([]);
    expect(asC.summary?.byLanguage.cpp).toBe(0);
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

describe('parseLanguageSelection', () => {
  it('when given auto, should select detection', () => {
    // given / when / then: the one selector that needs no language list
    expect(parseLanguageSelection('auto')).toEqual({ auto: true, languages: null });
  });

  it('when given names or extensions, should resolve both through the routing table', () => {
    // given: the documented short form, a mixed form, and a duplicate
    // when / then: extensions resolve to their language, duplicates collapse
    expect(parseLanguageSelection('ts,js,go')).toEqual({
      auto: false,
      languages: ['typescript', 'javascript', 'go']
    });
    expect(parseLanguageSelection('.py, java')).toEqual({
      auto: false,
      languages: ['python', 'java']
    });
    expect(parseLanguageSelection('ts,typescript')).toEqual({
      auto: false,
      languages: ['typescript']
    });
  });

  it.each(['cobol', '', 'auto,go'])('when given %j, should refuse it', (spec) => {
    // given: an empty, unknown, or mixed-auto selector
    // when / then: it is refused rather than silently reviewing nothing
    expect(() => parseLanguageSelection(spec)).toThrow(/unsupported language|no language given/);
  });
});
