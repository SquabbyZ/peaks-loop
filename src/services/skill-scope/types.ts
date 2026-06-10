/**
 * `peaks skill scope` — slice 025 multi-IDE skill scoping types.
 *
 * This file is the single source of truth for the `SkillScopeAdapter`
 * interface (G1). It is consumed by every per-IDE adapter (Claude Code
 * full impl, 5 stub adapters) and by the detection algorithm + CLI.
 *
 * Design notes (see tech-doc-025 §2):
 * - The interface is deliberately small: only the four operations the CLI
 *   actually needs (detect / apply / show / reset).
 * - `detect()` returns a confidence score in [0, 1] so the registry can
 *   pick the best match when several adapters are partially active.
 * - Errors are typed (NotSupportedError / ScopeApplyError), not strings.
 *   The CLI maps `ScopeApplyError.code` to exit codes (see tech-doc §6.3).
 */

import type { IdeId } from '../ide/ide-types.js';

/** Detection bucket for a single installed skill (G5). */
export type SkillRelevance = 'relevant' | 'borderline' | 'irrelevant';

/** Skill category — used for the JSON envelope's `kind` field (AC1). */
export type SkillKind = 'peaks-family' | 'generic-ai' | 'language-specific' | 'other';

/** Per-skill detail emitted by the detect algorithm. */
export interface SkillScopeRecord {
  /** Skill directory name (e.g. "peaks-rd", "tdd-guide"). */
  readonly name: string;
  /** Category — peaks-family, generic-ai, language-specific, other. */
  readonly kind: SkillKind;
  /** Detection bucket. */
  readonly relevance: SkillRelevance;
  /** Human-readable reasons that produced the bucket; stable for fixtures. */
  readonly reasons: readonly string[];
}

/** Counts of skills per bucket, for the JSON envelope (AC1). */
export interface SkillScopeCounts {
  readonly relevant: number;
  readonly borderline: number;
  readonly irrelevant: number;
}

/** Project signals extracted from package.json + tsconfig + file tree (G5). */
export interface ProjectSignals {
  /** True when the project's root package.json exists. */
  readonly hasPackageJson: boolean;
  readonly isTypeScript: boolean;
  readonly isTypeScriptESM: boolean;
  readonly isReact: boolean;
  readonly isVue: boolean;
  readonly isSvelte: boolean;
  readonly isNext: boolean;
  readonly isNestJS: boolean;
  readonly isExpress: boolean;
  readonly isFastify: boolean;
  readonly isPostgres: boolean;
  readonly isMysql: boolean;
  readonly isMongo: boolean;
  readonly isRedis: boolean;
  readonly isDocker: boolean;
  readonly isK8s: boolean;
  readonly isCommander: boolean;
  readonly isCodegraph: boolean;
  readonly isHeadroom: boolean;
  /** True when the project is a Python project (no package.json / has pyproject). */
  readonly isPython: boolean;
  /** Major version of Node engine requirement, or null. */
  readonly nodeEngineMajor: number | null;
  /** Top file extensions under src/ (max 50, lexicographically sorted, unique). */
  readonly topExtensions: readonly string[];
  /** Per-extension presence flags derived from topExtensions. */
  readonly hasFileExtension: Readonly<Record<string, boolean>>;
  /**
   * Per-extension fractional share (file count / total files, in [0, 1]).
   * Slice 025 / R003.1: replaces the binary `hasFileExtension` for the
   * keyword-matching path. A language/framework skill becomes `relevant`
   * only when its corresponding share is >= the configured threshold
   * (default 0.05). Extensions with 0 files are absent.
   */
  readonly shareByExtension: Readonly<Record<string, number>>;
}

/**
 * Default threshold for the share-based relevance check (R003.1).
 * Override at runtime with `PEAKS_SCOPE_THRESHOLD=0.05` (env) or
 * `--threshold 0.05` (CLI).
 */
export const SCOPE_THRESHOLD_DEFAULT = 0.05;

/**
 * Read the threshold from `PEAKS_SCOPE_THRESHOLD` env var, clamped to
 * [0, 1]. Falls back to SCOPE_THRESHOLD_DEFAULT.
 */
export function readScopeThreshold(): number {
  const raw = process.env['PEAKS_SCOPE_THRESHOLD'];
  if (raw === undefined || raw === '') return SCOPE_THRESHOLD_DEFAULT;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return SCOPE_THRESHOLD_DEFAULT;
  if (parsed < 0) return 0;
  if (parsed > 1) return 1;
  return parsed;
}

/** The shape of the always-written source-of-truth file. */
export interface ScopeConfig {
  /** ISO-8601 UTC timestamp at which this scope was last applied. */
  readonly generatedAt: string;
  /** Detected or explicitly-selected IDE id. */
  readonly ide: IdeId;
  /** Strictness mode (drives borderline handling). */
  readonly strict: boolean;
  /** Skills the user wants available (LLM-invokable). Always includes all peaks-*. */
  readonly allowlist: readonly string[];
  /** Skills the user wants hidden. */
  readonly denylist: readonly string[];
  /** Per-skill reasons (mirrored from detect, for audit). */
  readonly skills: readonly SkillScopeRecord[];
  /** Project signals that drove the classification. */
  readonly signals: ProjectSignals;
}

/** Returned from `applyScope`. */
export interface ApplyResult {
  /** Adapter id that handled the apply. */
  readonly ide: IdeId;
  /** Whether the apply succeeded (false = NOT_SUPPORTED or hard failure). */
  readonly ok: boolean;
  /** Absolute paths the adapter wrote or removed. */
  readonly writtenFiles: readonly string[];
  /** Whether shadow stubs were used (Claude Code fallback path). */
  readonly usedShadowStub: boolean;
  /** Whether the adapter returned NOT_SUPPORTED and only wrote the source-of-truth. */
  readonly notSupported: boolean;
  /** Peaks-* skills the adapter stripped from the denylist (G6 enforcement report). */
  readonly strippedFromDenylist?: readonly string[];
  /** Optional error code when ok=false. */
  readonly error?: { readonly code: string; readonly message: string };
}

/** Returned from `showScope`. */
export interface ShowScopeResult {
  /** The source-of-truth config, or null if no scope has been applied. */
  readonly source: ScopeConfig | null;
  /** Whatever the adapter can read back from its native config. Null if not supported. */
  readonly native: unknown;
  /** Adapter id. */
  readonly ide: IdeId;
}

/** Reset output mirrors apply but without the lists. */
export interface ResetScopeResult {
  readonly ide: IdeId;
  readonly removedFiles: readonly string[];
}

/** Sentinel error type for stub adapters (G3). */
export class NotSupportedError extends Error {
  readonly code = 'NOT_SUPPORTED' as const;
  readonly ide: IdeId;
  constructor(ide: IdeId, message: string) {
    super(`${ide}: ${message}`);
    this.name = 'NotSupportedError';
    this.ide = ide;
  }
}

/** Errors emitted by adapters (validated by runtime probe in claude-code §3.4). */
export type ScopeApplyErrorCode =
  | 'NOT_SUPPORTED'
  | 'IO_ERROR'
  | 'MALFORMED_CONFIG'
  | 'WRITE_FAILED'
  | 'PARTIAL_FAILURE';

export class ScopeApplyError extends Error {
  readonly code: ScopeApplyErrorCode;
  readonly ide: IdeId;
  constructor(code: ScopeApplyErrorCode, message: string, ide: IdeId) {
    super(`${ide}: ${message}`);
    this.name = 'ScopeApplyError';
    this.code = code;
    this.ide = ide;
  }
}

/** Input to `applyScope`. */
export interface ApplyScopeInput {
  /** Final allowlist (the CLI guarantees peaks-* is in here before calling). */
  readonly allowlist: readonly string[];
  /** Final denylist. */
  readonly denylist: readonly string[];
  /** Strictness mode. */
  readonly strict: boolean;
  /** Project root for resolving relative paths. */
  readonly projectRoot: string;
  /** Source-of-truth config that the adapter MAY re-derive fields from. */
  readonly sourceConfig: ScopeConfig;
  /** When true, prefer shadow-stub fallback over the native config. */
  readonly shadowFallback: boolean;
  /** Test seam: simulate an adapter write failure (returns the partial path written before failure). */
  readonly simulateWriteFailure?: boolean;
}

/** Reset input mirrors apply but without the lists. */
export interface ResetScopeInput {
  readonly projectRoot: string;
}

/** The interface every adapter implements. */
export interface SkillScopeAdapter {
  /** Adapter id; matches the IdeId it pairs with. */
  readonly ide: IdeId;
  /** Whether this adapter supports a real (non-stub) implementation. */
  readonly supported: boolean;
  /** Detect this adapter's IDE is active in the given project root. Returns a confidence score in [0,1]. */
  detect(projectRoot: string): Promise<number>;
  /** Write the IDE-specific scope config. */
  applyScope(input: ApplyScopeInput): Promise<ApplyResult>;
  /** Read the current scope config. */
  showScope(projectRoot: string): Promise<ShowScopeResult>;
  /** Remove the IDE-specific scope config. */
  resetScope(input: ResetScopeInput): Promise<ResetScopeResult>;
}

/** Helper: build a NOT_SUPPORTED ApplyResult (for stub adapters that pre-write source-of-truth). */
export function makeNotSupportedResult(
  ide: IdeId,
  message: string,
  writtenFiles: readonly string[] = []
): ApplyResult {
  return {
    ide,
    ok: false,
    writtenFiles: [...writtenFiles],
    usedShadowStub: false,
    notSupported: true,
    error: { code: 'NOT_SUPPORTED', message },
  };
}

/** Hard-coded allowlist of peaks-* skills (G6 + generic AI-engineering skills per AC2). */
export const ALWAYS_RELEVANT_SKILLS: readonly string[] = [
  // peaks-* family (G6 hard constraint)
  'peaks-rd', 'peaks-qa', 'peaks-solo', 'peaks-prd', 'peaks-sc',
  'peaks-txt', 'peaks-sop', 'peaks-solo-resume', 'peaks-solo-status',
  'peaks-solo-test', 'peaks-ui', 'peaks-ide',
  // generic AI-engineering skills (per AC2)
  'tdd-guide', 'coding-standards', 'karpathy-guidelines',
  'continuous-learning', 'code-tour', 'agent-harness-construction',
  'security-review', 'code-review',
] as const;

/** Hard-coded denylist prefixes: non-TS language families (G5 §5.4). */
export const NON_TS_SKILL_PREFIXES: readonly string[] = [
  'kotlin-', 'python-', 'java-', 'rust-', 'go-', 'ruby-',
  'swift-', 'csharp-', 'cpp-',
] as const;

/** File extensions the file-tree walker looks for (top-50 limit per tech-doc §5.1). */
export const TRACKED_EXTENSIONS: readonly string[] = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.swift', '.kt', '.kts', '.java', '.scala',
  '.py', '.pyx', '.go', '.rs',
  '.rb', '.php', '.cs', '.cpp', '.c', '.h', '.hpp',
  '.vue', '.svelte', '.html', '.css', '.scss',
  '.json', '.yaml', '.yml', '.toml', '.md',
  '.sql', '.sh', '.bash', '.ps1',
  '.dockerfile', '.dockerignore', '.lua', '.ex', '.exs', '.erl', '.hs',
  '.dart', '.r', '.jl', '.clj',
];