/**
 * Slice 3 — `peaks browser action <intent> [args...]` thin wrapper.
 *
 * Five supported intents: navigate, click, fill, snapshot, extract.
 * Each intent invokes EXACTLY ONE Playwright MCP tool call. No auto
 * snapshots between intents, no retry, no selector caching, no healing.
 *
 * Anti-features (per slice 3 spec):
 *   - No retry / circuit-breaker
 *   - No selector caching
 *   - No accessibility tree customization
 *   - No screenshot / video
 *   - No "smart selector healing"
 *
 * Selectors are restricted to simple forms (`#id`, `.class`, `tag#id`,
 * `tag.class`, `tag`). Anything else returns a fall-back error pointing
 * the caller to the raw MCP.
 */

export type BrowserIntent = 'navigate' | 'click' | 'fill' | 'snapshot' | 'extract';

export type McpCaller = (
  tool: string,
  args: Record<string, unknown>
) => Promise<unknown>;

export interface BrowserActionArgs {
  url?: string | undefined;
  selector?: string | undefined;
  value?: string | undefined;
  expression?: string | undefined;
}

export interface BrowserActionResult {
  readonly intent: BrowserIntent;
  readonly ok: boolean;
  readonly data: unknown;
  readonly elapsedMs: number;
}

// Simple selectors only: `#id`, `.class`, `tag`, `tag#id`, `tag.class`.
// Anything else (xpath, attribute, pseudo-class chains, descendants) →
// fall back to raw MCP.
const SIMPLE_SELECTOR = /^([a-zA-Z][a-zA-Z0-9-]*)?([#.][a-zA-Z][a-zA-Z0-9_-]*)?$/;

/**
 * Run a single browser intent. Throws on validation errors; returns
 * a structured result on success.
 */
export async function runBrowserAction(
  intent: BrowserIntent,
  args: BrowserActionArgs,
  caller: McpCaller
): Promise<BrowserActionResult> {
  const start = Date.now();
  const tool = toolFor(intent, args);
  const data = await caller(tool.name, tool.args);
  return {
    intent,
    ok: true,
    data,
    elapsedMs: Date.now() - start
  };
}

interface ResolvedTool {
  readonly name: string;
  readonly args: Record<string, unknown>;
}

function toolFor(intent: BrowserIntent, args: BrowserActionArgs): ResolvedTool {
  switch (intent) {
    case 'navigate': {
      if (typeof args.url !== 'string' || args.url.length === 0) {
        throw new Error('navigate requires a non-empty --url');
      }
      return { name: 'mcp__playwright__browser_navigate', args: { url: args.url } };
    }
    case 'click': {
      assertSimpleSelector(args.selector);
      return {
        name: 'mcp__playwright__browser_click',
        args: { selector: args.selector }
      };
    }
    case 'fill': {
      assertSimpleSelector(args.selector);
      if (typeof args.value !== 'string') {
        throw new Error('fill requires both --selector and --value');
      }
      return {
        name: 'mcp__playwright__browser_fill_form',
        args: { fields: [{ selector: args.selector, value: args.value }] }
      };
    }
    case 'snapshot': {
      return { name: 'mcp__playwright__browser_snapshot', args: {} };
    }
    case 'extract': {
      if (typeof args.expression !== 'string' || args.expression.length === 0) {
        throw new Error('extract requires a non-empty --expression');
      }
      return {
        name: 'mcp__playwright__browser_evaluate',
        args: { function: args.expression }
      };
    }
    default: {
      const exhaustive: never = intent;
      throw new Error(
        `unknown intent "${String(exhaustive)}" — fall back to raw MCP`
      );
    }
  }
}

function assertSimpleSelector(selector: unknown): asserts selector is string {
  if (typeof selector !== 'string' || selector.length === 0) {
    throw new Error('selector is required (fall back to raw MCP for complex selectors)');
  }
  if (!SIMPLE_SELECTOR.test(selector)) {
    throw new Error(
      `selector "${selector}" is not a simple selector — fall back to raw MCP`
    );
  }
}
