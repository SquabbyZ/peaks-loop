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

const REQUEST_ID = '2026-09-03-cg-auto-request';
const SESSION_ID = '2026-09-03-session-request-cg';

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
  data: { codegraphRefresh?: unknown; state?: string };
} {
  const out = captured.stdout.join('\n');
  return JSON.parse(out) as {
    ok: boolean;
    warnings?: string[];
    data: { codegraphRefresh?: unknown; state?: string };
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
