/**
 * ESLint runner — read-only verifier for peaks code lint.
 * Pins the 4 toolchain packages to the same major versions
 * `config/eslint/.peaks-rules.cjs` requires; the runner loads them
 * via `npx --package` so peaks-loop devDeps do not grow. Per the
 * G-lint-2 red line, --fix / --write are FORBIDDEN.
 */
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';

export const ESLINT_PACKAGE_PINS = {
  eslint: '10.8.0',
  typescriptEslintParser: '8.66.0',
  typescriptEslintPlugin: '8.66.0',
  importPlugin: '2.32.0'
} as const;

export type EslintState =
  | 'ok'
  | 'eslint-missing'
  | 'npx-failed'
  | 'execution-failed';

export type EslintFinding = {
  readonly filePath: string;
  readonly line: number;
  readonly column: number;
  readonly ruleId: string | null;
  readonly severity: 'error' | 'warn' | 'info';
  readonly message: string;
};

export type EslintSummary = {
  readonly error: number;
  readonly warn: number;
  readonly info: number;
};

export type EslintRunResult = {
  readonly state: EslintState;
  readonly findings: readonly EslintFinding[];
  readonly summary: EslintSummary;
  readonly durationMs: number;
  readonly rawOutput: string;
};

export type EslintRunOptions = {
  readonly cwd: string;
  readonly scope?: string;
  readonly configPath?: string;
  readonly fix?: boolean;
  readonly write?: boolean;
  readonly timeoutMs?: number;
};

type EslintMessage = {
  filePath?: unknown;
  line?: unknown;
  column?: unknown;
  ruleId?: unknown;
  severity?: unknown;
  message?: unknown;
};

function severityFor(value: unknown): 'error' | 'warn' | 'info' {
  if (value === 2) return 'error';
  if (value === 1) return 'warn';
  return 'info';
}

function summarize(findings: readonly EslintFinding[]): EslintSummary {
  let error = 0;
  let warn = 0;
  let info = 0;
  for (const f of findings) {
    if (f.severity === 'error') error++;
    else if (f.severity === 'warn') warn++;
    else info++;
  }
  return { error, warn, info };
}

export function buildEslintArgs(options: EslintRunOptions): string[] {
  if (options.fix === true || options.write === true) {
    throw Object.assign(new Error('peaks code lint is read-only; --fix and --write are forbidden'), {
      code: 'LINT_FIX_FORBIDDEN'
    });
  }
  const args = [
    '--package', `eslint@${ESLINT_PACKAGE_PINS.eslint}`,
    '--package', `@typescript-eslint/parser@${ESLINT_PACKAGE_PINS.typescriptEslintParser}`,
    '--package', `@typescript-eslint/eslint-plugin@${ESLINT_PACKAGE_PINS.typescriptEslintPlugin}`,
    '--package', `eslint-plugin-import@${ESLINT_PACKAGE_PINS.importPlugin}`,
    '--', 'eslint', '--no-warn-ignored', '--format', 'json'
  ];
  if (options.configPath !== undefined) {
    args.push('--config', options.configPath);
  }
  args.push(...(options.scope !== undefined && options.scope.length > 0 ? [options.scope] : ['.']));
  return args;
}

export function runEslint(options: EslintRunOptions): EslintRunResult {
  const start = Date.now();
  let args: string[];
  try {
    args = buildEslintArgs(options);
  } catch (error: unknown) {
    return {
      state: 'execution-failed',
      findings: [],
      summary: { error: 0, warn: 0, info: 0 },
      durationMs: Date.now() - start,
      rawOutput: error instanceof Error ? error.message : String(error)
    };
  }

  const spawnOptions: SpawnSyncOptions = {
    cwd: options.cwd,
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 60_000,
    maxBuffer: 32 * 1024 * 1024
  };

  const result = spawnSync('npx', args, spawnOptions);

  if (result.error !== undefined && result.error !== null) {
    const message = result.error.message;
    const state: EslintState = /ENOENT/.test(message) ? 'npx-failed' : 'execution-failed';
    return {
      state,
      findings: [],
      summary: { error: 0, warn: 0, info: 0 },
      durationMs: Date.now() - start,
      rawOutput: typeof result.stdout === 'string' ? result.stdout : ''
    };
  }

  if (result.signal !== null && result.signal !== undefined) {
    return {
      state: 'execution-failed',
      findings: [],
      summary: { error: 0, warn: 0, info: 0 },
      durationMs: Date.now() - start,
      rawOutput: typeof result.stdout === 'string' ? result.stdout : ''
    };
  }

  const stdout = typeof result.stdout === 'string' ? result.stdout : '';
  let findings: EslintFinding[] = [];
  if (stdout.trim().length > 0) {
    try {
      const parsed = JSON.parse(stdout) as ReadonlyArray<EslintMessage>;
      for (const entry of parsed) {
        if (typeof entry !== 'object' || entry === null) continue;
        const messages = Array.isArray((entry as { messages?: unknown[] }).messages)
          ? (entry as { messages: EslintMessage[] }).messages
          : [];
        for (const m of messages) {
          if (m === null || typeof m !== 'object') continue;
          findings.push({
            filePath: typeof m.filePath === 'string' ? m.filePath : '',
            line: typeof m.line === 'number' ? m.line : 0,
            column: typeof m.column === 'number' ? m.column : 0,
            ruleId: typeof m.ruleId === 'string' ? m.ruleId : null,
            severity: severityFor(m.severity),
            message: typeof m.message === 'string' ? m.message : ''
          });
        }
      }
    } catch {
      return {
        state: 'execution-failed',
        findings: [],
        summary: { error: 0, warn: 0, info: 0 },
        durationMs: Date.now() - start,
        rawOutput: stdout
      };
    }
  }

  if (result.status !== 0 && findings.length === 0) {
    return {
      state: 'eslint-missing',
      findings: [],
      summary: { error: 0, warn: 0, info: 0 },
      durationMs: Date.now() - start,
      rawOutput: typeof result.stderr === 'string' ? result.stderr : stdout
    };
  }

  return {
    state: 'ok',
    findings,
    summary: summarize(findings),
    durationMs: Date.now() - start,
    rawOutput: stdout
  };
}
