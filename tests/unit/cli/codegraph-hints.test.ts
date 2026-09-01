// tests/unit/cli/codegraph-hints.test.ts
//
// rid-CG-007 — rewrite bare upstream `codegraph <subcommand>` hints.
//
// The upstream @colbymchenry/codegraph binary's `status` output prints a
// bare-command hint like `Run "codegraph init" to initialize`. Because the
// binary is a nested transitive dependency and is NOT on PATH, an LLM that
// follows that hint hits "command not found". `rewriteBareCodegraphHints`
// (in `src/cli/commands/codegraph-commands.ts`) rewrites the bare hint to
// `peaks codegraph init`.
//
// Dimensions covered:
//   - behavior: input -> output transformation; bare hints get the `peaks `
//                prefix, already-prefixed hints are left alone (idempotent),
//                and text with no codegraph references is unchanged.
//   - a11y:     the rewritten hint names the correct `peaks codegraph`
//                command so the LLM (or human) can follow it directly.
//
// Omitted:
//   - render:       pure string transform; no structured output shape to
//                   assert beyond the returned string (covered by behavior).
//   - integration:  pure function — no fs / subprocess / network / env /
//                   clock boundary.
//
// Run with:
//   pnpm vitest run tests/unit/cli/codegraph-hints.test.ts

import { describe, expect, it } from 'vitest';

import { rewriteBareCodegraphHints } from '~/src/cli/commands/codegraph-commands';
import { declareDimensions } from '../_setup/4dim-template.js';

declareDimensions(
  'tests/unit/cli/codegraph-hints.test.ts',
  ['behavior', 'a11y'],
  [
    { dim: 'render', reason: 'pure string transform; returned string is asserted under behavior' },
    { dim: 'integration', reason: 'pure function; no fs / subprocess / network / env / clock boundary' }
  ]
);

const SUBCOMMANDS = ['status', 'init', 'index', 'query', 'files', 'context', 'affected'] as const;

describe('rewriteBareCodegraphHints (rid-CG-007) — behavior', () => {
  it('rewrites the quoted upstream status hint', () => {
    expect(rewriteBareCodegraphHints('Run "codegraph init" to initialize')).toBe(
      'Run "peaks codegraph init" to initialize'
    );
  });

  it('rewrites a backtick-quoted bare hint', () => {
    expect(rewriteBareCodegraphHints('Run `codegraph init` to initialize')).toBe(
      'Run `peaks codegraph init` to initialize'
    );
  });

  it('prefixes every bare subcommand reference with `peaks `', () => {
    for (const sub of SUBCOMMANDS) {
      expect(rewriteBareCodegraphHints(`codegraph ${sub}`)).toBe(`peaks codegraph ${sub}`);
    }
  });

  it('rewrites multiple bare references in one string', () => {
    expect(rewriteBareCodegraphHints('codegraph status then codegraph index')).toBe(
      'peaks codegraph status then peaks codegraph index'
    );
  });

  it('leaves already-prefixed `peaks codegraph ...` hints unchanged (idempotent)', () => {
    const input = 'Run `peaks codegraph index` to rebuild';
    expect(rewriteBareCodegraphHints(input)).toBe(input);
  });

  it('leaves text with no codegraph references unchanged', () => {
    const input = 'no command references here, just prose';
    expect(rewriteBareCodegraphHints(input)).toBe(input);
  });

  it('does not touch `codegraph` inside larger tokens (no subcommand follows)', () => {
    const input = 'use @colbymchenry/codegraph for indexing';
    expect(rewriteBareCodegraphHints(input)).toBe(input);
  });
});

describe('rewriteBareCodegraphHints (rid-CG-007) — a11y', () => {
  it('surfaces the peaks-prefixed recovery command a caller can follow', () => {
    const rewritten = rewriteBareCodegraphHints('Run "codegraph init" to initialize');
    expect(rewritten).toBe('Run "peaks codegraph init" to initialize');
    expect(rewritten).toContain('peaks codegraph init');
  });
});
