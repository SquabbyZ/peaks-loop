/**
 * Slice 3 — peaks browser action wrapper.
 *
 * `peaks browser action <intent> [args...]` accepts one of 5 intents:
 *   navigate, click, fill, snapshot, extract.
 *
 * Each intent invokes EXACTLY ONE underlying MCP tool call (the wrapper
 * never emits a snapshot between actions — caller is responsible for
 * intent transitions). Goal: single browser action ≤ 5s end-to-end.
 *
 * Anti-features (per slice 3 spec):
 *   - No retry / circuit-breaker
 *   - No selector caching
 *   - No accessibility tree customization
 *   - No screenshot / video
 *   - No "smart selector healing"
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  runBrowserAction,
  type BrowserActionResult,
  type McpCaller
} from '../../../src/services/qa/browser-wrapper-service.js';

interface FakeMcp {
  caller: McpCaller;
  calls: Array<{ tool: string; args: Record<string, unknown> }>;
}

function makeFakeMcp(respond: (tool: string, args: Record<string, unknown>) => unknown): FakeMcp {
  const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
  const caller: McpCaller = vi.fn(async (tool: string, args: Record<string, unknown>) => {
    calls.push({ tool, args });
    return respond(tool, args);
  });
  return { caller, calls };
}

describe('browser-wrapper-service: intent dispatch', () => {
  let mcp: FakeMcp;

  beforeEach(() => {
    mcp = makeFakeMcp((tool) => {
      if (tool === 'mcp__playwright__browser_navigate') return { ok: true, url: 'about:blank' };
      if (tool === 'mcp__playwright__browser_click') return { ok: true };
      if (tool === 'mcp__playwright__browser_fill_form') return { ok: true };
      if (tool === 'mcp__playwright__browser_snapshot') return { ok: true, snapshot: '<empty />' };
      if (tool === 'mcp__playwright__browser_evaluate') return { ok: true, text: 'extracted' };
      throw new Error(`unexpected tool ${tool}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('navigate forwards url and returns first MCP call only', async () => {
    const result = await runBrowserAction('navigate', { url: 'https://example.com' }, mcp.caller);
    expect(mcp.calls).toHaveLength(1);
    expect(mcp.calls[0]?.tool).toBe('mcp__playwright__browser_navigate');
    expect(mcp.calls[0]?.args).toEqual({ url: 'https://example.com' });
    expect(result.intent).toBe('navigate');
    expect(result.ok).toBe(true);
  });

  test('click forwards selector + ref and emits exactly 1 MCP call', async () => {
    const result = await runBrowserAction('click', { selector: 'button#submit' }, mcp.caller);
    expect(mcp.calls).toHaveLength(1);
    expect(mcp.calls[0]?.tool).toBe('mcp__playwright__browser_click');
    expect(mcp.calls[0]?.args).toMatchObject({ selector: 'button#submit' });
    expect(result.intent).toBe('click');
  });

  test('fill uses fill_form with a single field map and 1 MCP call', async () => {
    const result = await runBrowserAction(
      'fill',
      { selector: 'input#email', value: 'a@b.c' },
      mcp.caller
    );
    expect(mcp.calls).toHaveLength(1);
    expect(mcp.calls[0]?.tool).toBe('mcp__playwright__browser_fill_form');
    expect(mcp.calls[0]?.args).toMatchObject({
      fields: [{ selector: 'input#email', value: 'a@b.c' }]
    });
    expect(result.intent).toBe('fill');
  });

  test('snapshot calls snapshot tool exactly once', async () => {
    const result = await runBrowserAction('snapshot', {}, mcp.caller);
    expect(mcp.calls).toHaveLength(1);
    expect(mcp.calls[0]?.tool).toBe('mcp__playwright__browser_snapshot');
    expect(result.intent).toBe('snapshot');
    expect(result.data).toEqual({ ok: true, snapshot: '<empty />' });
  });

  test('extract uses browser_evaluate with the caller-supplied expression', async () => {
    const result = await runBrowserAction(
      'extract',
      { expression: 'document.title' },
      mcp.caller
    );
    expect(mcp.calls).toHaveLength(1);
    expect(mcp.calls[0]?.tool).toBe('mcp__playwright__browser_evaluate');
    expect(mcp.calls[0]?.args).toMatchObject({ function: 'document.title' });
    expect(result.intent).toBe('extract');
    expect(result.data).toEqual({ ok: true, text: 'extracted' });
  });

  test('wrapper never auto-inserts a snapshot between intents', async () => {
    // simulating a 3-step sequence via 3 separate wrapper calls — still 3 MCP calls total,
    // not 6 (no auto-snapshot between each).
    await runBrowserAction('navigate', { url: 'https://x.test' }, mcp.caller);
    await runBrowserAction('click', { selector: '#a' }, mcp.caller);
    await runBrowserAction('fill', { selector: '#b', value: 'v' }, mcp.caller);
    expect(mcp.calls).toHaveLength(3);
    expect(mcp.calls.map((c) => c.tool)).toEqual([
      'mcp__playwright__browser_navigate',
      'mcp__playwright__browser_click',
      'mcp__playwright__browser_fill_form'
    ]);
  });
});

describe('browser-wrapper-service: anti-features', () => {
  let mcp: FakeMcp;
  beforeEach(() => {
    mcp = makeFakeMcp(() => ({ ok: true }));
  });

  test('rejects unknown intent with a "fall back to raw MCP" error', async () => {
    await expect(
      runBrowserAction('hover' as never, {}, mcp.caller)
    ).rejects.toThrow(/fall back to raw MCP/i);
    expect(mcp.calls).toHaveLength(0);
  });

  test('rejects complex CSS selectors with a fall-back error (no arbitrary selectors)', async () => {
    await expect(
      runBrowserAction(
        'click',
        { selector: 'div > ul li:nth-of-type(3) a[href^="/x"]' },
        mcp.caller
      )
    ).rejects.toThrow(/fall back to raw MCP/i);
    expect(mcp.calls).toHaveLength(0);
  });

  test('rejects XPath selectors (only simple id / class / tag#id / tag.class allowed)', async () => {
    await expect(
      runBrowserAction('click', { selector: '//div[@id="x"]' }, mcp.caller)
    ).rejects.toThrow(/fall back to raw MCP/i);
  });

  test('rejects missing required args per intent', async () => {
    await expect(runBrowserAction('navigate', {}, mcp.caller)).rejects.toThrow(/url/i);
    await expect(runBrowserAction('click', {}, mcp.caller)).rejects.toThrow(/selector/i);
    await expect(runBrowserAction('fill', { selector: '#x' }, mcp.caller)).rejects.toThrow(/value/i);
    await expect(runBrowserAction('extract', {}, mcp.caller)).rejects.toThrow(/expression/i);
    expect(mcp.calls).toHaveLength(0);
  });

  test('result shape: { intent, ok, data, elapsedMs }', async () => {
    const result: BrowserActionResult = await runBrowserAction('snapshot', {}, mcp.caller);
    expect(result).toMatchObject({
      intent: 'snapshot',
      ok: true,
      data: expect.anything(),
      elapsedMs: expect.any(Number)
    });
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
