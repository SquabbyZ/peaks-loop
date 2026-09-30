/**
 * ESLint runner public type surface + package pins — moved VERBATIM out of
 * `eslint-runner.ts` for the 300-raw-line cap (slice `b1-filesplit-campaign`,
 * wave 3C). `eslint-runner.ts` re-exports every name, so existing import
 * paths keep working.
 */
export const ESLINT_PACKAGE_PINS = {
  eslint: '8.57.1',
  typescriptEslintParser: '8.66.0',
  typescriptEslintPlugin: '8.66.0'
} as const;

export type RedLineMode = 'none' | 'baseline-aware';

export type EslintState =
  'ok' | 'eslint-missing' | 'npx-failed' | 'execution-failed' | 'baseline-missing';

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

export type BaselineViolation = {
  readonly ruleId: string;
  readonly file: string;
  readonly line: number;
  readonly severity: 'error' | 'warn' | 'info';
  readonly message: string;
};

export type RedLineEntry = {
  readonly ruleId: string;
  readonly count: number;
  readonly topFiles: ReadonlyArray<{ readonly file: string; readonly count: number }>;
};

export type EslintRunResult = {
  readonly state: EslintState;
  readonly findings: readonly EslintFinding[];
  readonly summary: EslintSummary;
  readonly durationMs: number;
  readonly rawOutput: string;
  readonly baselineWaived: readonly EslintFinding[];
  readonly redLine: readonly RedLineEntry[];
};

export type EslintRunOptions = {
  readonly cwd: string;
  readonly scope?: string;
  readonly configPath?: string;
  readonly fix?: boolean;
  readonly write?: boolean;
  readonly timeoutMs?: number;
  readonly diffOnly?: boolean;
  readonly baselineFile?: string;
  readonly redLineMode?: RedLineMode;
};

export type EslintMessage = {
  filePath?: unknown;
  line?: unknown;
  column?: unknown;
  ruleId?: unknown;
  severity?: unknown;
  message?: unknown;
};
