// tests/unit/ide/zcode-adapter-probe.test.ts
//
// Slice 2026-09-15-s9-platform-vendor-coverage, D6 — the zcode adapter is the
// one built-in adapter whose surface is not a "fill the table" row: `zcode` is
// a desktop app with no CLI binary, so its adapter carries a runtime probe
// (`detectCurrentModel`) that reads `~/.zcode/v2/config.json` and resolves the
// active provider. That probe — `defaultZcodeConfigPath`, `readZcodeConfig`,
// `resolveZcodeCurrentModel`, `detectZcodeCurrentModel` — was referenced by
// ZERO tests before this file, while the four-step priority chain it documents
// (P1 env override → P2 non-builtin provider → P3 first enabled → P4 first) is
// exactly the kind of ordered resolution that silently reorders.
//
// The chain is asserted step by step, from the bottom up, because a case that
// only proves "it returns something" cannot tell a working chain from one that
// always answers with its last resort.
//
// Dimensions covered:
//   - behavior:    the priority chain over in-memory config objects
//   - integration: a real config file on a real fs, located through
//                  `PEAKS_ZCODE_CONFIG_PATH`, with real `process.env`
//   - render:      omitted — the probe returns a model id, it renders nothing
//   - a11y:        omitted — no human-facing surface; a missing or corrupt
//                  config is a documented `undefined`, not a message

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { withEnv } from '../_setup/io.js';

// `homedir` is mocked (the ESM namespace is frozen, so a spy is impossible)
// so the DEFAULT config path is a tmp tree this file owns. That is what makes
// the "empty override falls back to the default" case assertable: without a
// controlled home, the only honest assertion about the real `~/.zcode/v2`
// would be "whatever this machine happens to have", which cannot fail.
const __home = vi.hoisted(() => ({ value: '' }));
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => __home.value };
});

const { defaultZcodeConfigPath, detectZcodeCurrentModel, resolveZcodeCurrentModel } =
  await import('../../../src/services/ide/adapters/zcode-adapter.js');

declareDimensions(
  'tests/unit/ide/zcode-adapter-probe.test.ts',
  ['behavior', 'integration'],
  [
    { dim: 'render', reason: 'the probe returns a model id; it renders nothing' },
    { dim: 'a11y', reason: 'a missing or corrupt config is a documented undefined, not a message' }
  ]
);

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-zcode-probe-'));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  __home.value = makeTmpDir();
});

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

/** Write a config file at the DEFAULT location under the mocked home. */
function writeDefaultConfig(contents: unknown): string {
  const path = join(__home.value, '.zcode', 'v2', 'config.json');
  mkdirSync(join(__home.value, '.zcode', 'v2'), { recursive: true });
  writeFileSync(path, JSON.stringify(contents), 'utf8');
  return path;
}

/** A `provider` map in the shape z-code writes it. */
function configWith(provider: Record<string, unknown>): unknown {
  return { provider };
}

describe('Scenario: behavior — the resolution chain walks its four steps in order', () => {
  it('when no provider block is present, should return undefined', () => {
    // given: the three shapes a config can have without providers
    // when / then: each is undefined rather than a throw or a fallback id
    expect(resolveZcodeCurrentModel(undefined)).toBeUndefined();
    expect(resolveZcodeCurrentModel(null)).toBeUndefined();
    expect(resolveZcodeCurrentModel({})).toBeUndefined();
    expect(resolveZcodeCurrentModel({ provider: null })).toBeUndefined();
    expect(resolveZcodeCurrentModel({ provider: 'not-an-object' })).toBeUndefined();
    expect(resolveZcodeCurrentModel({ provider: {} })).toBeUndefined();
  });

  it('when P1 matches an env-pinned provider uuid, should return that provider first model', () => {
    // given: a pinned uuid and a config where P2 would answer differently
    const config = configWith({
      'user-uuid-1': { models: { 'model-from-p2': {} } },
      'pinned-uuid': { models: { 'model-from-p1': {} } }
    });

    // when / then: the pin wins — P1 outranks the non-builtin preference
    expect(resolveZcodeCurrentModel(config, 'pinned-uuid')).toBe('model-from-p1');
  });

  it('when the env pin names no provider, should fall through to P2 rather than give up', () => {
    // given: a uuid that is not in the config at all
    const config = configWith({ 'user-uuid-1': { models: { 'model-from-p2': {} } } });

    // when / then: an unknown pin is not an error — the chain continues
    expect(resolveZcodeCurrentModel(config, 'uuid-not-present')).toBe('model-from-p2');
  });

  it('when the env pin is an empty string, should be treated as absent', () => {
    // The reader passes `process.env.PEAKS_ZCODE_ACTIVE_PROVIDER_UUID`, which
    // is `''` — not `undefined` — on many shells for an exported-but-empty
    // variable. `''` must not be looked up as a provider uuid.
    const config = configWith({ 'user-uuid-1': { models: { 'model-from-p2': {} } } });
    expect(resolveZcodeCurrentModel(config, '')).toBe('model-from-p2');
  });

  it('when P2 applies, should skip builtin-prefixed providers and take the first user provider', () => {
    // given: builtins listed BEFORE the user-installed provider — the shape
    // z-code actually writes
    const config = configWith({
      'builtin:anthropic': { models: { 'builtin-model': {} } },
      'user-uuid-1': { models: { 'user-model-1': {} } },
      'user-uuid-2': { models: { 'user-model-2': {} } }
    });

    // when / then: the prefix, not the position, decides
    expect(resolveZcodeCurrentModel(config)).toBe('user-model-1');
  });

  it('when every provider is builtin, should fall to P3 and take the first ENABLED one', () => {
    // given: no user provider, so P2 has nothing to return
    const config = configWith({
      'builtin:a': { enabled: false, models: { 'disabled-model': {} } },
      'builtin:b': { enabled: true, models: { 'enabled-model': {} } },
      'builtin:c': { enabled: true, models: { 'later-enabled-model': {} } }
    });

    // when / then: `enabled: true` is the discriminator, and insertion order
    // breaks the tie between the two enabled ones
    expect(resolveZcodeCurrentModel(config)).toBe('enabled-model');
  });

  it('when no provider is enabled, should fall to P4 and take the first one at all', () => {
    // given: the last resort — every provider disabled
    const config = configWith({
      'builtin:a': { enabled: false, models: { 'first-model': {} } },
      'builtin:b': { enabled: false, models: { 'second-model': {} } }
    });

    // when / then: P4 answers instead of returning undefined, which is what
    // makes a fresh / legacy install usable
    expect(resolveZcodeCurrentModel(config)).toBe('first-model');
  });

  it('when a provider has no usable models, should be skipped by every step', () => {
    // given: providers whose `models` is missing, empty or the wrong shape
    const unusable = configWith({
      'builtin:a': {},
      'builtin:b': { models: {} },
      'builtin:c': { models: 'nope' },
      'builtin:d': { models: null }
    });
    expect(resolveZcodeCurrentModel(unusable)).toBeUndefined();

    // and: with one usable provider after them, the chain reaches it rather
    // than stopping on the first provider
    const mixed = configWith({
      'builtin:a': {},
      'builtin:b': { enabled: true, models: {} },
      user: { models: { 'real-model': {} } }
    });
    expect(resolveZcodeCurrentModel(mixed)).toBe('real-model');
  });

  it('when the first model key is blank, should skip it and take the next', () => {
    // given: an insertion order whose first key is whitespace
    // when / then: a blank key is not a model id — and the key is returned
    // TRIMMED, so a padded key does not leak padding into the model name
    expect(
      resolveZcodeCurrentModel(configWith({ user: { models: { '   ': {}, 'real-model': {} } } }))
    ).toBe('real-model');
    expect(
      resolveZcodeCurrentModel(configWith({ user: { models: { '  padded-model  ': {} } } }))
    ).toBe('padded-model');
  });
});

describe('Scenario: integration — the probe reads a real config file at the path it is told', () => {
  it('when the config path is overridden, should resolve the model from that file', async () => {
    // given: a config file on disk with one user provider
    const path = join(makeTmpDir(), 'config.json');
    writeFileSync(
      path,
      JSON.stringify(configWith({ 'user-uuid-1': { models: { 'disk-model': {} } } })),
      'utf8'
    );
    withEnv('PEAKS_ZCODE_CONFIG_PATH', path);
    withEnv('PEAKS_ZCODE_ACTIVE_PROVIDER_UUID', undefined);

    // when / then
    await expect(detectZcodeCurrentModel()).resolves.toBe('disk-model');
  });

  it('when the pinned provider uuid is exported, should resolve through P1 from the real environment', async () => {
    // given: a config whose P2 answer differs from the pinned provider's
    const path = join(makeTmpDir(), 'config.json');
    writeFileSync(
      path,
      JSON.stringify(
        configWith({
          'user-uuid-1': { models: { 'p2-model': {} } },
          'pinned-uuid': { models: { 'p1-model': {} } }
        })
      ),
      'utf8'
    );
    withEnv('PEAKS_ZCODE_CONFIG_PATH', path);
    withEnv('PEAKS_ZCODE_ACTIVE_PROVIDER_UUID', 'pinned-uuid');

    // when / then: the whole point of the probe is that this env var reaches
    // the resolver — asserted end to end, not at the pure function only
    await expect(detectZcodeCurrentModel()).resolves.toBe('p1-model');
  });

  it('when the config file is missing, should return undefined rather than throw', async () => {
    // given: a path that does not exist
    withEnv('PEAKS_ZCODE_CONFIG_PATH', join(makeTmpDir(), 'absent.json'));

    // when / then: the cross-IDE contract is `undefined`, and a throw here
    // would reach `peaks ide model --current` as a crash on a machine with
    // z-code installed but never launched
    await expect(detectZcodeCurrentModel()).resolves.toBeUndefined();
  });

  it('when the config file is present but corrupt, should return undefined', async () => {
    // given: a truncated write (the crash-during-write shape)
    const path = join(makeTmpDir(), 'config.json');
    writeFileSync(path, '{"provider": {"user-uuid-1": {"models"', 'utf8');
    withEnv('PEAKS_ZCODE_CONFIG_PATH', path);

    // when / then: a parse failure is swallowed by contract, not propagated
    await expect(detectZcodeCurrentModel()).resolves.toBeUndefined();
  });

  it('when no path override is set, should probe the documented default location', () => {
    // given: the default the probe falls back to
    // when / then: it is under the user home, at the pinned `.zcode/v2`
    // layout — asserted with `join` so the expectation is built the same way
    // on Windows and on POSIX
    expect(defaultZcodeConfigPath()).toBe(join(__home.value, '.zcode', 'v2', 'config.json'));
  });

  it('when no path override is set, should resolve from the default location itself', async () => {
    // given: a config at the DEFAULT path, and no override
    writeDefaultConfig(configWith({ user: { models: { 'default-path-model': {} } } }));
    withEnv('PEAKS_ZCODE_CONFIG_PATH', undefined);
    withEnv('PEAKS_ZCODE_ACTIVE_PROVIDER_UUID', undefined);

    // when / then: the probe reads there, not somewhere else
    await expect(detectZcodeCurrentModel()).resolves.toBe('default-path-model');
  });

  it('when the override is an empty string, should fall back to the default location', async () => {
    // given: an exported-but-empty override, which must NOT be read as the
    // path `''` (that would make every probe report a missing config)
    writeDefaultConfig(configWith({ user: { models: { 'default-path-model': {} } } }));
    withEnv('PEAKS_ZCODE_CONFIG_PATH', '');
    withEnv('PEAKS_ZCODE_ACTIVE_PROVIDER_UUID', undefined);

    // when / then: it resolves from the default path, so the empty value was
    // treated as absent
    await expect(detectZcodeCurrentModel()).resolves.toBe('default-path-model');
  });
});
