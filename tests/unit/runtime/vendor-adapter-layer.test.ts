// tests/unit/runtime/vendor-adapter-layer.test.ts
//
// Slice 2026-09-15-s9-platform-vendor-coverage, D8 — three layers in this repo
// export a class named `CodexAdapter` / `CopilotAdapter`, and until this test
// nothing said which one is live:
//
//   1. `src/services/runtime/vendors/<vendor>.ts`
//        `class CodexAdapter implements VendorAdapter`
//        LIVE — the built-in list `RuntimeService` is constructed with.
//   2. `packages/peaks-loop-internal-runtime/src/vendor/<vendor>-adapter.ts`
//        a second `CodexAdapter`, different surface, for the dispatched
//        sub-agent runtime. LIVE — its package's public index exports it.
//   3. `src/services/adapter/{codex,copilot}-adapter.ts`
//        a third pair, every method throws `ADAPTER_NOT_IMPLEMENTED`.
//        UNREFERENCED — zero importers in `src/`, `tests/`, `packages/`,
//        `scripts/`. Layer 3 sits INSIDE the directory that also holds the
//        LIVE `adapter-registry.ts` (imported by three CLI command modules),
//        which is what makes the wrong pick so easy to make.
//
// This file does not assert prose about any of that. It asserts the
// DIFFERENCE that makes layer 1 live and layer 3 dead, in one observation:
// given the same environment, the live adapters answer and the placeholders
// do not.
//
// Dimensions covered:
//   - behavior:    the same vendor signal drives the live adapter to `true`
//                  and leaves the same-named placeholder at `false`; every
//                  other placeholder method raises its typed error
//   - integration: a real tmp dir on a real fs + real `process.env`
//                  (`withEnv`), read by the real `RuntimeService`
//   - render:      omitted — the only rendered surface asserted here is the
//                  typed error's text, which the a11y scenario owns
//   - a11y:        the typed error names vendor AND method, so a reader who
//                  lands on a placeholder can tell which layer raised it

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { declareDimensions } from '../_setup/4dim-template.js';
import { withEnv } from '../_setup/io.js';
import { RuntimeService } from '../../../src/services/runtime/runtime-service.js';
import { ADAPTER_NOT_IMPLEMENTED } from '../../../src/services/adapter/adapter.js';
import { CodexAdapter as PlaceholderCodex } from '../../../src/services/adapter/codex-adapter.js';
import { CopilotAdapter as PlaceholderCopilot } from '../../../src/services/adapter/copilot-adapter.js';

declareDimensions(
  'tests/unit/runtime/vendor-adapter-layer.test.ts',
  ['behavior', 'integration', 'a11y'],
  [{ dim: 'render', reason: 'the only rendered surface here is the typed error text, asserted under a11y' }],
);

const tmpDirs: string[] = [];
function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'peaks-vendor-layer-'));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe('Scenario: behavior — the live layer is the one that answers the environment', () => {
  it('when CODEX_HOME points at a real dir, should drive the live codex adapter to true and the same-named placeholder to false', async () => {
    // given: a vendor signal that only an implementation can honour
    const home = makeTmpDir();
    withEnv('CODEX_HOME', home);

    // when: both classes of the same name are asked about the same env
    const live = await new RuntimeService().getBuiltInAdapter('codex')?.detect();
    const placeholder = await new PlaceholderCodex({ home }).detect();

    // then: they disagree — which is the difference the name hides
    expect(live).toBe(true);
    expect(placeholder).toBe(false);
  });

  it('when GITHUB_COPILOT is set, should drive the live copilot adapter to true and the same-named placeholder to false', async () => {
    // given: the copilot vendor signal (a different spelling from codex's —
    //        a flag, not a path, so a shared detector would not pass both)
    withEnv('GITHUB_COPILOT', '1');

    // when / then
    const live = await new RuntimeService().getBuiltInAdapter('copilot')?.detect();
    const placeholder = await new PlaceholderCopilot({ home: makeTmpDir() }).detect();
    expect(live).toBe(true);
    expect(placeholder).toBe(false);
  });

  it('when the live layer is enumerated, should hold exactly the three vendor ids it claims', () => {
    // given: the built-in list every `peaks runtime compact --via <id>` call
    //        falls back to (after the user-registry miss)
    // when / then: the ids are pinned, so wiring a placeholder in here — the
    //        exact confusion this slice is about — turns this red
    const service = new RuntimeService();
    expect(service.listBuiltInAdapters().map((a) => a.id)).toEqual(['claude-code', 'codex', 'copilot']);
    expect(service.listBuiltInAdapters().map((a) => a.displayName)).toEqual([
      'Claude Code',
      'Codex',
      'GitHub Copilot',
    ]);
  });

  it('when a placeholder method is called, should raise ADAPTER_NOT_IMPLEMENTED rather than a vague failure', async () => {
    // given: the placeholder pair, constructed the way its own constructor asks
    const codex = new PlaceholderCodex({ home: makeTmpDir() });
    const copilot = new PlaceholderCopilot({ home: makeTmpDir() });

    // when / then: every non-detect method is a typed refusal. Asserting the
    // CLASS (not the message text) is what keeps this stable across slices
    // while still failing if a placeholder is silently promoted to a real
    // implementation without the layers being reconciled.
    //
    // Note the empty argument lists. The placeholders declare their methods
    // with NO parameters — not the `Adapter` interface's signatures, which is
    // the other half of why they cannot be mistaken for an implementation of
    // it. Calling them as the interface would want does not type-check, and
    // that mismatch is deliberate here rather than worked around.
    await expect(codex.resolveScratchDir()).rejects.toBeInstanceOf(ADAPTER_NOT_IMPLEMENTED);
    await expect(codex.materialize()).rejects.toBeInstanceOf(ADAPTER_NOT_IMPLEMENTED);
    await expect(codex.publish()).rejects.toBeInstanceOf(ADAPTER_NOT_IMPLEMENTED);
    await expect(codex.activate()).rejects.toBeInstanceOf(ADAPTER_NOT_IMPLEMENTED);
    await expect(codex.cleanup()).rejects.toBeInstanceOf(ADAPTER_NOT_IMPLEMENTED);
    await expect(copilot.resolveScratchDir()).rejects.toBeInstanceOf(ADAPTER_NOT_IMPLEMENTED);
    await expect(copilot.materialize()).rejects.toBeInstanceOf(ADAPTER_NOT_IMPLEMENTED);
    await expect(copilot.publish()).rejects.toBeInstanceOf(ADAPTER_NOT_IMPLEMENTED);
    await expect(copilot.activate()).rejects.toBeInstanceOf(ADAPTER_NOT_IMPLEMENTED);
    await expect(copilot.cleanup()).rejects.toBeInstanceOf(ADAPTER_NOT_IMPLEMENTED);
  });
});

describe('Scenario: integration — the placeholder pair carries the same NAME as the live classes, and nothing more', () => {
  it('when the live and placeholder codex classes are compared, should share a constructor name but not an identity', () => {
    // given: the name collision this slice records
    // when: the live built-in and the placeholder are both in hand
    const live = new RuntimeService().getBuiltInAdapter('codex');

    // then: same name, different class. That pair is the whole collision:
    // a grep for `CodexAdapter` cannot tell the reader which is live, and
    // the name does not carry a discriminator. If a future slice re-exports
    // the placeholder THROUGH the live module (or the reverse), these become
    // the same constructor and the layers must be reconciled before this
    // can pass again.
    expect(PlaceholderCodex.name).toBe('CodexAdapter');
    expect(live).toBeDefined();
    expect(live).not.toBeInstanceOf(PlaceholderCodex);
    expect(live?.constructor.name).toBe(PlaceholderCodex.name);
    expect(live?.constructor).not.toBe(PlaceholderCodex);
  });
});

describe('Scenario: a11y — the refusal names the layer it came from', () => {
  it('when a placeholder refuses, should name its vendor and its method in the message', async () => {
    // given: a reader who grepped `CodexAdapter` and landed on a placeholder
    const codex = new PlaceholderCodex({ home: makeTmpDir() });

    // when: the refusal is caught
    const error = await codex.resolveScratchDir().then(
      () => null,
      (e: unknown) => e as Error,
    );

    // then: both the vendor and the method are in the text, and the text
    // says it is a stub — so the reader can tell it apart from a live
    // adapter's real failure (a missing binary reports exitCode 127, it does
    // not throw this).
    expect(error).toBeInstanceOf(ADAPTER_NOT_IMPLEMENTED);
    expect(error?.message).toContain('codex');
    expect(error?.message).toContain('resolveScratchDir');
    expect(error?.message).toContain('stub');
  });
});
