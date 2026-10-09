// src/cli/commands/playwright-browser-command.ts
//
// `peaks browser action <intent>` — the thin Playwright MCP wrapper for the 5
// supported intents. Split out of `playwright-commands.ts`; the registered
// name, description, options and envelopes are unchanged.

import type { Command } from 'commander';
import { runBrowserAction } from '../../services/qa/browser-wrapper-service.js';
import { getErrorMessage } from '../cli-helpers.js';
import { emitFailure, emitSuccess } from './playwright-envelope.js';

const SUPPORTED_INTENTS = ['navigate', 'click', 'fill', 'snapshot', 'extract'] as const;
type SupportedIntent = (typeof SUPPORTED_INTENTS)[number];

type BrowserActionOptions = {
  url?: string;
  selector?: string;
  value?: string;
  expression?: string;
  json?: boolean;
};

function isSupportedIntent(value: string): value is SupportedIntent {
  return (SUPPORTED_INTENTS as readonly string[]).includes(value);
}

/**
 * Pass-through caller used when the CLI surface is invoked outside the
 * harness. In production the IDE/agent harness intercepts the wrapper's
 * output and routes the underlying MCP call. Tests inject a stub via
 * the `runBrowserAction(..., caller)` overload.
 */
async function mockOrPassThroughCaller(
  tool: string,
  args: Record<string, unknown>
): Promise<unknown> {
  return { tool, args, routedBy: 'peaks-loop-browser-wrapper' };
}

/**
 * Wire `peaks browser action <intent>`. The wrapper is a thin adapter
 * for the 5 intents. The real MCP caller is provided by the IDE / agent
 * harness — this CLI surface is invoked by tests and skills to drive
 * browser flows without hand-shelling the MCP protocol.
 */
export function registerBrowserActionCommand(program: Command): void {
  const browser = program
    .command('browser')
    .description('Browser action helpers (slice 3: thin Playwright MCP wrapper, 5 intents only)');

  browser
    .command('action')
    .description('Run one of 5 browser intents: navigate, click, fill, snapshot, extract')
    .argument('<intent>', 'one of: navigate, click, fill, snapshot, extract')
    .option('--url <url>', 'URL (navigate)')
    .option('--selector <selector>', 'simple selector: #id, .class, tag, tag#id, tag.class')
    .option('--value <value>', 'value to fill')
    .option('--expression <expr>', 'JS expression to evaluate (extract)')
    .option('--json', 'emit JSON envelope')
    .action(async (intent: string, opts: BrowserActionOptions) => {
      try {
        if (!isSupportedIntent(intent)) {
          throw new Error(
            `unknown intent "${intent}" — fall back to raw MCP (supported: navigate, click, fill, snapshot, extract)`
          );
        }
        // The IDE/agent harness bridges `mcp__playwright__browser_*` tools.
        // Outside the harness, we use a pass-through caller that records
        // the intent + args so skills and tests can route the call.
        const result = await runBrowserAction(
          intent,
          {
            url: opts.url,
            selector: opts.selector,
            value: opts.value,
            expression: opts.expression
          },
          mockOrPassThroughCaller
        );
        emitSuccess(
          opts.json,
          result,
          `intent=${result.intent} ok=${result.ok} elapsedMs=${result.elapsedMs}`
        );
      } catch (error) {
        emitFailure(opts.json, getErrorMessage(error));
      }
    });
}
