import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/design/design-render-verdict.test.ts',
  ['behavior', 'a11y'],
  [
    { dim: 'render', reason: 'the classifiers return verdict records, not render artifacts' },
    {
      dim: 'integration',
      reason: 'the spawn is injected as a plain result; no process or network boundary here'
    }
  ]
);

import {
  driftVerdict,
  verifyUiVerdict,
  type RenderVerdict
} from '../../../src/services/design/design-render-verdict.js';
import { blockedMessage } from '../../../src/services/design/acceptance.js';
import type { DesignlangRunResult } from '../../../src/services/design/designlang.js';

const URL = 'http://127.0.0.1:4321/';
const TOKENS = '/tmp/app/design/tokens.json';

function run(stdout: string, exitCode = 0): DesignlangRunResult {
  return { exitCode, stdout, stderr: '', timedOut: false };
}

/** The real drift payload, with its provenance echoed back. */
function driftStdout(verdict: string): string {
  return JSON.stringify({
    url: URL,
    tokensFile: TOKENS,
    verdict,
    driftRatio: 0,
    drifted: [],
    matched: [{ token: 'color.primary', liveMatch: '#2563eb', distance: 0 }],
    unknown: [],
    summary: { total: 1, drifted: 0, matched: 1, unknown: 0 }
  });
}

describe('Scenario: behavior — drift is judged by its own payload', () => {
  it('when drift reports in-sync, should pass', () => {
    // given: an in-sync payload that echoes the page and tokens file
    // when: the drift run is classified
    // then: the payload verdict is a pass
    expect(driftVerdict(run(driftStdout('in-sync')), URL, TOKENS)).toEqual({ status: 'pass' });
  });

  it('when drift reports a verdict but exits 1, should fail on the payload', () => {
    // given: a notable-drift payload and exit 1
    // when: the drift run is classified
    // then: the exact sentence names the verdict, not a swapped argument order
    const verdict = driftVerdict(run(driftStdout('notable-drift'), 1), URL, TOKENS);
    expect(verdict.status).toBe('fail');
    if (verdict.status !== 'fail') throw new Error('expected a fail');
    expect(verdict.reason).toBe(`designlang drift reported notable-drift for ${URL}`);
  });

  it('when an in-sync report exits 1, should let the report win over the code', () => {
    // given: a parseable in-sync report whose exit code disagrees
    // when: the drift run is classified
    // then: a parsed report outranks the exit code
    expect(driftVerdict(run(driftStdout('in-sync'), 1), URL, TOKENS)).toEqual({ status: 'pass' });
  });

  it('when drift prints no report and exits 1, should fail', () => {
    // given: exit 1 with empty stdout
    // when: the drift run is classified
    // then: the exact sentence names the exit code and the page it came from
    const verdict = driftVerdict(run('', 1), URL, TOKENS);
    expect(verdict.status).toBe('fail');
    if (verdict.status !== 'fail') throw new Error('expected a fail');
    expect(verdict.reason).toBe(`designlang drift exited 1 for ${URL}`);
  });

  it('when drift times out navigation, should block as retryable', () => {
    // given: exit 3 (navigation timeout) with no report
    // when: the drift run is classified
    // then: the block names retry, never a design fail
    const verdict = driftVerdict(run('', 3), URL, TOKENS);
    expect(verdict.status).toBe('blocked');
    if (verdict.status !== 'blocked') throw new Error('expected a block');
    expect(verdict.code).toBe('DESIGN_RENDER_RETRYABLE');
    expect(verdict.message.toLowerCase()).toContain('retry');
  });

  it('when drift exits 0 with no report, should block as no evidence', () => {
    // given: exit 0 and empty stdout
    // when: the drift run is classified
    // then: a silent check is never a pass
    const verdict = driftVerdict(run(''), URL, TOKENS);
    expect(verdict.status).toBe('blocked');
    if (verdict.status !== 'blocked') throw new Error('expected a block');
    expect(verdict.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
  });

  it('when drift echoes another page, should block as no evidence', () => {
    // given: a payload about a different page
    // when: the drift run is classified
    // then: the provenance failure is no evidence
    const verdict = driftVerdict(
      run(JSON.stringify({ ...JSON.parse(driftStdout('in-sync')), url: 'http://127.0.0.1:1/' })),
      URL,
      TOKENS
    );
    expect(verdict.status).toBe('blocked');
    if (verdict.status !== 'blocked') throw new Error('expected a block');
    expect(verdict.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
  });
});

describe('Scenario: behavior — verify-ui maps its exit codes', () => {
  it('when verify-ui reports pass true with no timestamp, should pass', () => {
    // given: the real payload shape — pass, onBrand, no generatedAt
    // when: the run is classified
    // then: the dead gate now opens on a real pass
    const verdict = verifyUiVerdict(run(JSON.stringify({ pass: true, onBrand: 99 })), URL);
    expect(verdict).toEqual({ status: 'pass' });
  });

  it('when verify-ui exits 1 with no report, should fail', () => {
    // given: exit 1 with empty stdout
    // when: the run is classified
    // then: exit 1 is the scored fail
    expect(verifyUiVerdict(run('', 1), URL).status).toBe('fail');
  });

  it('when verify-ui exits 2 with no report, should block as unusable', () => {
    // given: exit 2, the unusable-page code, with empty stdout
    // when: the run is classified
    // then: a blank or unreadable page blocks instead of failing
    const verdict = verifyUiVerdict(run('', 2), URL);
    expect(verdict.status).toBe('blocked');
    if (verdict.status !== 'blocked') throw new Error('expected a block');
    expect(verdict.code).toBe('DESIGN_PAGE_UNUSABLE');
  });

  it('when verify-ui exits 3, should block as retryable', () => {
    // given: exit 3, the navigation-timeout code
    // when: the run is classified
    // then: the block says the check is retryable
    const verdict = verifyUiVerdict(run('', 3), URL);
    expect(verdict.status).toBe('blocked');
    if (verdict.status !== 'blocked') throw new Error('expected a block');
    expect(verdict.code).toBe('DESIGN_RENDER_RETRYABLE');
    expect(verdict.message).toContain('retryable');
  });

  it('when a parsed pass disagrees with exit 2, should let the report win', () => {
    // given: a pass:true payload from a run that exited 2
    // when: the run is classified
    // then: a parsed report still outranks the exit code
    const verdict = verifyUiVerdict(run(JSON.stringify({ pass: true, onBrand: 95 }), 2), URL);
    expect(verdict).toEqual({ status: 'pass' });
  });

  it('when verify-ui reports pass false, should fail even on exit 1', () => {
    // given: a pass:false payload with exit 1
    // when: the run is classified
    // then: the exact sentence is the report's own fail
    const verdict = verifyUiVerdict(run(JSON.stringify({ pass: false, onBrand: 40 }), 1), URL);
    expect(verdict.status).toBe('fail');
    if (verdict.status !== 'fail') throw new Error('expected a fail');
    expect(verdict.reason).toBe(`designlang verify-ui reported pass: false for ${URL}`);
  });

  it('when verify-ui exits 0 with no report, should block as no evidence', () => {
    // given: exit 0 and empty stdout
    // when: the run is classified
    // then: the message carries the parser's sentence exactly once
    const verdict = verifyUiVerdict(run(''), URL);
    expect(verdict.status).toBe('blocked');
    if (verdict.status !== 'blocked') throw new Error('expected a block');
    expect(verdict.code).toBe('DESIGN_RENDER_NO_EVIDENCE');
    expect(verdict.message).toBe('designlang verify-ui produced no evidence: stdout was empty.');
  });

  it('when verify-ui exits 2 with a stderr cause, should carry that cause', () => {
    // given: exit 2 whose stderr names the missing brand primary
    // when: the run is classified
    // then: the message and the carried cause name it, not just the page
    const verdict = verifyUiVerdict(
      {
        exitCode: 2,
        stdout: '',
        stderr: 'no brand primary in design/contract.md',
        timedOut: false
      },
      URL
    );
    expect(verdict.status).toBe('blocked');
    if (verdict.status !== 'blocked') throw new Error('expected a block');
    expect(verdict.cause).toBe('no brand primary in design/contract.md');
    expect(verdict.message).toContain('no brand primary in design/contract.md');
  });

  it('when verify-ui exits 2 without stderr, should not invent a cause', () => {
    // given: exit 2 with no stderr text
    // when: the run is classified
    // then: no cause is carried and the page block stays the whole message
    const verdict = verifyUiVerdict(run('', 2), URL);
    expect(verdict.status).toBe('blocked');
    if (verdict.status !== 'blocked') throw new Error('expected a block');
    expect(verdict.cause).toBeUndefined();
    expect(verdict.message).not.toContain('produced no evidence');
  });
});

describe('Scenario: a11y — the block codes carry user-facing text', () => {
  it('when a page is unusable, should name the block rather than a score', () => {
    // given: an exit-2 verify-ui run
    // when: the verdict is classified
    // then: the message names the unusable page and no score
    const verdict: RenderVerdict = verifyUiVerdict(run('', 2), URL);
    if (verdict.status !== 'blocked') throw new Error('expected a block');
    expect(verdict.message).toContain('cannot be judged');
    expect(verdict.message).not.toContain('score');
  });

  it('when the URL carries credentials, should mask them in every verdict message', () => {
    // given: a credentialed page URL on each verdict path
    // when: each classification renders its message
    // then: neither a user nor a password character survives into the text
    const secret = 'http://user:pass@127.0.0.1:4321/';
    const failed = driftVerdict(run('', 1), secret, TOKENS);
    const retryable = verifyUiVerdict(run('', 3), secret);
    const unusable = verifyUiVerdict(run('', 2), secret);
    for (const verdict of [failed, retryable, unusable]) {
      const text = verdict.status === 'fail' ? verdict.reason : JSON.stringify(verdict);
      expect(text).toContain('127.0.0.1:4321');
      expect(text).not.toContain('user:pass');
      expect(text).not.toContain('user@');
    }
  });
});

describe('Scenario: a11y — the carried cause is one short redacted line', () => {
  it('when stderr spans lines and spaces, should single-line and trim the cause', () => {
    // given: an exit-2 run whose stderr is wrapped and indented
    // when: the run is classified
    // then: the cause is one trimmed line with single spaces
    const verdict = verifyUiVerdict(
      { exitCode: 2, stdout: '', stderr: '  no\n brand    primary  ', timedOut: false },
      URL
    );
    if (verdict.status !== 'blocked') throw new Error('expected a block');
    expect(verdict.cause).toBe('no brand primary');
    expect(verdict.message).toContain(': no brand primary)');
  });

  it('when stderr carries a credentialed URL, should redact it before carrying it', () => {
    // given: an exit-2 run whose stderr is the page URL with userinfo
    // when: the run is classified
    // then: the carried cause keeps the host and drops the credentials
    const verdict = verifyUiVerdict(
      {
        exitCode: 2,
        stdout: '',
        stderr: 'http://alice:s3cret@127.0.0.1:4321/x failed',
        timedOut: false
      },
      URL
    );
    if (verdict.status !== 'blocked') throw new Error('expected a block');
    expect(verdict.cause).toContain('127.0.0.1:4321/x');
    expect(verdict.cause).not.toContain('alice');
    expect(verdict.cause).not.toContain('s3cret');
  });

  it('when stderr carries a sensitive assignment, should mask it before carrying it', () => {
    // given: an exit-2 run whose stderr names a token assignment
    // when: the run is classified
    // then: the sensitive word and its value never reach the cause
    const verdict = verifyUiVerdict(
      {
        exitCode: 2,
        stdout: '',
        stderr: 'designlang failed: token=abcdefgh12345 was rejected',
        timedOut: false
      },
      URL
    );
    if (verdict.status !== 'blocked') throw new Error('expected a block');
    expect(verdict.cause).not.toContain('abcdefgh12345');
    expect(verdict.cause?.toLowerCase()).not.toContain('token');
    expect(verdict.cause).toContain('[redacted]');
  });

  it('when the cause is exactly 240 or 241 characters, should truncate only past the cap', () => {
    // given: a 240-character stderr and a 241-character one
    // when: each run is classified
    // then: the cap keeps 240 whole characters and adds an ellipsis only when cut
    const exact = verifyUiVerdict(
      { exitCode: 2, stdout: '', stderr: 'x'.repeat(240), timedOut: false },
      URL
    );
    if (exact.status !== 'blocked') throw new Error('expected a block');
    expect(exact.cause).toBe('x'.repeat(240));
    expect(exact.cause).not.toContain('…');
    const over = verifyUiVerdict(
      { exitCode: 2, stdout: '', stderr: 'y'.repeat(241), timedOut: false },
      URL
    );
    if (over.status !== 'blocked') throw new Error('expected a block');
    expect(over.cause).toBe(`${'y'.repeat(240)}…`);
    expect(over.cause?.length).toBe(241);
  });

  it('when stderr is only whitespace, should not invent a cause', () => {
    // given: an exit-2 run whose stderr is spaces and newlines
    // when: the run is classified
    // then: no cause is carried and the message ends at the page block
    const verdict = verifyUiVerdict(
      { exitCode: 2, stdout: '', stderr: ' \n\t ', timedOut: false },
      URL
    );
    if (verdict.status !== 'blocked') throw new Error('expected a block');
    expect(verdict.cause).toBeUndefined();
    expect('cause' in verdict).toBe(false);
    expect(verdict.message).toBe(
      `${blockedMessage('DESIGN_PAGE_UNUSABLE')} (designlang verify-ui exited 2 for ${URL})`
    );
  });

  it('when a cause is carried, should publish the exact blocked sentence with it', () => {
    // given: an exit-2 run whose stderr names the missing brand primary
    // when: the run is classified
    // then: the message is the block sentence, the exit code and the cause
    const verdict = verifyUiVerdict(
      { exitCode: 2, stdout: '', stderr: 'no brand primary', timedOut: false },
      URL
    );
    if (verdict.status !== 'blocked') throw new Error('expected a block');
    expect(verdict.message).toBe(
      `${blockedMessage('DESIGN_PAGE_UNUSABLE')} (designlang verify-ui exited 2 for ${URL}: no brand primary)`
    );
    expect(verdict.cause).toBe('no brand primary');
    expect(verdict.code).toBe('DESIGN_PAGE_UNUSABLE');
  });
});

describe('Scenario: behavior — every exit code and silent report has one verdict', () => {
  it('when a check exits with an unknown nonzero code, should fail naming that code', () => {
    // given: exit 4, which designlang does not define as retryable
    // when: each check is classified
    // then: it is a fail, not a block
    expect(verifyUiVerdict(run('', 4), URL)).toEqual({
      status: 'fail',
      reason: `designlang verify-ui exited 4 for ${URL}`
    });
    expect(driftVerdict(run('', 4), URL, TOKENS)).toEqual({
      status: 'fail',
      reason: `designlang drift exited 4 for ${URL}`
    });
  });

  it('when a check exits 3, should name the retryable sentence and the exit code', () => {
    // given: exit 3 with no report for each check
    // when: each is classified
    // then: the block is retryable and names the tool, the code and the page
    for (const verdict of [
      driftVerdict(run('', 3), URL, TOKENS),
      verifyUiVerdict(run('', 3), URL)
    ]) {
      if (verdict.status !== 'blocked') throw new Error('expected a block');
      expect(verdict.code).toBe('DESIGN_RENDER_RETRYABLE');
      expect(verdict.message).toMatch(
        /^designlang could not navigate the page before its budget elapsed; this is retryable — start the app and re-run the check\. \(designlang (drift|verify-ui) exited 3 for http:\/\/127\.0\.0\.1:4321\/\)$/
      );
    }
  });

  it('when drift exits 0 without a report, should publish the parser sentence exactly once', () => {
    // given: exit 0 and empty stdout for drift
    // when: the run is classified
    // then: the message is the parser's own sentence, not a doubled prefix
    const verdict = driftVerdict(run(''), URL, TOKENS);
    expect(verdict).toEqual({
      status: 'blocked',
      code: 'DESIGN_RENDER_NO_EVIDENCE',
      message: 'designlang drift produced no evidence: stdout was empty.'
    });
  });
});
