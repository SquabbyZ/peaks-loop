// tests/unit/cli/observability-report-sections.test.ts
//
// WHY THIS FILE EXISTS. The markdown report is the artifact that LEAVES the
// terminal — it is pasted into a PR description, and once it is out there it
// is read as a fact. The near-miss rate is the one number in it that can be
// read two ways: "no near-misses happened" and "the classes that could show
// a near-miss were never observed".
//
// This repository's recorded history is the second case: the `gate` emitter
// postdates every session here, so two of the three reason classes have NO
// events at all, and the third one has the near-misses. A report that printed
// the bare rate would read as a clean bill of health.
//
// WHAT IS ASSERTED HERE:
//   - the report command really renders the near-miss section, over a REAL
//     project tree, from the events on disk;
//   - the section names what it did NOT observe, so a reader who sees only
//     the rate cannot conclude "there were no near-misses";
//   - the near-miss section sits before the slice table and the hotspot
//     section after it.
//
// Dimensions:
//   - behavior:   the sections the report renders, and where they sit
//   - integration: the real command reading a real project tree on disk
//   - render:     the markdown a reader pastes into a PR
//   - a11y:       what the rate says about the classes it did not measure

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProgram } from '~/src/cli/program';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo, withEnv } from '../_setup/io.js';

declareDimensions('tests/unit/cli/observability-report-sections.test.ts', [
  'behavior',
  'integration',
  'render',
  'a11y'
]);

const SESSION_ID = '2026-10-27-session-reportsections';

let root = '';

/**
 * One observability event at an explicit instant, in the shape the emitter
 * writes. The instant is NOW so the event falls inside the period window
 * whatever day the suite runs on.
 */
function seedEvent(sliceRid: string, to: string, prereqOk: boolean, offsetSeconds: number): string {
  return JSON.stringify({
    schemaVersion: 1,
    ts: new Date(Date.now() - 60_000 + offsetSeconds * 1000).toISOString(),
    sessionId: SESSION_ID,
    category: 'slice-transition',
    sliceRid,
    detail: { artifactRole: 'rd', to, prereqOk, missingCount: 0 }
  });
}

/** Write a session's metrics file, the way the emitter lays it down. */
function writeEvents(lines: readonly string[]): void {
  const dir = join(root, '.peaks', '_runtime', SESSION_ID, 'metrics');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'slices.jsonl'), `${lines.join('\n')}\n`, 'utf8');
}

/** Run `peaks observability report` and hand back the markdown it renders. */
async function renderReport(): Promise<string> {
  const { io, captured } = makeCapturedIo();
  const program = createProgram(io);
  program.exitOverride();
  await program.parseAsync([
    'node',
    'peaks',
    'observability',
    'report',
    '--project',
    root,
    '--period',
    'month',
    '--json'
  ]);
  const envelope = JSON.parse(captured.text()) as {
    readonly data?: { readonly markdown?: string };
  };
  return envelope.data?.markdown ?? '';
}

/** The line that states the rate, as the reader sees it. */
function rateLineOf(markdown: string): string {
  const line = markdown.split('\n').find((text) => text.startsWith('- **rate**:'));
  if (line === undefined) throw new Error('the report has no rate line');
  return line;
}

/**
 * Where a section starts in the report.
 *
 * It THROWS when the section is absent, because `indexOf` answers `-1` for a
 * section that is not there — and `-1` compares as "before" every heading, so
 * an ordering assertion built on it passes against a report that has NEITHER
 * section. That is a false green, and this helper exists to refuse it.
 */
function sectionAt(markdown: string, heading: string): number {
  const index = markdown.indexOf(heading);
  if (index < 0) throw new Error(`the report has no ${heading} section`);
  return index;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'peaks-observability-report-'));
  // The canonical binding is read through the caller projection, which
  // resolves a caller id from the environment; a leftover caller id from the
  // developer's shell must not decide which session the report reads.
  withEnv('PEAKS_CALLER_ID', undefined);
  withEnv('CLAUDE_CODE_SESSION_ID', undefined);
  // The CLI bootstraps a log line into the home directory; point the home at
  // the throwaway project so the run leaves nothing behind.
  withEnv('HOME', root);
  withEnv('USERPROFILE', root);
  const runtime = join(root, '.peaks', '_runtime');
  mkdirSync(runtime, { recursive: true });
  writeFileSync(
    join(runtime, 'session.json'),
    `${JSON.stringify({ sessionId: SESSION_ID, projectRoot: root })}\n`,
    'utf8'
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('Scenario: integration — the report renders what the events recorded', () => {
  it('when a slice passed with a check unsatisfied, should report the near-miss', async () => {
    // given: two slices that were declared passing, one of which had a
    //        refused check that was still unsatisfied at the pass moment
    // when:  the report is asked for
    // then:  the report carries the near-miss section with the rate
    writeEvents([
      seedEvent('slice-clean', 'qa-handoff', true, 0),
      seedEvent('slice-clean', 'verdict-issued', true, 1),
      seedEvent('slice-skipped', 'qa-handoff', false, 2),
      seedEvent('slice-skipped', 'verdict-issued', true, 3)
    ]);
    const markdown = await renderReport();
    expect(markdown).toContain('## Near-misses');
    expect(rateLineOf(markdown)).toContain('0.5');
    expect(rateLineOf(markdown)).toContain('1 of 2 passed slice(s)');
  });

  it('when the report is asked for, should render the hotspot section too', async () => {
    // given: a session with one recorded slice
    // when:  the report is asked for
    // then:  the hotspot section is rendered — the ranking is computed, so
    //         the section is present even when the ranking is empty
    writeEvents([seedEvent('slice-clean', 'verdict-issued', true, 0)]);
    const markdown = await renderReport();
    expect(markdown).toContain('## Hotspots');
  });
});

describe('Scenario: behavior — the sections sit where the reader expects them', () => {
  it('when the report is rendered, should put the near-miss section first', async () => {
    // given: a session with one recorded slice
    // when:  the report is asked for
    // then:  the near-miss section comes before the slice table and the
    //         hotspot section comes after it
    writeEvents([seedEvent('slice-clean', 'verdict-issued', true, 0)]);
    const markdown = await renderReport();
    expect(sectionAt(markdown, '## Near-misses')).toBeLessThan(sectionAt(markdown, '## Slices'));
    expect(sectionAt(markdown, '## Slices')).toBeLessThan(sectionAt(markdown, '## Hotspots'));
  });
});

describe('Scenario: a11y — the rate says what it did not measure', () => {
  it('when a reason class had no events, should name it as unobserved', async () => {
    // given: a session whose events carry no gate event and no tool trace
    // when:  the report is asked for
    // then:  the report names the classes it could not observe, so their
    //         share of the rate reads as an absence of data
    writeEvents([seedEvent('slice-clean', 'verdict-issued', true, 0)]);
    const markdown = await renderReport();
    expect(markdown).toContain('- **unobserved classes**: `gate-never-evaluated`, `tool-blocked`');
    expect(markdown).toContain('| gate-never-evaluated | no | 0 | 0 | 1 | 0 | not measured |');
  });

  it('when the rate is zero, should not read as "there were no near-misses"', async () => {
    // given: one slice that passed cleanly, with two classes never observable
    // when:  the report is asked for
    // then:  the rate line says how many classes it covered, so a reader
    //         who sees only the rate cannot conclude there were none
    writeEvents([seedEvent('slice-clean', 'verdict-issued', true, 0)]);
    const line = rateLineOf(await renderReport());
    expect(line).toContain('0 (0%)');
    expect(line).toContain('1 of 3 reason classes');
    expect(line).toContain('absence of data');
    expect(line).not.toContain('no near-misses');
  });
});
