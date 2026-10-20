/**
 * OCR 1.x multi-language review: detect which routed languages a git range
 * touches, run `ocr review` ONCE for the whole change set, and group the
 * returned comments by language.
 *
 * A Python+Go change costs one review, not two. A range with no routed language
 * skips the invocation entirely — spawning OCR to discover there is nothing to
 * review is exactly the cost this guard exists to avoid.
 */
import { spawnSync } from 'node:child_process';
import {
  buildReviewArgs,
  emptyByLanguage,
  invokeOcr,
  parseComments,
  summarize,
  type Ocr18Finding,
  type Ocr18Range,
  type Ocr18State,
  type Ocr18Summary,
  type ParsedComments
} from './ocr-multilang-adapter.js';
import { languageForPath, type Ocr18Language } from './ocr-18-language-routing.js';

export type Ocr18Detection = {
  readonly languages: readonly Ocr18Language[];
  readonly changedFileCount: number;
  /** Changed files whose format the CLI does not review as a routed language. */
  readonly unsupportedFiles: readonly string[];
};

/** 16 MiB — the largest `git diff --name-only` list this repo reviews. */
const GIT_MAX_BUFFER = 16_777_216;

/**
 * A ref is handed to git as its own argv entry. No valid revision starts with
 * `-`, but an option-shaped value would let a caller inject a git flag
 * (`--output=…`), so it is refused at the boundary rather than passed through.
 */
function checkedRef(value: string, flag: string): string {
  if (value.startsWith('-')) throw new Error(`invalid ${flag} value: ${value}`);
  return value;
}

function changedFiles(cwd: string, range: Ocr18Range): string[] {
  const git = (args: readonly string[]): string[] => {
    // `windowsHide` on every spawn (repo convention) — the child is a console app.
    const result = spawnSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: GIT_MAX_BUFFER
    });
    if (result.error !== undefined && result.error !== null) {
      throw new Error(`git ${args.join(' ')} failed: ${result.error.message}`);
    }
    if (result.status !== 0) {
      const stderr = typeof result.stderr === 'string' ? result.stderr.trim() : '';
      throw new Error(`git ${args.join(' ')} failed: ${stderr || `exit ${String(result.status)}`}`);
    }
    const stdout = typeof result.stdout === 'string' ? result.stdout : '';
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  };

  if (range.commit !== undefined) {
    // `--commit` reviews one commit against its parent; `git show` is that diff
    // and also works for a root commit.
    return git([
      'show',
      '--pretty=format:',
      '--name-only',
      '--diff-filter=ACMR',
      checkedRef(range.commit, '--commit')
    ]);
  }
  if (range.from !== undefined || range.to !== undefined) {
    const refs: string[] = [];
    if (range.from !== undefined) refs.push(checkedRef(range.from, '--from'));
    if (range.to !== undefined) refs.push(checkedRef(range.to, '--to'));
    return git(['diff', '--name-only', '--diff-filter=ACMR', ...refs, '--']);
  }
  // The workspace, as `ocr review` defaults to it: staged + unstaged tracked
  // changes vs HEAD, plus untracked files. Missing the untracked half would let
  // a brand-new source file skip the review it is about to be part of.
  return [
    ...git(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD', '--']),
    ...git(['ls-files', '--others', '--exclude-standard'])
  ];
}

/**
 * Which routed languages (and which unrouted files) the requested range touches.
 *
 * @throws when git cannot answer — "could not detect" must not read as "nothing
 * to review", so the caller is given the choice of what to say.
 */
export function detectLanguages(cwd: string, range: Ocr18Range = {}): Ocr18Detection {
  const files = [...new Set(changedFiles(cwd, range))];
  const languages = new Set<Ocr18Language>();
  const unsupportedFiles: string[] = [];
  for (const file of files) {
    const language = languageForPath(file);
    if (language === null) unsupportedFiles.push(file);
    else languages.add(language);
  }
  return {
    languages: [...languages].sort(),
    changedFileCount: files.length,
    unsupportedFiles
  };
}

export type Ocr18LanguageReport = {
  readonly language: Ocr18Language;
  readonly findings: readonly Ocr18Finding[];
  readonly count: number;
};

export type Ocr18MultiResult = {
  readonly state: Ocr18State;
  readonly detected: readonly Ocr18Language[];
  readonly languages: readonly Ocr18LanguageReport[];
  readonly changedFileCount: number;
  readonly unsupportedFiles: readonly string[];
  /**
   * Findings on formats the caller did not route (a `.yaml` finding, say).
   * Reported rather than dropped: the review DID look at them.
   */
  readonly unroutedFindings: readonly Ocr18Finding[];
  readonly summary: Ocr18Summary | null;
  readonly durationMs: number;
  readonly rawOutput: string;
};

export type Ocr18MultiOptions = Ocr18Range & {
  readonly cwd: string;
  /** Requested report set; omitted means every language detected in the range. */
  readonly languages?: readonly Ocr18Language[];
  readonly timeoutMs?: number;
};

type GroupedFindings = {
  readonly byLanguage: Map<Ocr18Language, Ocr18Finding[]>;
  readonly routed: Ocr18Finding[];
  readonly unrouted: Ocr18Finding[];
};

function groupByLanguage(findings: readonly Ocr18Finding[]): GroupedFindings {
  const byLanguage = new Map<Ocr18Language, Ocr18Finding[]>();
  const routed: Ocr18Finding[] = [];
  const unrouted: Ocr18Finding[] = [];
  for (const finding of findings) {
    const language = languageForPath(finding.filePath);
    if (language === null) {
      unrouted.push(finding);
      continue;
    }
    routed.push(finding);
    const bucket = byLanguage.get(language) ?? [];
    bucket.push(finding);
    byLanguage.set(language, bucket);
  }
  return { byLanguage, routed, unrouted };
}

/**
 * Every requested/detected language gets an entry, so a clean language is a
 * visible zero; a language that only appears in the findings is kept as well
 * rather than dropped for not having been detected.
 */
function reportsFor(
  grouped: GroupedFindings,
  requested: readonly Ocr18Language[]
): Ocr18LanguageReport[] {
  const order = [...new Set<Ocr18Language>([...requested, ...grouped.byLanguage.keys()])];
  return order.map((language) => {
    const bucket = grouped.byLanguage.get(language) ?? [];
    return { language, findings: bucket, count: bucket.length };
  });
}

function countsFor(grouped: GroupedFindings): Record<Ocr18Language, number> {
  const counts = { ...emptyByLanguage() };
  for (const [language, bucket] of grouped.byLanguage) counts[language] = bucket.length;
  return counts;
}

/** A result for an outcome that has no per-language reports — and so no zero. */
function stopped(
  base: Pick<Ocr18MultiResult, 'detected' | 'changedFileCount' | 'unsupportedFiles'>,
  state: Ocr18State,
  start: number,
  rawOutput: string
): Ocr18MultiResult {
  return {
    ...base,
    state,
    languages: [],
    unroutedFindings: [],
    summary: null,
    durationMs: Date.now() - start,
    rawOutput
  };
}

/**
 * One review for the whole change set, findings grouped by language.
 *
 * The four outcomes a caller must be able to tell apart:
 * 1. a language reported with findings (`count` > 0);
 * 2. a language reported with count 0 while the state is `ok` — it ran and was clean;
 * 3. `unsupportedFiles` — the file is in the diff but the CLI does not review it
 *    as a routed language (with state `no-routed-language` when that is ALL
 *    the range holds);
 * 4. a state of `ocr18-missing` / `execution-failed` with `languages: []` — it
 *    never ran, so there is no zero to mistake for a clean result.
 */
export function runOcr18Multi(options: Ocr18MultiOptions): Ocr18MultiResult {
  const start = Date.now();
  const detection = detectLanguages(options.cwd, options);
  const base = {
    detected: detection.languages,
    changedFileCount: detection.changedFileCount,
    unsupportedFiles: detection.unsupportedFiles
  };

  // No routed language ⇒ no review. Spawning OCR to discover there is nothing
  // to review is exactly the cost this guard exists to avoid.
  if (detection.languages.length === 0) return stopped(base, 'no-routed-language', start, '');

  const invoked = invokeOcr(buildReviewArgs(options), options.cwd, options.timeoutMs);
  if (!invoked.ok) return stopped(base, invoked.state, start, invoked.rawOutput);

  const parsed: ParsedComments =
    invoked.stdout.trim().length === 0 ? { ok: true, findings: [] } : parseComments(invoked.stdout);
  if (!parsed.ok) return stopped(base, 'execution-failed', start, invoked.stderr || invoked.stdout);

  const grouped = groupByLanguage(parsed.findings);
  return {
    ...base,
    state: 'ok',
    languages: reportsFor(grouped, options.languages ?? detection.languages),
    unroutedFindings: grouped.unrouted,
    summary: summarize(grouped.routed, countsFor(grouped)),
    durationMs: Date.now() - start,
    rawOutput: invoked.stdout
  };
}
