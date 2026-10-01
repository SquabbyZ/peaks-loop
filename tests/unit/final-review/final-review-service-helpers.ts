// tests/unit/final-review/final-review-service-helpers.ts
//
// Shared fixture helpers for the `final-review-service` test family, moved
// verbatim out of `final-review-service.test.ts` (C wave 7 file-size work).
// Every definition below is the original code, unchanged; the suites import
// these instead of each re-owning them. The `afterEach` temp-dir cleanup
// registers when this module is evaluated by a suite file, so every suite in
// the family gets it.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';
import { type LlmRunner } from '~/src/services/final-review/final-review-service';

const RID = '2026-09-12-d1-fixture';
const SESSION_ID = '2026-09-12-session-fixture';

const REQUIRED = [
  'functional-completeness',
  'problem-resolution',
  'no-new-bugs',
  'existing-functionality-intact'
] as const;
type RequiredDimension = (typeof REQUIRED)[number];
type Verdict = 'pass' | 'fail' | 'inconclusive';

let tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots) rmSync(root, { recursive: true, force: true });
  tempRoots = [];
});

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-final-review-'));
  tempRoots.push(root);
  return root;
}

/** Read-only git, for the fixtures themselves (never for the service). */
function git(root: string, args: readonly string[]): void {
  execFileSync('git', [...args], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });
}

/**
 * A project that is ALSO a git work tree with a comparable base (two commits,
 * no remote, so the producer's last-resort `HEAD~1` resolves).
 *
 * Only the fixtures that assert `allPass === true` use it. Since the
 * pre-post-diff gate covers every reason a baseline can be missing — including
 * "this project is not a git work tree" — a project with no computable baseline
 * can no longer reach `allPass` at all, however complete its evidence is
 * otherwise. The `makeProject()` fixtures stay non-git on purpose: they pin the
 * allocation, prompt-shape and failure-path behaviour, where a tenth
 * `pre-post-diff` source block would be an unrelated variable.
 */
function makeGitProject(): string {
  const root = makeProject();
  git(root, ['init', '-q', '.']);
  git(root, ['config', 'user.email', 'fixture@peaks.local']);
  git(root, ['config', 'user.name', 'peaks fixture']);
  git(root, ['config', 'commit.gpgsign', 'false']);
  writeFileSync(join(root, 'README.md'), '# fixture\n', 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-q', '-m', 'baseline']);
  writeFileSync(join(root, 'README.md'), '# fixture\n\nsecond line\n', 'utf8');
  git(root, ['add', 'README.md']);
  git(root, ['commit', '-q', '-m', 'second']);
  return root;
}

function writeUnderProject(root: string, segments: readonly string[], content: string): string {
  const dir = join(root, '.peaks', '_runtime', SESSION_ID, ...segments.slice(0, -1));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, segments[segments.length - 1] as string);
  writeFileSync(file, content, 'utf8');
  return file;
}

function writeAuditGoal(root: string, criteria: readonly string[]): void {
  writeUnderProject(
    root,
    ['audit-goal', `${RID}.json`],
    JSON.stringify({ successCriteria: criteria })
  );
}

/**
 * The full evidence set, one distinct marker per source.
 *
 * `exactBodyBytes` pads every source to an EXACT byte length, which is what the
 * budget tests need: a fixture that lands the remaining budget on a specific
 * value is the only way to reproduce the allocation edge cases (and, before the
 * all-or-nothing fix, the "1 byte left" one). The marker is never truncated —
 * the pad is appended after it.
 */
function writeAllEvidence(root: string, filler = '', exactBodyBytes?: number): void {
  const body = (marker: string): string => {
    const base = `# fixture\n\n${marker}\n${filler}`;
    if (exactBodyBytes === undefined) return base;
    return base + 'X'.repeat(Math.max(0, exactBodyBytes - base.length));
  };
  writeUnderProject(
    root,
    ['qa', 'test-reports', `${RID}.md`],
    body('MARKER-QA-TEST-REPORT 48 files / 406 tests passed')
  );
  writeUnderProject(
    root,
    ['qa', 'test-cases', `${RID}.md`],
    body('MARKER-QA-TEST-CASES AC1 -> tests/unit/x.test.ts')
  );
  writeUnderProject(
    root,
    ['qa', `security-findings-${RID}.md`],
    body('MARKER-QA-SECURITY 0 findings')
  );
  writeUnderProject(
    root,
    ['qa', `performance-findings-${RID}.md`],
    body('MARKER-QA-PERFORMANCE no regression')
  );
  writeUnderProject(root, ['rd', 'code-review.md'], body('MARKER-RD-CODE-REVIEW 0 blockers'));
  writeUnderProject(
    root,
    ['rd', 'security-review.md'],
    body('MARKER-RD-SECURITY-REVIEW 0 findings')
  );
  writeUnderProject(root, ['rd', 'tech-doc.md'], body('MARKER-RD-TECH-DOC no public API change'));
  writeUnderProject(root, ['rd', 'bug-analysis.md'], body('MARKER-RD-BUG-ANALYSIS original repro'));
  writeUnderProject(root, ['prd', 'handoff.md'], body('MARKER-PRD-HANDOFF scope + non-goals'));
}

interface CapturedCall {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly maxTokens: number;
}

/**
 * Capturing fake — records the exact prompt; never touches a real LLM.
 *
 * `outputTokens` is what the provider would report as `usage.output_tokens`.
 * It is a number, or a function of the budget the service asked for (a truncating
 * provider reports exactly what it was allowed). Defaults to 0.
 */
function captureRunner(
  output: string | (() => string),
  outputTokens: number | ((maxTokens: number) => number) = 0
): { runner: LlmRunner; calls: CapturedCall[] } {
  const calls: CapturedCall[] = [];
  const runner: LlmRunner = {
    async call(systemPrompt, userPrompt, opts) {
      calls.push({ systemPrompt, userPrompt, maxTokens: opts.maxTokens });
      const raw = typeof output === 'function' ? output() : output;
      const emitted =
        typeof outputTokens === 'function' ? outputTokens(opts.maxTokens) : outputTokens;
      return { output: raw, tokens: { input: 0, output: emitted } };
    }
  };
  return { runner, calls };
}

function reviewJson(
  verdicts: Readonly<Record<RequiredDimension, Verdict>>,
  flags: { readonly allPass: boolean; readonly needsAttention: readonly string[] }
): string {
  return JSON.stringify({
    rid: RID,
    generatedAt: '2026-09-12T00:00:00.000Z',
    dimensions: REQUIRED.map((dimension) => ({
      dimension,
      verdict: verdicts[dimension],
      summary: `model summary for ${dimension}`,
      evidence: [{ kind: 'test-result', description: `${dimension} evidence from [1]` }],
      confidence: 'high'
    })),
    overallSummary: 'model overall summary',
    allPass: flags.allPass,
    needsAttention: flags.needsAttention
  });
}

function allVerdicts(verdict: Verdict): Record<RequiredDimension, Verdict> {
  return {
    'functional-completeness': verdict,
    'problem-resolution': verdict,
    'no-new-bugs': verdict,
    'existing-functionality-intact': verdict
  };
}

interface RenderedSource {
  readonly key: string;
  readonly supports: readonly string[];
  readonly status: string;
  readonly includedBytes: number;
}

/**
 * Re-reads the prompt the way the reviewer reads it: one block per source,
 * each carrying its SUPPORTS list and its STATUS line. Asserting on this keeps
 * the test honest about what the model could actually see, rather than about
 * what the allocator intended.
 */
function parseRenderedSources(prompt: string): readonly RenderedSource[] {
  return prompt
    .split(/^### \[/m)
    .slice(1)
    .map((block) => {
      const key = block.match(/^\d+\]\s+(\S+)/)?.[1] ?? '';
      const supports = (block.match(/^SUPPORTS: (.+)$/m)?.[1] ?? '')
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      const truncated = block.match(/showing the first (\d+) of (\d+) bytes/);
      if (truncated) {
        return {
          key,
          supports,
          status: 'found',
          includedBytes: Number(truncated[1])
        };
      }
      const whole = block.match(/^STATUS: FOUND at .* — (\d+) bytes$/m);
      if (whole) {
        return { key, supports, status: 'found', includedBytes: Number(whole[1]) };
      }
      return {
        key,
        supports,
        status: block.match(/^STATUS: MISSING \((\w+)\)/m)?.[1] ?? 'absent',
        includedBytes: 0
      };
    });
}

/** Dimensions a FOUND source backs — the same set the service's gate uses. */
function dimensionsCovered(prompt: string): ReadonlySet<string> {
  const covered = new Set<string>();
  for (const source of parseRenderedSources(prompt)) {
    if (source.status !== 'found') continue;
    for (const dimension of source.supports) covered.add(dimension);
  }
  return covered;
}

// ---------------------------------------------------------------------------
// Round 6 — the module-level sweep.
//
// Six rounds of this primitive each fixed the instance QA named and left the
// same SHAPE next door, because "was it delivered?" had as many answers as
// there were call sites. These four blocks pin the four things that make the
// shape impossible to re-create: the floor protects the source the GATE needs
// (F1), delivery is one content judgement (1.3), the conclusion the reviewer
// received is READ and not merely counted (F2), and the three ways a source can
// carry nothing are three different facts (F4). The fifth is the guard.
// ---------------------------------------------------------------------------

/**
 * The ten evidence files at the sizes this repo's own run measured
 * (`2026-09-12-session-e37ef0`, rid `2026-09-12-codegraph-exclude-integrity`),
 * which is the input every "reachable on the real machine" claim is about.
 */
function writeRealSizedEvidence(root: string): void {
  const sized = (marker: string, bytes: number): string => {
    const head = `# ${marker}\n\n${marker}\n`;
    return head + 'X'.repeat(Math.max(0, bytes - head.length));
  };
  writeUnderProject(root, ['qa', 'test-reports', `${RID}.md`], sized('QA-REPORT', 9492));
  writeUnderProject(root, ['qa', 'test-cases', `${RID}.md`], sized('QA-CASES', 20543));
  writeUnderProject(root, ['qa', `security-findings-${RID}.md`], sized('QA-SEC', 13852));
  writeUnderProject(root, ['qa', `performance-findings-${RID}.md`], sized('QA-PERF', 10839));
  writeUnderProject(root, ['rd', 'code-review.md'], sized('RD-CODE-REVIEW', 17745));
  writeUnderProject(root, ['rd', 'security-review.md'], sized('RD-SEC-REVIEW', 11422));
  writeUnderProject(root, ['rd', 'tech-doc.md'], sized('RD-TECH-DOC', 13462));
  writeUnderProject(root, ['rd', 'bug-analysis.md'], sized('RD-BUG-ANALYSIS', 13050));
  // The capsule carries the rid (slice `2026-09-14-prd-capsule-rid-scoping`).
  // `writeAllEvidence` above keeps the BARE name on purpose, so both tiers of
  // this source stay exercised: that fixture proves the pre-scoping layout
  // still resolves, this one proves the slice's own capsule is preferred.
  writeUnderProject(root, ['prd', `handoff-${RID}.md`], sized('PRD-HANDOFF', 8164));
}

function fourPassesJson(): string {
  return JSON.stringify({
    rid: RID,
    generatedAt: '2026-09-12T00:00:00.000Z',
    dimensions: REQUIRED.map((dimension) => ({
      dimension,
      verdict: 'pass',
      summary: 's',
      evidence: [{ kind: 'test-result', description: 'd' }],
      confidence: 'high'
    })),
    overallSummary: 'ok',
    allPass: true,
    needsAttention: []
  });
}

export {
  RID,
  SESSION_ID,
  REQUIRED,
  allVerdicts,
  captureRunner,
  dimensionsCovered,
  fourPassesJson,
  git,
  makeGitProject,
  makeProject,
  parseRenderedSources,
  reviewJson,
  writeAllEvidence,
  writeAuditGoal,
  writeRealSizedEvidence,
  writeUnderProject
};
export type { CapturedCall, RenderedSource, RequiredDimension, Verdict };
