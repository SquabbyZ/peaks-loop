/**
 * rid `2026-09-13-statusline-window-witness` — the render path captures the
 * harness's context numbers, and the render itself does not change.
 *
 * AC1 — this file exercises the REAL render action (`runDefaultStatuslineRender`,
 * the same function `peaks statusline` runs), not the capture helper, because
 * the claim under test is a WIRING claim: the numbers on the payload reach the
 * session runtime path. A test of the helper alone would pass with the call
 * site deleted.
 *
 * AC6 — the same call without a `context_window` on the payload must produce a
 * byte-identical rendered line and no witness file. Byte-identity separates
 * "the capture is additive" from "the capture is additive today": any change
 * to the rendered line fails it, and the case where nothing is captured is the
 * control that says the difference between the two renders was the payload.
 *
 * AC6 also covers the write failing. The statusline runs on every turn; an
 * observability file that cannot be written must cost the observation and not
 * the status line. The failing case is forced with a DIRECTORY where the file
 * belongs, so `writeFileSync` throws for real instead of through a mock.
 *
 * `PEAKS_STATUSLINE_STDIN` is the test seam (same shape as `PEAKS_HOOK_STDIN`):
 * the harness payload is the only channel carrying these numbers, so a test
 * that cannot supply one cannot verify the capture at all.
 *
 * Style: BDD given/when/then per peaks-loop 4.0.11+ contract.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/cli/statusline-witness-capture.test.ts',
  ['render', 'behavior', 'integration'],
  [
    {
      dim: 'a11y',
      reason:
        'The rendered line is asserted byte-for-byte under (render); this slice adds no human-facing text.'
    }
  ]
);

import { makeCapturedIo, withEnv } from '../_setup/io.js';
import { withTmpWorkspacePerTest } from '../_setup/tmp-workspace.js';
import { runDefaultStatuslineRender } from '~/src/cli/commands/statusline-commands';
import {
  harnessWitnessPath,
  readHarnessWitness
} from '~/src/services/context/harness-context-witness';

const SID = '2026-09-13-session-renderwitness';
const OUTER = 'outer-render-session';
const WINDOW = 1_000_000;
const FIXED_NOW = Date.parse('2026-09-13T12:00:00.000Z');

/** A payload with the harness's context block, as the docs describe it. */
const PAYLOAD_WITH_CONTEXT = JSON.stringify({
  session_id: OUTER,
  context_window: {
    context_window_size: WINDOW,
    used_percentage: 42,
    remaining_percentage: 58,
    current_usage: {
      input_tokens: 300_000,
      cache_read_input_tokens: 100_000,
      cache_creation_input_tokens: 20_000,
      output_tokens: 3_000
    }
  }
});

/** The same payload minus the context block (an older / other harness render). */
const PAYLOAD_WITHOUT_CONTEXT = JSON.stringify({ session_id: OUTER });

/**
 * The same payload with the block present and EMPTY — `null`. A JSON producer's
 * normal spelling of "this key has no value", and the shape that used to kill
 * the render outright (repair cycle 3).
 */
const PAYLOAD_WITH_NULL_CONTEXT = JSON.stringify({ session_id: OUTER, context_window: null });

/**
 * The record a read found, or `null`. The read returns a tagged union; a case
 * that is ABOUT the difference calls `readHarnessWitness` directly.
 */
function witnessAt(root: string) {
  const read = readHarnessWitness({ projectRoot: root, sessionId: SID });
  return read.kind === 'valid' ? read.witness : null;
}

describe('peaks statusline — harness context witness capture', () => {
  const ws = withTmpWorkspacePerTest('peaks-statusline-witness-');

  afterEach(() => {
    process.exitCode = undefined;
  });

  /**
   * Turn the tmp workspace into a project this render can resolve: a git
   * marker for `findProjectRoot`, and the canonical session file so the
   * render's own session resolution binds to `SID`.
   */
  function seedProject(root: string, withSession = true): void {
    mkdirSync(join(root, '.git'), { recursive: true });
    mkdirSync(join(root, '.peaks', '_runtime'), { recursive: true });
    if (withSession) {
      // The canonical session file AND its session directory: a real session
      // has both (the session layer creates the directory, and the presence
      // lease / lifecycle record live inside it). The capture deliberately
      // does NOT create the directory — see `writeHarnessWitness`.
      mkdirSync(join(root, '.peaks', '_runtime', SID), { recursive: true });
      writeFileSync(
        join(root, '.peaks', '_runtime', 'session.json'),
        JSON.stringify({ sessionId: SID, projectRoot: root }),
        'utf8'
      );
    }
  }

  async function render(root: string, stdin: string): Promise<string> {
    withEnv('PEAKS_STATUSLINE_STDIN', stdin);
    withEnv('CLAUDE_CODE_SESSION_ID', undefined);
    const { io, captured } = makeCapturedIo();
    await runDefaultStatuslineRender({ project: root, json: false, now: FIXED_NOW }, io);
    return captured.text();
  }

  describe('(integration)', () => {
    it('AC1 — when the harness payload carries context numbers, should land them on the session runtime path', async () => {
      // given
      const root = ws().path;
      seedProject(root);
      // when
      await render(root, PAYLOAD_WITH_CONTEXT);
      // then: the harness's own numbers, on disk, under the session dir
      const witness = witnessAt(root);
      expect(witness).not.toBeNull();
      expect(witness!.usedPercentage).toBeCloseTo(0.42, 10);
      expect(witness!.modelWindowTokens).toBe(WINDOW);
      expect(witness!.usageTokens).toBe(420_000);
      expect(witness!.outerSessionId).toBe(OUTER);
      expect(harnessWitnessPath(root, SID).startsWith(join(root, '.peaks', '_runtime', SID))).toBe(
        true
      );
      // and nothing was written into a harness-owned location
      expect(existsSync(join(root, '.claude', 'settings.json'))).toBe(false);
    });

    it('AC1 — when there is no session binding, should render without creating a session dir', async () => {
      // given: a project with no canonical session file
      const root = ws().path;
      seedProject(root, false);
      // when
      const text = await render(root, PAYLOAD_WITH_CONTEXT);
      // then: a real line, and no directory invented for a session we cannot name
      expect(text.length).toBeGreaterThan(0);
      expect(existsSync(join(root, '.peaks', '_runtime', SID))).toBe(false);
    });

    it('AC6 — when the write throws, should still render (the observation is lost, not the line)', async () => {
      // given: a DIRECTORY where the witness file belongs, so writeFileSync
      // throws a real EISDIR / EPERM rather than a mocked one
      const root = ws().path;
      seedProject(root);
      mkdirSync(harnessWitnessPath(root, SID), { recursive: true });
      // when
      const text = await render(root, PAYLOAD_WITH_CONTEXT);
      // then: no throw, a real line, and the failure surfaces at the read end
      // as a missing witness instead of being swallowed
      expect(text.length).toBeGreaterThan(0);
      // `invalid`, not `missing`: the file's absence-of-a-record and the file's
      // non-existence are different facts, and only the first one says a render
      // happened here (repair cycle 3 — the reader used to call both `null`).
      expect(readHarnessWitness({ projectRoot: root, sessionId: SID }).kind).toBe('invalid');
      expect(process.exitCode).toBeUndefined();
    });

    it('AC6 — when context_window is `null`, should still render and record the render', async () => {
      // REGRESSION (repair cycle 3). This payload used to throw out of the
      // render — measured against the real CLI: exit 1, stdout EMPTY,
      // UNHANDLED_ERROR. The status line disappeared entirely instead of losing
      // one observation, which is the inversion AC6 forbids. The control is the
      // payload with the key ABSENT, rendered on the same project: a `null`
      // block and no block are the same absence of information, so they must
      // produce the same line and the same record.
      const root = ws().path;
      seedProject(root);
      // when: `null` FIRST, so the assertions below read the file THIS render
      // was responsible for. Rendering the control first would leave a record
      // behind that a broken `null` render could hide behind.
      const nulled = await render(root, PAYLOAD_WITH_NULL_CONTEXT);
      expect(witnessAt(root)).not.toBeNull();
      const absent = await render(root, PAYLOAD_WITHOUT_CONTEXT);
      // then: a real line each time, exit 0, `null` read as "no block"
      expect(nulled.length).toBeGreaterThan(0);
      expect(nulled).toBe(absent);
      expect(process.exitCode).toBeUndefined();
      expect(witnessAt(root)!.usedPercentage).toBeNull();
      expect(witnessAt(root)!.modelWindowTokens).toBeNull();
    });
  });

  describe('(render)', () => {
    it('AC6 — the rendered line is byte-identical with and without the context block', async () => {
      // given: one project, two payloads that differ ONLY in the context block
      const root = ws().path;
      seedProject(root);
      // when
      const withoutContext = await render(root, PAYLOAD_WITHOUT_CONTEXT);
      // then: the control — the render happened and the ledger says so, with
      // no number in it, so nothing below can be attributed to the capture
      expect(witnessAt(root)!.usedPercentage).toBeNull();
      const withContext = await render(root, PAYLOAD_WITH_CONTEXT);
      // ...and the captured render is byte-for-byte the same line
      expect(withContext).toBe(withoutContext);
      expect(witnessAt(root)!.usedPercentage).toBeCloseTo(0.42, 10);
    });
  });

  describe('(behavior)', () => {
    it('should refuse a percentage that is on neither scale, keep the value, and still render', async () => {
      // given: a payload whose used_percentage cannot be interpreted
      const root = ws().path;
      seedProject(root);
      const payload = JSON.stringify({
        session_id: OUTER,
        context_window: { context_window_size: WINDOW, used_percentage: 150 }
      });
      // when
      const text = await render(root, payload);
      // then: the raw value survives — a refused payload must not leave the
      // reader unable to tell it apart from a statusline that never rendered
      expect(text.length).toBeGreaterThan(0);
      const witness = witnessAt(root);
      expect(witness).not.toBeNull();
      expect(witness!.usedPercentage).toBeNull();
      expect(witness!.usedPercentageRaw).toBe(150);
    });

    it('should read a bare `1` as one percent, not as a full window', async () => {
      // given: an integer-percent payload reporting 1% of the window — 10,000
      // of 1,000,000. Stored as 100% this would be a confident 70-point
      // "disagreement" attributing a unit misread to the two denominators.
      const root = ws().path;
      seedProject(root);
      const payload = JSON.stringify({
        session_id: OUTER,
        context_window: {
          context_window_size: WINDOW,
          used_percentage: 1,
          current_usage: { input_tokens: 10_000 }
        }
      });
      // when
      await render(root, payload);
      // then: the payload's own token snapshot settles the unit
      const witness = witnessAt(root)!;
      expect(witness.usedPercentage).toBeCloseTo(0.01, 10);
      expect(witness.usedPercentageUnit).toBe('percent');
      expect(witness.usedPercentageRaw).toBe(1);
    });
  });
});
