import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { defaultCodegraphProcessRunner } from './codegraph-process-runner.js';
import { getSessionId, getSessionDir } from '../session/index.js';

const CODEGRAPH_PACKAGE_NAME = '@colbymchenry/codegraph';
const CODEGRAPH_PACKAGE_VERSION = '0.7.10';
const CODEGRAPH_EXECUTABLE = process.execPath;
const CODEGRAPH_BINARY_PATH = resolveCodegraphBinaryPath();
const POSITIONAL_ARGUMENT_PREFIX = '-';
const ALLOWED_SUBCOMMANDS = ['status', 'init', 'index', 'query', 'files', 'context', 'affected'] as const;
const NUMERIC_FLAG_NAMES = ['limit', 'maxDepth'] as const;
const COMMON_OPTION_KEYS = ['subcommand', 'project'] as const;
const ALLOWED_OPTIONS_BY_SUBCOMMAND = {
  status: [],
  init: ['yes'],
  index: ['force', 'quiet'],
  query: ['search', 'json', 'limit'],
  files: ['json', 'maxDepth'],
  context: ['task'],
  affected: ['files', 'json']
} as const satisfies Record<CodegraphSubcommand, readonly string[]>;

type CodegraphSubcommand = (typeof ALLOWED_SUBCOMMANDS)[number];
type NumericFlagName = (typeof NUMERIC_FLAG_NAMES)[number];

type BaseCodegraphInvocationOptions = {
  subcommand: CodegraphSubcommand;
  project: string;
  search?: string;
  files?: string[];
  json?: boolean;
  quiet?: boolean;
  yes?: boolean;
  force?: boolean;
  limit?: number;
  maxDepth?: number;
};

type ContextCodegraphInvocationOptions = Omit<BaseCodegraphInvocationOptions, 'subcommand'> & {
  subcommand: 'context';
  task: string;
};

type NonContextCodegraphInvocationOptions = BaseCodegraphInvocationOptions & {
  subcommand: Exclude<CodegraphSubcommand, 'context'>;
  task?: never;
};

export type CodegraphInvocationOptions = ContextCodegraphInvocationOptions | NonContextCodegraphInvocationOptions;

export type CodegraphInvocation = {
  executable: typeof CODEGRAPH_EXECUTABLE;
  args: string[];
  cwd: string;
  packageName: typeof CODEGRAPH_PACKAGE_NAME;
  packageVersion: typeof CODEGRAPH_PACKAGE_VERSION;
  subcommand: CodegraphSubcommand;
};

export type CodegraphExecutionResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export type CodegraphProcessRunner = (invocation: CodegraphInvocation) => Promise<CodegraphExecutionResult>;

function resolveCodegraphBinaryPath(): string {
  const require = createRequire(import.meta.url);
  const packageJsonPath = require.resolve('@colbymchenry/codegraph/package.json');
  const binaryPath = resolve(dirname(packageJsonPath), 'dist', 'bin', 'codegraph.js');

  return binaryPath;
}

function assertSupportedSubcommand(subcommand: string): asserts subcommand is CodegraphSubcommand {
  if (!ALLOWED_SUBCOMMANDS.includes(subcommand as CodegraphSubcommand)) {
    throw new Error(`Unsupported codegraph subcommand: ${subcommand}`);
  }
}

function resolveProjectRoot(project: string): string {
  const projectRoot = resolve(project);

  try {
    if (!statSync(projectRoot).isDirectory()) {
      throw new Error('Project path must exist and be a directory');
    }

    return realpathSync.native(projectRoot);
  } catch {
    throw new Error('Project path must exist and be a directory');
  }
}

function assertPositiveInteger(value: number | undefined, flagName: NumericFlagName): void {
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${flagName} must be a positive integer`);
  }
}

function assertPositionalArgument(value: string, argumentName: string): void {
  if (value.startsWith(POSITIONAL_ARGUMENT_PREFIX)) {
    throw new Error(`${argumentName} must not start with -`);
  }
}

function assertSupportedOptions(options: CodegraphInvocationOptions): void {
  const allowedOptions = new Set<string>(ALLOWED_OPTIONS_BY_SUBCOMMAND[options.subcommand]);
  const presentOptionKeys = Object.keys(options).filter((key) => !COMMON_OPTION_KEYS.includes(key as (typeof COMMON_OPTION_KEYS)[number]));
  const unsupportedOption = presentOptionKeys.find((key) => !allowedOptions.has(key));

  if (unsupportedOption) {
    throw new Error(`Unsupported option ${unsupportedOption} for codegraph ${options.subcommand}`);
  }
}

function assertRequiredOptions(options: CodegraphInvocationOptions): void {
  if (options.subcommand === 'query' && (!options.search || options.search.trim() === '')) {
    throw new Error('search must be non-empty');
  }

  if (options.subcommand === 'query' && options.search) {
    assertPositionalArgument(options.search, 'search');
  }

  if (options.subcommand === 'context') {
    assertPositionalArgument(options.task, 'task');
  }
}

function assertInsideProject(projectRoot: string, absolutePath: string): void {
  const relativePath = relative(projectRoot, absolutePath);

  if (relativePath === '' || relativePath.startsWith('..') || isAbsolute(relativePath)) {
    throw new Error('Affected files must stay inside the project');
  }
}

function resolveExistingBoundary(absoluteFilePath: string): string {
  if (existsSync(absoluteFilePath)) {
    return absoluteFilePath;
  }

  let currentPath = dirname(absoluteFilePath);

  while (!existsSync(currentPath)) {
    const parentPath = dirname(currentPath);

    currentPath = parentPath;
  }

  return currentPath;
}

function normalizeProjectRelativeFile(projectRoot: string, file: string): string {
  assertPositionalArgument(file, 'Affected files');
  const absoluteFilePath = resolve(projectRoot, file);
  assertInsideProject(projectRoot, absoluteFilePath);
  const realBoundary = realpathSync.native(resolveExistingBoundary(absoluteFilePath));
  assertInsideProject(projectRoot, realBoundary);

  return relative(projectRoot, absoluteFilePath).split(sep).join('/');
}

function buildAffectedFileArgs(projectRoot: string, files: string[] | undefined): string[] {
  if (!files || files.length < 1) {
    throw new Error('affected requires at least one file');
  }

  return files.map((file) => normalizeProjectRelativeFile(projectRoot, file));
}

function buildCommandArgs(options: CodegraphInvocationOptions, projectRoot: string): string[] {
  const args = [CODEGRAPH_BINARY_PATH, options.subcommand];

  if (options.subcommand === 'query' && options.search) {
    args.push(options.search);
  }

  if (options.subcommand === 'context') {
    if (options.task.trim() === '') {
      throw new Error('task must be non-empty');
    }

    args.push(options.task);
  }

  if (options.subcommand === 'affected') {
    args.push(...buildAffectedFileArgs(projectRoot, options.files));
  }

  if (options.yes === true) {
    args.push('--yes');
  }

  if (options.force === true) {
    args.push('--force');
  }

  if (options.json === true) {
    args.push('--json');
  }

  if (options.quiet === true) {
    args.push('--quiet');
  }

  if (options.limit !== undefined) {
    args.push('--limit', String(options.limit));
  }

  if (options.maxDepth !== undefined) {
    args.push('--max-depth', String(options.maxDepth));
  }

  return args;
}

export function createCodegraphInvocation(options: CodegraphInvocationOptions): CodegraphInvocation {
  assertSupportedSubcommand(options.subcommand);
  const projectRoot = resolveProjectRoot(options.project);
  // Slice rid-CG-003 — spawn the upstream binary inside the
  // resolved codegraph dir's PARENT so its default `.codegraph/`
  // discovery lands on `.peaks/.codegraph/` (preferred) or
  // `.codegraph/` (legacy fallback).
  const location = resolveCodegraphProjectRoot(projectRoot);

  assertSupportedOptions(options);
  assertRequiredOptions(options);
  assertPositiveInteger(options.limit, 'limit');
  assertPositiveInteger(options.maxDepth, 'maxDepth');

  return {
    executable: CODEGRAPH_EXECUTABLE,
    args: buildCommandArgs(options, projectRoot),
    cwd: location.cwd,
    packageName: CODEGRAPH_PACKAGE_NAME,
    packageVersion: CODEGRAPH_PACKAGE_VERSION,
    subcommand: options.subcommand
  };
}

export async function executeCodegraphInvocation(
  invocation: CodegraphInvocation,
  runner: CodegraphProcessRunner = defaultCodegraphProcessRunner
): Promise<CodegraphExecutionResult> {
  return runner(invocation);
}

/* ──────────────────────────────────────────────────────────────────────
 * Slice rid-CG-003 — preferred `.peaks/.codegraph/` lookup + legacy
 * root `.codegraph/` fallback (spike follow-up #1).
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Slice rid-CG-006 — root `.codegraph/` (legacy). peaks-loop still
 * reads from this location for back-compat with downstream consumers
 * whose projects pre-date the slice rid-CG-003 preferred-path move.
 */
export const CODEGRAPH_DIR_NAME = '.codegraph';
/**
 * Slice rid-CG-003 — preferred managed location. Going forward
 * peaks-loop writes here; legacy root `.codegraph/` is only used
 * when it pre-exists AND `.peaks/.codegraph/` does not.
 */
export const PREFERRED_CODEGRAPH_DIR = '.peaks/.codegraph';
/**
 * Marker file peaks-loop writes inside the resolved codegraph dir
 * after a successful upstream init. Its presence distinguishes
 * peaks-loop-managed schemas from foreign ones (aider / cody /
 * etc. all happily use the same directory name).
 */
export const CODEGRAPH_MARKER_NAME = '.peaks-loop-marker';
export const CODEGRAPH_INIT_CONFLICT_EXIT_CODE = 73;

export type ResolvedCodegraphLocation =
  | { readonly source: 'preferred'; readonly cwd: string; readonly codegraphDir: string }
  | { readonly source: 'legacy'; readonly cwd: string; readonly codegraphDir: string }
  | { readonly source: 'fresh-preferred'; readonly cwd: string; readonly codegraphDir: string };

/**
 * Slice rid-CG-003 — pure resolver that returns the cwd the
 * upstream codegraph binary should be spawned with and the
 * absolute path to the data directory it should read/write.
 *
 * Precedence:
 *   1. `<projectRoot>/.peaks/.codegraph/` exists → use it
 *      (cwd = `<projectRoot>/.peaks`, codegraphDir = preferred path)
 *   2. `<projectRoot>/.codegraph/` exists → fall back to legacy
 *      (cwd = `<projectRoot>`, codegraphDir = legacy path)
 *   3. neither exists → default to the preferred path so the next
 *      `peaks codegraph init` lands in `.peaks/.codegraph/`
 *      (cwd = `<projectRoot>/.peaks`, codegraphDir = preferred path,
 *       `source: 'fresh-preferred'`)
 *
 * The cwd is the directory the upstream binary treats as "project
 * root" — the binary's default codegraph discovery reads
 * `<cwd>/.codegraph/`, so we always set cwd to the PARENT of the
 * resolved codegraph dir. Pure fs check; no IO beyond `existsSync`.
 */
export function resolveCodegraphProjectRoot(projectRoot: string): ResolvedCodegraphLocation {
  const preferredDir = join(projectRoot, PREFERRED_CODEGRAPH_DIR);
  const legacyDir = join(projectRoot, CODEGRAPH_DIR_NAME);

  if (existsSync(preferredDir)) {
    return {
      source: 'preferred',
      cwd: join(projectRoot, '.peaks'),
      codegraphDir: preferredDir
    };
  }

  if (existsSync(legacyDir)) {
    return {
      source: 'legacy',
      cwd: projectRoot,
      codegraphDir: legacyDir
    };
  }

  return {
    source: 'fresh-preferred',
    cwd: join(projectRoot, '.peaks'),
    codegraphDir: preferredDir
  };
}

export type CodegraphInitGuardResult =
  | { status: 'fresh'; codegraphDir: string }
  | { status: 'noop-already-peaks-loop'; codegraphDir: string }
  | { status: 'conflict-foreign-schema'; codegraphDir: string };

export class CodegraphInitConflictError extends Error {
  public readonly code = 'CODEGRAPH_INIT_CONFLICT';
  public readonly exitCode = CODEGRAPH_INIT_CONFLICT_EXIT_CODE;

  public constructor(message: string, public readonly codegraphDir: string) {
    super(message);
    this.name = 'CodegraphInitConflictError';
  }
}

export type CodegraphInitGuard = (projectRoot: string) => CodegraphInitGuardResult;

/**
 * Inspect a candidate codegraph directory and return its guard
 * status. A file (or symlink-to-file) at the path counts as a
 * foreign-schema conflict because it blocks directory creation.
 */
function inspectCandidateCodegraphDir(codegraphDir: string): CodegraphInitGuardResult {
  let isDir = false;
  try {
    isDir = statSync(codegraphDir).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) {
    return { status: 'conflict-foreign-schema', codegraphDir };
  }

  const markerPath = join(codegraphDir, CODEGRAPH_MARKER_NAME);
  if (existsSync(markerPath)) {
    return { status: 'noop-already-peaks-loop', codegraphDir };
  }

  return { status: 'conflict-foreign-schema', codegraphDir };
}

/**
 * Slice rid-CG-003 — preferred-path-first init guard.
 *
 * Looks at `.peaks/.codegraph/` first; falls back to `.codegraph/`
 * when the preferred path is absent. The 'fresh' case returns the
 * preferred path so the next `peaks codegraph init` lands inside
 * `.peaks/` instead of polluting the project root.
 */
export function defaultCodegraphInitGuard(projectRoot: string): CodegraphInitGuardResult {
  const preferredDir = join(projectRoot, PREFERRED_CODEGRAPH_DIR);
  const legacyDir = join(projectRoot, CODEGRAPH_DIR_NAME);

  if (existsSync(preferredDir)) {
    return inspectCandidateCodegraphDir(preferredDir);
  }

  if (existsSync(legacyDir)) {
    return inspectCandidateCodegraphDir(legacyDir);
  }

  return { status: 'fresh', codegraphDir: preferredDir };
}

/**
 * Pure-fs helper that stamps the peaks-loop marker AFTER a
 * successful upstream init. The CLI action must call this after
 * `executeCodegraphInvocation` returns exit 0.
 */
export function writeCodegraphMarker(codegraphDir: string): void {
  writeFileSync(join(codegraphDir, CODEGRAPH_MARKER_NAME), 'peaks-loop-managed\n', 'utf8');
}

/**
 * Test seam — pure stub of the default guard. Lets callers inject a
 * pre-computed outcome without touching the real filesystem.
 */
export function constantCodegraphInitGuard(outcome: CodegraphInitGuardResult): CodegraphInitGuard {
  return () => outcome;
}

/* ──────────────────────────────────────────────────────────────────────
 * Slice rid-CG-002 — affected-context envelope writer
 * ────────────────────────────────────────────────────────────────────── */

/**
 * Per-file row rendered into the codegraph-context envelope's
 * Markdown table. Symbol-count + cross-ref edges are intentionally
 * optional: when the upstream `affected` JSON does not carry them
 * (older codegraph versions, or a non-JSON stdout) we leave the
 * cells blank instead of inventing numbers.
 */
export type CodegraphAffectedRow = {
  readonly file: string;
  readonly symbolCount?: number;
  readonly crossRefEdges?: number;
};

export type WriteCodegraphAffectedContextInput = {
  /** The peaks-loop project root (where `.peaks/_runtime/` lives). */
  readonly projectRoot: string;
  /** Request id, e.g. `rid-CG-002`. Used as the envelope's anchor. */
  readonly rid: string;
  /** Project-relative file paths passed to `peaks codegraph affected`. */
  readonly files: readonly string[];
  /** Raw upstream payload (string or already-parsed JSON). */
  readonly affectedPayload: unknown;
  /**
   * Optional override for the active session id. When omitted,
   * the writer calls `getSessionId(projectRoot)` and falls
   * back to a graceful skip-with-warning when no binding is
   * present (e.g. the consumer ran `peaks codegraph affected`
   * outside of a peaks session).
   */
  readonly sessionId?: string | null;
  /**
   * Optional clock seam for tests; defaults to `new Date()`.
   */
  readonly now?: () => Date;
};

export type WriteCodegraphAffectedContextResult =
  | { readonly written: true; readonly path: string; readonly sessionId: string }
  | { readonly written: false; readonly path: ''; readonly warning: string };

/**
 * Pure renderer — turns the affected payload + rid + file list
 * into a Markdown body with a leading human-readable table and
 * a trailing JSON fence for machine consumers.
 */
export function renderCodegraphAffectedContext(
  rid: string,
  files: readonly string[],
  affectedPayload: unknown,
  sessionId: string,
  now: () => Date = () => new Date()
): string {
  const rows: CodegraphAffectedRow[] = files.map((file) => ({ file }));
  const generatedAt = now().toISOString();
  const lines: string[] = [
    '# Codegraph orchestration context',
    '',
    `- sessionId: \`${sessionId}\``,
    `- rid: \`${rid}\``,
    `- generatedAt: \`${generatedAt}\``,
    '',
    '## Affected files',
    '',
    '| file | symbolCount | crossRefEdges |',
    '| --- | --- | --- |',
    ...rows.map((row) => {
      const sym = row.symbolCount === undefined ? '' : String(row.symbolCount);
      const edges = row.crossRefEdges === undefined ? '' : String(row.crossRefEdges);
      return `| \`${row.file}\` | ${sym} | ${edges} |`;
    }),
    '',
    '## Raw upstream output',
    '',
    '```json',
    typeof affectedPayload === 'string'
      ? affectedPayload
      : JSON.stringify(affectedPayload, null, 2),
    '```',
    ''
  ];
  return lines.join('\n');
}

/**
 * Write the `codegraph-context.md` envelope into the canonical
 * session directory (`.peaks/_runtime/<sessionId>/rd/`). The
 * envelope is what peaks-code's RD dispatch hook reads back to
 * seed the QA / TXT handoff (see `peaks-code/SKILL.md`
 * §"Codegraph orchestration context").
 *
 * The function is intentionally side-effect-safe:
 *   - No session binding → returns `{ written: false, warning }`,
 *     does NOT throw. Callers can either surface the warning or
 *     treat it as a no-op.
 *   - Directory creation is `mkdirSync({ recursive: true })`, so
 *     the first run in a fresh session creates the `rd/` subdir
 *     on demand.
 *   - The path is canonicalized through `getSessionDir` so
 *     downstream readers (QA / TXT) get a stable path even when
 *     the caller passed a relative `projectRoot`.
 */
export function writeCodegraphAffectedContext(
  input: WriteCodegraphAffectedContextInput
): WriteCodegraphAffectedContextResult {
  const sessionId = input.sessionId ?? getSessionId(input.projectRoot);
  if (!sessionId || sessionId.length === 0) {
    return {
      written: false,
      path: '',
      warning:
        'No active peaks-loop session binding; skipping codegraph-context envelope. ' +
        'Run `peaks workspace init` (or `peaks session set <id>`) and re-invoke ' +
        '`peaks codegraph affected`.'
    };
  }
  const sessionDir = getSessionDir(input.projectRoot, sessionId);
  const rdDir = join(sessionDir, 'rd');
  if (!existsSync(rdDir)) {
    mkdirSync(rdDir, { recursive: true });
  }
  const contextPath = join(rdDir, 'codegraph-context.md');
  const body = renderCodegraphAffectedContext(
    input.rid,
    input.files,
    input.affectedPayload,
    sessionId,
    input.now
  );
  writeFileSync(contextPath, body, 'utf8');
  return { written: true, path: contextPath, sessionId };
}
