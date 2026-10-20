/**
 * OCR 1.x multi-language reviewer adapter. Scopes one of the 8 supported
 * languages by file extension after `ocr review` returns — the pinned CLI has
 * no language flag of its own (see `LANGUAGE_EXTENSIONS`).
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { resolveNpxInvocation } from './npx-resolver.js';

export const OCR_18_PACKAGE = '@alibaba-group/open-code-review@1.13.1';

export const OCR_18_LANGUAGES = [
  'python',
  'go',
  'java',
  'rust',
  'cpp',
  'csharp',
  'ruby',
  'php'
] as const;

export type Ocr18Language = (typeof OCR_18_LANGUAGES)[number];

/**
 * The file extensions each language routes through.
 *
 * `ocr review` HAS NO LANGUAGE FLAG in the pinned 1.x line — `--filter-language`
 * is not a flag of the real binary (`Error: unknown flag`). So language routing
 * happens AFTER the review: the review still runs over the whole diff, and
 * findings outside the requested language's extensions are dropped here. This
 * scopes what is REPORTED, not what the LLM was asked to look at.
 *
 * Exported so the table-driven test can assert hard that every language in
 * `OCR_18_LANGUAGES` has at least one extension — a language added without an
 * entry here would otherwise route zero findings silently.
 */
export const LANGUAGE_EXTENSIONS: Readonly<Record<Ocr18Language, readonly string[]>> = {
  python: ['.py'],
  go: ['.go'],
  java: ['.java'],
  rust: ['.rs'],
  cpp: ['.cpp', '.cc', '.cxx', '.h', '.hpp'],
  csharp: ['.cs'],
  ruby: ['.rb'],
  php: ['.php']
};

export type Ocr18State =
  | 'ok'
  | 'ocr18-missing'
  | 'binary-missing'
  | 'llm-config-missing'
  | 'execution-failed'
  | 'language-unsupported';

export type Ocr18Finding = {
  readonly filePath: string;
  readonly line: number;
  readonly ruleId: string | null;
  readonly severity: 'error' | 'warn' | 'info';
  readonly message: string;
};

export type Ocr18Summary = {
  readonly total: number;
  readonly bySeverity: Readonly<Record<'error' | 'warn' | 'info', number>>;
  readonly byLanguage: Readonly<Record<Ocr18Language, number>>;
};

export type Ocr18RunResult = {
  readonly state: Ocr18State;
  readonly findings: readonly Ocr18Finding[];
  readonly summary: Ocr18Summary | null;
  readonly durationMs: number;
  readonly rawOutput: string;
};

export type Ocr18RunOptions = {
  readonly cwd: string;
  readonly language: string;
  readonly from?: string;
  readonly to?: string;
  readonly commit?: string;
  readonly delegate?: boolean;
  readonly timeoutMs?: number;
};

function isSupportedLanguage(value: string): value is Ocr18Language {
  return (OCR_18_LANGUAGES as ReadonlyArray<string>).includes(value);
}

function severityFor(value: unknown): 'error' | 'warn' | 'info' {
  if (value === 'error' || value === 'critical' || value === 'high' || value === 2) return 'error';
  if (value === 'warn' || value === 'warning' || value === 'medium' || value === 1) return 'warn';
  return 'info';
}

/** Whether `filePath` carries one of the requested language's extensions. */
function isRequestedLanguageFile(filePath: string, language: Ocr18Language): boolean {
  const lower = filePath.toLowerCase();
  return LANGUAGE_EXTENSIONS[language].some((extension) => lower.endsWith(extension));
}

function emptyByLanguage(): Readonly<Record<Ocr18Language, number>> {
  const out = {} as Record<Ocr18Language, number>;
  for (const lang of OCR_18_LANGUAGES) {
    out[lang] = 0;
  }
  return out;
}

export function buildOcr18Args(options: Ocr18RunOptions): string[] {
  if (!isSupportedLanguage(options.language)) {
    throw Object.assign(new Error(`unsupported language: ${options.language}`), {
      code: 'LANGUAGE_UNSUPPORTED'
    });
  }
  const args: string[] = ['--package', OCR_18_PACKAGE, '--', 'ocr'];
  if (options.delegate === true) {
    args.push('delegate', 'preview');
    if (options.from !== undefined) args.push('--from', options.from);
    if (options.to !== undefined) args.push('--to', options.to);
    if (options.commit !== undefined) args.push('--commit', options.commit);
  } else {
    args.push('review');
    if (options.from !== undefined) args.push('--from', options.from);
    if (options.to !== undefined) args.push('--to', options.to);
    if (options.commit !== undefined) args.push('--commit', options.commit);
    args.push('--format', 'json');
  }
  return args;
}

export function runOcr18(options: Ocr18RunOptions): Ocr18RunResult {
  const start = Date.now();
  if (!isSupportedLanguage(options.language)) {
    return {
      state: 'language-unsupported',
      findings: [],
      summary: null,
      durationMs: Date.now() - start,
      rawOutput: `unsupported language: ${options.language}`
    };
  }

  const args = buildOcr18Args(options);
  const spawnOptions: SpawnSyncOptions = {
    cwd: options.cwd,
    encoding: 'utf8',
    // Repo convention: without this the child pops a console window on the
    // user's desktop — and this child can run for the length of a full review.
    windowsHide: true,
    timeout: options.timeoutMs ?? 60_000,
    maxBuffer: 32 * 1024 * 1024
  };

  // 2026-09-10: bare `spawnSync('npx', …)` cannot launch the Windows `npx.cmd`
  // shim (ENOENT, no shell) — same fix and same helper as `detect-ocr-18.ts` /
  // `detect-eslint.ts`. `shell: true` is NOT an option: it would concatenate the
  // argv unescaped and split the `--package` flag.
  const { command, args: npxArgs, baseEnv } = resolveNpxInvocation(args);
  const result = spawnSync(command, npxArgs, { ...spawnOptions, env: baseEnv });
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';

  if (result.error !== undefined && result.error !== null) {
    return {
      state: 'ocr18-missing',
      findings: [],
      summary: null,
      durationMs: Date.now() - start,
      // Never discard WHY the launch failed — stdout/stderr are both empty here.
      rawOutput: stderr || stdout || result.error.message
    };
  }

  if (result.status !== 0) {
    return {
      state: 'execution-failed',
      findings: [],
      summary: null,
      durationMs: Date.now() - start,
      rawOutput: stderr || stdout
    };
  }

  let findings: Ocr18Finding[] = [];
  if (stdout.trim().length > 0) {
    try {
      const parsed = JSON.parse(stdout) as { comments?: unknown };
      // A missing `comments` is a clean review, not a parse failure.
      if (Array.isArray(parsed.comments)) {
        for (const entry of parsed.comments) {
          if (entry === null || typeof entry !== 'object') continue;
          const c = entry as {
            path?: unknown;
            content?: unknown;
            start_line?: unknown;
            severity?: unknown;
            category?: unknown;
          };
          const filePath = typeof c.path === 'string' ? c.path : '';
          if (!isRequestedLanguageFile(filePath, options.language)) continue;
          findings.push({
            filePath,
            line: typeof c.start_line === 'number' ? c.start_line : 0,
            ruleId: typeof c.category === 'string' ? c.category : null,
            severity: severityFor(c.severity),
            message: typeof c.content === 'string' ? c.content : ''
          });
        }
      }
    } catch {
      return {
        state: 'execution-failed',
        findings: [],
        summary: null,
        durationMs: Date.now() - start,
        rawOutput: stderr || stdout
      };
    }
  }

  const bySeverity: Record<'error' | 'warn' | 'info', number> = { error: 0, warn: 0, info: 0 };
  for (const f of findings) bySeverity[f.severity]++;
  const byLanguageMut: Record<Ocr18Language, number> = { ...emptyByLanguage() };
  byLanguageMut[options.language] = findings.length;

  return {
    state: 'ok',
    findings,
    summary: { total: findings.length, bySeverity, byLanguage: byLanguageMut },
    durationMs: Date.now() - start,
    rawOutput: stdout
  };
}
