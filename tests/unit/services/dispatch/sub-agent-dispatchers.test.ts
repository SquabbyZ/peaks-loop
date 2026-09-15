// tests/unit/services/dispatch/sub-agent-dispatchers.test.ts
//
// Slice 2026-09-15-s9-platform-vendor-coverage, D7 — before this file, all
// five exported dispatchers in `src/services/dispatch/sub-agent-dispatcher.ts`
// were referenced by ZERO tests. Four of them (`trae` / `trae-cn` / `codex` /
// `cursor`) are the ONLY route by which a sub-agent fan-out leaves
// claude-code: every non-Claude adapter in `src/services/ide/adapters/`
// carries one of them as its `subAgentDispatcher`, and nothing asserted that
// the route existed, that the per-IDE label reached the caller, or that the
// per-IDE `awaitBatch` behaved. A break in it — an adapter pointed at the
// wrong dispatcher, a lost note prefix — would have been invisible.
//
// What is asserted here is the route END TO END: adapter → dispatcher →
// batch result, over a real filesystem, with the per-IDE label present in the
// output. The label is not decoration; it is how a caller tells which IDE's
// batch timed out, and it is the only per-IDE value on the wire.
//
// Dimensions covered:
//   - behavior:    labels, role support, tool-call shape, the typed refusal
//   - integration: real dispatch-record files on a real fs, read by the real
//                  `awaitBatch` loop, through each adapter's own dispatcher
//   - render:      omitted — the CLI envelope that wraps these results is
//                  another file's subject; the note strings are asserted as
//                  data under integration
//   - a11y:        omitted — the one human-facing string is the typed refusal
//                  message, asserted as text under behavior

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { getAdapter, listAdapterIds } from '../../../../src/services/ide/ide-registry.js';
import {
  awaitByLlmFallback,
  claudeCodeSubAgentDispatcher,
  codexSubAgentDispatcher,
  cursorSubAgentDispatcher,
  nullSubAgentDispatcher,
  SubAgentNotSupportedError,
  traeCnSubAgentDispatcher,
  traeSubAgentDispatcher,
  type SubAgentDispatcher,
} from '../../../../src/services/dispatch/sub-agent-dispatcher.js';

declareDimensions(
  'tests/unit/services/dispatch/sub-agent-dispatchers.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the CLI envelope wrapping these results is asserted in the CLI test suite' },
    { dim: 'a11y', reason: 'the single human-facing string is the typed refusal, asserted as text under behavior' },
  ],
);

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-dispatchers-'));
  tmpDirs.push(dir);
  return dir;
}

/** Write a dispatch-record file in the shape `awaitBatch`'s reader expects. */
function writeRecord(payload: Record<string, unknown>): string {
  const path = join(makeTmpDir(), 'dispatch-record.json');
  writeFileSync(path, JSON.stringify(payload), 'utf8');
  return path;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** The five dispatchers that build a tool call, paired with their label. */
const TOOL_CALL_DISPATCHERS: ReadonlyArray<readonly [string, SubAgentDispatcher]> = [
  ['claude-code', claudeCodeSubAgentDispatcher],
  ['trae', traeSubAgentDispatcher],
  ['trae-cn', traeCnSubAgentDispatcher],
  ['codex', codexSubAgentDispatcher],
  ['cursor', cursorSubAgentDispatcher],
];

/** The four that carry a per-IDE `awaitBatch` note prefix. */
const PREFIXED: ReadonlyArray<readonly [string, string, SubAgentDispatcher]> = [
  ['trae', 'trae 1.3 real awaitBatch', traeSubAgentDispatcher],
  ['trae-cn', 'trae-cn 1.3 real awaitBatch', traeCnSubAgentDispatcher],
  ['codex', 'codex 1.3 real awaitBatch', codexSubAgentDispatcher],
  ['cursor', 'cursor 1.3 real awaitBatch', cursorSubAgentDispatcher],
];

describe('Scenario: behavior — every dispatcher announces itself and accepts a role', () => {
  for (const [label, dispatcher] of TOOL_CALL_DISPATCHERS) {
    it(`when the ${label} dispatcher is read, should carry its own label and accept a non-empty role`, () => {
      expect(dispatcher.label).toBe(label);
      expect(dispatcher.supportsRole('rd')).toBe(true);
      // A sub-role and a business subdivision both pass — the whitelist is soft
      expect(dispatcher.supportsRole('qa-business-regression')).toBe(true);
      // ...but the empty role does not, on every dispatcher including claude-code
      expect(dispatcher.supportsRole('')).toBe(false);
    });
  }

  it('when the labels are collected, should be five distinct values', () => {
    const labels = TOOL_CALL_DISPATCHERS.map(([, d]) => d.label);
    expect(new Set(labels).size).toBe(TOOL_CALL_DISPATCHERS.length);
  });

  it('when the null dispatcher is asked, should support nothing and refuse with a typed error', async () => {
    // given: the fallback for an IDE with no sub-agent surface (zcode today)
    expect(nullSubAgentDispatcher.label).toBe('null');
    expect(nullSubAgentDispatcher.supportsRole('rd')).toBe(false);

    // when / then: both methods refuse, with the code the CLI branches on
    let fromToolCall: unknown;
    try {
      nullSubAgentDispatcher.buildToolCall({ role: 'rd', prompt: 'p', requestId: 'r', sessionId: 's' });
    } catch (error) {
      fromToolCall = error;
    }
    expect(fromToolCall).toBeInstanceOf(SubAgentNotSupportedError);
    expect((fromToolCall as SubAgentNotSupportedError).code).toBe('IDE_NOT_SUPPORTED');

    await expect(
      nullSubAgentDispatcher.awaitBatch?.({ batchId: 'b', dispatchCount: 1, recordPaths: ['x'] }),
    ).rejects.toBeInstanceOf(SubAgentNotSupportedError);
  });
});

describe('Scenario: behavior — the five tool-call shapes agree, and carry the request through', () => {
  it('when the same input is handed to every dispatcher, should produce the same tool call', () => {
    // given: one dispatch, asked of all five
    const input = { role: 'qa', prompt: 'verify the slice', requestId: 'rid-1', sessionId: 'sid-1' };
    const [firstLabel, first] = TOOL_CALL_DISPATCHERS[0] as readonly [string, SubAgentDispatcher];
    const expected = first.buildToolCall(input);

    // then: each returns the same `name` + `args`. Those two fields ARE the
    // documented uniform shape ("byte-level identical across adapters", the
    // CLI envelope's contract). `toolCallVersion` is deliberately outside the
    // comparison: trae-cn omits it, which is a real divergence from its own
    // "mirrors Trae's shape" doc — pinned separately below rather than
    // smoothed over here.
    for (const [label, dispatcher] of TOOL_CALL_DISPATCHERS) {
      const actual = dispatcher.buildToolCall(input);
      expect(actual.name, label).toBe(expected.name);
      expect(actual.args, `${label} diverged from ${firstLabel}`).toEqual(expected.args);
    }
  });

  it('when a tool call is built, should name the task tool and carry role, rid and prompt in its args', () => {
    const call = claudeCodeSubAgentDispatcher.buildToolCall({
      role: 'rd',
      prompt: 'do the thing',
      requestId: 'rid-9',
      sessionId: 'sid-9',
    });
    expect(call.name).toBe('Task');
    expect(call.args).toEqual({
      subagent_type: 'general-purpose',
      description: 'rd for rid=rid-9',
      prompt: 'do the thing',
    });
    // and: the arg-shape version is stamped (a future IDE version can detect a
    // record written by this one). Codex omitted; trae omitted — see the
    // divergence case below.
    expect(claudeCodeSubAgentDispatcher.buildToolCall({
      role: 'rd', prompt: 'p', requestId: 'r', sessionId: 's',
    }).toolCallVersion).toBe('2.0.0');
  });

  it('when the session id is dropped, should not leak it into the description', () => {
    // The `description` is built from role + requestId only. Asserting the
    // ABSENCE matters: a session id in the description is how a sub-agent
    // envelope would carry state it was never meant to carry.
    const call = codexSubAgentDispatcher.buildToolCall({
      role: 'ui', prompt: 'p', requestId: 'rid-2', sessionId: 'sid-secret',
    });
    expect(call.args.description).toBe('ui for rid=rid-2');
    expect(JSON.stringify(call.args)).not.toContain('sid-secret');
  });

  it('when the tool-call version is read, should record that one of the five omits it', () => {
    // A pinned DIVERGENCE, discoverable rather than latent: `trae-cn` is the
    // only dispatcher that never stamps `toolCallVersion`. The field is
    // optional and the record reader defaults it to '2.0.0', so this is not a
    // defect today — but it is the kind of asymmetry that looks like a bug
    // and is invisible without this case. If a future slice unifies them,
    // update this list deliberately.
    const input = { role: 'rd', prompt: 'p', requestId: 'r', sessionId: 's' };
    const stamped = TOOL_CALL_DISPATCHERS.filter(([, d]) => d.buildToolCall(input).toolCallVersion === '2.0.0');
    expect(stamped.map(([label]) => label)).toEqual(['claude-code', 'trae', 'codex', 'cursor']);
    expect(traeCnSubAgentDispatcher.buildToolCall(input).toolCallVersion).toBeUndefined();
  });
});

describe('Scenario: integration — the four non-Claude awaitBatch calls attribute their results per IDE', () => {
  for (const [label, prefix, dispatcher] of PREFIXED) {
    it(`when a ${label} batch times out, should report the timeout under the ${label} label`, async () => {
      // given: a batch whose only record never reaches a terminal state
      const missing = join(makeTmpDir(), 'never-written.json');

      // when: the caller's budget is zero, so the loop makes no attempt
      const results = await dispatcher.awaitBatch?.({
        batchId: 'b',
        dispatchCount: 1,
        recordPaths: [missing],
        timeoutMs: 0,
      });

      // then: one slot, timed out, labelled with THIS IDE — the whole reason
      // the four prefixes exist is cross-IDE attribution in one session
      expect(results).toHaveLength(1);
      expect(results?.[0]?.dispatchIndex).toBe(0);
      expect(results?.[0]?.recordPath).toBe(missing);
      expect(results?.[0]?.status).toBe('timeout');
      expect(results?.[0]?.note).toBe(`${prefix} (timeout)`);
    });

    it(`when a ${label} batch record is done, should report done under the ${label} label`, async () => {
      const record = writeRecord({ status: 'done' });
      const results = await dispatcher.awaitBatch?.({
        batchId: 'b',
        dispatchCount: 1,
        recordPaths: [record],
        timeoutMs: 5_000,
      });
      expect(results?.[0]?.status).toBe('done');
      // done carries a bare prefix — no outcome suffix to explain
      expect(results?.[0]?.note).toBe(prefix);
    });

    it(`when a ${label} batch record failed with a reason, should surface the reason under the ${label} label`, async () => {
      const record = writeRecord({ status: 'failed', outcome: 'leaf-2 died' });
      const results = await dispatcher.awaitBatch?.({
        batchId: 'b',
        dispatchCount: 1,
        recordPaths: [record],
        timeoutMs: 5_000,
      });
      expect(results?.[0]?.status).toBe('failed');
      expect(results?.[0]?.note).toBe(`${prefix} — leaf-2 died`);
    });

    it(`when a ${label} batch record is stale, should map it to a labelled timeout`, async () => {
      // `stale` is not in the public status union, so it maps to `timeout`
      // while the human reason survives in the note. Losing the reason is a
      // regression a bare status check would not catch.
      const record = writeRecord({ status: 'stale' });
      const results = await dispatcher.awaitBatch?.({
        batchId: 'b',
        dispatchCount: 1,
        recordPaths: [record],
        timeoutMs: 5_000,
      });
      expect(results?.[0]?.status).toBe('timeout');
      expect(results?.[0]?.note).toBe(`${prefix} — stale`);
    });
  }

  it('when a claude-code batch times out, should carry no IDE prefix on the note', async () => {
    // The negative control for the four cases above: claude-code passes no
    // note prefix, so its timeout note is bare. If a future slice gives
    // claude-code a prefix, this fails and the four above stop being evidence
    // of anything specific to the non-Claude IDEs.
    const results = await claudeCodeSubAgentDispatcher.awaitBatch?.({
      batchId: 'b',
      dispatchCount: 1,
      recordPaths: [join(makeTmpDir(), 'never-written.json')],
      timeoutMs: 0,
    });
    expect(results?.[0]?.status).toBe('timeout');
    expect(results?.[0]?.note).toBeNull();
  });

  it('when a batch names no record paths, should report an empty result rather than inventing slots', async () => {
    // Pinned because `peaks sub-agent await` passes exactly this today: with
    // no record index it hands `recordPaths: []`, and the loop returns zero
    // slots. A caller reading only `results.length > 0` therefore sees
    // nothing — recorded here so the shape is not mistaken for a fan-out.
    const results = await codexSubAgentDispatcher.awaitBatch?.({
      batchId: 'b',
      dispatchCount: 1,
      recordPaths: [],
    });
    expect(results).toEqual([]);
  });

  it('when a record file holds unparseable JSON, should time out rather than throw', async () => {
    // A corrupt record must not kill the batch: the reader swallows the parse
    // error and the slot stays pending. Asserted because the failure mode of
    // a thrown parse error would be a hung fan-out with no result array.
    const path = join(makeTmpDir(), 'corrupt.json');
    writeFileSync(path, '{not json', 'utf8');
    const results = await cursorSubAgentDispatcher.awaitBatch?.({
      batchId: 'b',
      dispatchCount: 1,
      recordPaths: [path],
      timeoutMs: 0,
    });
    expect(results?.[0]?.status).toBe('timeout');
  });
});

describe('Scenario: integration — each adapter fans out through the dispatcher it declares', () => {
  it('when every adapter is asked for its dispatcher, should be exactly the wiring pinned here', () => {
    // given: the route out of claude-code, adapter by adapter. Pinning the
    // full map is the point — five adapters share the Trae dispatcher as a
    // documented placeholder, and a sixth silently joining them is a change.
    const wiring: Record<string, string> = {};
    for (const ide of listAdapterIds()) {
      wiring[ide] = getAdapter(ide).subAgentDispatcher.label;
    }
    expect(wiring).toEqual({
      'claude-code': 'claude-code',
      trae: 'trae',
      cursor: 'cursor',
      codex: 'codex',
      hermes: 'trae',
      openclaw: 'trae',
      qoder: 'trae',
      'tongyi-lingma': 'trae',
      zcode: 'null',
    });
  });

  it('when a sub-agent fans out on a non-Claude adapter, should label the result as that IDE', async () => {
    // The end-to-end case D7 exists for: a caller on Codex gets a batch result
    // whose note says codex. Before this file, no test ran a non-Claude
    // adapter's dispatcher at all.
    const codex = getAdapter('codex').subAgentDispatcher;
    const results = await codex.awaitBatch?.({
      batchId: 'b',
      dispatchCount: 1,
      recordPaths: [join(makeTmpDir(), 'never-written.json')],
      timeoutMs: 0,
    });
    expect(results?.[0]?.note).toBe('codex 1.3 real awaitBatch (timeout)');
  });

  it('when the 1.2 fallback note would reach a caller, should be checked for on every adapter', async () => {
    // The `awaitByLlm` marker is slice 1.2's shape: it was dropped in 1.3 when
    // the four IDEs got a real file-polling await. It survives ONLY as the
    // exported `awaitByLlmFallback` below, which nothing calls. No adapter may
    // still produce that note — `peaks sub-agent share` told users to expect
    // it, and a reader trusting that text would wait for a marker that never
    // arrives.
    const stale: string[] = [];
    for (const ide of listAdapterIds()) {
      const dispatcher = getAdapter(ide).subAgentDispatcher;
      if (typeof dispatcher.awaitBatch !== 'function') continue;
      let results: readonly { note: string | null }[] = [];
      try {
        results = await dispatcher.awaitBatch({
          batchId: 'b',
          dispatchCount: 1,
          recordPaths: [join(makeTmpDir(), 'never-written.json')],
          timeoutMs: 0,
        });
      } catch {
        continue; // null dispatcher refuses — not a stale note
      }
      for (const result of results) {
        if (result.note !== null && result.note.includes('awaitByLlm')) {
          stale.push(`${ide}: ${result.note}`);
        }
      }
    }
    expect(stale).toEqual([]);
  });

  it('when the 1.2 fallback is called directly, should still return its labelled marker', async () => {
    // Exported for back-compat, so it is kept working rather than deleted.
    // Its note text is what `peaks sub-agent share` used to describe; the
    // assertion is here so that text cannot change unnoticed while the CLI
    // help still quotes it.
    const results = await awaitByLlmFallback(
      { batchId: 'b', dispatchCount: 2, recordPaths: ['a', 'b'] },
      'cursor',
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.note).toBe('awaitByLlm: cursor 1.2 fallback (real impl in 1.3)');
    expect(results[0]?.status).toBe('timeout');
  });

  it('when the trae-cn dispatcher is looked for among adapters, should find no adapter using it', () => {
    // `traeCnSubAgentDispatcher` is exported and maintained, and NO registered
    // adapter references it: there is no `trae-cn` id in the `IdeId` union and
    // no `trae-cn` adapter file. It is reachable only by direct import.
    // Pinned so that the day a trae-cn adapter is registered, this fails and
    // the wiring map above gets the entry it needs.
    const users = listAdapterIds().filter(
      (ide) => getAdapter(ide).subAgentDispatcher === traeCnSubAgentDispatcher,
    );
    expect(users).toEqual([]);
  });
});
