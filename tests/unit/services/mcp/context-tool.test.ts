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
import type { CliExecutor } from '~/src/services/mcp/tool-core';
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
  /**
   * A stubbed CLI executor. The tool's own behaviour is what these cases
   * assert, so the input is a fixed envelope rather than whatever this machine
   * happens to have bound — the earlier version read the real session and
   * therefore failed on any machine with no active presence, including CI.
   *
   * The shape is the REAL `CliExecution`: `runArgv` parses `stdout` as the CLI's
   * JSON envelope and reads `argv` for its failure prose, so a stub that omits
   * either crashes inside the layer under test rather than asserting on it.
   */
  function stubExecutor(envelopes: Readonly<Record<string, unknown>>): CliExecutor {
    return async (argv) => {
      const joined = argv.join(' ');
      const needle = Object.keys(envelopes).find((key) => joined.includes(key));
      const data = needle === undefined ? {} : envelopes[needle];
      return {
        argv,
        exitCode: 0,
        stdout: JSON.stringify({ ok: true, command: needle ?? 'unknown', data }),
        stderr: '',
        timedOut: false
      };
    };
  }

  const PRESENCE = {
    active: true,
    skill: 'peaks-code',
    gate: 'qa-handoff',
    context: { ratioPct: '42.5%', action: 'none', mode: 'standard' }
  };
  const REQUEST = {
    requestId: 'rid-1',
    state: 'qa-handoff',
    path: '.peaks/_runtime/s/rd/requests/001-rid-1.md'
  };

  it('when a request is given, should report the skill, gate, ratio and request state', async () => {
    // given: stubbed envelopes for the two argv the tool runs
    // when: the tool runs with rid and role
    // then: every one of those facts appears — including the ratio, which the
    //       first implementation silently dropped by reading the wrong level
    const text = textOf(
      await callContextCompressTool(
        contextTool(),
        { rid: 'rid-1', role: 'rd', project: '/tmp/project' },
        {
          cwd: '/tmp/project',
          execute: stubExecutor({ 'skill presence': PRESENCE, 'request show': REQUEST })
        }
      )
    );

    expect(text).toContain('active skill: peaks-code');
    expect(text).toContain('gate: qa-handoff');
    expect(text).toContain('context used: 42.5%');
    expect(text).toContain('request state: qa-handoff');
  });

  it('when no request is given, should still summarise the session and not invent a request', async () => {
    // given: only the presence envelope is available
    // when: the tool runs with no rid
    // then: the session facts are present and no request line is fabricated
    const text = textOf(
      await callContextCompressTool(
        contextTool(),
        { project: '/tmp/project' },
        {
          cwd: '/tmp/project',
          execute: stubExecutor({ 'skill presence': PRESENCE })
        }
      )
    );

    expect(text).toContain('active skill: peaks-code');
    expect(text).not.toContain('request state:');
  });

  it('when the summary is produced, should not conclude anything', async () => {
    // given: a stubbed run, so the text is asserted rather than the environment
    // when: the text is read
    // then: it carries facts and an explicit warning that omission is not absence
    const text = textOf(
      await callContextCompressTool(
        contextTool(),
        { project: '/tmp/project' },
        {
          cwd: '/tmp/project',
          execute: stubExecutor({ 'skill presence': PRESENCE })
        }
      )
    );

    expect(text).toContain('facts only; no judgement');
    expect(text).toContain('is NOT recorded here');
  });
});
