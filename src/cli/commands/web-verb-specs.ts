// src/cli/commands/web-verb-specs.ts
//
// The six S1 `peaks web open|text|snap|click|shot|metrics` verbs, as data.
// Split out of `web-commands.ts`: the table is what `registerWebCommands`
// iterates, and keeping it beside the registration loop is what made that
// function's own body read as the whole command surface.
//
// `--profile <name>` is declared on `open` and nowhere else (design §2 lists it
// only there). Any other verb taking a profile would invent behaviour nobody
// asked for and multiply the isolation questions for no requested benefit.

import type { WebOp } from '../../services/web/web-protocol.js';

export interface WebVerbSpec {
  readonly name: string;
  readonly op: WebOp;
  readonly description: string;
  readonly argument: { readonly name: string; readonly description: string } | null;
  readonly takesProfile?: true;
  readonly toArgs: (
    positional: readonly (string | undefined)[],
    profile: string | undefined
  ) => Record<string, unknown>;
}

/**
 * The option text names the read-only half out loud: a caller who browses with a
 * profile must not assume the profile was refreshed by it.
 */
export const PROFILE_OPTION_DESCRIPTION =
  'navigate with a saved login profile (`peaks web login --profile <name>`): [a-z0-9._-], ' +
  '1-64 chars, upper case folds to lower. The profile is READ-ONLY here — this run loads it ' +
  'and never writes it back, so browser activity is not saved into it.';

export const WEB_VERBS: readonly WebVerbSpec[] = [
  {
    name: 'open',
    op: 'open',
    description:
      'Navigate the dispatch browser context to <url>. With --profile, the page loads that ' +
      'saved login.',
    argument: { name: '<url>', description: 'absolute URL to load' },
    takesProfile: true,
    toArgs: (positional, profile) => ({
      url: positional[0] ?? '',
      ...(profile === undefined ? {} : { profile })
    })
  },
  {
    name: 'text',
    op: 'text',
    description: 'Return the visible text of the page (or of [selector]), byte-capped.',
    argument: { name: '[selector]', description: 'CSS selector (default: body)' },
    toArgs: (positional) => ({ selector: positional[0] })
  },
  {
    name: 'snap',
    op: 'snap',
    description: 'Return a pruned ARIA snapshot of the page (or of [selector]), byte-capped.',
    argument: { name: '[selector]', description: 'CSS selector (default: body)' },
    toArgs: (positional) => ({ selector: positional[0] })
  },
  {
    name: 'click',
    op: 'click',
    description: 'Click the element matching <selector> in the dispatch browser context.',
    argument: { name: '<selector>', description: 'CSS selector to click' },
    toArgs: (positional) => ({ selector: positional[0] ?? '' })
  },
  {
    name: 'shot',
    op: 'shot',
    description: 'Screenshot the page (or [selector]) into the session web/ directory.',
    argument: { name: '[selector]', description: 'CSS selector (default: full page)' },
    toArgs: (positional) => ({ selector: positional[0] })
  },
  {
    name: 'metrics',
    op: 'metrics',
    description: 'Return Core Web Vitals for the dispatch page, or why they are unavailable.',
    argument: null,
    toArgs: () => ({})
  }
];
