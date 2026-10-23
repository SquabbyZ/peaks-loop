/**
 *
 * `peaks best-practice-scan --intent <goal> --project <path> [--lang <lang>] [--commit]`
 *
 * Pipeline:
 *   1. detect language via language-detector (or use --lang override)
 *   2. scan via scan-orchestrator (Context7 → WebSearch → empty)
 *   3. render 8-row table via output-formatter
 *   4. write artifact into <projectRoot>/best-practice/<date>-<intent>.md
 *      (gitignored directory by convention; --commit flag reserved for
 *       a future slice that opts the artifact into git tracking)
 *   5. print artifact path + the 8-row table to stdout
 *
 * `--intent` is REQUIRED: it is the business goal the scan is for (Step 2.5
 * fires from a non-empty business goal), and it is what the artifact slug is
 * derived from. The project path is NOT an intent — falling back to it was
 * the defect this command was fixed for (a `.`-titled "best-practice scan").
 * Omitting `--intent` fails with `BEST_PRACTICE_SCAN_INTENT_REQUIRED`.
 *
 * Honesty gate: the built-in Context7 / WebSearch lookups are stubs, so an
 * uninjected scan comes back `synthetic: true` (see scan-orchestrator). A
 * synthetic result is NOT a scan result — the command then prints a refusal (no
 * table, no recommendation, no ⚠️ catch gate), records the skip, and exits
 * non-zero with `BEST_PRACTICE_SCAN_SYNTHETIC_LOOKUP` so no automated caller can
 * treat Step 2.5 as satisfied. Two further outcomes also refuse non-zero, both
 * without rendering: a `--lookup-results` document that breaks the injection
 * contract (`BEST_PRACTICE_SCAN_INVALID_RESULTS`) and a scan that resolved
 * against caller-supplied lookups and found nothing
 * (`BEST_PRACTICE_SCAN_NO_FRAGMENTS` — see `emitNoFragmentsRefusal`, which is
 * the guard against a `★` recommendation built from zero fragments).
 *
 * Collision refusal: the artifact path keys on `(date, slug)` with the slug
 * capped at 32 characters, so two intents that agree in their first 32 slug
 * characters land on one file. The second scan refuses
 * (`BEST_PRACTICE_SCAN_SLUG_COLLISION`) rather than overwrite the first.
 *
 * Catch-gate (spec §7): the command emits a 3-line prompt asking the
 * user to ack / pick alt / reject + reason. The gate is read from
 * stdin via `PEAKS_BEST_PRACTICE_STDIN` (test seam) or the real stdin
 * (production). The result is written to stdout as a JSON envelope
 * suffix so the orchestrator can react programmatically.
 */
import type { Command } from 'commander';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { detectLanguage } from '../../services/best-practice/language-detector.js';
import { scanBestPractice } from '../../services/best-practice/scan-orchestrator.js';
import {
  findForbiddenTokens,
  formatOutputTable,
  type RecommendationChoice
} from '../../services/best-practice/output-formatter.js';
import {
  CATCH_GATE_PROMPT,
  emitNoFragmentsRefusal,
  INTENT_REQUIRED_MESSAGE,
  readUserInput,
  renderSyntheticRefusal,
  SYNTHETIC_SOURCE_MESSAGE,
  writeRefusal,
  writeRenderedArtifact
} from './best-practice-scan-helpers.js';
import {
  detectSlugCollision,
  emitSlugCollisionRefusal,
  scanArtifactPath
} from './best-practice-scan-collision.js';
import { readLookupResultsOrFail } from './best-practice-scan-lookup-results.js';

type BestPracticeScanOptions = {
  readonly intent?: string;
  readonly project: string;
  readonly lang?: string;
  readonly commit?: boolean;
  readonly lookupResults?: string;
  readonly json?: boolean;
};

export type CatchGateOutcome =
  | { kind: 'accept'; choice: RecommendationChoice }
  | { kind: 'alternative'; choice: RecommendationChoice; reason?: string }
  | { kind: 'reject'; reason: string };

export function parseCatchGateReply(
  raw: string,
  recommended: RecommendationChoice
): CatchGateOutcome {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { kind: 'accept', choice: recommended };
  }
  const altMatch = /^接受方案\s*([ABC])(?:\s+(.+))?$/u.exec(trimmed);
  if (altMatch !== null) {
    const letter = altMatch[1];
    const reason = altMatch[2];
    if (letter === 'A' || letter === 'B' || letter === 'C') {
      return reason === undefined
        ? { kind: 'alternative', choice: letter }
        : { kind: 'alternative', choice: letter, reason };
    }
  }
  const rejectMatch = /^拒绝(?:\s+(.+))?$/u.exec(trimmed);
  if (rejectMatch !== null) {
    const reason = rejectMatch[1];
    return reason === undefined
      ? { kind: 'reject', reason: 'unspecified' }
      : { kind: 'reject', reason };
  }
  if (trimmed === '接受' || trimmed === 'accept' || trimmed === 'y' || trimmed === 'Y') {
    return { kind: 'accept', choice: recommended };
  }
  // Anything else is treated as a rejection-with-reason.
  return { kind: 'reject', reason: trimmed };
}

export function registerBestPracticeScanCommand(program: Command, io: ProgramIO): void {
  addJsonOption(
    program
      .command('best-practice-scan')
      .description(
        '2026-08-12 best-practice-scan: language-aware + business-aware doc-fragment lookup ' +
          'via Context7 (priority 1) → WebSearch (priority 2) → empty fallback. ' +
          'Renders the 8-row comparison table from spec §5 + §6 + §7. ' +
          'Writes the artifact to <project>/best-practice/<date>-<intent>.md (gitignored). ' +
          '--intent is required; a synthetic (stub) lookup refuses instead of rendering a ' +
          'recommendation and exits non-zero.'
      )
      .option('--intent <text>', 'business goal the scan is for (required)')
      .option('--project <path>', 'project root (default cwd)', process.cwd())
      .option('--lang <lang>', 'language override (skip auto-detect)')
      .option(
        '--lookup-results <file>',
        'JSON file of real Context7 / WebSearch results the caller performed; ' +
          'keys are `context7` / `websearch`, values are { ok, results:[{title,url,snippet}] }'
      )
      .option('--commit', 'reserved flag — opts the artifact into git tracking (future slice)')
  ).action(async (opts: BestPracticeScanOptions) => {
    try {
      const intent = (opts.intent ?? '').trim();
      if (intent.length === 0) {
        printResult(
          io,
          fail(
            'best-practice.scan',
            'BEST_PRACTICE_SCAN_INTENT_REQUIRED',
            INTENT_REQUIRED_MESSAGE,
            { project: opts.project },
            ['Rerun with --intent "<business goal>" — the goal from the PRD artifact']
          ),
          opts.json === true
        );
        process.exitCode = 1;
        return;
      }

      const injection =
        opts.lookupResults === undefined
          ? {}
          : readLookupResultsOrFail(opts.lookupResults, intent, io, opts.json === true);
      if (injection === null) {
        process.exitCode = 1;
        return;
      }

      const detection = opts.lang === undefined ? detectLanguage(opts.project) : null;
      const language = opts.lang ?? detection?.language ?? 'unknown';
      io.stdout(
        `[best-practice-scan] project=${opts.project} intent=${intent} language=${language}`
      );

      const scan = await scanBestPractice({
        intent,
        language,
        projectRoot: opts.project,
        io,
        ...injection
      });

      if (scan.synthetic) {
        const refusal = renderSyntheticRefusal({ intent, language, source: scan.source });
        io.stdout(refusal);
        const refusedPath = writeRefusal(opts.project, intent, refusal);
        printResult(
          io,
          fail(
            'best-practice.scan',
            'BEST_PRACTICE_SCAN_SYNTHETIC_LOOKUP',
            SYNTHETIC_SOURCE_MESSAGE,
            {
              project: opts.project,
              intent,
              language,
              scanSource: scan.source,
              synthetic: true,
              step25: 'skipped-synthetic-lookup',
              artifactPath: refusedPath
            },
            [
              'Re-run with --lookup-results <file> carrying the Context7 / WebSearch results you fetched',
              `Skip record written to ${refusedPath}`
            ]
          ),
          opts.json === true
        );
        process.exitCode = 1;
        return;
      }

      if (scan.results.length === 0) {
        emitNoFragmentsRefusal(io, opts.json === true, {
          project: opts.project,
          intent,
          language,
          source: scan.source
        });
        process.exitCode = 1;
        return;
      }

      const collision = detectSlugCollision(opts.project, intent, language);
      if (collision !== null) {
        emitSlugCollisionRefusal(io, opts.json === true, collision);
        process.exitCode = 1;
        return;
      }

      const recommendation: RecommendationChoice = scan.results.length > 0 ? 'A' : 'B';
      const reasoning =
        `基于调用方提供的 ${scan.fragments.length} 个 ${scan.source} 文档片段` +
        `(URL 由调用方构造,Context7 响应不含 URL);` +
        `语言=${language};LLM 推断方案 ${recommendation} 与项目阶段最匹配。`;

      const table = formatOutputTable({
        intent,
        language,
        fragments: scan.results,
        recommendation,
        reasoning
      });

      io.stdout(table);

      const forbiddenHits = findForbiddenTokens(table);
      if (forbiddenHits.length > 0) {
        io.stderr(
          `[best-practice-scan] WARNING: forbidden tokens detected: ${forbiddenHits.join(', ')}`
        );
      }

      io.stdout('');
      io.stdout(CATCH_GATE_PROMPT);
      const userInput = await readUserInput();
      const outcome = parseCatchGateReply(userInput, recommendation);

      const artifactPath = scanArtifactPath(opts.project, intent);
      const payload = {
        project: opts.project,
        intent,
        language,
        scanSource: scan.source,
        fragments: scan.results,
        recommendation,
        catchGate: outcome,
        artifactPath,
        commitFlag: opts.commit === true,
        forbiddenHits
      };
      writeRenderedArtifact(artifactPath, table, payload, intent);

      printResult(
        io,
        ok(
          'best-practice.scan',
          payload,
          forbiddenHits.length > 0 ? [`forbidden tokens present: ${forbiddenHits.join(', ')}`] : [],
          [`Artifact written to ${artifactPath}`, `catch-gate outcome: ${outcome.kind}`]
        ),
        opts.json === true
      );
    } catch (err) {
      // No `data.stack`: the caller asked for a scan, not a diagnosis, and the
      // failure here is usually a path it chose (EISDIR names it in the message).
      printResult(
        io,
        fail(
          'best-practice.scan',
          'BEST_PRACTICE_SCAN_FAILED',
          getErrorMessage(err),
          { project: opts.project, intent: opts.intent ?? null },
          ['Rerun with --json for machine-readable envelope']
        ),
        opts.json === true
      );
      process.exitCode = 1;
    }
  });
}
