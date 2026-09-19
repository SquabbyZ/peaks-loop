/**
 * rid `2026-09-13-statusline-window-witness` — capture the harness's OWN
 * context numbers, and compare them with peaks-loop's, with a control group
 * that proves the comparison can come out BOTH ways.
 *
 * AC1 — the statusline render captures `used_percentage` +
 * `context_window_size` into the session runtime path. The cases below assert
 * the write, its refusals, and that the file lands under
 * `.peaks/_runtime/<sid>/` and nowhere near a harness-owned file.
 *
 * AC2/AC3 — the comparison itself, at the layer both the CLI and a future
 * reader consume. `describeHarnessWitness` is the one-way sentence; it must be
 * `null` for every verdict except `disagree`.
 *
 * AC4 — THE CONTROL GROUP. Two inputs that differ in ONE field produce
 * opposite verdicts: same session, same window, same token snapshot, same
 * probe ratio; only the harness's percentage moves. The "agree" input and the
 * "disagree" input go through the identical call, so whichever way the guard
 * is broken, one of them fails. The pair at the tolerance boundary is what
 * pins the tolerance's VALUE rather than its existence.
 *
 * The third case that matters is the one where the guard must stay SILENT:
 * a witness that is far away in tokens AND far away in percentage. A guard
 * whose only outcomes are "fired" and "silent" cannot tell "correctly silent"
 * from "broken"; `unverifiable` is that third outcome, and it is asserted here
 * on the input that would otherwise produce a confident false alarm.
 *
 * Style: BDD given/when/then per peaks-loop 4.0.11+ contract.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

// One switch, off by default: makes `renameSync` fail the way Windows fails it
// when the reader holds the target open. Every other `node:fs` export is the
// real one, so the case below is the only one that sees it.
const __rename = vi.hoisted(() => ({ fail: false }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    renameSync: (...args: Parameters<typeof actual.renameSync>) => {
      if (__rename.fail)
        throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
      return actual.renameSync(...args);
    }
  };
});

declareDimensions(
  'tests/unit/services/context/harness-context-witness.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason: 'No human-visible output beyond the one-way sentence, asserted in the behavior suite.'
    }
  ]
);

import {
  WITNESS_NUMERATOR_FRACTION,
  WITNESS_PERCENT_ROUNDING_FRACTION,
  WITNESS_SCHEMA_VERSION,
  compareHarnessWitness,
  describeHarnessWitness,
  harnessWitnessPath,
  parseHarnessWitness,
  readHarnessWitness,
  witnessToleranceTokens,
  writeHarnessWitness,
  type HarnessContextWitness
} from '~/src/services/context/harness-context-witness';
import type { StatusLineStdin } from '~/src/services/skills/skill-statusline-service';

const SID = '2026-09-13-session-witness';
const WINDOW = 1_000_000;

const tmpRoots: string[] = [];

afterEach(() => {
  for (const root of tmpRoots) {
    try {
      if (existsSync(root)) rmSync(root, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  tmpRoots.length = 0;
});

function makeProject(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-witness-'));
  tmpRoots.push(root);
  return root;
}

function withSessionDir(root: string, sid = SID): string {
  const dir = join(root, '.peaks', '_runtime', sid);
  mkdirSync(dir, { recursive: true });
  return dir;
}

interface HarnessPayload {
  readonly session_id?: string;
  readonly context_window?: {
    readonly context_window_size?: unknown;
    readonly used_percentage?: unknown;
    readonly current_usage?: Record<string, unknown>;
  };
}

function payloadOf(overrides: HarnessPayload = {}): StatusLineStdin {
  return {
    session_id: 'outer-harness-sid',
    workspace: { current_dir: '/tmp/project' },
    context_window: {
      context_window_size: WINDOW,
      used_percentage: 30,
      current_usage: {
        input_tokens: 200_000,
        cache_read_input_tokens: 90_000,
        cache_creation_input_tokens: 10_000,
        output_tokens: 4_000
      }
    },
    ...overrides
  };
}

/** The `usageTokens` the payload above must parse to (output_tokens excluded). */
const PAYLOAD_USAGE_TOKENS = 300_000;

/**
 * The comparison fixtures read 90% of the window, and 900,000 of its tokens.
 *
 * IT USED TO BE 30%, AND THAT WAS PART OF THE DEFECT (repair cycle 2). The
 * guard's residual for a window difference carries the WITNESS's ratio, so a
 * sample at 30% of the window cannot separate the smallest real difference from
 * the budget's uncertainty, and `agree` there was a claim it could not support.
 * Every fixture in this file sat at 30% — the one region where the guard was
 * quiet about a real gap — so no case here could have caught it. 90% is also
 * where the guard actually runs: the probe's consumers care about the band
 * around the auto-compact threshold, not about an early session.
 */
const PEAKS_RATIO_FIXTURE = 0.9;
const PEAKS_TOKENS_FIXTURE = 900_000;

function witnessOf(overrides: Partial<HarnessContextWitness> = {}): HarnessContextWitness {
  const usedPercentage =
    overrides.usedPercentage === undefined ? PEAKS_RATIO_FIXTURE : overrides.usedPercentage;
  return {
    schemaVersion: WITNESS_SCHEMA_VERSION,
    capturedAt: '2026-09-13T10:00:00.000Z',
    usedPercentage,
    // consistent with `usedPercentage` unless a case is specifically about the
    // raw value / the reading taken from it
    usedPercentageRaw: usedPercentage,
    usedPercentageUnit: usedPercentage === null ? null : 'fraction',
    modelWindowTokens: WINDOW,
    usageTokens: PEAKS_TOKENS_FIXTURE,
    outerSessionId: null,
    ...overrides
  };
}

/**
 * The witness a read found, or `null` — the shape most cases here assert on.
 * The read itself returns a tagged union (`missing` / `valid` / `invalid`)
 * because those are three different facts; a case that is ABOUT the difference
 * calls `readHarnessWitness` directly.
 */
function witnessAt(root: string, sid = SID): HarnessContextWitness | null {
  const read = readHarnessWitness({ projectRoot: root, sessionId: sid });
  return read.kind === 'valid' ? read.witness : null;
}

/** Probe side: peaks-loop measured 900,000 tokens against a 1,000,000 window. */
function compareWith(
  witness: HarnessContextWitness | null,
  overrides: Record<string, unknown> = {}
) {
  return compareHarnessWitness({
    witness,
    peaksRatio: PEAKS_RATIO_FIXTURE,
    peaksTokens: PEAKS_TOKENS_FIXTURE,
    peaksWindowTokens: WINDOW,
    outerSessionId: null,
    ...overrides
  });
}

// The tolerance this fixture must produce. Written as the formula, not as a
// literal, so a change to either contributor shows up as a failing case rather
// than as a silently different budget.
const FRESH_TOLERANCE =
  (WITNESS_PERCENT_ROUNDING_FRACTION * WINDOW + WITNESS_NUMERATOR_FRACTION * PEAKS_TOKENS_FIXTURE) /
  WINDOW;

describe('harness context witness — capture (AC1)', () => {
  describe('(behavior)', () => {
    it('when the payload carries a context_window, should parse it into the recorded shape', () => {
      // given / when
      const parsed = parseHarnessWitness({
        stdin: payloadOf(),
        nowMs: Date.parse('2026-09-13T10:00:00.000Z')
      });
      // then: every field the comparison needs, and the raw usage components
      // summed the same way peaks-loop sums its own transcript estimate.
      expect(parsed).not.toBeNull();
      expect(parsed!.usedPercentage).toBeCloseTo(0.3, 10);
      expect(parsed!.modelWindowTokens).toBe(WINDOW);
      expect(parsed!.usageTokens).toBe(PAYLOAD_USAGE_TOKENS);
      expect(parsed!.outerSessionId).toBe('outer-harness-sid');
      expect(parsed!.capturedAt).toBe('2026-09-13T10:00:00.000Z');
    });

    it('when used_percentage is already a fraction, should keep it (unit is inferred, not assumed)', () => {
      // given: a payload whose own token snapshot agrees with the fraction
      // reading — 300,000 tokens of a 1,000,000 window is the 0.3 it reports
      const payload = payloadOf({
        context_window: {
          context_window_size: WINDOW,
          used_percentage: 0.3,
          current_usage: { input_tokens: 300_000 }
        }
      });
      // then
      const parsed = parseHarnessWitness({ stdin: payload, nowMs: 0 })!;
      expect(parsed.usedPercentage).toBeCloseTo(0.3, 10);
      expect(parsed.usedPercentageRaw).toBe(0.3);
      expect(parsed.usedPercentageUnit).toBe('fraction');
    });

    it('should read a bare `1` as 1%, not as a full window (the witness settles the unit)', () => {
      // given: an integer-percent payload reporting 1% — 10,000 of 1,000,000.
      // Read as a fraction this is 100% of the window, which is a state the
      // harness does not report, and it would turn a unit misread into a
      // confident 70-point "disagreement" with a probe reading 30%.
      const payload = payloadOf({
        context_window: {
          context_window_size: WINDOW,
          used_percentage: 1,
          current_usage: { input_tokens: 10_000 }
        }
      });
      // when
      const parsed = parseHarnessWitness({ stdin: payload, nowMs: 0 })!;
      // then: the one reading consistent with the payload's own tokens
      expect(parsed.usedPercentage).toBeCloseTo(0.01, 10);
      expect(parsed.usedPercentageRaw).toBe(1);
      expect(parsed.usedPercentageUnit).toBe('percent');
    });

    it('should read a value above 1 as a percent by range alone, and keep it', () => {
      // given: 1.2 is out of range as a fraction and in range as a percent —
      // it is not refused (the old (1, 1.5] hole), and the snapshot agreeing
      // makes this the easy case
      const payload = payloadOf({
        context_window: {
          context_window_size: WINDOW,
          used_percentage: 1.2,
          current_usage: { input_tokens: 12_000 }
        }
      });
      // when / then
      const parsed = parseHarnessWitness({ stdin: payload, nowMs: 0 })!;
      expect(parsed.usedPercentage).toBeCloseTo(0.012, 10);
      expect(parsed.usedPercentageUnit).toBe('percent');
    });

    it('should read a value just above 1 as a percent by range alone, even when the snapshot points the other way', () => {
      // THE PIN ON `FRACTION_MAX`. Its value decides anything only on a payload
      // that contradicts itself: 1.0001 has exactly one in-range reading
      // (percent), and a snapshot saying 20% of the window fits neither
      // reading. The rule is that RANGE outranks the snapshot above this
      // threshold, and the threshold is 1 — at the repo's env / statusline
      // threshold of 1.5 this payload falls to the snapshot instead and is
      // stored as 1.0001, i.e. 100.01% of the window.
      const payload = payloadOf({
        context_window: {
          context_window_size: WINDOW,
          used_percentage: 1.0001,
          current_usage: { input_tokens: 200_000 }
        }
      });
      // when / then
      const parsed = parseHarnessWitness({ stdin: payload, nowMs: 0 })!;
      expect(parsed.usedPercentageUnit).toBe('percent');
      expect(parsed.usedPercentage).toBeCloseTo(0.010001, 10);
    });

    it('should take the nearer of the two readings when the snapshot sits between them', () => {
      // THE PIN ON THE MIDPOINT. The two in-range readings of a raw value differ
      // by exactly 100x, so the boundary between them is their geometric
      // midpoint — `raw / 10`, which is 0.05 for this 0.5. Neither payload below
      // is self-consistent (0.5 is neither 3% nor 70% of the window); what they
      // pin is which side of that boundary the snapshot falls on, and therefore
      // that the boundary is where the doc says it is.
      const nearerThePercent = parseHarnessWitness({
        stdin: payloadOf({
          context_window: {
            context_window_size: WINDOW,
            used_percentage: 0.5,
            current_usage: { input_tokens: 30_000 }
          }
        }),
        nowMs: 0
      })!;
      const nearerTheFraction = parseHarnessWitness({
        stdin: payloadOf({
          context_window: {
            context_window_size: WINDOW,
            used_percentage: 0.5,
            current_usage: { input_tokens: 70_000 }
          }
        }),
        nowMs: 0
      })!;
      expect(nearerThePercent.usedPercentageUnit).toBe('percent');
      expect(nearerThePercent.usedPercentage).toBeCloseTo(0.005, 10);
      expect(nearerTheFraction.usedPercentageUnit).toBe('fraction');
      expect(nearerTheFraction.usedPercentage).toBeCloseTo(0.5, 10);
    });

    it('should refuse a percentage below zero as well as above the scale, and keep it', () => {
      // Only the upper bound of the scale had a case. Without the lower one a
      // negative reading falls through to the unit rule, is stored as a
      // negative ratio, and compares as a confident disagreement.
      const payload = payloadOf({
        context_window: {
          context_window_size: WINDOW,
          used_percentage: -1,
          current_usage: { input_tokens: 10_000 }
        }
      });
      const parsed = parseHarnessWitness({ stdin: payload, nowMs: 0 })!;
      expect(parsed.usedPercentage).toBeNull();
      expect(parsed.usedPercentageRaw).toBe(-1);
      expect(parsed.usedPercentageUnit).toBeNull();
    });

    it('when nothing in the payload settles the scale, should record the value without taking a reading', () => {
      // given: `used_percentage` with no token snapshot at all — no
      // `context_window_size` and no `current_usage`. 1 is in range as a
      // fraction (100%) and as a percent (1%), and the two readings differ by
      // 100x. The repo's convention elsewhere is fraction-first; applying it
      // here is what read a "used 1%" payload as a full window and produced a
      // confident disagreement — with a sentence blaming the two denominators —
      // against a probe reading 90%.
      const payload = payloadOf({
        context_window: { context_window_size: WINDOW, used_percentage: 1 }
      });
      // when
      const parsed = parseHarnessWitness({ stdin: payload, nowMs: 0 })!;
      // then: the value is kept and NO reading is taken. The control is the
      // bare-`1` case above: the same payload WITH a snapshot resolves.
      expect(parsed.usedPercentage).toBeNull();
      expect(parsed.usedPercentageRaw).toBe(1);
      expect(parsed.usedPercentageUnit).toBe('unestablished');
    });

    it('when used_percentage is on neither scale, should keep the raw value and refuse to compare', () => {
      // given
      const payload = payloadOf({
        context_window: { context_window_size: WINDOW, used_percentage: 150, current_usage: {} }
      });
      // when
      const parsed = parseHarnessWitness({ stdin: payload, nowMs: 0 });
      // then: the value is NOT discarded — a refused payload and a render that
      // never happened must not look the same on disk
      expect(parsed).not.toBeNull();
      expect(parsed!.usedPercentage).toBeNull();
      expect(parsed!.usedPercentageRaw).toBe(150);
      expect(parsed!.usedPercentageUnit).toBeNull();
    });

    it('when the payload has no context_window, should record the render without inventing a number', () => {
      const parsed = parseHarnessWitness({
        stdin: { session_id: 'x' },
        nowMs: 0
      });
      expect(parsed).not.toBeNull();
      expect(parsed!.usedPercentage).toBeNull();
      expect(parsed!.usedPercentageRaw).toBeNull();
      expect(parsed!.modelWindowTokens).toBeNull();
      expect(parsed!.usageTokens).toBeNull();
    });

    it('when context_window is `null`, should read it as "no context block" rather than throw', () => {
      // REGRESSION (repair cycle 3). `null` is what a JSON producer writes for
      // "present key, no value", and this field's value is the harness's to
      // choose. The guard tested only `undefined`, so `null.context_window_size`
      // threw — out of this function, past `writeHarnessWitness`'s only `try`,
      // out of `runDefaultStatuslineRender` and out of the commander action,
      // with NO line emitted: measured against the real CLI, exit 1, empty
      // stdout, UNHANDLED_ERROR, and the user's status bar blank for the
      // session. The control is the case above — the key absent — which must
      // produce the identical record, and does.
      const parsed = parseHarnessWitness({
        stdin: { session_id: 'x', context_window: null } as unknown as StatusLineStdin,
        nowMs: 0
      });
      expect(parsed).not.toBeNull();
      expect(parsed!.usedPercentage).toBeNull();
      expect(parsed!.usedPercentageRaw).toBeNull();
      expect(parsed!.modelWindowTokens).toBeNull();
      expect(parsed!.usageTokens).toBeNull();
      expect(parsed).toEqual(parseHarnessWitness({ stdin: { session_id: 'x' }, nowMs: 0 }));
    });

    it('when there is no payload at all, should record nothing (a TTY render is not a harness render)', () => {
      expect(parseHarnessWitness({ stdin: null, nowMs: 0 })).toBeNull();
    });
  });

  describe('(integration)', () => {
    it('when the session dir exists, should write the witness under `.peaks/_runtime/<sid>/`', () => {
      // given
      const root = makeProject();
      withSessionDir(root);
      // when
      const written = writeHarnessWitness({
        projectRoot: root,
        sessionId: SID,
        stdin: payloadOf(),
        nowMs: 0
      });
      // then: on disk, under the session runtime path, and readable back
      expect(written).toBe(true);
      const path = harnessWitnessPath(root, SID);
      expect(existsSync(path)).toBe(true);
      expect(path.startsWith(join(root, '.peaks', '_runtime', SID))).toBe(true);
      // ...and NOT anywhere the harness owns
      expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false);
      expect(witnessAt(root)!.usageTokens).toBe(PAYLOAD_USAGE_TOKENS);
      // ...and no partial state is left behind: the write goes through a temp
      // file, so a concurrent reader can never see half a witness
      expect(readdirSync(dirname(path)).filter((name) => name.includes('.tmp-'))).toEqual([]);
    });

    it('when the session dir is missing, should not create it and not write', () => {
      const root = makeProject();
      expect(
        writeHarnessWitness({ projectRoot: root, sessionId: SID, stdin: payloadOf(), nowMs: 0 })
      ).toBe(false);
      expect(existsSync(join(root, '.peaks'))).toBe(false);
    });

    it('when the payload has no context_window, should still record the render, without a number', () => {
      // given
      const root = makeProject();
      withSessionDir(root);
      // when
      const written = writeHarnessWitness({
        projectRoot: root,
        sessionId: SID,
        stdin: { session_id: 'x' },
        nowMs: 0
      });
      // then: a render DID happen here, and the file says so — that is what
      // separates "the payload had nothing to read" from "nothing rendered"
      expect(written).toBe(true);
      const read = witnessAt(root);
      expect(read).not.toBeNull();
      expect(read!.usedPercentage).toBeNull();
      expect(read!.usedPercentageRaw).toBeNull();
    });

    it('when a second render happens, should overwrite — the latest render is the witness', () => {
      const root = makeProject();
      withSessionDir(root);
      writeHarnessWitness({ projectRoot: root, sessionId: SID, stdin: payloadOf(), nowMs: 0 });
      const changed = payloadOf({
        context_window: {
          context_window_size: WINDOW,
          used_percentage: 61,
          current_usage: { input_tokens: 610_000 }
        }
      });
      writeHarnessWitness({ projectRoot: root, sessionId: SID, stdin: changed, nowMs: 1 });
      const read = witnessAt(root);
      expect(read!.usedPercentage).toBeCloseTo(0.61, 10);
      expect(read!.usageTokens).toBe(610_000);
      // then: exactly one file, not an append log
      expect(JSON.parse(readFileSync(harnessWitnessPath(root, SID), 'utf8')).schemaVersion).toBe(
        WITNESS_SCHEMA_VERSION
      );
    });

    it('when the rename cannot replace the file, should still land the sample', () => {
      // given: the rename failing the way it fails on Windows when the reader
      // — the probe, in another process — holds the target open. The control
      // for this case is the case above: unmocked, the temp path is used and
      // no `.tmp-` file is left behind.
      const root = makeProject();
      const dir = withSessionDir(root);
      writeFileSync(
        harnessWitnessPath(root, SID),
        '{"schemaVersion":2,"usedPercentage":0.99}\n',
        'utf8'
      );
      __rename.fail = true;
      try {
        // when
        const written = writeHarnessWitness({
          projectRoot: root,
          sessionId: SID,
          stdin: payloadOf(),
          nowMs: 0
        });
        // then: the observation survives — dropping it here would be the exact
        // silent loss the temp+rename exists to remove
        expect(written).toBe(true);
      } finally {
        __rename.fail = false;
      }
      expect(witnessAt(root)!.usageTokens).toBe(PAYLOAD_USAGE_TOKENS);
      expect(readdirSync(dir).filter((name) => name.includes('.tmp-'))).toEqual([]);
    });
  });
});

describe('harness context witness — comparison (AC2/AC3/AC4)', () => {
  describe('(render)', () => {
    it('when the witness is absent, should report `absent` — not agreement, not disagreement', () => {
      const comparison = compareWith(null);
      expect(comparison.verdict).toBe('absent');
      expect(comparison.harnessPct).toBeNull();
      expect(comparison.deviation).toBeNull();
      expect(describeHarnessWitness(comparison)).toBeNull();
    });

    it('when the witness belongs to another harness session, should refuse to compare it', () => {
      const comparison = compareWith(witnessOf({ outerSessionId: 'other-session' }), {
        outerSessionId: 'this-session'
      });
      expect(comparison.verdict).toBe('foreign-session');
      expect(describeHarnessWitness(comparison)).toBeNull();
    });

    it('when one id is unresolvable, should compare anyway (leniency is one-way by design)', () => {
      // given: the witness names a session, this side cannot resolve one
      const comparison = compareWith(witnessOf({ outerSessionId: 'other-session' }), {
        outerSessionId: null
      });
      // then: a missing field never becomes a permanent "cannot tell"
      expect(comparison.verdict).toBe('agree');
    });
  });

  describe('(behavior)', () => {
    it('AC4 control A — when both sides describe the same moment and agree, should NOT alert', () => {
      // given: identical token snapshot, harness percentage == peaks ratio
      const comparison = compareWith(witnessOf({ usedPercentage: 0.9, usageTokens: 900_000 }));
      // then
      expect(comparison.verdict).toBe('agree');
      expect(comparison.deviation).toBeCloseTo(0, 10);
      expect(comparison.tolerance).toBeCloseTo(FRESH_TOLERANCE, 10);
      expect(describeHarnessWitness(comparison)).toBeNull();
    });

    it('AC4 control B — when both sides describe the same moment and DISAGREE, should alert', () => {
      // given: the SAME token snapshot and the SAME probe ratio as control A —
      // only the harness's percentage moves. This is the shape of a real
      // denominator mismatch (the harness compacting against ~1/5th of the
      // window peaks-loop divides by), not an arbitrary large delta.
      const comparison = compareWith(witnessOf({ usedPercentage: 0.18, usageTokens: 900_000 }));
      // then
      expect(comparison.verdict).toBe('disagree');
      expect(comparison.deviation).toBeCloseTo(0.72, 10);
      const sentence = describeHarnessWitness(comparison);
      expect(sentence).not.toBeNull();
      // the sentence states the two numbers it is comparing, and asks nothing
      expect(sentence).toContain('90.0%');
      expect(sentence).toContain('18.0%');
      expect(sentence).not.toContain('?');
    });

    it('when the deviation sits just inside the tolerance, should agree — and just outside, should disagree', () => {
      // given: two inputs 0.001 apart, straddling the computed budget
      const inside = compareWith(
        witnessOf({ usedPercentage: 0.9 - (FRESH_TOLERANCE - 0.001), usageTokens: 900_000 })
      );
      const outside = compareWith(
        witnessOf({ usedPercentage: 0.9 - (FRESH_TOLERANCE + 0.001), usageTokens: 900_000 })
      );
      // then: the tolerance is not merely present, it is the thing deciding
      expect(inside.verdict).toBe('agree');
      expect(outside.verdict).toBe('disagree');
    });

    it('when the witness is stale but consistent, should subtract the skew and not alert', () => {
      // given: a witness captured 750,000 tokens ago, whose reading is exactly
      // what that much smaller count implies — 15% of the window against
      // peaks-loop's 90%. A guard that merely BUDGETED the skew would "agree"
      // for the wrong reason here, and would go on agreeing for any window
      // difference small enough to hide inside the same allowance.
      const comparison = compareWith(witnessOf({ usedPercentage: 0.15, usageTokens: 150_000 }));
      // then: the deviation is real (75 points) and the residual is zero,
      // because under equal denominators the two differences are the same
      // number; the budget stayed the rounding-and-numerator one.
      expect(comparison.deviation).toBeCloseTo(0.75, 10);
      expect(comparison.residual).toBeCloseTo(0, 10);
      expect(comparison.tolerance).toBeCloseTo((0.005 * WINDOW + 0.0017 * 900_000) / WINDOW, 10);
      expect(comparison.tolerance).toBeLessThan(0.007);
      expect(describeHarnessWitness(comparison)).toBeNull();
      // ...and the answer is the THIRD one, not `agree`: the residual is
      // exactly zero, but a witness at 15% of the window cannot separate the
      // smallest real window difference from the budget, so this sample cannot
      // support a claim that the denominators match. A consistent witness is
      // not the same fact as a sharp one.
      expect(comparison.verdict).toBe('unverifiable');
    });

    it('when the same staleness cannot explain the difference, should disagree', () => {
      // given: the SAME 150,000-token skew as the case above, but the witness
      // reports 5% where that skew implies 15%. Removing the skew exactly is
      // what exposes this; adding it to the budget is what hid it.
      const comparison = compareWith(witnessOf({ usedPercentage: 0.05, usageTokens: 150_000 }));
      // then
      expect(comparison.residual).toBeCloseTo(0.1, 10);
      expect(comparison.verdict).toBe('disagree');
      // and the printed evidence names the raw value and the reading taken
      const sentence = describeHarnessWitness(comparison);
      expect(sentence).not.toBeNull();
      expect(sentence).not.toContain('?');
    });

    it('when the harness percentage is on neither scale, should abstain — never a disagreement', () => {
      // given: a recorded render whose payload reported 150 (the ledger keeps
      // the raw value); a unit misfire must not be able to look like a
      // denominator difference
      const comparison = compareWith(
        witnessOf({ usedPercentage: null, usedPercentageRaw: 150, usedPercentageUnit: null })
      );
      // then
      expect(comparison.verdict).toBe('unverifiable');
      expect(comparison.harnessPct).toBeNull();
      expect(comparison.reason).toContain('150');
      expect(describeHarnessWitness(comparison)).toBeNull();
    });

    it('when the render recorded no percentage at all, should say so rather than blame the statusline', () => {
      // given: a ledger entry from a payload with no `context_window`
      const comparison = compareWith(
        witnessOf({ usedPercentage: null, usedPercentageRaw: null, usedPercentageUnit: null })
      );
      // then: the cause is named, and it is not "nothing rendered here"
      expect(comparison.verdict).toBe('unverifiable');
      expect(comparison.reason).toContain('no `used_percentage`');
      expect(describeHarnessWitness(comparison)).toBeNull();
    });

    it('when the payload settled no scale for its percentage, should name that cause and not the other two', () => {
      // given: a recorded render whose percentage was in range on both scales
      // with nothing to settle which (see the capture case)
      const comparison = compareWith(
        witnessOf({
          usedPercentage: null,
          usedPercentageRaw: 1,
          usedPercentageUnit: 'unestablished'
        })
      );
      // then: the three `unverifiable` causes are three different sentences —
      // "the payload said nothing", "the payload said 1 and meant either scale",
      // "the payload said 150 which is on neither" — because a reader who is
      // told the wrong cause looks in the wrong place
      expect(comparison.verdict).toBe('unverifiable');
      expect(comparison.harnessPct).toBeNull();
      expect(comparison.reason).toContain('1');
      expect(comparison.reason).toContain('no token snapshot');
      expect(comparison.reason).not.toContain('neither scale');
      expect(describeHarnessWitness(comparison)).toBeNull();
    });

    it('when there is no witness file, should name which of the two absences this is', () => {
      // given: the same verdict from two different states
      const noDir = compareWith(null, { absentCause: 'session-dir-missing' });
      const noRender = compareWith(null, { absentCause: 'not-rendered' });
      // then: the reason is not one fixed string for every cause
      expect(noDir.verdict).toBe('absent');
      expect(noRender.verdict).toBe('absent');
      expect(noDir.reason).toContain('no runtime directory');
      expect(noRender.reason).toContain('no render has been recorded');
      expect(noDir.reason).not.toBe(noRender.reason);
    });

    it('when either side has no token snapshot, should abstain — the moment cannot be established', () => {
      const noWitnessTokens = compareWith(witnessOf({ usageTokens: null }));
      const noProbeTokens = compareWith(witnessOf(), { peaksTokens: null });
      const noWindow = compareWith(witnessOf(), { peaksWindowTokens: null });
      for (const comparison of [noWitnessTokens, noProbeTokens, noWindow]) {
        expect(comparison.verdict).toBe('unverifiable');
        expect(describeHarnessWitness(comparison)).toBeNull();
      }
    });

    it('when the witness is too small a share of the window, should abstain', () => {
      // given: both sides describe the SAME moment at 2% of the window — an
      // exactly consistent witness. The residual is zero, and the answer is
      // still not `agree`: a 3% window difference would leave a residual of
      // 0.03 x 0.02 / 1.03 = 0.00058 here, far inside the budget's own
      // uncertainty, so no sample at this size can support the claim. 2% is
      // also far below any compact threshold, where the question does not
      // matter operationally.
      const comparison = compareWith(witnessOf({ usedPercentage: 0.02, usageTokens: 20_000 }), {
        peaksRatio: 0.02,
        peaksTokens: 20_000
      });
      expect(comparison.residual).toBeCloseTo(0, 10);
      expect(comparison.verdict).toBe('unverifiable');
    });
  });

  describe('(integration)', () => {
    it('when the window changes, should scale the rounding term and not the measured one', () => {
      // given: the same token count against two windows
      const small = witnessToleranceTokens({ windowTokens: 200_000, usedTokens: 300_000 });
      const large = witnessToleranceTokens({ windowTokens: 1_000_000, usedTokens: 300_000 });
      // then: rounding is a fraction OF THE WINDOW; the numerator term is a
      // fraction of the tokens and must not move with the window
      expect(large - small).toBeCloseTo(
        WITNESS_PERCENT_ROUNDING_FRACTION * (1_000_000 - 200_000),
        10
      );
      expect(small).toBeGreaterThan(WITNESS_NUMERATOR_FRACTION * 300_000);
      expect(witnessToleranceTokens({ windowTokens: WINDOW, usedTokens: 300_000 })).toBeCloseTo(
        5_510,
        10
      );
    });

    it('when the ratio sits where the sharpness gate decides the answer, should abstain', () => {
      // given: 120,000 of a 1,000,000 window, witnessed at the same moment. The
      // budget is 0.005 + 0.0017 x 0.12 = 0.005204, and a 3% window difference
      // would leave 0.03 x 0.12 / 1.03 = 0.0035 of residual — inside the
      // budget's own uncertainty, so no sample at this ratio can support an
      // `agree`, however good the token alignment.
      const comparison = compareWith(witnessOf({ usedPercentage: 0.12, usageTokens: 120_000 }), {
        peaksRatio: 0.12,
        peaksTokens: 120_000
      });
      // then: abstaining is the honest answer. (The arithmetic is written as
      // literals, not derived from the constants: an expectation recomputed
      // from the thing under test cannot notice that the thing moved, which is
      // how a gate of 0.05 once left every case here green.)
      expect(comparison.verdict).toBe('unverifiable');
      expect(comparison.tolerance).toBeCloseTo(0.005 + 0.0017 * 0.12, 10);
      expect((0.03 * 0.12) / 1.03).toBeLessThan(2 * comparison.tolerance!);
    });

    it('when the witness file was written by an earlier revision, should abstain rather than read it under the new rule', () => {
      // given: the file the cycle-0 writer left on disk — no
      // `usedPercentageRaw`, no `usedPercentageUnit`, and a `usedPercentage`
      // normalised by the OLD unit rule, which read the payload's bare `1` as a
      // fraction, i.e. 100% of the window. These files exist for anyone who ran
      // that revision.
      const root = makeProject();
      const dir = withSessionDir(root);
      writeFileSync(
        join(dir, 'harness-context-witness.json'),
        `${JSON.stringify({
          schemaVersion: 1,
          capturedAt: '2026-09-13T10:00:00.000Z',
          usedPercentage: 1,
          modelWindowTokens: WINDOW,
          usageTokens: 900_000,
          outerSessionId: null
        })}\n`,
        'utf8'
      );
      // when
      const comparison = compareWith(witnessAt(root));
      // then: the version is branched on, and the OLD value is not compared as
      // if it were current. The control is the bare-`1` capture case: the same
      // payload through the current writer reads 0.01 (a percent), which is
      // `agree` here — reading the stored 1 as if it were current would instead
      // report a confident disagreement and blame the two denominators for a
      // unit misfire.
      expect(comparison.verdict).toBe('unverifiable');
      expect(comparison.harnessPct).toBeNull();
      expect(comparison.reason).toContain('v1');
      expect(comparison.reason).toContain(`v${WITNESS_SCHEMA_VERSION}`);
      expect(describeHarnessWitness(comparison)).toBeNull();
    });

    it('should pin the witness schema version to its declared value', () => {
      // Also a literal, and now load-bearing: the comparison branches on this
      // value, so a silent bump re-reads every witness already on disk under a
      // rule it was not written with — which is the defect the branch exists to
      // prevent. Moving it must be a deliberate act with a migration, not a
      // side effect of adding a field.
      expect(WITNESS_SCHEMA_VERSION).toBe(2);
    });

    it('should report the real-world 3.3% window gap at every skew, not only at some', () => {
      // THE REGRESSION THIS PINS. With the sampling skew added to the budget
      // instead of subtracted from the deviation, this gap — 1,000,000 against
      // the harness's ~967,000, the smallest real denominator difference and
      // the one this slice exists to surface — was reported `agree` for skews
      // of 12,400 to 22,100 tokens, and gaps up to 5.3% never surfaced at all.
      const W = 1_000_000;
      const harnessWindow = W / 1.033;
      const peaksTokens = Math.round(0.96 * W);
      const verdicts = new Set<string>();
      for (let skew = 0; skew <= 0.03; skew += 0.0005) {
        const witnessTokens = peaksTokens - Math.round(skew * W);
        verdicts.add(
          compareHarnessWitness({
            witness: witnessOf({
              usedPercentage: witnessTokens / harnessWindow,
              usageTokens: witnessTokens
            }),
            peaksRatio: 0.96,
            peaksTokens,
            peaksWindowTokens: W,
            outerSessionId: null
          }).verdict
        );
      }
      expect([...verdicts]).toEqual(['disagree']);
    });
  });
});
