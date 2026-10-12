// tests/unit/cli/request-codegraph-autorefresh.test.ts
//
// 4-dimension unit test for the Option-1 slice-complete auto-refresh
// wiring inside `peaks request transition` at the RD → QA boundary
// (rid-2026-09-03-codegraph-autorefresh).
//
// `peaks request transition <rid> --role rd --state qa-handoff` is the
// request-level "RD done → QA done" slice boundary (the same boundary the
// pre-compact hook uses). After it succeeds the CLI action calls
// `refreshCodegraphAfterSlice(projectRoot)` BEFORE returning its ok
// envelope. Non-boundary transitions (e.g. rd:implemented) must NOT fire
// the refresh.
//
// The artifact-transition service and the codegraph-autorefresh service
// are the mocked boundaries; the request-commands action itself runs for
// real.
//
// Dimensions covered:
//   - integration: transition wiring with a mocked artifact service +
//                 mocked codegraph-autorefresh; verifies call counts
//   - a11y:        a failing auto-refresh never fails the transition; the
//                 ok envelope carries a readable `codegraphRefresh` note
//   - behavior:    OMITTED — pure control-flow is asserted through the
//                 integration describe (the trigger only exists inside
//                 the CLI action)
//   - render:      OMITTED — envelope shape assertions live under a11y
//
// Run with: pnpm vitest run tests/unit/cli/request-codegraph-autorefresh.test.ts

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';
import {
  cleanupTmpWorkspace,
  useTmpWorkspace,
  type TmpWorkspace
} from '../_setup/tmp-workspace.js';

declareDimensions(
  'tests/unit/cli/request-codegraph-autorefresh.test.ts',
  ['integration', 'a11y'],
  [
    {
      dim: 'behavior',
      reason:
        'the trigger only exists inside the CLI transition action; control flow is asserted via the integration describe'
    },
    {
      dim: 'render',
      reason:
        'envelope shape assertions live under a11y (ok + codegraphRefresh note) rather than a separate render block'
    }
  ]
);

const __m = vi.hoisted(() => ({
  transitionRequestArtifact: vi.fn(),
  refreshCodegraphAfterSlice: vi.fn()
}));

// A2 (2026-09-17): the action now also imports `codegraphRefreshNotice` from
// this module, so the mock spreads the REAL module and overrides only the
// process-spawning boundary — see the note in job-codegraph-autorefresh.
vi.mock('../../../src/services/codegraph/codegraph-autorefresh.js', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('../../../src/services/codegraph/codegraph-autorefresh.js')
  >()),
  refreshCodegraphAfterSlice: __m.refreshCodegraphAfterSlice
}));

vi.mock('../../../src/services/artifacts/request-artifact-service.js', async () => {
  const actual = await vi.importActual<
    typeof import('../../../src/services/artifacts/request-artifact-service.js')
  >('../../../src/services/artifacts/request-artifact-service.js');
  return {
    ...actual,
    transitionRequestArtifact: __m.transitionRequestArtifact
  };
});

import { registerRequestCommands } from '../../../src/cli/commands/request-commands.js';
import { PrerequisitesNotSatisfiedError } from '../../../src/services/artifacts/request-artifact-state-helpers.js';

const REQUEST_ID = '2026-09-03-cg-auto-request';
const SESSION_ID = '2026-09-03-session-request-cg';

/** True when `text` holds a C0 / DEL / C1 character — the range the CLI
 *  printer's sanitizer replaces. Checked by code point, not by a regex: a regex
 *  literal naming this range is an eslint error here (`no-control-regex`). */
function hasControlCharacter(text: string): boolean {
  return [...text].some((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f);
  });
}

type CapturedIo = ReturnType<typeof makeCapturedIo>['captured'];

async function runTransition(state: string, wsPath: string): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerRequestCommands(program, io);
  await program.parseAsync(
    [
      'request',
      'transition',
      REQUEST_ID,
      '--role',
      'rd',
      '--state',
      state,
      '--project',
      wsPath,
      '--session-id',
      SESSION_ID,
      '--json'
    ],
    { from: 'user' }
  );
  return captured;
}

/**
 * The invocation WITHOUT `--json`. `request-commands.ts` passes
 * `options.json` to `printResult` (unlike `job-commands.ts`, which passes the
 * whole options object), so this is the path that renders `warnings` to
 * stderr as `warning: <note>` — the channel A2 is about.
 */
async function runTransitionHuman(state: string, wsPath: string): Promise<CapturedIo> {
  const { io, captured } = makeCapturedIo();
  const program = new Command();
  registerRequestCommands(program, io);
  await program.parseAsync(
    [
      'request',
      'transition',
      REQUEST_ID,
      '--role',
      'rd',
      '--state',
      state,
      '--project',
      wsPath,
      '--session-id',
      SESSION_ID
    ],
    { from: 'user' }
  );
  return captured;
}

function parseJson(captured: CapturedIo): {
  ok: boolean;
  warnings?: string[];
  data: {
    codegraphRefresh?: unknown;
    state?: string;
    prerequisiteWarnings?: Array<{ path: string; code: string; message: string }>;
  };
} {
  const out = captured.stdout.join('\n');
  return JSON.parse(out) as {
    ok: boolean;
    warnings?: string[];
    data: {
      codegraphRefresh?: unknown;
      state?: string;
      prerequisiteWarnings?: Array<{ path: string; code: string; message: string }>;
    };
  };
}

describe('Scenario: integration — request transition triggers auto codegraph refresh on rd:qa-handoff only', () => {
  let ws: TmpWorkspace;

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-request-cg-');
    __m.refreshCodegraphAfterSlice.mockReset();
    __m.transitionRequestArtifact.mockReset();
  });

  afterEach(() => {
    cleanupTmpWorkspace();
  });

  it('when rd:qa-handoff succeeds, should invoke refreshCodegraphAfterSlice once with the project root', async () => {
    // given: a mock transition service reports a successful qa-handoff
    __m.transitionRequestArtifact.mockResolvedValue({
      role: 'rd',
      requestId: REQUEST_ID,
      state: 'qa-handoff',
      sessionId: SESSION_ID
    });
    __m.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
    // when: request transition rd -> qa-handoff runs
    const captured = await runTransition('qa-handoff', ws.path);
    // then: refresh is invoked exactly once with the project root and the envelope carries codegraphRefresh
    expect(__m.refreshCodegraphAfterSlice).toHaveBeenCalledTimes(1);
    expect(__m.refreshCodegraphAfterSlice).toHaveBeenCalledWith(ws.path);
    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.codegraphRefresh).toEqual({ refreshed: true });
  });

  it('when rd:implemented succeeds (not a slice boundary), should NOT invoke the refresh', async () => {
    // given: a mock transition service reports a successful rd:implemented step
    __m.transitionRequestArtifact.mockResolvedValue({
      role: 'rd',
      requestId: REQUEST_ID,
      state: 'implemented',
      sessionId: SESSION_ID
    });
    __m.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
    // when: request transition rd -> implemented runs
    const captured = await runTransition('implemented', ws.path);
    // then: the refresh is never invoked and codegraphRefresh is null in the envelope
    expect(__m.refreshCodegraphAfterSlice).not.toHaveBeenCalled();
    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.codegraphRefresh).toBeNull();
  });
});

describe('Scenario: a11y — a failing auto-refresh never fails the transition', () => {
  let ws: TmpWorkspace;

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-request-cg-a11y-');
    __m.refreshCodegraphAfterSlice.mockReset();
    __m.transitionRequestArtifact.mockReset();
  });

  afterEach(() => {
    cleanupTmpWorkspace();
  });

  it('when the refresh reports a non-blocking failure, should still return an ok transition envelope with a readable codegraphRefresh note', async () => {
    // given: a mock transition service succeeds and the refresh reports index-failed
    __m.transitionRequestArtifact.mockResolvedValue({
      role: 'rd',
      requestId: REQUEST_ID,
      state: 'qa-handoff',
      sessionId: SESSION_ID
    });
    __m.refreshCodegraphAfterSlice.mockResolvedValue({
      refreshed: false,
      reason: 'no-codegraph-dir',
      note: 'auto codegraph refresh skipped: no .codegraph directory. Run `peaks codegraph init` once to enable post-slice auto-refresh.'
    });
    // when: request transition rd -> qa-handoff runs despite the refresh skip
    const captured = await runTransition('qa-handoff', ws.path);
    // then: the transition is still ok and the note is surfaced, not an error
    const envelope = parseJson(captured);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.codegraphRefresh).toEqual({
      refreshed: false,
      reason: 'no-codegraph-dir',
      note: 'auto codegraph refresh skipped: no .codegraph directory. Run `peaks codegraph init` once to enable post-slice auto-refresh.'
    });
  });
});

// A2 (`2026-09-17-codegraph-msg-and-refresh`). Same defect, same boundary,
// other call site: the transition swallowed the refresh result's `note`
// entirely, so a slice that ended with no refreshed index looked exactly like
// one that ended with a current index.
describe('Scenario: a11y — A2 a non-refresh is visible to the operator', () => {
  let ws: TmpWorkspace;

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-request-cg-a2-');
    __m.refreshCodegraphAfterSlice.mockReset();
    __m.transitionRequestArtifact.mockReset();
    __m.transitionRequestArtifact.mockResolvedValue({
      role: 'rd',
      requestId: REQUEST_ID,
      state: 'qa-handoff',
      sessionId: SESSION_ID
    });
  });

  afterEach(() => {
    cleanupTmpWorkspace();
  });

  it('when a codegraph store is in use and the refresh fails, should warn on stderr with the reason and the remedy', async () => {
    // given: a refresh that failed against a store that DOES exist
    const note =
      'auto codegraph refresh failed (exit 2): schema lock conflict. Run `peaks codegraph index --project <root>` to refresh the codegraph index.';
    __m.refreshCodegraphAfterSlice.mockResolvedValue({
      refreshed: false,
      reason: 'index-failed',
      note
    });
    // when: the rd:qa-handoff transition runs on both output paths
    const json = await runTransition('qa-handoff', ws.path);
    const human = await runTransitionHuman('qa-handoff', ws.path);
    // then: the transition still succeeds (never blocks) …
    expect(parseJson(json).ok).toBe(true);
    // … the envelope carries the warning …
    expect(parseJson(json).warnings).toEqual([note]);
    // … and the operator reads it on stderr, with reason and remedy.
    expect(human.stderrText()).toContain(`warning: ${note}`);
    expect(human.stderrText()).toContain('schema lock conflict');
    expect(human.stderrText()).toContain('peaks codegraph index');
  });

  it('when no codegraph store was ever set up, should stay silent', async () => {
    // given: the project never opted in (clean control for the case above)
    __m.refreshCodegraphAfterSlice.mockResolvedValue({
      refreshed: false,
      reason: 'no-codegraph-dir',
      note: 'auto codegraph refresh skipped: no .codegraph directory. Run `peaks codegraph init` once to enable post-slice auto-refresh.'
    });
    // when: the rd:qa-handoff transition runs on both output paths
    const json = await runTransition('qa-handoff', ws.path);
    const human = await runTransitionHuman('qa-handoff', ws.path);
    // then: no WARNING anywhere …
    expect(parseJson(json).warnings).toEqual([]);
    expect(human.stderrText()).toBe('');
    // … while the note itself stays in the payload for a JSON consumer (that
    //     is the non-lossy half of the fix, not the operator-visible half).
    expect(parseJson(json).data.codegraphRefresh).toMatchObject({ reason: 'no-codegraph-dir' });
  });

  it('when the refresh succeeds, should print no warning', async () => {
    // given: the ordinary green boundary
    __m.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
    // when: the transition runs without --json
    const captured = await runTransitionHuman('qa-handoff', ws.path);
    // then: nothing is reported
    expect(captured.stderrText()).toBe('');
  });
});

// 1a of rid `rid-mut-report-warning-surfacing`. Same boundary, the other half
// of the same defect: `checkPrerequisites` BUILT the soft-pass warnings and
// `transitionRequestArtifact` read them only inside its failure `throw`, so a
// transition that succeeded after soft-passing two prerequisites printed
// nothing and a reader concluded every prerequisite had passed. The service
// now copies them onto its result; these cases pin that the CLI turns them
// into output — both the machine-readable entries in the payload and a
// warning line the operator reads — without failing anything.
describe('Scenario: a11y — a soft-passed prerequisite is reported, not fatal', () => {
  let ws: TmpWorkspace;

  /** The two warnings the real session `2026-10-12-session-74bd69` produced on
   *  `rd → qa-handoff`: one per artifact, each naming its own code. */
  const SOFT_PASSES = [
    {
      path: 'rd/third-party-review.md',
      code: 'third-party-review-missing-deprecated-in-v2.15.0',
      message: 'third-party reviewer absent — soft-blocked under the back-compat window.'
    },
    {
      path: 'mut/mut-report.json',
      code: 'mut-report-missing-deprecated-in-v2.14.0',
      message: 'mutation report absent — soft-blocked under the back-compat window.'
    }
  ];

  beforeEach(() => {
    ws = useTmpWorkspace('peaks-request-prereq-warn-');
    __m.refreshCodegraphAfterSlice.mockReset();
    __m.transitionRequestArtifact.mockReset();
    __m.refreshCodegraphAfterSlice.mockResolvedValue({ refreshed: true });
  });

  afterEach(() => {
    cleanupTmpWorkspace();
  });

  it('when a transition soft-passes two prerequisites, should name each code in the payload and on stderr', async () => {
    // given: a successful transition whose two prerequisites soft-passed
    // when:  the transition runs on both output paths
    // then:  it stays ok and exits zero, the structured entries ride the
    //        payload, the envelope warnings tell the two artifacts apart by
    //        code, and the operator reads them on stderr
    __m.transitionRequestArtifact.mockResolvedValue({
      role: 'rd',
      requestId: REQUEST_ID,
      state: 'qa-handoff',
      sessionId: SESSION_ID,
      prerequisiteWarnings: SOFT_PASSES
    });
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    const json = await runTransition('qa-handoff', ws.path);
    const human = await runTransitionHuman('qa-handoff', ws.path);
    try {
      const envelope = parseJson(json);
      expect(envelope.ok).toBe(true);
      expect(process.exitCode).toBeUndefined();
      expect(envelope.data.prerequisiteWarnings).toEqual(SOFT_PASSES);
      expect(envelope.warnings).toHaveLength(2);
      expect(envelope.warnings?.[0]).toContain(SOFT_PASSES[0]?.code);
      expect(envelope.warnings?.[1]).toContain(SOFT_PASSES[1]?.code);
      expect(human.stderrText()).toContain('warning: Soft prerequisite (not enforced)');
      expect(human.stderrText()).toContain(SOFT_PASSES[1]?.code);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('when nothing soft-passed, should report no warnings anywhere — the control', async () => {
    // given: a successful transition with no prerequisite soft-passed
    // when:  the transition runs on both output paths
    // then:  nothing is reported — so a non-empty list above is real news,
    //        not the envelope always carrying something
    __m.transitionRequestArtifact.mockResolvedValue({
      role: 'rd',
      requestId: REQUEST_ID,
      state: 'qa-handoff',
      sessionId: SESSION_ID
    });
    const json = await runTransition('qa-handoff', ws.path);
    const human = await runTransitionHuman('qa-handoff', ws.path);
    expect(parseJson(json).warnings).toEqual([]);
    expect(parseJson(json).data.prerequisiteWarnings).toBeUndefined();
    expect(human.stderrText()).toBe('');
  });

  it('when a warning carries a control character, should print it as `?` and add no line', async () => {
    // given: a warning whose fields carry a newline and other control
    //        characters — the shape `gateEvidence.<key>` can take when a quoted
    //        YAML key in the handoff frontmatter decodes to one
    // when:  the transition runs on both output paths
    // then:  the printed line holds no raw control character and is ONE line
    //        (a raw newline would forge a second line of this command's own
    //        output), while the JSON envelope keeps the field values intact
    const hostile = [
      {
        path: 'rd/evil\rmark\n[forged]',
        code: 'code\u0007with\u009bbell',
        message: 'line one\nwarning: forged second line\u0000'
      }
    ];
    __m.transitionRequestArtifact.mockResolvedValue({
      role: 'rd',
      requestId: REQUEST_ID,
      state: 'qa-handoff',
      sessionId: SESSION_ID,
      prerequisiteWarnings: hostile
    });
    const json = await runTransition('qa-handoff', ws.path);
    const human = await runTransitionHuman('qa-handoff', ws.path);
    const printed = human.stderrText();
    expect(printed).toContain('[forged]');
    expect(printed).toContain('code?with?bell');
    // Per WRITE, not the joined text (`stderrText()` joins with `\n`, itself a
    // control character): one write per line, and no forged second line.
    expect(human.stderr.every((line) => !hasControlCharacter(line))).toBe(true);
    expect(human.stderr).toHaveLength(1);
    // The envelope is JSON, so `printResult` escapes these itself; the entry
    // values survive byte-for-byte for a machine reader.
    expect(parseJson(json).data.prerequisiteWarnings).toEqual(hostile);
  });

  it('when a FAILED transition carries a control character, should print it as `?` and add no line', async () => {
    // given: the failure branch with the same hostile warning shape the reviewer
    //        replayed — a `gateEvidence` key whose YAML decodes to a newline
    //        (codepoints 97,10,98) plus a BEL (99,7,100)
    // when:  the transition refuses
    // then:  the failure's stderr holds no raw control character and is ONE
    //        line per warning — the same defence as the success branch
    const hostile = [
      {
        path: 'gateEvidence.a\nb',
        code: 'code\u0007x\n',
        message: 'FORGED BY HANDOFF KEY — c\u0007d\ne'
      }
    ];
    __m.transitionRequestArtifact.mockRejectedValue(
      new PrerequisitesNotSatisfiedError('rd', 'qa-handoff', SESSION_ID, [], hostile)
    );
    const human = await runTransitionHuman('qa-handoff', ws.path);
    const printed = human.stderrText();
    expect(printed).toContain('gateEvidence.a?b');
    expect(printed).toContain('FORGED BY HANDOFF KEY — c?d');
    // Per WRITE, not on the joined text: `stderrText()` joins with `\n`, which
    // is itself a control character. Four writes — the `code: message` line and
    // the three nextActions (the soft-blocked one carrying the warning); the
    // forged key stays inside ONE of them instead of becoming a second line of
    // this command's own output.
    expect(human.stderr.every((line) => !hasControlCharacter(line))).toBe(true);
    expect(human.stderr).toHaveLength(4);
  });
});
