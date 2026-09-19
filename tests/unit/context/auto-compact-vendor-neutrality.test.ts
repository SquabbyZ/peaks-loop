// tests/unit/context/auto-compact-vendor-neutrality.test.ts
//
// Behaviour coverage for slice 2026-09-12-auto-compact-vendor-neutrality:
// the three sites that decided by IDE NAME now decide by the adapter's
// DECLARED capability.
//
// Every case here is written so that the OLD code fails it and the NEW code
// passes — which is the only reason to add them. In particular:
//   - the Trae-shaped cases below never touch Trae's real `compact` profile
//     (it has none); they register a `compactPathway: 'ide-native'` profile
//     on the `trae` adapter via the registry's public test seam and assert
//     the dispatcher honours it. Under the old
//     `ideId !== 'claude-code'` gate, every one of them returned
//     `ok: false, pathway: 'noop'`.
//   - `compactPathwayForIde('trae')` under a declared `ide-native` profile
//     returned `'llm-self-compress'` under the old
//     `ide === 'claude-code' ? … : …` branch.
//   - the hook-install cases assert the written file lands at the
//     ADAPTER-declared location, which the old dispatcher could not reach —
//     it never passed `settingsPath` and always wrote `.claude/`.
//
// The `claude-code` cases are the byte-stability pins: the refactor must not
// move Claude Code's own path, env-var name or echoed id by a single byte.

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchIdeCompact } from '~/src/services/context/auto-compact-dispatcher';
import { compactPathwayForIde } from '~/src/services/context/main-session-monitor';
import { TRAE_ADAPTER } from '~/src/services/ide/adapters/trae-adapter';
import { _resetAdaptersForTesting, _setAdapterForTesting } from '~/src/services/ide/ide-registry';

/** A Trae adapter that declares the in-band pathway it does not ship with. */
const TRAE_WITH_IDE_NATIVE = {
  ...TRAE_ADAPTER,
  settings: { ...TRAE_ADAPTER.settings, localSettingsFileName: 'settings.local.json' },
  compact: {
    envVarForContextPercent: 'TRAE_CONTEXT_USAGE_PERCENT',
    compactCommand: 'trae --compact',
    compactPathway: 'ide-native' as const
  }
};

const TRAE_ENV = { TRAE_CLI: '1' };
const CLAUDE_ENV = { CLAUDE_CODE_ENTRYPOINT: '1' };

const roots: string[] = [];

function makeRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'peaks-vn-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  _resetAdaptersForTesting();
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }
});

describe('compact dispatch — capability, not IDE name', () => {
  it('dispatches a non-claude-code adapter that DECLARES ide-native, under its own id and its own settings path', async () => {
    _setAdapterForTesting('trae', TRAE_WITH_IDE_NATIVE);
    const root = makeRoot();

    const result = await dispatchIdeCompact({
      projectRoot: root,
      sessionId: 'sid',
      env: TRAE_ENV,
      target: 'main'
    });

    // The old name gate returned `ok: false, pathway: 'noop'` here.
    expect(result.ok).toBe(true);
    expect(result.pathway).toBe('ide-native');
    // The echoed id is the adapter's, not a literal.
    expect(result.ide).toBe('trae');
    // The hook went to the adapter's declared location...
    const written = join(root, '.trae', 'settings.local.json');
    expect(existsSync(written)).toBe(true);
    // The written entry is the real hook (the marker constant is not part of
    // the JSON payload — `AUTO_COMPACT_HOOK_MATCHER` is the on-disk key).
    expect(readFileSync(written, 'utf8')).toContain('peaks code auto-compact --project .');
    // ...and NOT to the claude-code default the old dispatcher hardcoded.
    expect(existsSync(join(root, '.claude', 'settings.local.json'))).toBe(false);
    // The message names the adapter-declared env-var, not CLAUDE_*.
    expect(result.message).toContain('TRAE_CONTEXT_USAGE_PERCENT');
    expect(result.message).not.toContain('CLAUDE_CONTEXT_USAGE_PERCENT');
  });

  it('refuses an adapter with no compact profile for BOTH targets, without consulting its name', async () => {
    const root = makeRoot();

    // `trae` ships no `compact` profile — the refusal now comes from the
    // profile's absence, and says so, rather than from an IDE shortlist.
    const main = await dispatchIdeCompact({
      projectRoot: root,
      sessionId: 'sid',
      env: TRAE_ENV,
      target: 'main'
    });
    const sub = await dispatchIdeCompact({
      projectRoot: root,
      sessionId: 'sid',
      env: TRAE_ENV,
      target: 'sub-agent'
    });

    for (const result of [main, sub]) {
      expect(result.ok).toBe(false);
      expect(result.ide).toBe('trae');
      expect(result.pathway).toBe('noop');
      expect(result.message).toContain('no registered compact profile');
    }
  });

  it('leaves claude-code byte-identical: same id, same env-var, same settings path', async () => {
    const root = makeRoot();

    const result = await dispatchIdeCompact({
      projectRoot: root,
      sessionId: 'sid',
      env: CLAUDE_ENV,
      target: 'main'
    });

    expect(result.ok).toBe(true);
    expect(result.ide).toBe('claude-code');
    expect(result.pathway).toBe('ide-native');
    expect(result.message).toContain('CLAUDE_CONTEXT_USAGE_PERCENT');
    expect(existsSync(join(root, '.claude', 'settings.local.json'))).toBe(true);
  });
});

describe('main-session pathway — declared by the adapter, not derived from the name', () => {
  it('reports ide-native for the adapter that declares it, whichever IDE it is', () => {
    _setAdapterForTesting('trae', TRAE_WITH_IDE_NATIVE);
    // The old `ide === 'claude-code' ? 'ide-native' : 'llm-self-compress'`
    // returned 'llm-self-compress' for exactly this input.
    expect(compactPathwayForIde('trae')).toBe('ide-native');
    // ...and keeps claude-code's answer unchanged.
    expect(compactPathwayForIde('claude-code')).toBe('ide-native');
  });

  it('falls back to llm-self-compress for an adapter with no profile, and does not throw for an id with no adapter at all', () => {
    // `trae` is registered but declares no `compact`.
    expect(compactPathwayForIde('trae')).toBe('llm-self-compress');
    // `opencode` is an `IdeKind` with NO registered adapter — a `getAdapter`
    // call here would throw inside a pure formatting path.
    expect(compactPathwayForIde('opencode')).toBe('llm-self-compress');
    expect(compactPathwayForIde('unknown')).toBe('llm-self-compress');
  });
});
