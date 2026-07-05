/**
 * Slice 2026-06-16-peaks-rd-no-gates — missing-project-standards diagnostic
 * + JSON gate list shape for the RD bootstrap path.
 *
 * Background: when `peaks-rd` (or `peaks-qa` / `peaks-code`) starts in a
 * project whose `.claude/rules/{common,typescript}/` is missing or empty,
 * the existing code-review / security / performance gates were silently
 * dropped. This module makes the missing-standards condition observable:
 *
 *   G1  `detectMissingProjectStandards` + `renderRdStandardsDiagnostic`
 *       produce a clear stderr/JSON diagnostic with a copy-pasteable
 *       `peaks standards init --project <X> --apply` remediation hint.
 *   G2  `resolveRdStartupStandardsCheck({ strict: true })` returns an
 *       exitCode of 1 with errorCode `EPEAKS_NO_STANDARDS` when standards
 *       are missing. Default (`strict: false`) keeps the warn-and-continue
 *       behavior so existing users with empty rules don't break.
 *   G3  `buildRdStandardsGateList` returns the three gates each marked
 *       `{ status: 'skipped', reason: 'no project-local standards' }` when
 *       standards are missing. When present, gates are `{ status: 'ready' }`.
 *   G4  The remediation string is the exact copy-pasteable CLI invocation.
 *
 * This module is a pure-function helper. The `peaks rd` / `peaks qa` /
 * `peaks solo` runtime hooks call `resolveRdStartupStandardsCheck` at
 * bootstrap and decide whether to write `process.stderr` + JSON envelope
 * + exit. The bootstrap is intentionally side-effect-free here so unit
 * tests can run it without spawning child processes.
 *
 * Cross-platform: `path` field is rendered verbatim from the caller's
 * projectRoot string (we never normalize or rewrite the user's path —
 * Windows users see their `C:\Users\foo` form; macOS / Linux users see
 * their `/Users/foo` form). The remediation command always uses POSIX
 * forward slashes since the CLI is invoked through a shell that
 * double-normalizes on Windows (`peaks standards init --project C:/Users/...`).
 *
 * Out of scope (downstream slices):
 *   - audit-log emission for gate-skip events (see memory
 *     `peaks-ide-skill-ac-10-audit-log-writer-is-a-thin-helper-not-a-separate-cli-primitive`
 *     — the helper is intentionally not surfaced here).
 *   - one-time suppression marker (`peaks standards suppress --project <X>`
 *     or `.peaks/.no-standards`); tracked in PRD#004 R3 as a future slice.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Stable exit code surfaced to the CLI when `--strict-standards` is set. */
export const EPEAKS_NO_STANDARDS = 'EPEAKS_NO_STANDARDS' as const;

/** Subdirectories of `<projectRoot>/.claude/rules/` that must be populated. */
export type RdStandardsSubdir = 'common' | 'typescript';

export const RD_STANDARDS_REQUIRED_SUBDIRS: ReadonlyArray<RdStandardsSubdir> = ['common', 'typescript'] as const;

/** The three gates the RD bootstrap inspects. */
export type RdStandardGateName = 'code-review' | 'security-review' | 'performance-review';

export type RdStandardGateStatus = 'ready' | 'skipped';

export type RdStandardGate = {
  readonly name: RdStandardGateName;
  readonly status: RdStandardGateStatus;
  readonly reason: string | null;
};

export type DetectMissingProjectStandardsInput = {
  readonly projectRoot: string;
};

export type DetectMissingProjectStandardsResult = {
  readonly missing: boolean;
  readonly path: string;
  readonly missingSubdirs: ReadonlyArray<RdStandardsSubdir>;
  readonly remediation: string;
};

export type RenderRdStandardsDiagnosticInput = {
  readonly projectRoot: string;
  readonly detection: DetectMissingProjectStandardsResult;
};

export type ResolveRdStartupStandardsCheckInput = {
  readonly projectRoot: string;
  readonly strict: boolean;
};

export type ResolveRdStartupStandardsCheckResult = {
  readonly exitCode: 0 | 1;
  readonly errorCode: typeof EPEAKS_NO_STANDARDS | null;
  readonly diagnostic: string | null;
  readonly gates: ReadonlyArray<RdStandardGate>;
};

/**
 * Pure detection: scan `<projectRoot>/.claude/rules/{common,typescript}/`
 * for at least one `.md` rule file per subdir. Empty subdirs and missing
 * subdirs both count as "missing".
 *
 * Defensive: never throws. Missing projectRoot, permission errors, or a
 * non-directory at the path all collapse to `{ missing: true }`. The caller
 * (CLI bootstrap) is expected to surface the remediation; this function
 * just reports the truth.
 */
export function detectMissingProjectStandards(input: DetectMissingProjectStandardsInput): DetectMissingProjectStandardsResult {
  const projectRoot = input.projectRoot;
  const rulesPath = join(projectRoot, '.claude', 'rules');
  const missingSubdirs: RdStandardsSubdir[] = [];

  if (!existsSync(rulesPath)) {
    return {
      missing: true,
      path: rulesPath,
      missingSubdirs: [...RD_STANDARDS_REQUIRED_SUBDIRS],
      remediation: buildRemediationCommand(projectRoot)
    };
  }

  for (const subdir of RD_STANDARDS_REQUIRED_SUBDIRS) {
    if (!hasMdRules(join(rulesPath, subdir))) {
      missingSubdirs.push(subdir);
    }
  }

  return {
    missing: missingSubdirs.length > 0,
    path: rulesPath,
    missingSubdirs,
    remediation: buildRemediationCommand(projectRoot)
  };
}

/**
 * Render the human-readable diagnostic line that goes to stderr.
 * The line is single-line + copy-pasteable so the model can echo it
 * into a Bash command verbatim.
 */
export function renderRdStandardsDiagnostic(input: RenderRdStandardsDiagnosticInput): string {
  const { projectRoot: _projectRoot, detection } = input;
  const missingList = detection.missingSubdirs.length > 0 ? ` (missing: ${detection.missingSubdirs.join(', ')})` : '';
  return [
    `⚠ no project-local standards found at ${detection.path}${missingList}`,
    `— run ${detection.remediation} to scaffold.`,
    `Gates (code-review, security-review, performance-review) will be skipped.`
  ].join(' ');
}

/**
 * Build the gate list for the JSON envelope returned by `peaks rd --json`.
 * Mirrors the PRD's AC2 contract: when missing, each gate is
 * `{ name, status: 'skipped', reason: 'no project-local standards' }`.
 */
export function buildRdStandardsGateList(input: { readonly missing: boolean }): ReadonlyArray<RdStandardGate> {
  if (input.missing) {
    return [
      { name: 'code-review', status: 'skipped', reason: 'no project-local standards' },
      { name: 'security-review', status: 'skipped', reason: 'no project-local standards' },
      { name: 'performance-review', status: 'skipped', reason: 'no project-local standards' }
    ];
  }
  return [
    { name: 'code-review', status: 'ready', reason: null },
    { name: 'security-review', status: 'ready', reason: null },
    { name: 'performance-review', status: 'ready', reason: null }
  ];
}

/**
 * Single entry point for the RD / QA / Solo bootstrap. Returns the
 * exit code + error code + diagnostic + gate list. The CLI wrapper is
 * responsible for `process.stderr.write(diagnostic ?? '')` and
 * `process.exit(result.exitCode)`.
 *
 * - `strict=true`  + missing  → exitCode 1, errorCode EPEAKS_NO_STANDARDS,
 *                                diagnostic + skipped gates emitted.
 * - `strict=false` + missing  → exitCode 0, errorCode null,
 *                                diagnostic + skipped gates emitted
 *                                (warn-and-continue; PRD NG1).
 * - strict any     + present  → exitCode 0, errorCode null,
 *                                diagnostic null, gates ready.
 */
export function resolveRdStartupStandardsCheck(input: ResolveRdStartupStandardsCheckInput): ResolveRdStartupStandardsCheckResult {
  const detection = detectMissingProjectStandards({ projectRoot: input.projectRoot });
  if (!detection.missing) {
    return {
      exitCode: 0,
      errorCode: null,
      diagnostic: null,
      gates: buildRdStandardsGateList({ missing: false })
    };
  }

  const diagnostic = renderRdStandardsDiagnostic({ projectRoot: input.projectRoot, detection });
  const exitCode: 0 | 1 = input.strict ? 1 : 0;
  return {
    exitCode,
    errorCode: input.strict ? EPEAKS_NO_STANDARDS : null,
    diagnostic,
    gates: buildRdStandardsGateList({ missing: true })
  };
}

// --- internal helpers -------------------------------------------------------

function buildRemediationCommand(projectRoot: string): string {
  // The remediation command is always rendered with POSIX forward slashes
  // because the CLI shell normalizes path separators on Windows anyway,
  // and users on macOS / Linux will copy this verbatim.
  const posix = projectRoot.split('\\').join('/');
  return `peaks standards init --project ${posix} --apply`;
}

function hasMdRules(dirPath: string): boolean {
  try {
    if (!existsSync(dirPath)) {
      return false;
    }
    const entries = readdirSync(dirPath);
    return entries.some((entry) => entry.toLowerCase().endsWith('.md'));
  } catch {
    return false;
  }
}