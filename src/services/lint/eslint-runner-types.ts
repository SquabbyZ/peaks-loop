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
  | 'ok'
  | 'eslint-missing'
  | 'npx-failed'
  | 'execution-failed'
  | 'baseline-missing'
  /**
   * eslint ran and examined ZERO files. A count of findings over an empty
   * population cannot be told apart from a clean run, so it is refused unless
   * the caller opts in with `allowEmpty` (backlog §2.41).
   */
  | 'empty-scope';

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
  /**
   * Files eslint actually examined (backlog §2.41). A finding count is only
   * meaningful next to the population that produced it: "0 findings" over 0
   * files is indistinguishable from "0 findings" over 2000. Entries eslint
   * skipped ("File ignored …") do not count; they are reported separately.
   */
  readonly checkedFiles: number;
  /** Entries eslint skipped, e.g. a dot-path without `--no-ignore`. */
  readonly ignoredFiles: number;
  /**
   * Why a non-`ok` state was reached. Four different conditions — an
   * unbuildable argument list, a spawn failure, a signal kill (which is how a
   * spawn timeout lands) and unparseable linter output — all reported
   * `execution-failed` and nothing else, so an operator could not tell a
   * timed-out linter from one that emitted rubbish. Absent when `state` is ok.
   */
  readonly reason?: string;
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
  /**
   * Accept an examined population of 0 instead of refusing it. The explicit
   * opt-in §2.41 requires; without it `runEslint` returns `empty-scope`.
   */
  readonly allowEmpty?: boolean;
};

export type EslintMessage = {
  filePath?: unknown;
  line?: unknown;
  column?: unknown;
  ruleId?: unknown;
  severity?: unknown;
  message?: unknown;
};
