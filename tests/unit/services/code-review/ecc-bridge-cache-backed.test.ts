// Slice A (2026-09-09-ecc-dynamic-and-cleanup) — cache-backed ECC dispatch.
// Verifies the new `ready-via-cache` state, that every legacy detect state
// keeps its meaning, and that the cache-backed path feeds the SAME
// `adaptEccEnvelopeToRdCodeReview` bridge (Gate B3 shape).

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_NATIVE_ECC_AGENT_ID,
  ECC_OUTPUT_CONTRACT,
  buildCacheBackedEccPrompt,
  detectEcc,
  isEccEnvelope,
  runEccCodeReview,
  type EccEnvelope
} from '../../../../src/services/code-review/ecc-bridge.js';

const ENVELOPE: EccEnvelope = {
  passed: false,
  violations: [
    { kind: 'correctness', line: 12, snippet: 'if (x = 1)', hint: 'use ===' }
  ],
  gateAction: 'block'
};

describe('detectEcc — cache-backed state', () => {
  it('returns ready-via-cache when the plugin is missing but the cache is materialized', () => {
    const result = detectEcc({ pluginInstalled: false, agentAvailable: false, cacheAgentAvailable: true });
    expect(result.state).toBe('ready-via-cache');
    expect(result.pluginInstalled).toBe(false);
    expect(result.agentAvailable).toBe(false);
    // Real upstream name — upstream ECC ships `code-reviewer.md`, never `code-review.md`.
    expect(result.nextActions.join(' ')).toContain('~/.peaks/agents/ecc/code-reviewer.md');
    expect(result.nextActions.join(' ')).not.toContain('~/.peaks/agents/ecc/code-review.md');
  });

  it('names the caller-resolved materialized agent when one is passed through', () => {
    const result = detectEcc({
      pluginInstalled: false,
      agentAvailable: false,
      cacheAgentAvailable: true,
      cacheAgentName: 'code-reviewer'
    });
    expect(result.state).toBe('ready-via-cache');
    expect(result.nextActions.join(' ')).toContain('~/.peaks/agents/ecc/code-reviewer.md');
  });

  it('returns ready-via-cache when the plugin agent is missing but the cache is materialized', () => {
    const result = detectEcc({ pluginInstalled: true, agentAvailable: false, cacheAgentAvailable: true });
    expect(result.state).toBe('ready-via-cache');
    expect(result.pluginInstalled).toBe(true);
    expect(result.agentAvailable).toBe(false);
  });

  it('still returns plugin-missing without a cache (inline degradation note unchanged)', () => {
    const result = detectEcc({ pluginInstalled: false, agentAvailable: false });
    expect(result.state).toBe('plugin-missing');
    expect(result.nextActions.join(' ')).toContain('code-review-ecc-degraded-to-inline');
    expect(result.nextActions.join(' ')).toContain('peaks ecc install');
  });

  it('still returns agent-missing without a cache', () => {
    const result = detectEcc({ pluginInstalled: true, agentAvailable: false });
    expect(result.state).toBe('agent-missing');
  });
});

describe('detectEcc — legacy states keep their meaning', () => {
  it('ready when plugin + agent are available', () => {
    expect(detectEcc({ pluginInstalled: true, agentAvailable: true }).state).toBe('ready');
  });

  it('dispatch-failed when the Agent tool threw', () => {
    const result = detectEcc({
      pluginInstalled: true,
      agentAvailable: true,
      dispatchError: new Error('boom')
    });
    expect(result.state).toBe('dispatch-failed');
  });

  it('envelope-malformed when the returned value fails validation', () => {
    const result = detectEcc({
      pluginInstalled: true,
      agentAvailable: true,
      envelope: { passed: 'yes' }
    });
    expect(result.state).toBe('envelope-malformed');
  });

  it('a cache-backed state does not mask a malformed native envelope', () => {
    // Native plugin wins the fallback order; a malformed native envelope
    // must still surface as envelope-malformed.
    const result = detectEcc({
      pluginInstalled: true,
      agentAvailable: true,
      cacheAgentAvailable: true,
      envelope: { nope: true }
    });
    expect(result.state).toBe('envelope-malformed');
  });
});

describe('runEccCodeReview — cache-backed envelope adapts through the same bridge', () => {
  it('adapts a cache-backed envelope into the Gate B3 markdown shape', () => {
    const { detect, doc } = runEccCodeReview({
      rid: 'rid-1',
      generatedAt: '2026-09-09T00:00:00.000Z',
      pluginInstalled: false,
      agentAvailable: false,
      cacheAgentAvailable: true,
      envelope: ENVELOPE
    });
    expect(detect.state).toBe('ready-via-cache');
    expect(doc).not.toBeNull();
    expect(doc?.verdict).toBe('block');
    expect(doc?.body).toContain('## Findings');
    expect(doc?.body).toContain('CRITICAL');
    expect(doc?.body).toContain('source: ecc:code-reviewer');
  });

  it('returns a null doc when no cache-backed path exists', () => {
    const { detect, doc } = runEccCodeReview({
      rid: 'rid-2',
      generatedAt: '2026-09-09T00:00:00.000Z',
      pluginInstalled: false,
      agentAvailable: false,
      envelope: ENVELOPE
    });
    expect(detect.state).toBe('plugin-missing');
    expect(doc).toBeNull();
  });
});

describe('buildCacheBackedEccPrompt', () => {
  it('embeds the materialized instructions, the diff, and the output contract', () => {
    const prompt = buildCacheBackedEccPrompt({
      rid: 'rid-3',
      instructions: '# Code review agent\n\nCheck correctness.',
      diff: '--- a/x.ts\n+++ b/x.ts\n+const x = 1'
    });
    expect(prompt).toContain('Check correctness.');
    expect(prompt).toContain('+const x = 1');
    expect(prompt).toContain(ECC_OUTPUT_CONTRACT);
    expect(prompt).toContain('"gateAction"');
    expect(prompt).toContain('rid-3');
  });

  it('names an envelope shape that isEccEnvelope accepts', () => {
    expect(isEccEnvelope({ passed: true, violations: [], gateAction: 'pass' })).toBe(true);
    expect(ECC_OUTPUT_CONTRACT).toContain('"passed": boolean');
  });
});

describe('DEFAULT_NATIVE_ECC_AGENT_ID', () => {
  it('pins the native plugin agent id to the verified upstream naming', () => {
    // Verified upstream: plugin name is `ecc` (`.claude-plugin/plugin.json`),
    // agent frontmatter `name` is `code-reviewer`
    // (`~/.peaks/agents/ecc/code-reviewer.md`).
    expect(DEFAULT_NATIVE_ECC_AGENT_ID).toBe('ecc:code-reviewer');
  });

  it('is the id the cache-backed prompt heading names', () => {
    const prompt = buildCacheBackedEccPrompt({
      rid: 'rid-4',
      instructions: 'body',
      diff: 'diff'
    });
    expect(prompt).toContain(`materialized from ${DEFAULT_NATIVE_ECC_AGENT_ID}`);
  });
});
