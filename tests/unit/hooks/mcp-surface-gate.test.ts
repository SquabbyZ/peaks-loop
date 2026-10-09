// tests/unit/hooks/mcp-surface-gate.test.ts
//
// L3 for the read-only MCP surface (PRD rid-036 AC-7, AC-8).
//
//   AC-7  the pre-tool interception covers EVERY matcher the adapter provides,
//         a call outside the whitelist is blocked, and an internal failure
//         blocks instead of allowing.
//   AC-8  the matcher set comes FROM THE ADAPTER: for every registered adapter
//         and every template it declares, an out-of-bounds call is constructed
//         and must be blocked — with no matcher literal in this file, so adding
//         an adapter or a registration channel needs no edit here.
//
// WHY THE LOOP IS THE ASSERTION. A test that named one tool name would pass on
// the channel it named and say nothing about the other — which is exactly the
// silent-enforcement failure §6.3 warns about. The loop walks the live registry
// and the adapter's own declarations, and the anti-vacuity arm proves it walked
// something: with no adapter declaring MCP naming, the loop would report zero
// failures and look identical to a working guard.
//
// Dimensions covered: render, behavior, integration, a11y.

import { afterEach, describe, expect, it } from 'vitest';

import { getAdapter, listAdapterIds } from '~/src/services/ide/ide-registry';
import type { IdeId } from '~/src/services/ide/ide-types';
import { mcpToolName, mcpToolNameTemplates } from '~/src/services/ide/mcp-tool-matcher';
import { HOOK_BLOCK_EXIT_CODE } from '~/src/services/hooks/output';
import { handleMcpSurfaceGate, lookupAllowedMcpTools } from '~/src/services/hooks/mcp-surface-gate';
import {
  loadReadOnlyWhitelist,
  toolIdsOf
} from '~/src/services/readonly-surface/readonly-whitelist';
import { declareDimensions } from '../_setup/4dim-template.js';
import { makeCapturedIo } from '../_setup/io.js';

declareDimensions('tests/unit/hooks/mcp-surface-gate.test.ts', [
  'render',
  'behavior',
  'integration',
  'a11y'
]);

/** A tool id that is deliberately not part of the read-only surface. */
const OUT_OF_BOUNDS_TOOL_ID = 'peaks_not_a_readonly_tool';

/** A Claude-shaped PreToolUse payload naming a tool, as the hook receives it. */
function payloadFor(toolName: string): Record<string, unknown> {
  return { tool_name: toolName, tool_input: {} };
}

/** Every (adapter, template) pair the registry declares. */
function declaredChannels(): ReadonlyArray<{ ide: IdeId; template: string }> {
  return listAdapterIds().flatMap((ide) =>
    mcpToolNameTemplates(getAdapter(ide)).map((template) => ({ ide, template }))
  );
}

const previousExitCode = process.exitCode;
afterEach(() => {
  process.exitCode = previousExitCode;
});

describe('Scenario: behavior - a call outside the declared surface is blocked', () => {
  it('when every adapter matcher is used to build an out-of-bounds call, should block each one', () => {
    // given: every tool-name channel the registered adapters declare, whether or
    //        not this repository registers such a server today
    const channels = declaredChannels();
    // when:  one unproven tool call is built per channel and run through the gate
    // then:  every one is blocked - and the loop is not vacuous, because at
    //        least one adapter declares at least one channel
    expect(channels.length).toBeGreaterThan(0);
    for (const { ide, template } of channels) {
      const toolName = mcpToolName(template, OUT_OF_BOUNDS_TOOL_ID);
      const { io, captured } = makeCapturedIo();
      const blocked = handleMcpSurfaceGate(io, payloadFor(toolName));
      expect(blocked, `${ide} ${template}`).toBe(true);
      expect(captured.stderrText(), `${ide} ${template}`).toContain(toolName);
    }
  });

  it('when the whitelist carries the tool, should allow it', () => {
    // given: a call for a tool the proven whitelist actually declares
    const allowed = toolIdsOf(loadReadOnlyWhitelist());
    expect(allowed.length).toBeGreaterThan(0);
    const toolName = mcpToolName(declaredChannels()[0]?.template ?? '', allowed[0] ?? '');
    const { io, captured } = makeCapturedIo();
    // when:  the gate runs
    const blocked = handleMcpSurfaceGate(io, payloadFor(toolName));
    // then:  it is not the gate's business to second-guess a proven tool
    expect(blocked).toBe(false);
    expect(captured.text()).toBe('');
  });

  it('when the tool is not an MCP tool for this surface, should leave the call alone', () => {
    // given: an ordinary harness tool call, which the Bash and worktree branches
    //        own
    const { io, captured } = makeCapturedIo();
    // when:  the MCP branch runs
    const blocked = handleMcpSurfaceGate(io, {
      tool_name: 'Bash',
      tool_input: { command: 'ls' }
    });
    // then:  it declines jurisdiction instead of deciding, so the allow/deny
    //        result every existing tool class had is unchanged
    expect(blocked).toBe(false);
    expect(captured.text()).toBe('');
    expect(process.exitCode).toBe(previousExitCode);
  });
});

describe('Scenario: render - the block is the shape the host already honours', () => {
  it('when a call is blocked, should emit the deny decision and the block exit code', () => {
    // given: an out-of-bounds call on the first declared channel
    const channel = declaredChannels()[0];
    expect(channel).toBeDefined();
    const toolName = mcpToolName(channel?.template ?? '', OUT_OF_BOUNDS_TOOL_ID);
    const { io, captured } = makeCapturedIo();
    // when:  the gate blocks it
    const blocked = handleMcpSurfaceGate(io, payloadFor(toolName));
    // then:  the same JSON decision and exit code the worktree gate uses
    expect(blocked).toBe(true);
    expect(captured.text()).toContain('"permissionDecision":"deny"');
    expect(process.exitCode).toBe(HOOK_BLOCK_EXIT_CODE);
  });
});

describe('Scenario: integration - the surface is read as data, and a read failure blocks', () => {
  it('when the allowed set is read, should come from the generated whitelist artifact', () => {
    // given: the artifact the read-only proof produced
    const fromArtifact = toolIdsOf(loadReadOnlyWhitelist());
    // when:  the gate's production lookup runs
    const fromGate = lookupAllowedMcpTools();
    // then:  they are the same set - the gate has no list of its own to drift
    expect([...fromGate]).toEqual([...fromArtifact]);
  });

  it('when reading the surface throws, should block rather than allow', () => {
    // given: a surface whose artifact cannot be read - the fail-closed case §6.2
    //        calls out, and the one a fail-open `catch` would turn into silence
    const channel = declaredChannels()[0];
    const toolName = mcpToolName(channel?.template ?? '', OUT_OF_BOUNDS_TOOL_ID);
    const { io, captured } = makeCapturedIo();
    // when:  the gate runs with a lookup that throws
    const blocked = handleMcpSurfaceGate(io, payloadFor(toolName), () => {
      throw new Error('whitelist artifact is unreadable');
    });
    // then:  the call is refused, and the reason says why
    expect(blocked).toBe(true);
    expect(captured.stderrText()).toContain('SURFACE_UNREADABLE');
    expect(process.exitCode).toBe(HOOK_BLOCK_EXIT_CODE);
  });
});

describe('Scenario: a11y - a blocked call explains what to do', () => {
  it('when a call is blocked, should name the tool and the tools that are allowed', () => {
    // given: an out-of-bounds call
    const channel = declaredChannels()[0];
    const toolName = mcpToolName(channel?.template ?? '', OUT_OF_BOUNDS_TOOL_ID);
    const { io, captured } = makeCapturedIo();
    // when:  the gate blocks it
    handleMcpSurfaceGate(io, payloadFor(toolName));
    // then:  the message carries the refused name, the offered names, and the
    //        remediation - not a stack trace
    const text = captured.stderrText();
    expect(text).toContain('NOT_IN_READONLY_SURFACE');
    expect(text).toContain(toolName);
    for (const allowed of lookupAllowedMcpTools()) {
      expect(text).toContain(allowed);
    }
    expect(text).toContain('readonly-surface.json');
  });
});
