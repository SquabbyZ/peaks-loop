// tests/unit/services/web/web-fallback.test.ts
//
// AC5's envelope half: every degraded answer is `ok:false`, and carries the
// tier, the MCP tool to use instead, the install command, and the two things a
// caller must be told — that the local path was skipped, and where a screenshot
// taken through the MCP path lands.
//
// One envelope carries BOTH the fallback and the install instruction, because
// the CLI is a subprocess and cannot see the caller's `mcp__playwright__*` tool
// list (orchestrator decision C3). These tests hold that line: the tool is
// named, and the root-directory warning is present.
//
// Dimensions covered:
//   - behavior:    envelope shape per op and per coded reason
//   - a11y:        the warnings and next actions a caller reads
//   - render:      not applicable (the CLI layer prints the envelope)
//   - integration: not applicable (pure function: no daemon, no filesystem)

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/services/web/web-fallback.test.ts',
  ['behavior', 'a11y'],
  [
    { dim: 'render', reason: 'the envelope is printed by the CLI layer, not here' },
    { dim: 'integration', reason: 'pure function: no daemon, no filesystem, no process' },
  ],
);

import {
  degradedEnvelope,
  INSTALL_HINT,
  MCP_ROOT_DIR_WARNING,
  MCP_TOOL_FOR_OP,
} from '../../../../src/services/web/web-fallback.js';
import { PLAYWRIGHT_VERSION_PIN } from '../../../../src/services/web/playwright-loader.js';
import type { WebOp } from '../../../../src/services/web/web-protocol.js';

/** Every op the protocol can carry — `Record<WebOp, string>` makes tsc the completeness gate. */
const ALL_OPS: readonly WebOp[] = [
  'open',
  'text',
  'snap',
  'click',
  'shot',
  'metrics',
  'login',
  'install',
  'status',
  'stop',
  'whoami',
];

/** The ops that have a browser path, and therefore something to degrade. */
const BROWSER_OPS: readonly WebOp[] = ['open', 'text', 'snap', 'click', 'shot', 'metrics', 'login'];

/**
 * The members of `BROWSER_OPS` that also have an MCP stand-in. `login` is a
 * browser op WITHOUT one: no `mcp__playwright__*` tool persists a storage state,
 * so naming `browser_navigate` for it sent the caller to a dead end (S4 R3). It
 * is the one browser op whose `mcpTool` is empty.
 */
const MCP_BACKED_OPS: readonly WebOp[] = ['open', 'text', 'snap', 'click', 'shot', 'metrics'];

describe('behavior — the degraded envelope', () => {
  it('when the gate refuses a browser op, should answer tier 3 with the fallback tool named', () => {
    // given: the disabled gate's reason for each browser-touching op
    // when:  the envelope is built
    // then:  every one is a named failure carrying the tool, the hint and the tier
    for (const op of BROWSER_OPS) {
      const envelope = degradedEnvelope(op, 'PEAKS_WEB_DISABLED=1');
      expect(envelope.ok).toBe(false);
      expect(envelope.command).toBe(`peaks.web.${op}`);
      expect(envelope.code).toBe('WEB_DISABLED');
      expect(envelope.data.tier).toBe(3);
      expect(envelope.data.mcpTool).toBe(MCP_TOOL_FOR_OP[op]);
      expect(envelope.data.installHint).toContain('playwright install chromium');
    }
  });

  it('when login degrades, should not name an MCP tool that cannot persist a session', () => {
    // given: the gate's refusal for `login` — the one browser verb whose whole
    //        purpose is persisting a session, which no MCP tool can do (S4 R3)
    // when:  the envelope is built
    const envelope = degradedEnvelope('login', 'PEAKS_WEB_DISABLED=1');
    // then:  the machine-readable field agrees with the human-readable one. The
    //        old value was `mcp__playwright__browser_navigate` — a tool that
    //        saves nothing — while `nextActions` said the fallback cannot save a
    //        login profile at all. A consumer reads `mcpTool` as "call this
    //        instead", so an empty string is the only honest answer here.
    expect(envelope.data.mcpTool).toBe('');
    expect(MCP_TOOL_FOR_OP['login']).toBe('');
    expect(envelope.nextActions.join('\n')).not.toContain('mcp__playwright__');
    expect(envelope.nextActions.join('\n')).toContain('PEAKS_WEB_DISABLED');
  });

  it('when an op has an MCP stand-in, should still name it', () => {
    // given: every browser op that is NOT login
    // when:  each is degraded
    // then:  the empty-mcpTool carve-out above did not spread to its neighbours
    for (const op of MCP_BACKED_OPS) {
      expect(degradedEnvelope(op, 'PEAKS_WEB_DISABLED=1').data.mcpTool.length).toBeGreaterThan(0);
    }
  });

  it('when the install hint is read, should be the command line the installer actually runs', () => {
    // given: the pin the acquisition code spawns with
    // when:  the hint is compared with the documented argv
    // then:  it names the same package and the same subcommand
    expect(INSTALL_HINT).toContain('playwright install chromium');
    expect(INSTALL_HINT).toContain(`playwright@${PLAYWRIGHT_VERSION_PIN}`);
  });

  it('when the local browser is skipped, should warn where the MCP path puts its screenshots', () => {
    // given: a degraded envelope
    // when:  its warnings are read
    // then:  the root-directory warning is present in design §6's wording and QA's variant
    const envelope = degradedEnvelope('shot', 'PEAKS_WEB_DISABLED=1');
    expect(envelope.warnings).toContain(MCP_ROOT_DIR_WARNING);
    expect(envelope.warnings.join('\n')).toContain('截图会落根目录');
    expect(envelope.warnings.join('\n')).toContain('截图会落项目根目录');
  });

  it('when a failure code prefixes the reason, should carry that code instead of the tier default', () => {
    // given: a failed install reported as `CODE: detail`
    // when:  the envelope is built
    // then:  the code survives and the detail is the human sentence
    const envelope = degradedEnvelope('open', 'WEB_INSTALL_FAILED: playwright install chromium exited with status 1');
    expect(envelope.code).toBe('WEB_INSTALL_FAILED');
    expect(envelope.message).toContain('exited with status 1');
    expect(envelope.message).not.toContain('WEB_INSTALL_FAILED');
  });

  it('when nothing is available at all, should answer tier 4 with WEB_UNAVAILABLE', () => {
    // given: the "no local browser and no MCP" case design §6 calls tier 4
    // when:  the envelope is built
    // then:  the tier is reported as 4 and the code says so
    const envelope = degradedEnvelope('snap', 'no browser path is available', 4);
    expect(envelope.data.tier).toBe(4);
    expect(envelope.code).toBe('WEB_UNAVAILABLE');
  });

  it('when an op degrades, should carry the arguments the op was called with', () => {
    // given: `open <url>` degrading — the fallback names `browser_navigate`,
    //        which a caller cannot issue without the URL (R9)
    const envelope = degradedEnvelope('open', 'PEAKS_WEB_DISABLED=1', 3, {
      url: 'https://example.test/',
      dispatchId: 7,
      selector: undefined
    });
    // then: the op surface travels with the envelope, and nothing else does
    expect(envelope.data.args).toEqual({ url: 'https://example.test/' });
  });

  it('when an op degrades with no arguments, should carry an empty argument set', () => {
    // given: a verb with no positional argument, like `snap`
    const envelope = degradedEnvelope('snap', 'PEAKS_WEB_DISABLED=1');
    // then: the key is always present, so a caller never has to branch on it
    expect(envelope.data.args).toEqual({});
  });

  it('when every op is looked up, should have an entry for each', () => {
    // given: the full op surface
    // when:  each one is looked up in the map
    // then:  none is undefined (tsc enforces the keys; this pins the runtime values)
    for (const op of ALL_OPS) {
      expect(typeof MCP_TOOL_FOR_OP[op]).toBe('string');
    }
    expect(Object.keys(MCP_TOOL_FOR_OP).sort()).toEqual([...ALL_OPS].sort());
  });

  it('when an op has no browser path, should not name a tool it cannot use', () => {
    // given: `status` — the diagnosis path, which keeps working under the gate
    // when:  its degraded envelope is built anyway
    // then:  the tool is empty rather than a plausible-looking lie
    const envelope = degradedEnvelope('status', 'PEAKS_WEB_DISABLED=1');
    expect(envelope.data.mcpTool).toBe('');
    expect(envelope.nextActions.join('\n')).not.toContain('mcp__playwright__');
  });
});

describe('a11y — what the caller is told', () => {
  it('when a browser op degrades, should offer the MCP call and the local install as next actions', () => {
    // given: the gate's refusal for `snap`
    // when:  the envelope is built
    // then:  both ways forward are named, and the fallback says where screenshots land
    const envelope = degradedEnvelope('snap', 'PEAKS_WEB_DISABLED=1');
    expect(envelope.nextActions.length).toBe(2);
    expect(envelope.nextActions[0]).toContain('mcp__playwright__browser_snapshot');
    expect(envelope.nextActions[0]).toContain('project root');
    expect(envelope.nextActions[1]).toContain('peaks web install');
    expect(envelope.message).toContain('PEAKS_WEB_DISABLED=1');
  });
});
