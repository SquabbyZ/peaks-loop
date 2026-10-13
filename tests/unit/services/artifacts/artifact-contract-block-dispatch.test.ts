// tests/unit/services/artifacts/artifact-contract-block-dispatch.test.ts
//
// The integration half of the artifact-contract block: the REAL
// `peaks sub-agent dispatch` action, in-process, in a temp project. Split out of
// `artifact-contract-block.test.ts` when the combined file passed the 500-line
// `tests/**` cap — the same move the repository makes in `src/`.
//
// What only this file can show: the block is reachable from production, not just
// from the builder. A correct builder wired to nothing is the recorded defect
// (`a-feature-can-be-fully-tested-and-still-be-unreachable-from-production`), and
// every assertion here reads the composed prompt out of the dispatch envelope.
//
// Dimensions: integration. The other three are covered by the sibling file, so
// they are declared omitted here rather than duplicated.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Command } from 'commander';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { makeCapturedIo } from '../../_setup/io.js';
import { registerSubAgentCommands } from '../../../../src/cli/commands/sub-agent-commands.js';
import type { RequestType } from '../../../../src/services/artifacts/artifact-prerequisites.js';
import { buildArtifactContractBlock } from '../../../../src/services/artifacts/artifact-contract-block.js';

declareDimensions(
  'tests/unit/services/artifacts/artifact-contract-block-dispatch.test.ts',
  ['integration'],
  [
    { dim: 'render', reason: 'covered by artifact-contract-block.test.ts' },
    { dim: 'behavior', reason: 'covered by artifact-contract-block.test.ts' },
    { dim: 'a11y', reason: 'covered by artifact-contract-block.test.ts' }
  ]
);

const SESSION_ID = '2026-10-13-contract-block';
const RID = 'rid-contract-block-probe';

function block(
  role: string,
  requestType: RequestType,
  requestTypeSource: 'declared' | 'default' = 'declared'
): string {
  return buildArtifactContractBlock({ role, requestType, requestTypeSource, requestId: RID });
}

/** How many artifact-contract sections a text carries. */
function headingCount(text: string): number {
  return text.split('## Artifact contract (generated from the prerequisite table)').length - 1;
}

/** Write `<project>/.peaks/_runtime/<sid>/<role>/requests/<rid>.md` with a type line. */
function writeRequest(project: string, role: string, typeLine: string | null): void {
  const dir = join(project, '.peaks', '_runtime', SESSION_ID, role, 'requests');
  mkdirSync(dir, { recursive: true });
  const body = `# Request ${RID}\n\n- session: ${SESSION_ID}\n${typeLine === null ? '' : `- type: ${typeLine}\n`}`;
  writeFileSync(join(dir, `${RID}.md`), body, 'utf8');
}

describe('integration — the real dispatch composes the block into the prompt', () => {
  let project: string;

  beforeEach(() => {
    project = mkdtempSync(join(tmpdir(), 'contract-block-dispatch-'));
    process.exitCode = undefined;
  });

  afterEach(() => {
    process.exitCode = undefined;
    try {
      rmSync(project, { recursive: true, force: true });
    } catch {
      // Windows open-handle race on the tmp dir; reapable either way.
    }
  });

  async function dispatch(role: string, prompt = 'CONTRACT-BLOCK-DISPATCH-PROBE'): Promise<string> {
    const { io, captured } = makeCapturedIo();
    const program = new Command();
    program.exitOverride();
    registerSubAgentCommands(program, io);
    await program.parseAsync(
      [
        'sub-agent',
        'dispatch',
        role,
        '--prompt',
        prompt,
        '--request-id',
        RID,
        '--session-id',
        SESSION_ID,
        '--project',
        project,
        '--graph-node',
        'n1',
        '--json'
      ],
      { from: 'user' }
    );
    return captured.text();
  }

  /** The composed prompt the envelope carries, not the raw stdout text. */
  function composedPrompt(stdout: string): string {
    const envelope = JSON.parse(stdout.trim()) as {
      data?: { toolCall?: { args?: { prompt?: unknown } } };
    };
    const prompt = envelope.data?.toolCall?.args?.prompt;
    if (typeof prompt !== 'string') throw new Error('the envelope carried no composed prompt');
    return prompt;
  }

  it('when an rd dispatch runs with no recorded type, should name ## Findings and CRITICAL', async () => {
    const stdout = await dispatch('rd');

    expect(stdout).toContain('## Findings');
    expect(stdout).toContain('CRITICAL');
  });

  it('when a qa dispatch runs, should name ## Test cases and ## Test execution', async () => {
    const stdout = await dispatch('qa');

    expect(stdout).toContain('## Test cases');
    expect(stdout).toContain('## Test execution');
  });

  it('when a role with no gated rows is dispatched, should add no block at all', async () => {
    expect(await dispatch('ui')).not.toContain('## Artifact contract');
  });

  it('when the caller prompt already carries a block, should keep exactly one', async () => {
    // given: a re-dispatch of a prompt that already carries a BUGFIX block —
    // the shape a resume from a stored prompt has — for an id whose type is not
    // recorded on disk, so the fresh block would be the default-labelled one
    const carried = `PRIOR DISPATCH BRIEF\n\n${block('rd', 'bugfix')}`;

    // when: the real CLI composes the prompt for the same id
    const composed = composedPrompt(await dispatch('rd', carried));

    // then: exactly one section, the carried one — the fresh block is not added
    expect(headingCount(composed)).toBe(1);
    expect(composed).toContain('## Root cause');
    expect(composed).not.toContain('the DEFAULT, not a recorded choice');
  });

  it('when the caller prompt carries no block, should add exactly one', async () => {
    // the control for the case above: the same invocation, a prompt without one
    const composed = composedPrompt(await dispatch('rd'));

    expect(headingCount(composed)).toBe(1);
    expect(composed).toContain('## Findings');
  });

  it('when an rd dispatch runs under a declared bugfix, should name the bug-analysis markers', async () => {
    writeRequest(project, 'prd', 'bugfix');

    const stdout = await dispatch('rd');

    expect(stdout).toContain('## Root cause');
    expect(stdout).toContain('recorded by a `- type:` line');
  });
});
