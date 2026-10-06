// tests/unit/services/context/codegraph-preflight-dispatch-seam.test.ts
//
// 4-dimension unit test for the seam between a real codegraph preflight run and
// the dispatch prompt (rid 2026-10-06-codegraph-degradation-tripwire).
//
// WHY THIS FILE EXISTS SEPARATELY FROM
// `dispatch-codegraph-unavailable-reason.test.ts`. That file proves the composer
// CAN render a reason. This file proves a REAL PREFLIGHT HANDS ONE OVER — the
// seam where the production defect lived:
//
//     codegraphBlock = preflight.available ? preflight.block : null;
//
// `preflight.note`, the only place `buildCodegraphPreflightBlock` ever puts the
// upstream cause, was dropped on the floor. The arms below run the real service
// against a tmp `.codegraph/` store whose `files` command fails exactly the way
// the broken WAL-mode store failed, then compose the dispatch prompt from its
// outcome. Arms that only exercised the composer stay green if the seam drops the
// note again; these do not.
//
//   - arm A: the upstream cause reaches the prompt, and the block does not claim
//     the reason is missing;
//   - arm B: the frame is not a cause. Upstream draws a 72-dash rule around its
//     runtime block and its CLOSING rule survives the block removal whenever the
//     cause follows with no blank line between — measured on the real binary, so
//     the note quoted the rule instead of the error until the note builder
//     skipped frames;
//   - arm C: a preflight that reports no note at all still renders the explicit
//     no-reason fallback, so the two states stay distinguishable end to end.
//
// Dimensions covered:
//   - behavior:    the fallback arm of the note renderer
//   - integration: a real `buildCodegraphPreflightBlock` run against a tmp
//                  `.codegraph/` store with an injected process runner (the only
//                  mocked boundary), composed into a real prompt
//   - a11y:        the composed text is what the RD sub-agent reads
//   - render:      omitted — the functions return typed strings and print
//                  nothing; their shape is asserted under behavior

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { RULE, wasmBlock } from '../../_setup/codegraph-backend-output.js';

declareDimensions(
  'tests/unit/services/context/codegraph-preflight-dispatch-seam.test.ts',
  ['behavior', 'integration', 'a11y'],
  [
    {
      dim: 'render',
      reason: 'the seam returns typed strings and prints nothing'
    }
  ]
);

import { buildDispatchSystemPrompt } from '~/src/services/context/build-dispatch-system-prompt';
import {
  CODEGRAPH_REASON_MISSING,
  renderCodegraphUnavailableBlock
} from '~/src/services/context/codegraph-unavailable-block';
import { buildCodegraphPreflightBlock } from '~/src/services/codegraph/codegraph-preflight-service';
import {
  CODEGRAPH_DB_NAME,
  CODEGRAPH_MARKER_NAME,
  type CodegraphExecutionResult,
  type CodegraphInvocation
} from '~/src/services/codegraph/codegraph-service';

const REASON_SENTENCE = 'Reason reported by the codegraph preflight:';

/** A peaks-loop-managed store, so the preflight goes straight to the `files` read. */
function managedStore(prefix: string): string {
  const project = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(project, '.codegraph'), { recursive: true });
  writeFileSync(join(project, '.codegraph', CODEGRAPH_MARKER_NAME), 'peaks-loop-managed\n', 'utf8');
  writeFileSync(join(project, '.codegraph', CODEGRAPH_DB_NAME), 'schema\n', 'utf8');
  return project;
}

/** A runner whose `files` subcommand fails with the given stderr. */
function failingFilesRunner(stderr: string) {
  return vi.fn(async (invocation: CodegraphInvocation): Promise<CodegraphExecutionResult> =>
    invocation.subcommand === 'files'
      ? { exitCode: 1, stdout: '', stderr }
      : { exitCode: 1, stdout: '', stderr: `unexpected ${invocation.subcommand}` }
  );
}

function composeFrom(preflight: Awaited<ReturnType<typeof buildCodegraphPreflightBlock>>) {
  return buildDispatchSystemPrompt({
    taskTitle: 'rd',
    taskBody: 'plan the slice',
    memoryBlock: { available: false },
    codegraphBlock: preflight.available ? preflight.block : preflight.note
  });
}

describe('Scenario: behavior — the reasonless fallback is explicit', () => {
  it('when the note renderer is given no reason, should render the sentence naming the gap', () => {
    // given: the empty/absent note states the renderer can be handed
    const withNull = renderCodegraphUnavailableBlock(null);
    const withBlank = renderCodegraphUnavailableBlock('   ');
    // when: both are rendered
    // then: each says the reason was not obtained and quotes no cause
    for (const block of [withNull, withBlank]) {
      expect(block).toContain('## Codegraph structure');
      expect(block).toContain(CODEGRAPH_REASON_MISSING);
      expect(block).not.toContain(REASON_SENTENCE);
    }
  });
});

describe('Scenario: integration — the reason survives the dispatch seam', () => {
  it('when codegraph files fails on the store, should carry the upstream error into the dispatch prompt', async () => {
    // given: a managed store whose `files` command fails behind the wasm block
    const project = managedStore('peaks-cg-seam-');
    const runner = failingFilesRunner(`${wasmBlock()}\nunable to open database file\n`);
    try {
      // when: the real preflight runs and its outcome is composed into a prompt
      const preflight = await buildCodegraphPreflightBlock(project, runner);
      const out = composeFrom(preflight);
      // then: the upstream cause reaches the prompt and no gap is claimed
      expect(preflight.available).toBe(false);
      expect(out).toContain('## Codegraph structure');
      expect(out).toContain('unable to open database file');
      expect(out).toContain(REASON_SENTENCE);
      expect(out).not.toContain(CODEGRAPH_REASON_MISSING);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it('when the cause follows the closing frame rule, should carry the cause and drop the frame', async () => {
    // given: the stderr shape the real binary prints — the block, its closing
    //        rule, and the cause on the next line with no blank between them
    const project = managedStore('peaks-cg-frame-');
    const runner = failingFilesRunner(
      `${wasmBlock()}${RULE}\n[ERR] Failed to list files: file is not a database\n`
    );
    try {
      // when: the real preflight runs and its outcome is composed into a prompt
      const preflight = await buildCodegraphPreflightBlock(project, runner);
      const out = composeFrom(preflight);
      // then: the reader gets the database error, never the box-drawing frame
      expect(out).toContain('file is not a database');
      expect(out).not.toContain(RULE);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });
});

describe('Scenario: a11y — the reader can tell a reason was lost', () => {
  it('when the preflight reports an empty note, should render the explicit no-reason fallback', () => {
    // given: an unavailable outcome whose note carries no cause at all
    const preflight = { available: false as const, note: '' };
    // when: it is composed the way the dispatch site composes it
    const out = composeFrom(preflight);
    // then: the block names the gap instead of a bare "unavailable"
    expect(out).toContain('codegraph unavailable');
    expect(out).toContain(CODEGRAPH_REASON_MISSING);
    expect(out).not.toContain(REASON_SENTENCE);
  });
});
