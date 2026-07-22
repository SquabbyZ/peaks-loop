/**
 * Slice 2026-06-16-peaks-code-auto-scaffold (RD#7) — missing-standards-detector.
 *
 * Read-side companion to the `peaks standards init` / `peaks standards update`
 * writers in `./project-standards-service.ts`. The writer KNOWS how to scaffold
 * `.peaks/standards/{common,<language>}/` (2.0 canonical) from the curated
 * baseline; this module detects when the consumer project's rules tree is
 * missing or empty and emits a copy-pasteable diagnostic for the operator.
 *
 * Why a separate read module: the writer is `apply`-gated and write-bounded
 * (it touches the filesystem via `prevalidateWrites`/`assertNotHomedirBaseline`).
 * The detector is read-only and platform-aware (win32 path separators for
 * Windows consumers) — coupling the two would force the writer to grow a
 * read-only flag and a platform-switching argument.
 *
 * Cross-platform path rendering (AC6): the detector switches on
 * `process.platform` and renders the project path with `path.sep` so Windows
 * consumers see `C:\Users\<u>\project\.claude\rules\` verbatim rather than the
 * POSIX form. The detection logic itself (readdirSync on `node:fs`) is
 * platform-neutral.
 *
 * Once-per-session dedup (AC7): `peaks workspace init` writes a marker at
 * `.peaks/_runtime/<sessionId>/.standards-checked` after the first detection
 * pass. `detectMissingProjectStandards` does NOT consult the marker — that's
 * the caller's responsibility (the CLI command decides whether to skip per
 * AC7's "once per session" contract).
 */

import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, sep as pathSep } from 'node:path';

import type { StandardsLanguage } from './project-standards-service.js';

export type MissingProjectStandardsDiagnostic = {
  readonly missing: boolean;
  /**
   * Absolute path to the rules root (`<projectRoot>/.claude/rules`). Rendered
   * with the platform-native separator so Windows consumers see
   * `C:\...\.claude\rules` verbatim.
   */
  readonly path: string;
  /**
   * Copy-pasteable remediation hint for the operator. Always present, even
   * when `missing: false`, so downstream callers can show "if you ever need
   * to re-scaffold: ..." as a nextAction without re-running the detector.
   */
  readonly remediation: string;
  readonly language: StandardsLanguage;
};

const SUPPORTED_LANGUAGES: ReadonlySet<StandardsLanguage> = new Set([
  'generic',
  'typescript',
  'javascript',
  'python',
  'go',
  'rust'
]);

function normalizeProjectRoot(projectRoot: string): string {
  return isAbsolute(projectRoot) ? projectRoot : join(process.cwd(), projectRoot);
}

function renderForPlatform(projectRoot: string): string {
  // AC6: render with the platform-native separator. On win32 we replace '/'
  // with '\\' in the project path; the rest of the path is constructed with
  // the same separator via the literal '\\' join below.
  //
  // 2.0 canonical location: `<projectRoot>/.peaks/standards/`
  // (slice 2026-07-15-missing-standards-on-fresh-project — the 2.0
  // writer scaffolds the rules tree under `.peaks/standards/`, not
  // the legacy `.claude/rules/`).
  if (process.platform === 'win32') {
    const nativeRoot = projectRoot.replace(/\//g, '\\');
    return `${nativeRoot}\\.peaks\\standards`;
  }
  return `${projectRoot}/.peaks/standards`;
}

function hasPopulatedMarkdown(dir: string): boolean {
  if (!existsSync(dir)) return false;
  const stat = statSync(dir);
  if (!stat.isDirectory()) return false;
  const entries = readdirSync(dir);
  return entries.some((entry) => entry.toLowerCase().endsWith('.md'));
}

/**
 * List which standards tree components are missing vs populated.
 *
 * Returns one of three stable shapes:
 *   - { kind: 'complete' }                    — both common + language overlay populated
 *   - { kind: 'common-missing' }              — common dir absent/empty (universal)
 *   - { kind: 'language-missing', language }  — common ok, language overlay absent/empty
 *
 * The detector previously returned a single boolean that flipped to
 * "missing: true" the moment the language overlay was empty, but printed
 * the remediation as if BOTH common AND language were missing — a UX bug
 * that surfaced in ice-cola (common=4 .md files; typescript=1 .md file;
 * javascript overlay absent → label said "no project-local standards found"
 * even though common was clearly populated). This split lets the CLI emit
 * a precise remediation string per kind.
 */
export type StandardsTreeDiagnostic =
  | { readonly kind: 'complete' }
  | { readonly kind: 'common-missing' }
  | { readonly kind: 'language-missing'; readonly language: StandardsLanguage };

export function diagnoseStandardsTree(
  projectRoot: string,
  language: StandardsLanguage
): StandardsTreeDiagnostic {
  if (!SUPPORTED_LANGUAGES.has(language)) {
    throw new Error(`Unsupported standards language: ${String(language)}`);
  }

  const normalizedRoot = normalizeProjectRoot(projectRoot);
  const commonDir = join(normalizedRoot, '.peaks', 'standards', 'common');
  const languageDir = language === 'generic'
    ? null
    : join(normalizedRoot, '.peaks', 'standards', language);

  const commonOk = hasPopulatedMarkdown(commonDir);
  const languageOk = languageDir === null ? true : hasPopulatedMarkdown(languageDir);

  if (commonOk && languageOk) {
    return { kind: 'complete' };
  }
  if (!commonOk) {
    return { kind: 'common-missing' };
  }
  // common ok, language overlay empty/missing
  return { kind: 'language-missing', language };
}

/**
 * Detect whether a consumer project's `.peaks/standards/` tree (2.0
 * canonical) is missing or empty.
 *
 * Rules (per PRD R2, slice 2026-07-15):
 *   - `.peaks/standards/common/` MUST exist AND contain at least one
 *     `.md` file.
 *   - `.peaks/standards/<language>/` MUST exist AND contain at least one
 *     `.md` file — except for `generic`, where the language dir is
 *     OPTIONAL.
 *
 * Returns `{ missing: true, ... }` when either required dir is absent or
 * empty. The diagnostic is always populated so the caller can surface the
 * remediation hint unconditionally (the CLI uses the same string for both
 * the stderr banner and the JSON envelope warning).
 */
export function detectMissingProjectStandards(
  projectRoot: string,
  language: StandardsLanguage
): MissingProjectStandardsDiagnostic {
  if (!SUPPORTED_LANGUAGES.has(language)) {
    throw new Error(`Unsupported standards language: ${String(language)}`);
  }

  const normalizedRoot = normalizeProjectRoot(projectRoot);
  const renderedPath = renderForPlatform(normalizedRoot);
  const diagnostic = diagnoseStandardsTree(projectRoot, language);

  // Bug-01 fix (ice-cola surface check 2026-07-22): the previous
  // remediation said "no project-local standards found" whenever EITHER
  // common or the language overlay was empty, which misrepresented
  // projects that have common populated but a missing language overlay
  // (e.g. ice-cola has common/*.md + typescript/coding-style.md but no
  // javascript/coding-style.md). The remediation now distinguishes the
  // three kinds so the operator gets a precise hint.
  let missing: boolean;
  let remediation: string;
  if (diagnostic.kind === 'complete') {
    missing = false;
    remediation = `Project-local standards already present at ${renderedPath}. Re-run \`peaks standards init --project ${normalizedRoot} --apply\` to refresh from the curated baseline.`;
  } else if (diagnostic.kind === 'common-missing') {
    missing = true;
    remediation = `⚠ no project-local common standards at ${renderedPath} — run \`peaks standards init --project ${normalizedRoot} --apply\` to scaffold (language: ${language}), or pass --init-standards to peaks workspace init for one-shot auto-apply.`;
  } else {
    missing = true;
    const overlayName = diagnostic.language;
    remediation = `⚠ common standards present at ${renderedPath}\\common but ${overlayName} language overlay is missing — run \`peaks standards init --project ${normalizedRoot} --apply\` to scaffold the ${overlayName} overlay (or pass --init-standards to peaks workspace init for one-shot auto-apply).`;
  }

  return {
    missing,
    path: renderedPath,
    remediation,
    language
  };
}

/**
 * Once-per-session marker file path. The CLI writes this file under
 * `.peaks/_runtime/<sessionId>/` after the first diagnostic pass so that
 * subsequent `peaks workspace init` invocations within the same session
 * skip the stderr banner (the diagnostic is still computable for
 * programmatic consumers via `detectMissingProjectStandards`).
 */
export function getStandardsCheckedMarkerPath(projectRoot: string, sessionId: string): string {
  const normalizedRoot = normalizeProjectRoot(projectRoot);
  // Canonical session runtime dir — see `.peaks/memory/session-dir-canonical-resolver-must-route-all-writes.md`.
  return join(normalizedRoot, '.peaks', '_runtime', sessionId, '.standards-checked');
}

/**
 * Mark this session as "standards checked" so subsequent invocations can
 * skip the stderr diagnostic. Idempotent: existing marker is left as-is.
 * Returns true if the marker was newly created, false if it already existed.
 */
export function markStandardsChecked(projectRoot: string, sessionId: string): boolean {
  const markerPath = getStandardsCheckedMarkerPath(projectRoot, sessionId);
  if (existsSync(markerPath)) return false;
  mkdirSync(join(markerPath, '..'), { recursive: true });
  writeFileSync(markerPath, 'standards-checked\n', 'utf8');
  return true;
}

/**
 * Test seam: check whether the once-per-session marker exists. Caller is
 * responsible for routing the result into the AC7 dedup logic.
 */
export function hasStandardsCheckedMarker(projectRoot: string, sessionId: string): boolean {
  return existsSync(getStandardsCheckedMarkerPath(projectRoot, sessionId));
}

// Re-export path.sep for tests that want to assert the platform invariant.
export const platformPathSeparator = pathSep;