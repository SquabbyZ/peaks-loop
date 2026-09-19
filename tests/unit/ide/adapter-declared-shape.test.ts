// tests/unit/ide/adapter-declared-shape.test.ts
//
// Slice 2026-09-15-s9-platform-vendor-coverage, D6 — nine IDE adapters were
// registered and exactly one of them (`claude-code`) had a test file, which
// covered only its compact path. The other eight (`trae`, `cursor`, `codex`,
// `hermes`, `openclaw`, `qoder`, `tongyi-lingma`, `zcode`) had no test file at
// all, so the values they declare — the hook event an install writes, the
// matcher it writes it under, the env var gate-enforce templates interpolate,
// the vendor variable a caller id is read from — were never asserted by
// anything. A copy-paste slip while "filling the table" (the whole point of
// the slim `IdeAdapter` shape) would have been invisible.
//
// What is asserted here is each adapter's DECLARED SURFACE, value by value,
// plus the invariants that only hold if the nine stay distinct. Every case is
// a plain equality against a literal, so a wrong answer fails — there is no
// `typeof x === 'string'` case in this file.
//
// Dimensions covered:
//   - behavior:    declared per-IDE values, and the caller-id resolution
//                  ladder (override → own vendor signal → typed refusal)
//   - integration: the real registry (`getAdapter` / `listAdapterIds`), and
//                  real `process.env`-shaped inputs handed in explicitly
//   - render:      omitted — the adapters render nothing; the CLI envelope
//                  that carries these values is another file's subject
//   - a11y:        omitted — the one human-facing string (the refusal) is
//                  asserted by text under behavior, not as a rendered surface

import { describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { withEnv } from '../_setup/io.js';
import {
  getAdapter,
  listAdapterIds,
  tryGetAdapter
} from '../../../src/services/ide/ide-registry.js';
import type { IdeAdapter, IdeId } from '../../../src/services/ide/ide-types.js';

declareDimensions(
  'tests/unit/ide/adapter-declared-shape.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'adapters render nothing; the CLI envelope is asserted elsewhere' },
    { dim: 'a11y', reason: 'the single human-facing string is asserted as text under behavior' }
  ]
);

/**
 * The registry's own insertion order, pinned. Not derived from the registry —
 * deriving it would make the assertion unable to fail. A new adapter added to
 * `ide-registry.ts` without a decision here turns this red, which is the
 * point: the nine below carry a per-IDE row in `EXPECTED_SHAPE`.
 */
const EXPECTED_ORDER: readonly IdeId[] = [
  'claude-code',
  'trae',
  'cursor',
  'codex',
  'hermes',
  'openclaw',
  'qoder',
  'tongyi-lingma',
  'zcode'
];

interface ExpectedShape {
  readonly displayName: string;
  readonly dirName: string;
  readonly envVar: string;
  /** The key the install writes the hook array under. NOT uniform — see codex. */
  readonly hookEvent: string;
  /** The tool name the hook entry matches on. NOT uniform — see trae. */
  readonly toolMatcher: string;
  /** `capabilities.statusline` — false only where the IDE has no such UI. */
  readonly statusline: boolean;
  /** G9 prompt-size hook opt-in. */
  readonly promptSizeAware: boolean;
}

const EXPECTED_SHAPE: Readonly<Record<IdeId, ExpectedShape>> = {
  'claude-code': {
    displayName: 'Claude Code',
    dirName: '.claude',
    envVar: 'CLAUDE_PROJECT_DIR',
    hookEvent: 'PreToolUse',
    toolMatcher: 'Bash',
    statusline: true,
    promptSizeAware: true
  },
  trae: {
    displayName: 'Trae',
    dirName: '.trae',
    envVar: 'TRAE_PROJECT_DIR',
    // The only *verified* non-Claude shapes in the set (Trae 1.x fixture):
    // a camelCase event and a `terminal` matcher. A copy-paste from the
    // claude-code row would answer 'PreToolUse' / 'Bash' and fail here.
    hookEvent: 'beforeToolCall',
    toolMatcher: 'terminal',
    statusline: true,
    promptSizeAware: true
  },
  cursor: {
    displayName: 'Cursor',
    dirName: '.cursor',
    envVar: 'CURSOR_PROJECT_DIR',
    hookEvent: 'beforeShellExecution',
    toolMatcher: 'Bash',
    statusline: true,
    promptSizeAware: true
  },
  codex: {
    displayName: 'Codex',
    dirName: '.codex',
    envVar: 'CODEX_PROJECT_DIR',
    // The only snake_case event and the only `shell` matcher in the set.
    hookEvent: 'pre_tool_use',
    toolMatcher: 'shell',
    // Codex has no statusline UI and opts out of the G9 hook — the only
    // `false` in either column. Both are claimed, so both are pinned.
    statusline: false,
    promptSizeAware: false
  },
  hermes: {
    displayName: 'Hermes',
    dirName: '.hermes',
    envVar: 'HERMES_PROJECT_DIR',
    hookEvent: 'PreToolUse',
    toolMatcher: 'Bash',
    statusline: true,
    promptSizeAware: true
  },
  openclaw: {
    displayName: 'OpenClaw',
    dirName: '.openclaw',
    envVar: 'OPENCLAW_PROJECT_DIR',
    hookEvent: 'PreToolUse',
    toolMatcher: 'Bash',
    statusline: true,
    promptSizeAware: true
  },
  qoder: {
    displayName: 'Qoder',
    dirName: '.qoder',
    envVar: 'QODER_PROJECT_DIR',
    hookEvent: 'PreToolUse',
    toolMatcher: 'Bash',
    statusline: true,
    promptSizeAware: true
  },
  'tongyi-lingma': {
    displayName: 'Tongyi Lingma',
    // NOTE: the dirName is `.lingma`, not the `tongyi-lingma` the id would
    // suggest — the one row in this table where the id and the directory
    // disagree, and therefore the row a "derive it from the id" refactor
    // would silently break.
    dirName: '.lingma',
    envVar: 'TONGYI_LINGMA_PROJECT_DIR',
    hookEvent: 'PreToolUse',
    toolMatcher: 'Bash',
    statusline: true,
    promptSizeAware: true
  },
  zcode: {
    displayName: 'z-code',
    dirName: '.zcode',
    envVar: 'ZCODE_PROJECT_DIR',
    hookEvent: 'PreToolUse',
    toolMatcher: 'Bash',
    statusline: true,
    promptSizeAware: true
  }
};

/** The vendor variable each adapter reads a caller id from, by convention. */
function vendorSessionVar(ide: IdeId): string {
  return `${ide.toUpperCase().replace(/-/g, '_')}_SESSION_ID`;
}

describe('Scenario: behavior — every registered adapter declares the shape it is pinned to', () => {
  for (const ide of EXPECTED_ORDER) {
    it(`when the ${ide} adapter is read, should match its whole declared row`, () => {
      // given: the adapter the registry hands every consumer
      const adapter: IdeAdapter = getAdapter(ide);
      const expected = EXPECTED_SHAPE[ide];

      // when / then: id and display name
      expect(adapter.id).toBe(ide);
      expect(adapter.displayName).toBe(expected.displayName);

      // and: the four "uneliminable" per-IDE strings
      expect(adapter.settings.dirName).toBe(expected.dirName);
      expect(adapter.envVar).toBe(expected.envVar);
      expect(adapter.hookEvent).toBe(expected.hookEvent);
      expect(adapter.toolMatcher).toBe(expected.toolMatcher);

      // and: the settings file name is uniform — asserted anyway, because
      // "uniform" is a claim like any other
      expect(adapter.settings.settingsFileName).toBe('settings.json');

      // and: the capability + gate opt-in flags
      expect(adapter.capabilities.gateEnforce).toBe(true);
      expect(adapter.capabilities.statusline).toBe(expected.statusline);
      expect(adapter.promptSizeAware).toBe(expected.promptSizeAware);

      // and: a sub-agent dispatcher is wired, and it identifies as this IDE
      // or as an explicitly-shared placeholder (asserted in full by
      // tests/unit/services/dispatch/sub-agent-dispatchers.test.ts)
      expect(adapter.subAgentDispatcher.label.length).toBeGreaterThan(0);
    });
  }

  it('when the registry is enumerated, should hold exactly the pinned nine, in order', () => {
    // given: the single source of truth every consumer reads through
    // when / then: a tenth adapter cannot appear without a decision here
    expect([...listAdapterIds()]).toEqual([...EXPECTED_ORDER]);
  });

  it('when an unregistered id is resolved leniently, should return undefined rather than a stand-in adapter', () => {
    // given: `detectIdeFromEnv` can yield 'opencode', which has no adapter
    // when / then: the non-throwing twin reports absence; it must NOT hand
    // back some other IDE's adapter (which is what a `?? claudeCode` fallback
    // inside the registry would do)
    expect(tryGetAdapter('opencode')).toBeUndefined();
    expect(tryGetAdapter('')).toBeUndefined();
    expect(tryGetAdapter('claude-code')).toBeDefined();
  });

  it('when an unregistered id is resolved strictly, should refuse and name the registered set', () => {
    // given: the throwing twin
    // when: an unknown id is requested
    // then: the error enumerates the registry, so a reader does not have to
    // find the registry to learn the accepted values
    expect(() => getAdapter('opencode' as IdeId)).toThrow(/Unsupported IDE: opencode/);
    expect(() => getAdapter('opencode' as IdeId)).toThrow(/claude-code, trae, cursor/);
  });
});

describe('Scenario: behavior — the nine declarations stay mutually distinct where they must', () => {
  it('when the directory names are collected, should be nine distinct values', () => {
    // The "fill the table" pattern invites copying a row. A copied row that
    // keeps the source's `dirName` makes two IDEs share one settings
    // directory — the install for one then lands in the other's file.
    const dirNames = EXPECTED_ORDER.map((ide) => getAdapter(ide).settings.dirName);
    expect(new Set(dirNames).size).toBe(EXPECTED_ORDER.length);
  });

  it('when the project-root env vars are collected, should be nine distinct values', () => {
    // `detectIdeFromContext` returns the FIRST registered adapter whose
    // envVar is present. Two adapters sharing a variable name makes the
    // later one unreachable, silently.
    const envVars = EXPECTED_ORDER.map((ide) => getAdapter(ide).envVar);
    expect(new Set(envVars).size).toBe(EXPECTED_ORDER.length);
  });

  it('when the display names are collected, should be nine distinct values', () => {
    // These are what `peaks hooks install` prints back; a duplicate is
    // indistinguishable to the user from the wrong IDE being targeted.
    const names = EXPECTED_ORDER.map((ide) => getAdapter(ide).displayName);
    expect(new Set(names).size).toBe(EXPECTED_ORDER.length);
  });

  it('when the machine-local settings layer is asked for, should be declared by claude-code alone', () => {
    // `localSettingsFileName` is the layer a per-OS value can be written to
    // without committing it for teammates — the Windows hook `shell` pin
    // (`resolveHookShell('win32') === 'powershell'`) is the live example.
    // Asserting the EXACT set is the point: if a second adapter starts
    // declaring it, the pin's reach widened and that is a decision, not a
    // detail.
    const declaring = EXPECTED_ORDER.filter(
      (ide) => getAdapter(ide).settings.localSettingsFileName !== undefined
    );
    expect(declaring).toEqual(['claude-code']);
    expect(getAdapter('claude-code').settings.localSettingsFileName).toBe('settings.local.json');
  });

  it('when the compact profile is asked for, should be declared by claude-code alone', () => {
    // The other eight fall back to `llm-self-compress` (no profile = no
    // compact capability). A second profile appearing changes which IDE the
    // auto-compact dispatcher will try to drive itself — a capability claim.
    const declaring = EXPECTED_ORDER.filter((ide) => getAdapter(ide).compact !== undefined);
    expect(declaring).toEqual(['claude-code']);
    expect(getAdapter('claude-code').compact).toMatchObject({
      compactPathway: 'ide-native',
      envVarForContextPercent: 'CLAUDE_CONTEXT_USAGE_PERCENT',
      autoCompactWindowEnvVar: 'CLAUDE_CODE_AUTO_COMPACT_WINDOW'
    });
  });
});

describe('Scenario: behavior — caller id resolves from the adapter own vendor signal, never a sibling one', () => {
  it('when PEAKS_CALLER_ID is set, should win for every adapter over its own vendor variable', () => {
    // given: the vendor-neutral override, set alongside each adapter's own
    //        signal — the override must take precedence, not merely be read
    for (const ide of EXPECTED_ORDER) {
      const env = { PEAKS_CALLER_ID: 'neutral-1', [vendorSessionVar(ide)]: 'vendor-1' };
      expect(getAdapter(ide).resolveCallerId(env)).toBe('neutral-1');
    }
  });

  it('when only the adapter own vendor variable is set, should resolve to it for every adapter', () => {
    for (const ide of EXPECTED_ORDER) {
      expect(getAdapter(ide).resolveCallerId({ [vendorSessionVar(ide)]: 'sess-9' })).toBe('sess-9');
    }
  });

  it('when only a SIBLING adapter vendor variable is set, should refuse for every adapter', () => {
    // The cross-vendor case. A row copied from another adapter keeps reading
    // THAT adapter's session variable, so under a Codex install the caller
    // id would be a Trae session id — a foreign identity accepted as this
    // one. 72 ordered pairs, none of which may resolve.
    const leaks: string[] = [];
    for (const ide of EXPECTED_ORDER) {
      for (const other of EXPECTED_ORDER) {
        if (other === ide) continue;
        const env = { [vendorSessionVar(other)]: 'foreign-session' };
        try {
          const resolved = getAdapter(ide).resolveCallerId(env);
          leaks.push(`${ide} accepted ${other}'s variable as ${JSON.stringify(resolved)}`);
        } catch {
          // expected
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it('when nothing is set, should refuse with a typed PEAKS_CALLER_NOT_RESOLVED naming the adapter', () => {
    for (const ide of EXPECTED_ORDER) {
      const adapter = getAdapter(ide);
      let thrown: unknown;
      try {
        adapter.resolveCallerId({});
      } catch (error) {
        thrown = error;
      }
      // then: a typed code the CLI can branch on (not a bare Error)
      expect(thrown, `${ide} did not refuse an empty env`).toBeInstanceOf(Error);
      expect((thrown as { code?: string }).code).toBe('PEAKS_CALLER_NOT_RESOLVED');
      // and: the message identifies which vendor failed to signal, so a user
      // on that IDE knows which variable their install did not export
      expect((thrown as Error).message).toContain('PEAKS_CALLER_NOT_RESOLVED');
      expect((thrown as Error).message.toLowerCase()).toContain(
        ide === 'zcode' ? 'z-code' : adapter.displayName.toLowerCase()
      );
    }
  });

  it('when the vendor signal is blank or malformed, should refuse rather than resolve it', () => {
    // given: values that pass an emptiness check but are not usable ids
    const bad = ['   ', 'has space', 'semi;colon', 'a'.repeat(201)];
    for (const value of bad) {
      const ide: IdeId = 'trae';
      const thrownCode = (() => {
        try {
          getAdapter(ide).resolveCallerId({ TRAE_SESSION_ID: value });
          return null;
        } catch (error) {
          return (error as { code?: string }).code;
        }
      })();
      expect(thrownCode, `${JSON.stringify(value)} was accepted`).toBe('PEAKS_CALLER_NOT_RESOLVED');
    }
  });

  it('when a caller id sits exactly on the length boundary, should accept 200 characters and refuse 201', () => {
    // given: the pinned `{1,200}` window. Both sides are asserted, because a
    // one-sided check passes for an unbounded pattern too.
    const atLimit = 'b'.repeat(200);
    const overLimit = 'b'.repeat(201);
    expect(getAdapter('trae').resolveCallerId({ TRAE_SESSION_ID: atLimit })).toBe(atLimit);
    expect(() => getAdapter('trae').resolveCallerId({ TRAE_SESSION_ID: overLimit })).toThrow(
      /PEAKS_CALLER_NOT_RESOLVED/
    );
  });

  it('when the env argument is omitted, should read process.env rather than throw on undefined', () => {
    // given: the optional-argument path every CLI call site takes
    withEnv('PEAKS_CALLER_ID', undefined);
    withEnv('TRAE_SESSION_ID', undefined);

    // when / then: with both signals absent from the real environment the
    // adapter still refuses in a typed way (it must not read
    // `undefined[e.TRAE_SESSION_ID]` and die with a TypeError)
    expect(() => getAdapter('trae').resolveCallerId()).toThrow(/PEAKS_CALLER_NOT_RESOLVED/);

    // and: with one present it resolves from the live environment, i.e. the
    // omitted argument really does mean `process.env`
    withEnv('TRAE_SESSION_ID', 'from-process-env');
    expect(getAdapter('trae').resolveCallerId()).toBe('from-process-env');
  });
});
