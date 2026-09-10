/**
 * Slice 2026-08-12 best-practice-scan — CLI subcommand.
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
 * Honesty gate: v1's Context7 / WebSearch lookups are stubs, so a scan can
 * come back `synthetic: true` (see scan-orchestrator). A synthetic result is
 * NOT a scan result — the command then prints a refusal (no table, no
 * recommendation, no ⚠️ catch gate), records the skip, and exits non-zero
 * with `BEST_PRACTICE_SCAN_SYNTHETIC_LOOKUP` so no automated caller can
 * treat Step 2.5 as satisfied.
 *
 * Catch-gate (spec §7): the command emits a 3-line prompt asking the
 * user to ack / pick alt / reject + reason. The gate is read from
 * stdin via `PEAKS_BEST_PRACTICE_STDIN` (test seam) or the real stdin
 * (production). The result is written to stdout as a JSON envelope
 * suffix so the orchestrator can react programmatically.
 */
import type { Command } from 'commander';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { addJsonOption, getErrorMessage, printResult, type ProgramIO } from '../cli-helpers.js';
import { fail, ok } from 'peaks-loop-shared/result';
import { detectLanguage } from '../../services/best-practice/language-detector.js';
import { scanBestPractice } from '../../services/best-practice/scan-orchestrator.js';
import {
  findForbiddenTokens,
  formatOutputTable,
  type RecommendationChoice
} from '../../services/best-practice/output-formatter.js';

type BestPracticeScanOptions = {
  readonly intent?: string;
  readonly project: string;
  readonly lang?: string;
  readonly commit?: boolean;
  readonly json?: boolean;
};

const CATCH_GATE_PROMPT = [
  '⚠️ 任何跟你真实业务不一样,改 — LLM 推荐可能错。',
  '回应 (默认 = 接受): 接受 / 接受方案 A|接受方案 B|接受方案 C / 拒绝 + 原因'
].join('\n');

const INTENT_REQUIRED_MESSAGE =
  'best-practice-scan requires --intent <text>: the intent is the business goal the scan is ' +
  'for, not the project path. Deriving it from the project path labelled a scan with a ' +
  'non-goal, so there is no fallback.';

const SYNTHETIC_SOURCE_MESSAGE =
  'best-practice-scan: SKIPPED — the Context7 / WebSearch lookups in this build are stubs ' +
  '(synthetic fragments), so no real documentation was consulted and there is nothing to ' +
  'recommend. No recommendation, no comparison table and no ⚠️ catch gate were produced.';

function bestPracticeDir(projectRoot: string): string {
  return join(projectRoot, 'best-practice');
}

function artifactPathFor(projectRoot: string, slugSource: string): string {
  const dateStr = new Date().toISOString().slice(0, 10);
  const slug = slugSource.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 32) || 'intent';
  return join(bestPracticeDir(projectRoot), `${dateStr}-${slug}.md`);
}

/** Refusal body for a synthetic scan. It is written to the artifact path so
 *  the skip survives the fire-and-forget caller (`best-practice-auto-trigger`
 *  spawns with `stdio: 'ignore'`, so stdout never reaches anyone). */
function renderSyntheticRefusal(opts: {
  readonly intent: string;
  readonly language: string;
  readonly source: string;
}): string {
  return [
    `# Best-Practice Scan — ${opts.intent}`,
    '',
    '> SKIPPED — synthetic (stub) lookup. No real documentation lookup was performed.',
    '',
    SYNTHETIC_SOURCE_MESSAGE,
    '',
    `- language: ${opts.language}`,
    `- transport that answered: ${opts.source} (stub)`,
    '- Step 2.5: recorded as skipped, reason "synthetic-lookup". Re-run this step once the real',
    '  lookup lands; a gate cannot be satisfied from a fabricated scan.'
  ].join('\n');
}

async function readUserInput(): Promise<string> {
  const override = process.env.PEAKS_BEST_PRACTICE_STDIN;
  if (override !== undefined) return override;
  if (process.stdin.isTTY) return '';
  return new Promise<string>((resolveStdin) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolveStdin(data.trim()));
    process.stdin.on('error', () => resolveStdin(data.trim()));
  });
}

export type CatchGateOutcome =
  | { kind: 'accept'; choice: RecommendationChoice }
  | { kind: 'alternative'; choice: RecommendationChoice; reason?: string }
  | { kind: 'reject'; reason: string };

export function parseCatchGateReply(raw: string, recommended: RecommendationChoice): CatchGateOutcome {
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
      .option('--commit', 'reserved flag — opts the artifact into git tracking (future slice)')
  ).action(async (opts: BestPracticeScanOptions) => {
    try {
      const intent = (opts.intent ?? '').trim();
      if (intent.length === 0) {
        printResult(
          io,
          fail('best-practice.scan', 'BEST_PRACTICE_SCAN_INTENT_REQUIRED', INTENT_REQUIRED_MESSAGE, { project: opts.project }, [
            'Rerun with --intent "<business goal>" — the goal from the PRD artifact'
          ]),
          opts.json === true
        );
        process.exitCode = 1;
        return;
      }

      const detection = opts.lang === undefined ? detectLanguage(opts.project) : null;
      const language = opts.lang ?? detection?.language ?? 'unknown';
      io.stdout(`[best-practice-scan] project=${opts.project} intent=${intent} language=${language}`);

      const scan = await scanBestPractice({
        intent,
        language,
        projectRoot: opts.project,
        io
      });

      if (scan.synthetic) {
        const refusal = renderSyntheticRefusal({ intent, language, source: scan.source });
        io.stdout(refusal);
        const refusedPath = artifactPathFor(opts.project, intent);
        mkdirSync(bestPracticeDir(opts.project), { recursive: true });
        writeFileSync(refusedPath, refusal + '\n', 'utf8');
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
            ['Re-run once real Context7 / WebSearch wiring lands', `Skip record written to ${refusedPath}`]
          ),
          opts.json === true
        );
        process.exitCode = 1;
        return;
      }

      const recommendation: RecommendationChoice = scan.results.length > 0 ? 'A' : 'B';
      const reasoning =
        `基于 ${scan.fragments.length} 个 ${scan.source} 文档片段;` +
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
        io.stderr(`[best-practice-scan] WARNING: forbidden tokens detected: ${forbiddenHits.join(', ')}`);
      }

      io.stdout('');
      io.stdout(CATCH_GATE_PROMPT);
      const userInput = await readUserInput();
      const outcome = parseCatchGateReply(userInput, recommendation);

      const artifactPath = artifactPathFor(opts.project, intent);
      mkdirSync(bestPracticeDir(opts.project), { recursive: true });
      writeFileSync(artifactPath, table + '\n', 'utf8');

      printResult(
        io,
        ok(
          'best-practice.scan',
          {
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
          },
          forbiddenHits.length > 0 ? [`forbidden tokens present: ${forbiddenHits.join(', ')}`] : [],
          [`Artifact written to ${artifactPath}`, `catch-gate outcome: ${outcome.kind}`]
        ),
        opts.json === true
      );
    } catch (err) {
      printResult(
        io,
        fail('best-practice.scan', 'BEST_PRACTICE_SCAN_FAILED', getErrorMessage(err), { stack: err instanceof Error ? err.stack : undefined }, ['Rerun with --json for machine-readable envelope']),
        opts.json === true
      );
      process.exitCode = 1;
    }
  });
}