/**
 * rid `2026-09-13-statusline-window-witness` — the comparison reaches
 * `peaks code context-now`, and it reaches it as an OBSERVATION.
 *
 * AC2 — the probe's envelope carries the harness's percentage, peaks-loop's
 * ratio and the deviation between them.
 *
 * AC3 — a sustained disagreement is presented one-way (a `warning` line and a
 * `nextAction`), never as a question. The cases below drive the REAL CLI action
 * over a REAL transcript fixture, so the ratio, the window and the token count
 * are the ones the probe actually resolves — not values handed to it.
 *
 * AC4 — THE CONTROL GROUP, at the boundary the user actually reads. The
 * "agree" and "disagree" inputs differ in exactly ONE field of the witness
 * file; everything else — payload shape, token snapshot, probe ratio, window —
 * is identical. The stale case is the guard's third answer: it must abstain
 * rather than fire on the input that a two-outcome guard would report as a
 * 25-point disagreement.
 *
 * The witness is NEVER allowed to move `action` / `verdict` / `next`: the
 * last case asserts that the same probe reports the same compact decision with
 * a disagreeing witness and with none. A reading that can fire a compact is a
 * reading that can fire a WRONG compact.
 *
 * Style: BDD given/when/then per peaks-loop 4.0.11+ contract.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/cli/commands/code-context-now-witness.test.ts',
  ['render', 'behavior', 'integration'],
  [{ dim: 'a11y', reason: 'The one-way sentence is asserted under (behavior); no new user prompt or CLI verb exists to check.' }],
);

// os.homedir must be mocked for the transcript fixture to be found: the probe
// reads `~/.claude/projects/<hash>/<outer-session>.jsonl`, and no test may
// write into the real home. Same technique as
// tests/unit/ide/claude-code-adapter-compact.test.ts.
const __home = vi.hoisted(() => ({ value: '' }));
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => __home.value };
});

// Repair cycle 3 (perf F3): count the canonical-root resolutions the probe
// performs, because the defect was a COUNT (two calls with the same argument
// where one is enough) and the fix is verifiable as a count. The milliseconds
// are not verifiable here: one resolution spawns `git rev-parse
// --show-toplevel`, measured at a median 111.8 ms on this host but ~5-15 ms on
// warm Linux, so a timing assertion would pass against the redundant version
// on a fast host. Everything else about the module is the real one.
const __resolutions = vi.hoisted(() => ({ count: 0 }));
vi.mock('~/src/services/config/config-service.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('~/src/services/config/config-service.js')>();
  return {
    ...actual,
    resolveCanonicalProjectRoot: (startPath: string) => {
      __resolutions.count += 1;
      return actual.resolveCanonicalProjectRoot(startPath);
    },
  };
});

import { makeCapturedIo, withEnv } from '../../_setup/io.js';
import { withTmpWorkspacePerTest } from '../../_setup/tmp-workspace.js';
import { registerCodeRuntimeCommands } from '~/src/cli/commands/code-runtime-commands';
import {
  WITNESS_SCHEMA_VERSION,
  harnessWitnessPath,
} from '~/src/services/context/harness-context-witness';

const SID = '2026-09-13-session-ctxnowwitness';
const OUTER = 'aa11bb22-cccc-dddd-eeee-ff3344556677';
/** 120,000 + 45,000 + 15,000 — the same three components peaks-loop sums. */
const PEAKS_TOKENS = 180_000;
const WINDOW = 200_000;
/**
 * peaks-loop's ratio for the fixture above: 180,000 / 200,000.
 *
 * The fixture used to read 60,000 / 200,000 = 30%, and that was part of the
 * defect (repair cycle 2): the witness comparison's residual carries the
 * WITNESS's ratio, so a sample at 30% of the window cannot separate the
 * smallest real window difference from the budget's uncertainty. `agree` there
 * was a claim the sample could not support, and every case in this file sat in
 * that region. 90% is also where this guard actually runs.
 */
const PEAKS_RATIO = 0.9;

interface Envelope {
  readonly ok: boolean;
  readonly data: {
    readonly ratio: number;
    readonly action: string;
    readonly verdict: string;
    readonly next: string | null;
    readonly capacityTokens: number | null;
    readonly rawTokens: number | null;
    readonly harnessWitness: {
      readonly verdict: string;
      readonly reason: string | null;
      readonly harnessPct: number | null;
      readonly peaksRatio: number;
      readonly deviation: number | null;
      readonly residual: number | null;
      readonly tolerance: number | null;
      readonly witnessRawPercentage: number | null;
      readonly witnessPercentageUnit: 'fraction' | 'percent' | 'unestablished' | null;
    };
  };
  readonly warnings: readonly string[];
  readonly nextActions: readonly string[];
}

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  tmpDirs.length = 0;
  process.exitCode = undefined;
});

describe('peaks code context-now — harness context witness', () => {
  const ws = withTmpWorkspacePerTest('peaks-ctx-now-witness-');

  /** A synthetic `~/.claude/projects/<hash>/<outer>.jsonl` holding one usage entry. */
  function seedTranscript(): void {
    const home = mkdtempSync(join(tmpdir(), 'peaks-witness-home-'));
    tmpDirs.push(home);
    __home.value = home;
    const hashDir = join(home, '.claude', 'projects', '-Users-foo-bar');
    mkdirSync(hashDir, { recursive: true });
    writeFileSync(
      join(hashDir, `${OUTER}.jsonl`),
      `${JSON.stringify({
        type: 'assistant',
        message: {
          model: 'claude-3-5-sonnet-20241022',
          usage: { input_tokens: 120_000, cache_read_input_tokens: 45_000, cache_creation_input_tokens: 15_000 },
        },
      })}\n`,
      'utf8',
    );
  }

  function seedProject(root: string): void {
    mkdirSync(join(root, '.git'), { recursive: true });
    mkdirSync(join(root, '.peaks', '_runtime', SID), { recursive: true });
  }

  /** Write the witness the way the statusline render does — same file, same shape. */
  function seedWitness(root: string, usedPercentage: number, usageTokens: number | null): void {
    writeFileSync(
      harnessWitnessPath(root, SID),
      `${JSON.stringify({
        schemaVersion: WITNESS_SCHEMA_VERSION,
        capturedAt: '2026-09-13T12:00:00.000Z',
        usedPercentage,
        usedPercentageRaw: usedPercentage,
        usedPercentageUnit: 'fraction',
        modelWindowTokens: WINDOW,
        usageTokens,
        outerSessionId: OUTER,
      })}\n`,
      'utf8',
    );
  }

  async function runContextNow(projectRoot: string): Promise<Envelope> {
    withEnv('CLAUDE_CODE_ENTRYPOINT', 'cli');
    withEnv('CLAUDE_CODE_SESSION_ID', OUTER);
    // The env probe outranks the transcript estimate — clear it so the fixture
    // is the signal under test.
    withEnv('CLAUDE_CONTEXT_USAGE_PERCENT', undefined);
    // Pin the model so the window under test is the fixture's 200K one. The
    // ambient env of a 1M-window session would otherwise move `capacityTokens`
    // to 1,000,000 and halve every expected ratio in this file.
    for (const name of [
      'ANTHROPIC_MODEL',
      'ANTHROPIC_DEFAULT_OPUS_MODEL',
      'ANTHROPIC_DEFAULT_SONNET_MODEL',
      'ANTHROPIC_DEFAULT_HAIKU_MODEL',
      'ANTHROPIC_DEFAULT_FABLE_MODEL',
      'CLAUDE_CODE_SUBAGENT_MODEL',
    ]) {
      withEnv(name, undefined);
    }
    withEnv('ANTHROPIC_MODEL', 'claude-3-5-sonnet-20241022');
    withEnv('PEAKS_CONTEXT_WINDOW_TOKENS', undefined);
    // ...and the harness window key, which the ambient session env carries and
    // which outranks the model heuristic. Left set, it would make every probe
    // divide by this machine's window instead of the fixture's.
    withEnv('CLAUDE_CODE_AUTO_COMPACT_WINDOW', undefined);
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    const code = program.command('code');
    registerCodeRuntimeCommands(code, io);
    await program.parseAsync(['code', 'context-now', '--json', '--project', projectRoot, '--session-id', SID], {
      from: 'user',
    });
    return JSON.parse(captured.text()) as Envelope;
  }

  /** The fixture's own premises — if these drift, every case below is void. */
  async function assertFixtureIsReal(projectRoot: string): Promise<Envelope> {
    const envelope = await runContextNow(projectRoot);
    expect(envelope.data.ratio).toBeCloseTo(PEAKS_RATIO, 5);
    expect(envelope.data.rawTokens).toBe(PEAKS_TOKENS);
    expect(envelope.data.capacityTokens).toBe(WINDOW);
    return envelope;
  }

  describe('(integration)', () => {
    it('AC2 — should carry the harness percentage, peaks-loop ratio, deviation and tolerance', async () => {
      // given: a witness describing the SAME moment as the probe
      const root = ws().path;
      seedTranscript();
      seedProject(root);
      seedWitness(root, PEAKS_RATIO, PEAKS_TOKENS);
      // when
      const envelope = await assertFixtureIsReal(root);
      // then
      const witness = envelope.data.harnessWitness;
      expect(witness.verdict).toBe('agree');
      expect(witness.harnessPct).toBeCloseTo(PEAKS_RATIO, 10);
      expect(witness.peaksRatio).toBeCloseTo(PEAKS_RATIO, 10);
      expect(witness.deviation).toBeCloseTo(0, 10);
      expect(witness.residual).toBeCloseTo(0, 10);
      expect(witness.tolerance).toBeGreaterThan(0);
      // ...and the harness's raw number with the reading taken from it, so a
      // unit misread can be told from a denominator difference by reading the
      // envelope alone
      expect(witness.witnessRawPercentage).toBe(PEAKS_RATIO);
      expect(witness.witnessPercentageUnit).toBe('fraction');
      expect(envelope.warnings).toEqual([]);
    });

    it('AC2 — when no statusline ever rendered, should report `absent` and stay silent', async () => {
      // given: the same project with no witness file (this repo's state today)
      const root = ws().path;
      seedTranscript();
      seedProject(root);
      // when
      const envelope = await assertFixtureIsReal(root);
      // then: the absence is a named fact, not a missing key and not an alarm.
      // The session directory exists and holds no record, so the cause is the
      // one this state actually has — not "the statusline has not rendered
      // here", which is what every absent state used to say.
      expect(envelope.data.harnessWitness.verdict).toBe('absent');
      expect(envelope.data.harnessWitness.harnessPct).toBeNull();
      expect(envelope.data.harnessWitness.reason).toContain('no render has been recorded');
      expect(envelope.warnings).toEqual([]);
    });

    it('AC2 — when the witness file is unreadable, should NOT claim the statusline never rendered', async () => {
      // F2 (repair cycle 3), at the sentence the user actually reads. Every
      // other absent case in this file goes through `seedProject`, which
      // CREATES the session directory — so this state, a directory that holds a
      // file the reader cannot use, was reachable only as the wrong answer: it
      // reported "the statusline has not rendered here" about a session that
      // had. Same sentence shape as the case above; a different cause.
      const root = ws().path;
      seedTranscript();
      seedProject(root);
      writeFileSync(harnessWitnessPath(root, SID), '{ not json', 'utf8');
      // when
      const envelope = await assertFixtureIsReal(root);
      // then
      expect(envelope.data.harnessWitness.verdict).toBe('absent');
      expect(envelope.data.harnessWitness.reason).toContain('could not be read');
      expect(envelope.data.harnessWitness.reason).not.toContain('has not rendered');
      expect(envelope.warnings).toEqual([]);
    });
  });

  describe('(behavior)', () => {
    it('AC4 control A — when the two agree, should NOT warn', async () => {
      // given: identical moment, identical reading
      const root = ws().path;
      seedTranscript();
      seedProject(root);
      seedWitness(root, PEAKS_RATIO, PEAKS_TOKENS);
      // when
      const envelope = await runContextNow(root);
      // then
      expect(envelope.data.harnessWitness.verdict).toBe('agree');
      expect(envelope.warnings.join('\n')).not.toMatch(/witness/i);
    });

    it('AC4 control B — when the same moment reads differently, should warn one-way', async () => {
      // given: the SAME token snapshot as control A; only the harness's
      // percentage moves — the exact shape of the two denominators being
      // different numbers (a 5x window difference at 90% usage).
      const root = ws().path;
      seedTranscript();
      seedProject(root);
      seedWitness(root, 0.18, PEAKS_TOKENS);
      // when
      const envelope = await runContextNow(root);
      // then: the fact rides `warnings` …
      expect(envelope.data.harnessWitness.verdict).toBe('disagree');
      const warning = envelope.warnings.find((line) => /witness/i.test(line));
      expect(warning).toBeDefined();
      expect(warning!).toContain('90.0%');
      expect(warning!).toContain('18.0%');
      // … and the advice rides `nextActions`, as a statement, not a question
      expect(envelope.nextActions.join('\n')).toMatch(/re-probe with .peaks code context-now./i);
      expect(envelope.nextActions.join('\n')).not.toContain('?');
      expect(envelope.warnings.join('\n')).not.toContain('?');
    });

    it('AC4 — when the witness is stale but consistent, should subtract the skew and not warn', async () => {
      // given: a witness captured 140,000 tokens ago, reading exactly what that
      // smaller count implies — 20% of the window where the probe now reads
      // 90%. The 70-point deviation is the sample's AGE, not a disagreement,
      // and the guard has to say so.
      const root = ws().path;
      seedTranscript();
      seedProject(root);
      seedWitness(root, 0.2, 40_000);
      // when
      const envelope = await runContextNow(root);
      // then: the skew is removed rather than budgeted — deviation 70 points,
      // residual exactly zero …
      expect(envelope.data.harnessWitness.deviation).toBeCloseTo(0.7, 10);
      expect(envelope.data.harnessWitness.residual).toBeCloseTo(0, 10);
      // … and the verdict is the THIRD answer, not `agree`: a witness at 20% of
      // the harness window cannot separate the smallest real window difference
      // from the budget, so this sample cannot support a claim that the two
      // denominators match. Either way the user is not warned.
      expect(envelope.data.harnessWitness.verdict).toBe('unverifiable');
      expect(envelope.warnings).toEqual([]);
    });

    it('AC4 — when the moment cannot be established, should abstain instead of warning', async () => {
      // given: a witness with no token snapshot at all — the probe cannot show
      // that the two numbers describe the same API response, so it must not
      // answer either way
      const root = ws().path;
      seedTranscript();
      seedProject(root);
      seedWitness(root, 0.05, null);
      // when
      const envelope = await runContextNow(root);
      // then
      expect(envelope.data.harnessWitness.verdict).toBe('unverifiable');
      expect(envelope.data.harnessWitness.deviation).toBeCloseTo(0.85, 10);
      expect(envelope.warnings).toEqual([]);
    });

    it('should never let the witness move the compact decision', async () => {
      // given: the same probe run twice, once with a loud disagreement and
      // once with no witness at all
      const root = ws().path;
      seedTranscript();
      seedProject(root);
      seedWitness(root, 0.06, PEAKS_TOKENS);
      const withDisagreement = await runContextNow(root);
      rmSync(harnessWitnessPath(root, SID), { force: true });
      const withoutWitness = await runContextNow(root);
      // then: the decision is identical — the witness is an observation, and
      // an observation that could fire a compact could fire a WRONG one
      expect(withDisagreement.data.action).toBe(withoutWitness.data.action);
      expect(withDisagreement.data.verdict).toBe(withoutWitness.data.verdict);
      expect(withDisagreement.data.next).toBe(withoutWitness.data.next);
    });
  });

  describe('(render)', () => {
    it('should resolve the canonical project root ONCE per probe, not once per consumer', async () => {
      // Repair cycle 3 (perf). The handler called
      // `resolveCanonicalProjectRoot(opts.project)` twice with the SAME
      // argument: once for the harness-window write, once for the witness read
      // that follows it. That resolution spawns `git rev-parse
      // --show-toplevel`, so the witness read — 0.027 ms of actual work — was
      // charged roughly 4,000x its own cost on a per-turn command. The
      // control is the case below: the probe still produces the same envelope,
      // so this is a cost fix and not a behaviour change.
      const root = ws().path;
      seedTranscript();
      seedProject(root);
      __resolutions.count = 0;
      // when
      await runContextNow(root);
      // then
      expect(__resolutions.count).toBe(1);
    });

    it('should always expose the field, so a consumer never has to guess whether it was checked', async () => {
      const root = ws().path;
      seedTranscript();
      seedProject(root);
      const envelope = await runContextNow(root);
      expect(envelope.data.harnessWitness).toBeDefined();
      expect(typeof envelope.data.harnessWitness.verdict).toBe('string');
      expect(typeof envelope.data.harnessWitness.peaksRatio).toBe('number');
    });
  });
});
