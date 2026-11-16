// tests/unit/services/mcp/context-tool.test.ts
//
// WHAT THIS LOCKS. `peaks_context_compress` gives the model a bounded, factual
// statement of where a Peaks-Loop workflow stands, so that after it folds older
// turns out of its working set it is working from recorded facts rather than
// recollection.
//
// It is NOT a compaction, and the cases below keep that honest: the tool runs
// only argv already whitelisted for `peaks_status`, so it cannot write state,
// spawn a process, or reach the network. `validateSurface` refuses to start a
// server whose tool carries an unproven argv, which is the structural guarantee.
//
// THE DEFECT THAT MOTIVATED THE CASES. The first live run omitted the context
// ratio entirely, because `skill presence` nests it under `data.context` and the
// tool read `data.ratioPct` off the top level. A summary silently missing its
// most important number is worse than one that says it is missing: this file
// asserts the ratio appears.
//
// Dimensions covered:
//   - behavior:    what the summary includes, omits, and does with a failed source
//   - integration: the real tool surface and the real whitelist on disk
//
// Dimensions omitted:
//   - a11y: MCP tool text is consumed by a model, not rendered to a person.
//   - render: the reply is plain text; there is no layout to assert.

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';
import { callContextCompressTool } from '~/src/services/mcp/context-tool';
import {
  loadToolDefinitions,
  validateSurface,
  type McpToolDefinition
} from '~/src/services/mcp/surface';
import { loadReadOnlyWhitelist } from '~/src/services/readonly-surface/readonly-whitelist';

declareDimensions(
  'tests/unit/services/mcp/context-tool.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'a11y', reason: 'MCP tool output is consumed by a model, not rendered to a person' },
    { dim: 'render', reason: 'the reply is plain text with no layout to assert' }
  ]
);

const CONTEXT = { cwd: process.cwd() };

function contextTool(): McpToolDefinition {
  const tool = loadToolDefinitions().find((t) => t.name === 'peaks_context_compress');
  if (tool === undefined) throw new Error('peaks_context_compress is not in the surface');
  return tool;
}

function textOf(result: { content: ReadonlyArray<{ text?: string }> }): string {
  return result.content.map((c) => c.text ?? '').join('\n');
}

describe('(integration) the tool is part of a valid read-only surface', () => {
  it('when the surface is validated, should declare the tool without drift', () => {
    // given: the generated whitelist and the derived tool list
    // when: the startup check runs
    // then: it passes — every argv behind the new tool is already proven read-only
    const whitelist = loadReadOnlyWhitelist();

    expect(() => validateSurface(whitelist, loadToolDefinitions())).not.toThrow();
    expect(loadToolDefinitions().map((t) => t.name)).toContain('peaks_context_compress');
  });
});

describe('(behavior) the resume summary', () => {
  it('when a request is given, should report the skill, gate, ratio and request state', async () => {
    // given: a bound session with an active request
    // when: the tool runs with rid and role
    // then: every one of those facts appears — including the ratio, which the
    //       first implementation silently dropped by reading the wrong level
    const text = textOf(
      await callContextCompressTool(
        contextTool(),
        { rid: 'project-scan-field-refresh', role: 'rd', project: process.cwd() },
        CONTEXT
      )
    );

    expect(text).toContain('active skill:');
    expect(text).toContain('gate:');
    expect(text).toContain('context used:');
    expect(text).toContain('request state:');
  });

  it('when no request is given, should still summarise the session and not invent a request', async () => {
    // given: a call with no rid
    // when: the tool runs
    // then: the session facts are present and no request line is fabricated
    const text = textOf(
      await callContextCompressTool(contextTool(), { project: process.cwd() }, CONTEXT)
    );

    expect(text).toContain('active skill:');
    expect(text).not.toContain('request state:');
  });

  it('when the summary is produced, should not conclude anything', async () => {
    // given: any run
    // when: the text is read
    // then: it carries facts and an explicit warning that omission is not absence
    const text = textOf(
      await callContextCompressTool(contextTool(), { project: process.cwd() }, CONTEXT)
    );

    expect(text).toContain('facts only; no judgement');
    expect(text).toContain('is NOT recorded here');
  });
});
