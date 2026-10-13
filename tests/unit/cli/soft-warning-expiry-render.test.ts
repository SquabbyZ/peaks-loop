// tests/unit/cli/soft-warning-expiry-render.test.ts
//
// The surface that renders a soft pass whose back-compat window has CLOSED. The
// prerequisite resolver sets `expiredWindow` on the warning; this file pins that
// the printer turns it into text an operator reads, on the arm a refusal takes,
// and that a warning whose window is still open gains no clause.
//
// `reportTransitionFailure` is called directly with a real
// `PrerequisitesNotSatisfiedError` rather than through the commander harness:
// the harness that drives `request transition` end to end lives in
// `request-codegraph-autorefresh.test.ts`, and the printer is the whole subject
// here.
//
// The SUCCESS arm composes its line from the same `softWarningExpiryClause`
// helper `printTransitionResult` calls, so the clause's own two directions are
// pinned here; the success arm's end-to-end render is evidenced by a real
// `request transition rd → qa-handoff` run recorded in the RD artifact, not by
// this file.
//
// Dimensions covered:
//   - a11y:   the refusal line, as text
//   - render: the clause as a pure function of the field, both directions
//   - behavior / integration: OMITTED — no state move, no filesystem boundary

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import { PrerequisitesNotSatisfiedError } from '../../../src/services/artifacts/request-artifact-service.js';
import {
  reportTransitionFailure,
  softWarningExpiryClause
} from '../../../src/cli/commands/request-transition-failures.js';
import type { RequestTransitionOptions } from '../../../src/cli/commands/request-command-options.js';

declareDimensions(
  'tests/unit/cli/soft-warning-expiry-render.test.ts',
  ['a11y', 'render'],
  [
    {
      dim: 'behavior',
      reason: 'the only input is the warning list; no state move happens here'
    },
    {
      dim: 'integration',
      reason: 'no filesystem, subprocess or environment boundary is crossed by a printer'
    }
  ]
);

const SESSION_ID = '2026-10-14-session-2f9323';
const RID = '2026-10-14-backlog-9-2-mut-warnings';
/** What the resolver writes once the declared release is behind the build: the
 *  declared release, plus the build it was compared against. */
const EXPIRY = 'v2.14.0 (installed 4.1.4)';

const OPTIONS: RequestTransitionOptions = { role: 'rd', project: '.', state: 'qa-handoff' };

function warningWith(expiredWindow?: string): {
  path: string;
  code: string;
  message: string;
  expiredWindow?: string;
} {
  const warning = {
    path: 'mut/mut-report.json',
    code: 'mut-report-missing-deprecated-in-v2.14.0',
    message: 'mutation report absent — soft-blocked under the back-compat window.'
  };
  return expiredWindow === undefined ? warning : { ...warning, expiredWindow };
}

describe('Scenario: a11y — a refusal names the release a closed window closed at', () => {
  let previousExitCode: typeof process.exitCode;

  beforeEach(() => {
    previousExitCode = process.exitCode;
  });

  afterEach(() => {
    process.exitCode = previousExitCode;
  });

  it('when a soft pass is past expiry, should print the clause beside its own warning', () => {
    // given: the refusal arm, with one warning the resolver marked past expiry
    // when: the failure is reported
    // then: the operator reads which release the window closed at, and still
    //       reads the warning it belongs to
    const { io, captured } = makeCapturedIo();
    reportTransitionFailure(
      io,
      OPTIONS,
      RID,
      new PrerequisitesNotSatisfiedError('rd', 'qa-handoff', SESSION_ID, [], [warningWith(EXPIRY)])
    );
    expect(captured.stderrText()).toContain('mut/mut-report.json');
    expect(captured.stderrText()).toContain(`past expiry: ${EXPIRY}`);
  });

  it('when the window is still open, should add no clause — the control', () => {
    // given: the same refusal arm with the same warning, no expiry set
    // when: the failure is reported
    // then: nothing claims an expiry, so the case above is real news rather than
    //       the printer's always-something habit
    const { io, captured } = makeCapturedIo();
    reportTransitionFailure(
      io,
      OPTIONS,
      RID,
      new PrerequisitesNotSatisfiedError('rd', 'qa-handoff', SESSION_ID, [], [warningWith()])
    );
    expect(captured.stderrText()).toContain('mut/mut-report.json');
    expect(captured.stderrText()).not.toContain('past expiry:');
  });
});

describe('Scenario: render — the clause is a function of the field alone', () => {
  it('when the field is absent, should render nothing', () => {
    // given: a warning from before any window closed
    // when: the clause is built
    // then: it is empty, so it cannot add a sentence on its own
    expect(softWarningExpiryClause({})).toBe('');
  });

  it('when the field is set, should render it verbatim behind a separator', () => {
    // given: a warning the resolver marked past expiry
    // when: the clause is built
    // then: both releases reach the line — the one declared and the one compared
    //       against — with nothing reformatted
    expect(softWarningExpiryClause({ expiredWindow: EXPIRY })).toBe(` — past expiry: ${EXPIRY}`);
  });

  it('when the field carries a control character, should print it as `?`', () => {
    // given: a field holding a raw newline (the same defence the sibling
    //        warning fields carry: a newline would forge a line of this
    //        command's own output)
    // when: the clause is built
    // then: it holds no raw control character
    expect(softWarningExpiryClause({ expiredWindow: 'v1\n2' })).toBe(' — past expiry: v1?2');
  });
});
