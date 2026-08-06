/**
 * OCR 1.8.x multi-language reviewer adapter. Routes one of the
 * 8 supported languages to the corresponding `ocr review` filter.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';

export const OCR_18_PACKAGE = '@alibaba-group/open-code-review@1.8.9';

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
  if (value === 'error' || value === 'critical' || value === 2) return 'error';
  if (value === 'warn' || value === 'warning' || value === 1) return 'warn';
  return 'info';
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
    throw Object.assign(new Error(`unsupported language: ${options.language}`), { code: 'LANGUAGE_UNSUPPORTED' });
  }
  const args: string[] = [
    '--package', OCR_18_PACKAGE,
    '--', 'ocr'
  ];
  if (options.delegate === true) {
    args.push('delegate', 'preview');
    if (options.from !== undefined) args.push('--from', options.from);
    if (options.to !== undefined) args.push('--to', options.to);
    if (options.commit !== undefined) args.push('--commit', options.commit);
  } else {
    args.push('review', '--filter-language', options.language);
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
    timeout: options.timeoutMs ?? 60_000,
    maxBuffer: 32 * 1024 * 1024
  };

  const result = spawnSync('npx', args, spawnOptions);
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';

  if (result.error !== undefined && result.error !== null) {
    return {
      state: 'ocr18-missing',
      findings: [],
      summary: null,
      durationMs: Date.now() - start,
      rawOutput: stderr || stdout
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
      const parsed = JSON.parse(stdout) as { findings?: unknown };
      if (Array.isArray(parsed.findings)) {
        for (const entry of parsed.findings) {
          if (entry === null || typeof entry !== 'object') continue;
          const f = entry as { file?: unknown; line?: unknown; rule?: unknown; severity?: unknown; message?: unknown };
          findings.push({
            filePath: typeof f.file === 'string' ? f.file : '',
            line: typeof f.line === 'number' ? f.line : 0,
            ruleId: typeof f.rule === 'string' ? f.rule : null,
            severity: severityFor(f.severity),
            message: typeof f.message === 'string' ? f.message : ''
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
  const byLanguage = emptyByLanguage();
  byLanguage[options.language] = findings.length;

  return {
    state: 'ok',
    findings,
    summary: { total: findings.length, bySeverity, byLanguage },
    durationMs: Date.now() - start,
    rawOutput: stdout
  };
}
