// tests/unit/runtime/vendor-neutral-identity-guard-scope-controls.test.ts
//
// The re-injection and SCOPE half of `vendor-neutral-identity-guard.test.ts`,
// moved VERBATIM into this sibling for the C wave 7 file-size split (rid
// 2026-10-01-c-wave7-excess-w7-4). Nothing here was rewritten: same fixtures,
// same assertion literals, same expected line numbers.
//
// This file carries the guard's LIMITS list (below) because these cases are the
// ones that pin it: limit 1 (`hasHookSpec`'s id-keyed table), limit 6 (a
// non-consumer file is invisible to shapes 2/3 — the `shapes 2/3 are scoped`
// case), limit 7 (the value positions shape 2 skips by name) and limit 12 (the
// three import forms `isRegistryConsumer` matches) are each exercised here
// rather than left as prose.
//
// WHAT THIS FILE DEPENDS ON: `isRegistryConsumer` decides whether shapes 2/3 run
// on a file at all, so the four scope cases below are the guard's own reach
// check. The tree they are measured against is built once, in
// `vendor-neutral-identity-guard-shapes.ts`, from the walk in
// `vendor-neutral-identity-guard-reach.ts`.

//
// ---------------------------------------------------------------------------
// WHAT THIS GUARD DOES NOT CATCH — read before treating vendor neutrality as
// proven. This list is the guard's LIMIT, not a disclaimer.
//
//   1. Indirect identity. `IDE_IDS.has(ide)`, `['trae'].includes(ide)`, a
//      `Record<IdeId, X>` index, a `Map.get`, or `if (ide in SPECIAL)` all
//      decide vendor identity and all pass. This is why shape 2 excludes
//      array elements and property KEYS: an id list or an id-keyed table is
//      the same hole as `.has(ide)` until something indexes it.
//      Live instance, indexed: `hasHookSpec` in
//      `src/services/skills/hooks-codegate-superpowers.ts` —
//      `HOOK_COMMAND_BY_IDE[ide] !== undefined`, an `IdeId`-keyed table read
//      by the ide. NEITHER side is a literal, so no shape here sees it; it is
//      in fact the table that makes 6 of limit 7(d)'s sites invisible too.
//      (The instance this limit used to name —
//      `IDES_WITH_LOCAL_SETTINGS.has(ide)` in `hooks-settings-service.ts` —
//      was REMOVED in the 2026-09-13 revision, not by a new check but by
//      replacing the set with the adapter's own `localSettingsFileName`
//      declaration. Closing this hole was a source change, not a guard
//      change: only the source knows whether an identity test has a
//      declaration behind it.)
//   2. A value that is an IDE id but is not NAME-reachable — for shape 1 the
//      non-literal side may now be ANY expression, so this limit is gone for
//      comparisons. It remains for shape 2: `const d = detectIdeFromEnv();
//      ide = d; ide: d` is not a literal and is not a hit.
//   3. Non-literal on both sides: `ide === SOME_CONST`, `ide === ids[0]`.
//      The literal must appear. Unchanged by the fold: a `+` chain has to be
//      entirely literal to fold, so `'claude' + SUFFIX` is still invisible.
//   4. Files outside `SCAN_ROOTS`. THIS LIMIT IS ABOUT EXTENSIONS, NOT
//      DIRECTORIES — the previous revision said "NOT scanned: `packages/**`,
//      `examples/**`, `dist/**`", which named three directories and hid the
//      one that actually mattered: a SHIPPED `.js` file under a SCANNED
//      directory.
//      Scanned, by extension:
//        - `src/**/*.ts`, and `src/**/*.js`
//        - `scripts/**/*.{mjs,cjs,js}`
//      NOT scanned, and why each is not:
//        - `src/**/*.{tsx,jsx,mts,cts}` — no such file exists under `src/`
//          today. A new one would be invisible until this list changes.
//        - `scripts/**/*.mts` — the two that exist
//          (`_release-shared.d.mts`, `release-pack.d.mts`) are AMBIENT
//          DECLARATION files: types only, no runtime code, so nothing in them
//          can decide an identity. Scanned anyway? No: parsing `.d.mts` as
//          TS would contribute nothing and pretending otherwise would inflate
//          the walk without covering a decision.
//        - `scripts/**/*.{sh,ps1}`, `src/**/*.sh` — shell, unparsed.
//        - `packages/**` (including `packages/peaks-loop-mut/**`, a separate
//          workspace with its own tsconfig), `examples/**`.
//        - generated `dist/**` (its ids are copies of `src/`, so scanning it
//          would double every count).
//      WHY `src/**/*.js` WAS ADDED (2026-09-13): `src/` is not all-TypeScript.
//      At the time it held exactly ONE `.js` file — `src/services/hooks/
//      write-gate.js`, the Write|Edit|MultiEdit PreToolUse hook documented in
//      `.claude/HOOKS.md`, i.e. the very handler that ran on every edit of this
//      repo. It sat outside every shape of this guard for no reason but its
//      extension, so the extension was added.
//      WHY IT IS STILL HERE (2026-09-16, slice 2026-09-15-s10-misc-cleanup):
//      that file was DELETED — it was an installed handler that abstained on
//      every path, so the installation was the defect, not the abstention.
//      `src/` therefore holds NO `.js` file at all today and this extension has
//      no subject; it matches nothing and costs nothing. It is retained on
//      purpose rather than retired with its one subject: the blind spot it
//      closed was "a file invisible to every shape of this guard because of its
//      extension", which is a property of the ROOT, not of one file. A `.js`
//      dropped into `src/` tomorrow is walked from the moment it lands rather
//      than from the moment someone remembers this paragraph.
//      The anti-silence test no longer names the deleted file. An anti-silence
//      assertion that named it would turn its deliberate removal into a red
//      suite — i.e. it would demand the thing be kept alive to satisfy the test
//      that watches over it, which is the pattern this job exists to remove.
//      The `scripts/**` root was added in the same revision for the same
//      class of reason: that file SHIPS (`package.json#files` lists
//      `scripts/install-skills.mjs`) and held two live
//      `ideId === 'claude-code'` comparisons which a `src/**`-only walk could
//      not see even in principle. They are in `KNOWN_DEBT` — visible and
//      ratcheted rather than unseeable.
//   5. `src/services/ide/**` is a DIRECTORY allowlist, so it is coarse: a
//      NEW file dropped into that directory gets a blanket exemption.
//      `src/services/ide/hook-protocol.ts:63,65` and
//      `src/services/ide/hook-translator.ts:148` are per-IDE name branches
//      sitting inside that exemption today. It is a directory rather than a
//      file list because the adapter layer's whole job is per-IDE knowledge
//      and adapters are added regularly; a file list would need editing on
//      every new adapter, and the natural way to make that edit is to add
//      the new file, which teaches nothing. The trade is accepted
//      deliberately: the directory boundary is the property, so enforcing it
//      by directory is enforcing the property itself.
//   6. Shapes 2 and 3 do not apply outside registry consumers (see the scope
//      block above). A module that hardcodes `ide: 'claude-code'` or a
//      `.claude` path WITHOUT importing the registry is invisible to them.
//      CORRECTED 2026-09-13 — this entry used to end "Shape 1 still covers
//      that file's comparisons", and that sentence was FALSE as written: the
//      next revision showed that a type assertion around the literal
//      (`ide === ('claude-code' as const)`, `as string`, `<string>`) hid the
//      comparison from shape 1 too, so the escape needed BOTH conditions —
//      a wrapped literal AND a non-consumer file. Shape 1 now unfolds
//      `as`/`<T>` wrappers (`staticStringValue`), so the assertion half of
//      that conjunction is closed and the original sentence is true again for
//      every spelling of the literal. What remains uncovered in a
//      non-consumer file is the VALUE/PATH shapes only: `const x =
//      'claude-code' as const`, `const p = '.claude/settings.local.json'` —
//      an identity assertion with no comparison and no registry import. That
//      is a real residual and it is stated here rather than papered over.
//      REAL INSTANCE, tested by name: `src/services/hooks/auto-compact-hook-install.ts`
//      is on the compact path and holds `AUTO_COMPACT_HOOK_SETTINGS_PATH =
//      '.claude/settings.local.json'` as its documented default for callers
//      with no adapter in hand. Shape 3 does not cover it. The dispatcher,
//      which IS covered, must pass the adapter-derived path — so this default
//      only reaches callers that hold no adapter.
//   7. Shape 2 (`findIdeValueLiterals`) skips these positions, deliberately
//      and by name. Each is a real, live pattern that stays invisible.
//      COUNTED, NOT REMEMBERED: every count below was re-measured over the
//      scanned tree at the 2026-09-13 revision (registry consumers only,
//      adapter layer excluded) by walking the parsed tree and bucketing each
//      `staticStringValue`-reachable id by the kind and text of its parent
//      node. Two of the previous revision's counts were WRONG — (f) and (g)
//      each undercounted by one site — which is why the method is stated
//      here rather than the numbers alone:
//        a. type positions                  `type X = 'claude-code'`
//                                           (not bucketed; excluded before
//                                           the count by `isTypePosition`)
//        b. comparison operands             6 sites — owned by shape 1, not
//                                           lost: hooks-codegate-superpowers.ts
//                                           ×4, hooks-settings-service.ts,
//                                           hooks-commands.ts
//        c. `case` clauses                  0 sites today — owned by shape 1
//        d. property KEYS                   6 sites — the `HOOK_COMMAND_BY_IDE`
//                                           table in hooks-codegate-superpowers.ts
//        e. array elements                  0 sites today. Was 1
//                                           (`new Set<IdeId>(['claude-code'])`);
//                                           the 2026-09-13 revision replaced it
//                                           with the adapter declaration, so the
//                                           bucket is EMPTY, not merely smaller
//        f. ternary branches                4 sites, all the "unknown → claude-code"
//                                           default: auto-compact-dispatcher.ts:99,
//                                           auto-compact-reader.ts (×2),
//                                           context-audit.ts:353
//        g. `??` / `||` right-hand sides    7 sites, same default policy
//                                           (`detectInstalledIde(root) ?? 'claude-code'`
//                                           ×3, `options?.ide ?? 'claude-code'` ×2,
//                                           `opts.ideId ?? … ?? 'claude-code'` ×2 — the
//                                           last pair is the same shape nested twice)
//      (f) and (g) are the repo's "unknown → claude-code" DEFAULT policy; (d)
//      is an id table. The C1 defect shape 2 exists for is the opposite of a
//      default: a literal that OVERRIDES a known adapter id. If the default
//      policy itself must be enforced, that is a separate check with its own
//      scope — it is not smuggled in here.
//      Sites in `scripts/**` are NOT in these counts: that root has no
//      registry consumer, so shapes 2/3 have nothing to skip there.
//   8. Shape 3 covers only the directory names the adapters DECLARE
//      (`dirName: '.claude'`, `'.trae'`, …). A hardcoded path to some other
//      IDE-specific location (`~/.config/...`, an env-var name, a settings
//      FILENAME) is invisible. An adapter that computes its `dirName`
//      instead of writing a literal contributes no name to the set.
//      It is also PATH-SHAPED only: `.claude` inside a sentence
//      (`"install into the user-level ~/.claude/settings.json instead"`) is
//      prose and is NOT flagged — the same reason AC-1 is not a grep.
//   9. The `KNOWN_DEBT` files below are pinned VIOLATIONS, not clean files —
//      see the list for what they are and why they are not fixed here.
//  10. It says nothing about whether the ALLOWED layer is correct. An adapter
//      can hardcode its own id anywhere; that is where ids belong.
//  11. `unknown` is excluded from the id set on purpose — `x === 'unknown'`
//      is an ordinary sentinel test, not a vendor claim.
//  12. Scope is decided by a module NAMING the registry module — a static
//      `import … from`, a lazy `await import(…)`, or an `export … from`
//      re-export. Still not recognised as a consumer: a CommonJS `require`,
//      a module that reaches the registry through a SECOND-HOP barrel
//      (`a.ts` re-exports the registry, `b.ts` re-exports `a.ts`), and an
//      adapter object handed in by the caller. Shapes 2/3 skip those.
//      The re-export form was ADDED in the 2026-09-13 revision: a barrel
//      re-exporting the registry was not a consumer, so a barrel that
//      re-exported AND hardcoded an id was invisible — the round-3 injection
//      that falsified the previous revision. All four spellings are covered
//      (`export { x } from`, aliased, `export *`, `export * as ns`).
//  13. A template literal WITH substitutions is not foldable:
//      `` `${vendor}-code` `` and `` `${prefix}-compact` `` are invisible to
//      every shape, as is any runtime-assembled id (`ids.join('-')`). Only
//      fully-literal spellings fold. This is the residual of the round-3 fix;
//      no AST-only check can decide a value that is only known at runtime.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { parseSourceFile } from './vendor-neutral-identity-guard-reach.js';
import {
  findIdentityComparisons,
  findIdeValueLiterals,
  findSettingsPathLiterals,
  isRegistryConsumer
} from './vendor-neutral-identity-guard-shapes.js';

describe('vendor neutrality — IDE identity decisions outside the adapter layer (slice 2026-09-12)', () => {
  it('negative control — the five re-injection shapes this guard exists for are all detected', () => {
    // The shapes QA used to falsify the comparison-only guard, one fixture
    // each, in a file that consumes the registry (so shapes 2/3 apply). Four
    // of the five were invisible before this rewrite.
    const fixture = [
      `import { getAdapter } from '../ide/ide-registry.js';`,
      `// A: the deleted up-front gate`,
      `const a = target === 'main' && ideId !== 'claude-code';`,
      `// B: the pathway derived from the name`,
      `const b = ide === 'claude-code' ? 'ide-native' : 'llm-self-compress';`,
      `// C1: the adapter's own id replaced by a literal`,
      `const c1 = { ok: true, ide: 'claude-code', pathway: 'ide-native' };`,
      `// C2: the adapter's settings path replaced by a literal`,
      `const c2 = join(root, '.claude', 'settings.local.json');`,
      `// D: the same gate re-keyed onto the adapter object`,
      `const d = adapter.id !== 'claude-code';`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(isRegistryConsumer(parsed)).toBe(true);
    expect(findIdentityComparisons(parsed).map((h) => `${h.line}:${h.form}:${h.id}`)).toEqual([
      '3:comparison:claude-code',
      '5:comparison:claude-code',
      '11:comparison:claude-code'
    ]);
    expect(findIdeValueLiterals(parsed)).toEqual([
      { file: 'fixture.ts', line: 7, id: 'claude-code', position: 'ide:' }
    ]);
    expect(findSettingsPathLiterals(parsed).map((h) => `${h.line}:${h.text}`)).toEqual([
      '9:.claude'
    ]);
  });

  it('negative control — prose, the runtime-vendor axis and non-identity tests are NOT shape-1 hits', () => {
    const fixture = [
      "// ide === 'claude-code' used to decide this (comment, not code)",
      'const doc = "an adapter that declares ide === \'trae\' is fine";',
      "const isUnknown = ide === 'unknown';",
      'const isPresent = ide !== undefined;',
      'const byTable = IDE_SET.has(ide);',
      'const sameConst = ide === IDE_DEFAULT;'
    ].join('\n');
    expect(findIdentityComparisons(parseSourceFile('fixture.ts', fixture))).toEqual([]);
    // The runtime-vendor axis is NOT invisible any more — it is caught and
    // pinned as debt (see KNOWN_DEBT). Pinned here so nobody "restores" a
    // name filter that would silently reopen the `adapter.id` hole.
    const vendorAxis = "const vendor = obj.vendor === 'codex';";
    expect(
      findIdentityComparisons(parseSourceFile('fixture.ts', vendorAxis)).map((h) => h.id)
    ).toEqual(['codex']);
  });

  it('scope detector — a RE-EXPORT of the registry counts as consuming it', () => {
    // Round-3 injection: a module re-exporting the registry was not a consumer,
    // so shapes 2/3 skipped it — a barrel that routes per-IDE AND hardcodes an
    // id was invisible. All three re-export forms count; the alias form and
    // `export *` are the ones an `export { … } from`-only patch would miss.
    const named = `export { getAdapter } from '../ide/ide-registry.js';`;
    const aliased = `export { getAdapter as getIdeAdapter } from '../ide/ide-registry.js';`;
    const star = `export * from '../ide/ide-registry.js';`;
    const namespace = `export * as ide from '../ide/ide-registry.js';`;
    const unrelated = `export * from './auto-compact-types.js';`;
    expect(isRegistryConsumer(parseSourceFile('fixture.ts', named))).toBe(true);
    expect(isRegistryConsumer(parseSourceFile('fixture.ts', aliased))).toBe(true);
    expect(isRegistryConsumer(parseSourceFile('fixture.ts', star))).toBe(true);
    expect(isRegistryConsumer(parseSourceFile('fixture.ts', namespace))).toBe(true);
    expect(isRegistryConsumer(parseSourceFile('fixture.ts', unrelated))).toBe(false);
  });

  it('negative control — shape 2 catches `ide:` / `return` / argument values, and skips the documented positions', () => {
    const fixture = [
      `const c1 = { ide: 'claude-code' };`, // property value → caught
      `function f(): string { return 'trae'; }`, // return → caught
      `const g = h('cursor');`, // call argument → caught
      `const table: Record<string, number> = { 'claude-code': 1 };`, // property KEY → id table, excluded
      `const list = ['trae', 'cursor'];`, // array element → id table, excluded
      `const p = detected === 'unknown' ? 'claude-code' : detected;`, // default policy, excluded
      `const q = detected ?? 'claude-code';`, // default policy, excluded
      `const t = typeof x === 'string' ? 'x' : 'y';`, // no id literal at all
      `const r = ide === 'qoder';`, // comparison → owned by shape 1
      `const n = new RegExp('claude-code');` // regex from a LITERAL → still a value site
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findIdeValueLiterals(parsed).map((h) => `${h.line}:${h.position}:${h.id}`)).toEqual([
      '1:ide::claude-code',
      '2:return:trae',
      '3:h(...):cursor',
      '10:RegExp(...):claude-code'
    ]);
    // ...and the comparison in line 9 is caught by shape 1, not lost.
    expect(findIdentityComparisons(parsed).map((h) => `${h.line}:${h.id}`)).toEqual(['9:qoder']);
  });

  it('negative control — shape 3 is path-shaped: a prose mention of `.claude` is not a path', () => {
    const fixture = [
      `const p1 = join(root, '.claude', 'settings.local.json');`, // path → caught
      `const p2 = '.claude';`, // path → caught
      `const p3 = '~/.claude/settings.json';`, // user-level path → caught
      `const prose = 'install into the user-level ~/.claude/settings.json instead';`, // prose
      `const doc = 'Import memories from ~/.claude/projects/<hash>/memory/*.md';`, // prose
      `const other = join(root, '.peaks', 'runtime');` // not an adapter dir
    ].join('\n');
    expect(
      findSettingsPathLiterals(parseSourceFile('fixture.ts', fixture)).map(
        (h) => `${h.line}:${h.text}`
      )
    ).toEqual(['1:.claude', '2:.claude', '3:~/.claude/settings.json']);
  });

  it('negative control — shapes 2/3 are scoped: a non-consumer file is not checked by them', () => {
    // Limit 6, pinned. A hardcoded id/path in a module that never asks the
    // registry is deliberately out of scope for shapes 2/3 — state it here so
    // the guard is not read as covering the whole tree.
    const fixture = [
      `const c1 = { ide: 'claude-code' };`,
      `const p = join(root, '.claude', 'settings.local.json');`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(isRegistryConsumer(parsed)).toBe(false);
    expect(findIdeValueLiterals(parsed)).toHaveLength(1);
    expect(findSettingsPathLiterals(parsed)).toHaveLength(1);
    // The scanner applies shape 2/3 only when `isRegistryConsumer` is true —
    // asserted on the real tree by the scope test above.
  });
});
