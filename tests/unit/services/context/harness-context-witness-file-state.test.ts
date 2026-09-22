/**
 * rid `2026-09-13-statusline-window-witness` — WHAT IS ON DISK, AND WHAT THAT
 * SAYS. The four cases here are one subject: the state machine the reader and
 * the writer share over `harness-context-witness.json`.
 *
 *   absent file        → no render happened here
 *   file, unusable     → a render happened and its record cannot be used
 *   file, usable       → a render happened and here is what it saw
 *   a render that says less must not delete a record that says more
 *
 * WHY THE CASES LIVE HERE AND NOT IN `harness-context-witness.test.ts` (repair
 * cycle 3). That file crossed the 800-line wall when these cases were added to
 * it — the second time it has, and the same wall `peaks scan file-size` reports
 * on changed files. Repair cycle 2 met it by splitting out the sharpness sweep;
 * this is the same move for the same reason. The fixture scaffolding is local
 * and deliberately thin: these cases need a directory and a file, not a payload
 * builder, because what they are about is the FILE.
 *
 * WHY THE STATES ARE NAMED AT ALL. A reader used to return `null` for absent,
 * unreadable, malformed and wrong-shape alike, so the caller guessed the cause
 * from the directory alone — and told a session that HAD rendered that "the
 * statusline has not rendered here". That is the wrong-cause sentence §17-B was
 * written to remove, and it is the reason `readHarnessWitness` now returns a
 * tagged union instead of a nullable record.
 *
 * Style: BDD given/when/then per peaks-loop 4.0.11+ contract.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/context/harness-context-witness-file-state.test.ts',
  ['integration', 'behavior'],
  [
    {
      dim: 'render',
      reason:
        'No output shape is asserted here; the one-way sentence and the CLI envelope live in code-context-now-witness.test.ts.'
    },
    {
      dim: 'a11y',
      reason:
        'The only human-readable text asserted is the absent-cause clause, which is read by an LLM/CLI consumer rather than rendered.'
    }
  ]
);

import {
  WITNESS_SCHEMA_VERSION,
  harnessWitnessPath,
  readAndCompareHarnessWitness,
  readHarnessWitness,
  writeHarnessWitness,
  type HarnessContextWitness
} from '~/src/services/context/harness-context-witness';
import type { StatusLineStdin } from '~/src/services/skills/skill-statusline-service';
import { z } from 'zod';
import { parseJson } from '~/src/shared/json-parse';

const SID = '2026-09-13-session-filestate';
const WINDOW = 1_000_000;
const PEAKS_RATIO_FIXTURE = 0.9;
const PEAKS_TOKENS_FIXTURE = 900_000;
/** The `usageTokens` the payload below must parse to (`output_tokens` excluded). */
const PAYLOAD_USAGE_TOKENS = 300_000;

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
  const root = mkdtempSync(join(tmpdir(), 'peaks-witness-state-'));
  tmpRoots.push(root);
  return root;
}

function withSessionDir(root: string): string {
  const dir = join(root, '.peaks', '_runtime', SID);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** A payload carrying the harness's context block, as the docs describe it. */
function payloadOf(): StatusLineStdin {
  return {
    session_id: 'outer-harness-sid',
    workspace: { current_dir: '/tmp/project' },
    context_window: {
      context_window_size: WINDOW,
      used_percentage: 30,
      current_usage: {
        input_tokens: 200_000,
        cache_read_input_tokens: 90_000,
        cache_creation_input_tokens: 10_000
      }
    }
  };
}

/** A contextless payload — the shape a render that carries nothing usable has. */
const CONTEXTLESS = { session_id: 'outer-harness-sid' } as StatusLineStdin;

/** A well-formed record, for the `valid` arm. */
function recordJson(): string {
  const witness: HarnessContextWitness = {
    schemaVersion: WITNESS_SCHEMA_VERSION,
    capturedAt: '2026-09-13T10:00:00.000Z',
    usedPercentage: PEAKS_RATIO_FIXTURE,
    usedPercentageRaw: PEAKS_RATIO_FIXTURE,
    usedPercentageUnit: 'fraction',
    modelWindowTokens: WINDOW,
    usageTokens: PEAKS_TOKENS_FIXTURE,
    outerSessionId: null
  };
  return `${JSON.stringify(witness, null, 2)}\n`;
}

/**
 * The field this case reads back off the witness file on disk.
 *
 * It is read RAW on purpose — the point of the case is the downgrade decision,
 * and `readHarnessWitness` (asserted two lines above) normalizes the record.
 * `usageTokens` is `number | null` because a sample with no context block is
 * persisted as `null`, which the read side then treats as "no signal".
 */
const harnessWitnessFile = z.looseObject({ usageTokens: z.number().nullable() });

describe('harness context witness — on-disk state (repair cycle 3)', () => {
  describe('(integration)', () => {
    it('when the file is corrupt or absent, should not throw — and must not call the two the same', () => {
      // The control is the first assertion: absence and unusability are
      // different answers, produced by the same call on the same fixture. Both
      // used to read as `null`, so the caller had to guess.
      const root = makeProject();
      const dir = withSessionDir(root);
      expect(readHarnessWitness({ projectRoot: root, sessionId: SID }).kind).toBe('missing');
      writeFileSync(join(dir, 'harness-context-witness.json'), '{ not json', 'utf8');
      expect(readHarnessWitness({ projectRoot: root, sessionId: SID }).kind).toBe('invalid');
      // ...and a `valid` read is the third answer, with the record in it
      writeFileSync(join(dir, 'harness-context-witness.json'), recordJson(), 'utf8');
      const valid = readHarnessWitness({ projectRoot: root, sessionId: SID });
      expect(valid.kind).toBe('valid');
      expect(valid.kind === 'valid' && valid.witness.usageTokens).toBe(PEAKS_TOKENS_FIXTURE);
    });

    it('when the session directory is missing, should name THAT cause — not "nothing rendered"', () => {
      // F3 (repair cycle 3): this arm had ZERO coverage. Every case in
      // `code-context-now-witness.test.ts` calls `seedProject`, which CREATES
      // the directory, so the derivation always yielded `not-rendered` and
      // replacing the whole arm with that constant left the suite green. This
      // is the only case that calls the derivation directly.
      const root = makeProject();
      const noDir = readAndCompareHarnessWitness({
        projectRoot: root,
        sessionId: SID,
        peaksRatio: PEAKS_RATIO_FIXTURE,
        peaksTokens: PEAKS_TOKENS_FIXTURE,
        peaksWindowTokens: WINDOW,
        outerSessionId: null
      });
      // control: the SAME call with the directory present and no file in it
      withSessionDir(root);
      const noRender = readAndCompareHarnessWitness({
        projectRoot: root,
        sessionId: SID,
        peaksRatio: PEAKS_RATIO_FIXTURE,
        peaksTokens: PEAKS_TOKENS_FIXTURE,
        peaksWindowTokens: WINDOW,
        outerSessionId: null
      });
      expect(noDir.verdict).toBe('absent');
      expect(noRender.verdict).toBe('absent');
      expect(noDir.reason).toContain('no runtime directory');
      expect(noRender.reason).toContain('no render has been recorded');
      expect(noDir.reason).not.toBe(noRender.reason);
    });

    it('when a witness file exists but cannot be read, should say a render DID happen', () => {
      // F2 (repair cycle 3), end to end through the derivation the CLI uses.
      // The directory exists and holds a file the reader cannot use; this used
      // to be reported as "the statusline has not rendered here" — false, and
      // the wrong-cause sentence §17-B exists to remove. Same shape as the
      // Windows / in-place-fallback case the writer's own comment warns about.
      const root = makeProject();
      const dir = withSessionDir(root);
      writeFileSync(join(dir, 'harness-context-witness.json'), '{ not json', 'utf8');
      const comparison = readAndCompareHarnessWitness({
        projectRoot: root,
        sessionId: SID,
        peaksRatio: PEAKS_RATIO_FIXTURE,
        peaksTokens: PEAKS_TOKENS_FIXTURE,
        peaksWindowTokens: WINDOW,
        outerSessionId: null
      });
      expect(comparison.verdict).toBe('absent');
      expect(comparison.reason).toContain('could not be read');
      expect(comparison.reason).not.toContain('has not rendered');
    });

    it('when a later render carries no context_window, should keep the record that had a percentage', () => {
      // A contextless render used to overwrite the good record, so ONE payload
      // missing the block turned a real 3.3% window gap from a `disagree` with
      // its sentence into `unverifiable` with the sentence suppressed — a
      // silent loss of the only signal this slice exists to produce. The
      // control is the case above in `harness-context-witness.test.ts`: a
      // second render that DOES carry a percentage still overwrites.
      const root = makeProject();
      withSessionDir(root);
      writeHarnessWitness({ projectRoot: root, sessionId: SID, stdin: payloadOf(), nowMs: 0 });
      // when
      const downgraded = writeHarnessWitness({
        projectRoot: root,
        sessionId: SID,
        stdin: CONTEXTLESS,
        nowMs: 1
      });
      // then: nothing was written (`false` is "no file written", not an error),
      // and the higher-information record — with the render that produced it —
      // is what a reader finds
      expect(downgraded).toBe(false);
      const kept = readHarnessWitness({ projectRoot: root, sessionId: SID });
      expect(kept.kind).toBe('valid');
      expect(kept.kind === 'valid' && kept.witness.usedPercentage).toBeCloseTo(0.3, 10);
      expect(kept.kind === 'valid' && kept.witness.usageTokens).toBe(PAYLOAD_USAGE_TOKENS);
      expect(kept.kind === 'valid' && kept.witness.capturedAt).toBe(new Date(0).toISOString());
      expect(
        parseJson(readFileSync(harnessWitnessPath(root, SID), 'utf8'), harnessWitnessFile)
          .usageTokens
      ).toBe(PAYLOAD_USAGE_TOKENS);
    });
  });
});
