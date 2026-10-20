/**
 * OCR 1.x reviewer adapter: builds the argv, spawns the pinned runtime, and maps
 * its real `comments[]` envelope onto `Ocr18Finding`.
 *
 * The pinned CLI has NO language flag — `--filter-language` is not a flag of the
 * real binary (`Error: unknown flag`) — so this module never emits one. Language
 * attribution lives in `ocr-18-language-routing.ts` and the one-review-many-
 * languages path in `ocr-18-multi.ts`.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { resolveNpxInvocation } from './npx-resolver.js';
import {
  isSupportedLanguage,
  languageForPath,
  OCR_18_LANGUAGES,
  type Ocr18Language
} from './ocr-18-language-routing.js';

export const OCR_18_PACKAGE = '@alibaba-group/open-code-review@1.13.1';

export type Ocr18State =
  | 'ok'
  | 'no-routed-language'
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

/** The git range a review covers; empty means "the workspace" (what `ocr review` defaults to). */
export type Ocr18Range = {
  readonly from?: string;
  readonly to?: string;
  readonly commit?: string;
};

export type Ocr18RunOptions = Ocr18Range & {
  readonly cwd: string;
  /** Required for a review; ignored by delegation mode, which is not language-scoped. */
  readonly language?: string;
  readonly delegate?: boolean;
  readonly timeoutMs?: number;
};

/** The one severity map for OCR comments — used only by `parseComments` below. */
function severityFor(value: unknown): 'error' | 'warn' | 'info' {
  if (value === 'error' || value === 'critical' || value === 'high' || value === 2) return 'error';
  if (value === 'warn' || value === 'warning' || value === 'medium' || value === 1) return 'warn';
  return 'info';
}

export function emptyByLanguage(): Readonly<Record<Ocr18Language, number>> {
  const out = {} as Record<Ocr18Language, number>;
  for (const language of OCR_18_LANGUAGES) {
    out[language] = 0;
  }
  return out;
}

function rangeArgs(range: Ocr18Range): string[] {
  const args: string[] = [];
  if (range.from !== undefined) args.push('--from', range.from);
  if (range.to !== undefined) args.push('--to', range.to);
  if (range.commit !== undefined) args.push('--commit', range.commit);
  return args;
}

/** The review argv — no language flag exists, and none is emitted. */
export function buildReviewArgs(range: Ocr18Range): string[] {
  return [
    '--package',
    OCR_18_PACKAGE,
    '--',
    'ocr',
    'review',
    ...rangeArgs(range),
    '--format',
    'json'
  ];
}

export function buildOcr18Args(options: Ocr18RunOptions): string[] {
  if (options.delegate === true) {
    // Delegation mode hands the host agent a spec and takes no language: the
    // language is ignored by `ocr delegate preview`, so requiring one would be
    // a value the code carries but does not mean.
    return ['--package', OCR_18_PACKAGE, '--', 'ocr', 'delegate', 'preview', ...rangeArgs(options)];
  }
  if (options.language === undefined || !isSupportedLanguage(options.language)) {
    throw Object.assign(new Error(`unsupported language: ${options.language ?? '<missing>'}`), {
      code: 'LANGUAGE_UNSUPPORTED'
    });
  }
  return buildReviewArgs(options);
}

export type Ocr18Invocation =
  | { readonly ok: true; readonly stdout: string; readonly stderr: string }
  | { readonly ok: false; readonly state: Ocr18State; readonly rawOutput: string };

export function invokeOcr(
  args: readonly string[],
  cwd: string,
  timeoutMs?: number
): Ocr18Invocation {
  const spawnOptions: SpawnSyncOptions = {
    cwd,
    encoding: 'utf8',
    // Repo convention: without this the child pops a console window on the
    // user's desktop — and this child can run for the length of a full review.
    windowsHide: true,
    timeout: timeoutMs ?? 60_000,
    maxBuffer: 32 * 1024 * 1024
  };

  // 2026-09-10: bare `spawnSync('npx', …)` cannot launch the Windows `npx.cmd`
  // shim (ENOENT, no shell) — same fix and same helper as `detect-ocr-18.ts` /
  // `detect-eslint.ts`. `shell: true` is NOT an option: it would concatenate
  // the argv unescaped and split the `--package` flag.
  const { command, args: npxArgs, baseEnv } = resolveNpxInvocation([...args]);
  const result = spawnSync(command, npxArgs, { ...spawnOptions, env: baseEnv });
  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  const stderr = typeof result.stderr === 'string' ? result.stderr : '';

  if (result.error !== undefined && result.error !== null) {
    return {
      ok: false,
      state: 'ocr18-missing',
      // Never discard WHY the launch failed — stdout/stderr are both empty here.
      rawOutput: stderr || stdout || result.error.message
    };
  }
  if (result.status !== 0) {
    return { ok: false, state: 'execution-failed', rawOutput: stderr || stdout };
  }
  return { ok: true, stdout, stderr };
}

export type ParsedComments =
  { readonly ok: true; readonly findings: readonly Ocr18Finding[] } | { readonly ok: false };

/**
 * `comments[]` from the real 1.13.1 envelope, mapped onto `Ocr18Finding`.
 *
 * A discriminated result rather than `null`: `{ ok: false }` is the execution
 * failure the caller must report, and it cannot be mistaken for an empty review
 * (which is `{ ok: true, findings: [] }`).
 */
export function parseComments(stdout: string): ParsedComments {
  let parsed: { comments?: unknown };
  try {
    parsed = JSON.parse(stdout) as { comments?: unknown };
  } catch {
    return { ok: false };
  }
  // A missing or non-array `comments` is a clean review, not a parse failure.
  if (!Array.isArray(parsed.comments)) return { ok: true, findings: [] };
  const findings: Ocr18Finding[] = [];
  for (const entry of parsed.comments) {
    if (entry === null || typeof entry !== 'object') continue;
    const comment = entry as {
      path?: unknown;
      content?: unknown;
      start_line?: unknown;
      severity?: unknown;
      category?: unknown;
    };
    findings.push({
      filePath: typeof comment.path === 'string' ? comment.path : '',
      line: typeof comment.start_line === 'number' ? comment.start_line : 0,
      ruleId: typeof comment.category === 'string' ? comment.category : null,
      severity: severityFor(comment.severity),
      message: typeof comment.content === 'string' ? comment.content : ''
    });
  }
  return { ok: true, findings };
}

export function summarize(
  findings: readonly Ocr18Finding[],
  counts: Readonly<Record<Ocr18Language, number>>
): Ocr18Summary {
  const bySeverity: Record<'error' | 'warn' | 'info', number> = { error: 0, warn: 0, info: 0 };
  for (const finding of findings) bySeverity[finding.severity]++;
  return { total: findings.length, bySeverity, byLanguage: counts };
}

export function runOcr18(options: Ocr18RunOptions): Ocr18RunResult {
  const start = Date.now();
  const language = options.language;
  if (options.delegate !== true && (language === undefined || !isSupportedLanguage(language))) {
    return {
      state: 'language-unsupported',
      findings: [],
      summary: null,
      durationMs: Date.now() - start,
      rawOutput: `unsupported language: ${language ?? '<missing>'}`
    };
  }

  const invoked = invokeOcr(buildOcr18Args(options), options.cwd, options.timeoutMs);
  if (!invoked.ok) {
    return {
      state: invoked.state,
      findings: [],
      summary: null,
      durationMs: Date.now() - start,
      rawOutput: invoked.rawOutput
    };
  }

  let findings: readonly Ocr18Finding[] = [];
  if (invoked.stdout.trim().length > 0) {
    const parsed = parseComments(invoked.stdout);
    if (!parsed.ok) {
      return {
        state: 'execution-failed',
        findings: [],
        summary: null,
        durationMs: Date.now() - start,
        rawOutput: invoked.stderr || invoked.stdout
      };
    }
    // A single-language run reports only that language. Delegation mode has no
    // language, and its preview carries no comments, so nothing is filtered.
    findings =
      language === undefined
        ? parsed.findings
        : parsed.findings.filter((finding) => languageForPath(finding.filePath) === language);
  }

  const byLanguage = { ...emptyByLanguage() };
  if (language !== undefined && isSupportedLanguage(language))
    byLanguage[language] = findings.length;
  return {
    state: 'ok',
    findings,
    summary: summarize(findings, byLanguage),
    durationMs: Date.now() - start,
    rawOutput: invoked.stdout
  };
}
