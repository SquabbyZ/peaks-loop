/**
 * Shared validation for the `--test-files` list.
 *
 * `--test-files` was RESOLVED but never CHECKED: `resolveTestFiles()` mapped
 * a pattern to an absolute path and stopped, and `scanAssertions()` read the
 * path literally. A missing path therefore surfaced as whatever the layer
 * BELOW it happened to throw, and the three `peaks mut` subcommands disagreed:
 * `run` / `mutants` reported the generic `MUT_FAILED`, `asserts` had no
 * `try`/`catch` and fell through to `UNHANDLED_ERROR` — both a bare `ENOENT`
 * carrying a machine absolute path.
 *
 * ONE RULE, THREE CALLERS. The same validator runs in the CLI (before any
 * Stryker run, assertion scan or report write), in the Stryker options
 * builder and in the assertion scanner, so the three subcommands answer the
 * same question the same way — same code, same exit code, same message shape.
 *
 * A PATTERN IS NEVER A MISSING FILE. `--test-files` accepts patterns and
 * Stryker expands them; reporting a pattern as missing would turn a working
 * glob into "file not found". Only a LITERAL path can be missing; the one
 * caller that needs literal files (the assertion scanner) rejects a pattern
 * with its own named code.
 *
 * THE MESSAGE NAMES PATHS RELATIVE TO THE PROJECT ROOT; the absolute path
 * travels in the error's `details`, which the CLI envelope carries in its
 * machine-readable `data` field.
 */
import { existsSync, readdirSync, statSync, type Dirent } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { MUT_ERROR_CODES, MutToolchainError } from './stryker-errors.js';

/** How many near-miss candidates a message may list. */
export const MAX_TEST_FILE_CANDIDATES = 5;

/**
 * The characters that make a `--test-files` value a PATTERN rather than a
 * literal path. A value carrying any of them is never resolved against the
 * file system as a single file.
 */
const PATTERN_METACHARACTERS = /[*?[\]{}]/;

/** Directories the near-miss search never descends into. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage', 'build', 'out']);

/** The near-miss search is bounded: it must never turn an error into a hang. */
const MAX_WALK_DEPTH = 8;
const MAX_COLLECTED_FILES = 20_000;

/** One unusable `--test-files` entry. */
export interface TestFileProblem {
  /** The named code this entry's failure carries. */
  readonly code: string;
  /** The value the caller passed, verbatim. */
  readonly input: string;
  /** The path relative to the project root, `/`-separated. */
  readonly display: string;
  /** True when the path resolves outside the project root. */
  readonly outsideProject: boolean;
  /** Near-miss candidates, relative to the project root. */
  readonly candidates: ReadonlyArray<string>;
}

export interface TestFilesInput {
  /** The project root — the scope of the run. */
  readonly project: string;
  /** The `--test-files` values, as the caller passed them. */
  readonly testFiles: ReadonlyArray<string>;
  /**
   * True when the caller can expand a PATTERN itself (the CLI and the
   * Stryker options builder can; the assertion scanner cannot — it reads
   * files).
   */
  readonly allowPatterns: boolean;
}

/** True when the value is a PATTERN rather than a literal path. */
export function isTestFilePattern(value: string): boolean {
  return PATTERN_METACHARACTERS.test(value);
}

/** The absolute path a `--test-files` value denotes. */
function absoluteTestFilePath(project: string, value: string): string {
  return isAbsolute(value) ? resolve(value) : resolve(project, value);
}

/**
 * The project-relative, `/`-separated name of an absolute path, plus whether
 * the path escapes the project root. A path OUTSIDE the root is reported as
 * `../…` — never as a machine absolute path.
 */
function displayTestFilePath(
  project: string,
  absolutePath: string
): {
  display: string;
  outsideProject: boolean;
} {
  const rel = relative(project, absolutePath);
  const outsideProject = rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  const trimmed = rel === '' ? basename(absolutePath) : rel;
  return { display: trimmed.split(sep).join('/'), outsideProject };
}

/** The entries of one directory, or none when it cannot be read. */
function readEntries(dir: string): Dirent[] {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** Directories the near-miss search never descends into. */
function isSkippedDirectory(name: string): boolean {
  return name.startsWith('.') || SKIPPED_DIRECTORIES.has(name);
}

/**
 * Every file under the project root, relative and `/`-separated. Bounded by
 * `MAX_WALK_DEPTH` and `MAX_COLLECTED_FILES`; symlinked directories are not
 * followed.
 */
function collectProjectFiles(root: string): string[] {
  const files: string[] = [];
  const walk = (dir: string, depth: number): void => {
    if (depth > MAX_WALK_DEPTH || files.length >= MAX_COLLECTED_FILES) {
      return;
    }
    for (const entry of readEntries(dir)) {
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isSkippedDirectory(entry.name)) {
          walk(absolute, depth + 1);
        }
      } else if (entry.isFile()) {
        files.push(relative(root, absolute).split(sep).join('/'));
      }
    }
  };
  walk(root, 0);
  return files;
}

/** The file name without its extension. */
function baseNameOf(fileName: string): string {
  return fileName.slice(0, fileName.length - extname(fileName).length);
}

/**
 * The near-miss candidates for one missing path: files in the SAME DIRECTORY
 * with the SAME extension (rank 0), then files with the SAME BASE NAME
 * anywhere under the project (rank 1). Deterministic order, capped by the
 * caller.
 */
function findNearMissCandidates(project: string, missingAbsolute: string): string[] {
  const missingDir = displayTestFilePath(project, missingAbsolute).display;
  const missingDirName = missingDir.includes('/')
    ? missingDir.slice(0, missingDir.lastIndexOf('/'))
    : '';
  const missingName = basename(missingAbsolute);
  const missingExt = extname(missingName);
  const missingBase = baseNameOf(missingName);

  const ranked: Array<{ rank: number; path: string }> = [];
  for (const file of collectProjectFiles(project)) {
    const fileDir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
    const fileName = file.slice(fileDir.length + (fileDir === '' ? 0 : 1));
    if (fileDir === missingDirName && extname(fileName) === missingExt) {
      ranked.push({ rank: 0, path: file });
      continue;
    }
    if (baseNameOf(fileName) === missingBase) {
      ranked.push({ rank: 1, path: file });
    }
  }
  ranked.sort((a, b) => (a.rank === b.rank ? (a.path < b.path ? -1 : 1) : a.rank - b.rank));
  return ranked.map((entry) => entry.path);
}

/** The unusable entries of a `--test-files` list, in a deterministic order. */
export function collectTestFileProblems(input: TestFilesInput): TestFileProblem[] {
  const project = resolve(input.project);
  const problems: TestFileProblem[] = [];
  for (const value of input.testFiles) {
    if (isTestFilePattern(value)) {
      if (!input.allowPatterns) {
        problems.push({
          code: MUT_ERROR_CODES.testFilePatternUnsupported,
          input: value,
          display: value,
          outsideProject: false,
          candidates: []
        });
      }
      continue;
    }
    const absolute = absoluteTestFilePath(project, value);
    const { display, outsideProject } = displayTestFilePath(project, absolute);
    if (!existsSync(absolute)) {
      problems.push({
        code: MUT_ERROR_CODES.testFileNotFound,
        input: value,
        display,
        outsideProject,
        candidates: findNearMissCandidates(project, absolute)
      });
      continue;
    }
    if (!statSync(absolute).isFile()) {
      problems.push({
        code: MUT_ERROR_CODES.testFileNotAFile,
        input: value,
        display,
        outsideProject,
        candidates: findNearMissCandidates(project, absolute)
      });
    }
  }
  return problems;
}

/** The code the envelope carries for a list of problems. */
function envelopeCode(problems: ReadonlyArray<TestFileProblem>): string {
  const missing = problems.find((p) => p.code === MUT_ERROR_CODES.testFileNotFound);
  if (missing !== undefined) {
    return missing.code;
  }
  return problems[0]?.code ?? MUT_ERROR_CODES.testFileNotFound;
}

/** The human-readable name of one problem, with the outside-project marker. */
function describeProblem(problem: TestFileProblem): string {
  return problem.outsideProject ? `${problem.display} (outside the project root)` : problem.display;
}

/**
 * The message the envelope carries. Every missing path is named — a list of
 * two missing files names BOTH — and the near-miss candidates follow, capped
 * and deterministically ordered. No plausible near-miss means no candidate
 * line at all.
 */
export function buildTestFileMessage(problems: ReadonlyArray<TestFileProblem>): string {
  const lines: string[] = [];
  const missing = problems.filter((p) => p.code === MUT_ERROR_CODES.testFileNotFound);
  const notAFile = problems.filter((p) => p.code === MUT_ERROR_CODES.testFileNotAFile);
  const patterns = problems.filter((p) => p.code === MUT_ERROR_CODES.testFilePatternUnsupported);
  if (missing.length > 0) {
    lines.push(`Test file not found: ${missing.map(describeProblem).join(', ')}`);
  }
  if (notAFile.length > 0) {
    lines.push(
      `Test file is a directory, not a test file: ${notAFile.map(describeProblem).join(', ')}`
    );
  }
  if (patterns.length > 0) {
    lines.push(
      `Test file is a pattern, not a literal file: ${patterns.map(describeProblem).join(', ')}. ` +
        'The assertion scan reads literal files, so it cannot scan a pattern. ' +
        'List the files explicitly, or use `peaks mut mutants` for a pattern-based mutation run.'
    );
  }
  const candidates: string[] = [];
  for (const problem of problems) {
    for (const candidate of problem.candidates) {
      if (!candidates.includes(candidate)) {
        candidates.push(candidate);
      }
    }
  }
  if (candidates.length > 0) {
    lines.push('Near-miss candidates:');
    for (const candidate of candidates.slice(0, MAX_TEST_FILE_CANDIDATES)) {
      lines.push(`- ${candidate}`);
    }
  }
  return lines.join('\n');
}

/**
 * Validate a `--test-files` list. Throws a `MutToolchainError` carrying a
 * NAMED code when an entry cannot be used; returns normally when every
 * literal entry exists and every pattern is acceptable to the caller.
 */
export function assertTestFilesUsable(input: TestFilesInput): void {
  const problems = collectTestFileProblems(input);
  if (problems.length === 0) {
    return;
  }
  const byCode = (code: string): string[] =>
    problems.filter((p) => p.code === code).map((p) => p.display);
  throw new MutToolchainError(envelopeCode(problems), buildTestFileMessage(problems), {
    details: {
      project: resolve(input.project),
      missing: byCode(MUT_ERROR_CODES.testFileNotFound),
      notAFile: byCode(MUT_ERROR_CODES.testFileNotAFile),
      patterns: byCode(MUT_ERROR_CODES.testFilePatternUnsupported),
      candidates: problems.flatMap((p) => p.candidates).slice(0, MAX_TEST_FILE_CANDIDATES)
    }
  });
}
