// tests/unit/runtime/vendor-neutral-identity-guard.test.ts
//
// Vendor-neutrality guard, second shape (slice
// 2026-09-12-auto-compact-vendor-neutrality).
//
// Why this file exists:
//   The repo declares vendor neutrality in two places —
//   `src/services/runtime/vendor-adapter.ts` (AC-1: vendor VERB strings live
//   only in `src/services/runtime/vendors/<vendor>.ts`) and the compact
//   dispatcher's own header ("No hard-coded IDE names"). AC-1's grep was
//   scoped to `src/services/code/`, a directory that does not contain the
//   compact path at all, so it returned 0 by construction while
//   `src/services/context/auto-compact-dispatcher.ts:99` refused every
//   non-`claude-code` adapter by name and
//   `src/services/context/main-session-monitor.ts:148` hard-derived the
//   compact pathway from the same name.
//
//   AC-1 is a VERB-STRING grep. Every one of those defects was an IDENTITY
//   decision against an IDE id, which no verb grep can match. This guard
//   covers identity in the THREE shapes a re-injection actually takes:
//
//     1. DECISION     `ideId !== 'claude-code'`, `adapter.id !== 'claude-code'`,
//                     `switch (ide) { case 'trae' }`,
//                     `/^claude-code$/.test(ide)`                     → `findIdentityComparisons`
//     2. VALUE        `ide: 'claude-code'`, `return 'claude-code'`,
//                     `resolveHookSpec('claude-code')`                → `findIdeValueLiterals`
//     3. PATH         `join(root, '.claude', 'settings.local.json')`,
//                     i.e. an adapter-declared settings DIRECTORY used as a
//                     path literal                              → `findSettingsPathLiterals`
//
//   All three fold the literal spelling first (header, "WHAT AN ID LITERAL
//   MEANS"), so `'claude' + '-code'`, `\`claude-code\`` and
//   `('claude-code' as const)` count as the same id in every shape.
//
//   Shape 1 covers three SPELLINGS of the same decision: a binary comparison,
//   a `case` clause, and a regex test. The last two were each the round that
//   falsified the round before it — the guard is not a `===` grep.
//
//   Shapes 2 and 3 exist because shape 1 alone was measurably too narrow:
//   QA re-injected the three original defects and only the comparison forms
//   were caught — the literal-assignment form (`ide: 'claude-code'`), the
//   hardcoded-path form, and the same gate re-keyed as `adapter.id !==
//   'claude-code'` all PASSED the shape-1-only guard.
//
// How it checks, and why not by splitting source text:
//   It parses every file under `SCAN_ROOTS` (`src/**/*.{ts,js}` and
//   `scripts/**/*.{mjs,cjs,js}`) with the TypeScript compiler (the repo's own
//   `typescript` devDependency — no new dependency) and asks the AST for the
//   property. A line/regex scan would match ids inside comments and template
//   strings — `src/services/runtime/vendor-adapter.ts` itself quotes
//   `claude --compact` in prose, and `auto-compact-dispatcher.ts` names the
//   ids in its explanatory comments. Those are documentation, not decisions,
//   and a text scan cannot tell them apart. This is the
//   `guard-verifies-syntax-shape-not-the-property` lesson applied the right
//   way round: parse, then ask for the property.
//
// WHAT "AN ID LITERAL" MEANS (2026-09-13 revision):
//   Every shape asks `staticStringValue(node)` what STRING a node DENOTES,
//   rather than whether the node happens to be a `'…'` token. `'claude-code'`,
//   `\`claude-code\``, `'claude' + '-code'` and `('claude-code' as const)` are
//   one id written four ways, and each revision was falsified by the spelling
//   it left out: the id test used to be `ts.isStringLiteral` (loses 2 and 3),
//   then an unasserted string literal (loses 4). The fold is shared by all
//   three shapes — a fold in one shape and not its sibling is precisely how the
//   next injection gets through (header, limit 13).
//
//   A REGEX LITERAL is a FIFTH form and is NOT folded into `staticStringValue`,
//   on purpose: that fold answers "which string does this node denote", and a
//   regex denotes a language, not a string. Folding it there would have made a
//   regex satisfy the VALUE and PATH shapes it does not decide (a
//   `= /\.claude\//` would have read as a hardcoded settings path). What this
//   guard asks of a regex is `regexAlternativeIds`: which guarded ids does the
//   pattern match as a WHOLE string? That is asked by shape 1 — the identity-
//   decision shape — because `/^claude-code$/.test(ide)` is a CALL, not a
//   comparison, so no amount of literal folding would have reached it.
//
// The guarded data is READ FROM THE DECLARATIONS, not hardcoded here:
//   - IDE ids      ← the `IdeId` union (`src/services/ide/ide-types.ts`)
//                    and the `IdeKind` union (`src/services/context/ide-detect.ts`)
//   - settings dirs ← every `dirName: '<literal>'` in `src/services/ide/adapters/*`
//   Adding an IDE to either place extends this guard automatically — an
//   allowlist or an id list maintained inside the guard is a guard that drifts.
//
// SCOPE OF SHAPES 2 AND 3 — the registry-consumer rule
//   Shapes 2 and 3 are enforced on the modules that CONSUME the adapter
//   registry (static import, lazy `await import`, or re-export — see
//   `isRegistryConsumer`) and only those, minus the adapter layer. The
//   property they assert is one sentence: *a module that routes per-IDE must
//   not also name one IDE's id or one IDE's settings path*. A module that
//   never names the registry cannot be routing, and the repo legitimately
//   contains Claude-specific modules (the `.claude` rules tree writer, the
//   Claude settings template, the runtime-vendor adapters) that name
//   `.claude` as their subject, not as a shortcut.
//   Enforcing shapes 2/3 over all of `src/` was measured before choosing:
//   24 id values (8 files) and 29 settings-path literals (18 files) — a union
//   of 23 files that would each need a debt or allowlist entry, i.e. a debt
//   list larger than the signal, and a guard that lists its exemptions is a
//   guard that reports nothing. The same rules scoped to registry consumers
//   flag 1 value site and 2 path sites, all three already pinned below. The
//   cost is stated as a limit (6, 7) rather than hidden. Those two
//   measurements were taken over `src/`; `scripts/**` (added 2026-09-13)
//   contributes no registry consumer, so they still hold.
//   Shape 1 (identity DECISIONS: comparison, `case`, regex test) IS global,
//   because deciding an IDE's identity is the same act wherever it appears.
// ---------------------------------------------------------------------------
// HOW THIS SUITE IS ARRANGED (2026-10-01, C wave 7 file-size split, rid
// 2026-10-01-c-wave7-excess-w7-4).
//
// This file was 1785 raw lines against the 500-line cap for `tests/**`. It was
// split along seams it already had — the walk, the literal fold, the three
// shapes, and the negative controls that exercise them — and every moved line
// moved VERBATIM. Nothing was re-authored and nothing was dropped: the guarded
// data is still READ FROM THE DECLARATIONS, `SCAN_ROOTS` still walks `src/**`
// and `scripts/**` at runtime, and `adapterSettingsDirNames` still walks
// `src/**/*.ts` for every `dirName:` literal.
//
// THE WALKED SET WAS PROVED NOT TO SHRINK, not assumed: measured over the same
// code path before the split and after it, the walk returned 932 files before and
// 944 after — and the difference is 12 `src/services/final-review/*` files another
// leaf added to this worktree while this split ran. ZERO files left the walked
// set, and every hit list the guard reads back was identical: 20 registry
// consumers, 12 identity comparisons, 5 id values, 2 settings paths, 1 verb
// literal, 10 ids, 9 settings dirs.
//
//   vendor-neutral-identity-guard-reach.ts
//       PROJECT_ROOT, the recursive walk, SCAN_ROOTS, the parser entry. This is
//       the file that owns the guard's REACH.
//   vendor-neutral-identity-guard-fold.ts
//       the `IdeId`/`IdeKind` and `dirName` derivations, `staticStringValue`,
//       `isFoldedIntoParent` and the regex normalisation. Limit 14 (the regex
//       normalisation boundary) heads this file, because it describes that code.
//   vendor-neutral-identity-guard-shapes.ts
//       shapes 1-3, `isRegistryConsumer`, AC-1's verb check, and
//       `scanProject`/`SCAN` (the one scanned tree every file below reads).
//   vendor-neutral-identity-guard-scope-controls.test.ts
//       the re-injection and scope cases. The LIMITS list (limits 1-13) heads
//       this file, because those cases are what pin it.
//   vendor-neutral-identity-guard-fold-controls.test.ts
//       the synthesized-literal, type-wrapper and regex cases.
//   vendor-neutral-identity-guard-ac1.test.ts
//       the AC-1 verb cases, with the AC-1 doc block that describes them.
//
// WHAT STAYS HERE, AND WHY: the `KNOWN_DEBT` census and `MUST_BE_COVERED`. The
// census is pinned by FILE NAME (lint-gate §4c) and is read back by exactly one
// case — "the pinned debt is exactly the known set — no growth, no stale
// entries" — so it lives with that case rather than in a sibling someone can
// edit without touching the ratchet. The six entries, their pinned counts and
// their `file:` strings are unchanged by this split (moved as one verbatim
// block), and so are the 26 cases of this suite: 8 here, 6 in the scope-controls
// file, 8 in the fold-controls file, 4 in the AC-1 file — counted before, counted
// after, by the runner and not by eye.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSourceFile,
  PROJECT_ROOT,
  relativeToRoot
} from './vendor-neutral-identity-guard-reach.js';
import { IDE_IDS, SETTINGS_DIR_NAMES } from './vendor-neutral-identity-guard-fold.js';
import {
  findSettingsPathLiterals,
  inAllowedDir,
  isRegistryConsumer,
  SCAN
} from './vendor-neutral-identity-guard-shapes.js';

/**
 * Files reachable from the compact path that MUST stay registry consumers. If
 * a refactor stops importing the registry from one of these, shapes 2/3 would
 * silently stop checking it — the anti-silence test below fails instead.
 *
 * `src/services/hooks/auto-compact-hook-install.ts` is deliberately NOT here:
 * it is a compact-path module, but it never asks the registry, and it holds
 * Claude Code's path as a documented DEFAULT
 * (`AUTO_COMPACT_HOOK_SETTINGS_PATH`) for callers with no adapter in hand.
 * Shape 3 therefore does not cover it — limit 6, pinned as a named case in
 * the "documented default" test below rather than left implicit.
 */
const MUST_BE_COVERED: readonly string[] = [
  'src/services/context/auto-compact-dispatcher.ts',
  'src/services/context/main-session-monitor.ts'
];

/** The installer's documented Claude default — see `MUST_BE_COVERED`. */
const HOOK_INSTALLER_PATH = 'src/services/hooks/auto-compact-hook-install.ts';

/**
 * Pre-existing vendor-identity decisions OUTSIDE the adapter layer that this
 * slice did not fix. A ratchet, not an allowlist: the counts are pinned, so
 * any NEW decision in these files fails, and a file that gets fixed must be
 * removed from this list (the equality assertion below fails otherwise).
 *
 * Each is the SAME defect shape as the ones this slice repaired. They are
 * reported as debt rather than silently exempted.
 */
const KNOWN_DEBT: readonly {
  readonly file: string;
  readonly comparisons: number;
  readonly ideValues: number;
  readonly settingsPaths: number;
  readonly reason: string;
}[] = [
  {
    file: 'src/services/skills/hooks-codegate-superpowers.ts',
    comparisons: 4,
    ideValues: 0,
    settingsPaths: 0,
    reason:
      'picks the hook shell + the codegate entry per IDE; pre-existing, and ' +
      'changing it risks the `peaks hooks install` byte-stability contract ' +
      "(same class as the fixed dispatcher sites, out of this slice's scope)"
  },
  {
    file: 'src/services/skills/hooks-settings-service.ts',
    comparisons: 1,
    ideValues: 1,
    settingsPaths: 0,
    reason:
      'decides whether the settings writer emits env exemptions, keyed on the IDE ' +
      'name, and derives the default peaks-managed hook entries from ' +
      "`resolveHookSpec('claude-code')`"
  },
  {
    file: 'src/cli/commands/hooks-commands.ts',
    comparisons: 0,
    ideValues: 0,
    settingsPaths: 2,
    reason:
      'REMAINING: the Claude Code skill-bridge copy targets ' +
      "(`resolve(userHome, '.claude', 'skills', …)`). The `comparisons: 1` this " +
      "entry used to carry was the `ide === 'trae'` branch in " +
      '`listExpectedEntriesForIde`; slice 2026-09-15-s7-doc-code-align removed it ' +
      'by deriving the entry list from `resolveHookEntries(ide)`, so the count ' +
      'drops to 0 and only the two literal `.claude` paths remain pinned.'
  },
  {
    file: 'src/services/dispatch/dispatch-record-upgrade.ts',
    comparisons: 1,
    ideValues: 0,
    settingsPaths: 0,
    reason:
      "runtime-VENDOR axis, not the IDE axis: `vendor === 'codex'` on a dispatch " +
      "record. Caught only because shape 1 no longer filters by the counterpart's " +
      'name; pinned rather than name-excluded (that filter was the `adapter.id` hole)'
  },
  {
    file: 'src/services/dispatch/dispatch-record-writer.ts',
    comparisons: 1,
    ideValues: 0,
    settingsPaths: 0,
    reason: 'same runtime-vendor axis as dispatch-record-upgrade.ts'
  },
  {
    file: 'scripts/install-skills.mjs',
    comparisons: 2,
    ideValues: 0,
    settingsPaths: 0,
    reason:
      "B3(a): `ideId === 'claude-code'` gates the PEAKS_CLAUDE_*_DIR env-var " +
      'override for the agentsDir fan-out and the skillsDir fan-out. The env ' +
      'var name IS already declared per-platform (`IDE_SKILL_INSTALL_PROFILES[' +
      'ide].envVar` / `.agentsEnvVar`), so an adapter-driven version is ' +
      'available — but it would also switch ON the override for the other ' +
      'platforms whose profile declares one (_trae / _trae-cn / …), which is a ' +
      "behaviour change to a shipped script's documented 1.x-compat contract. " +
      'Visible and ratcheted instead: a THIRD site here fails this test'
  }
];

const isDebt = (file: string): boolean => KNOWN_DEBT.some((debt) => debt.file === file);

describe('vendor neutrality — IDE identity decisions outside the adapter layer (slice 2026-09-12)', () => {
  it('parses a real part of the tree (anti-silence: a broken scanner must not pass)', () => {
    // A scanner that silently walks nothing, or stops recognising the id
    // literals, would make every assertion below vacuously green. Pin the
    // walk, the id set, the settings-dir derivation and the scope.
    expect(SCAN.scannedFiles).toBeGreaterThan(400);
    // BOTH roots were reached. Pinned by naming a file in the second root:
    // a count threshold alone tolerates one root silently vanishing, and the
    // `scripts/` root is the one that was invisible until B3(a).
    expect(
      SCAN.comparisons.some((hit) => relativeToRoot(hit.file) === 'scripts/install-skills.mjs'),
      'the scripts/ root was not walked'
    ).toBe(true);
    // These two names are what keep BOTH roots covered now. Each pins a root
    // by naming a file that can only be in it: a `.mjs` in `scripts/`, a `.ts`
    // in `src/`. A walk that silently stopped reaching either root fails here.
    //
    // Until 2026-09-16 this block ALSO asserted
    // `toContain('src/services/hooks/write-gate.js')`, to pin the `.js`
    // EXTENSION that the `src/` root carries. That file was deleted (an
    // installed handler that abstained on every path), so the assertion went
    // with it: naming a deleted file would make its deliberate removal read as
    // a scanner regression. The extension itself is retained at SCAN_ROOTS —
    // see the note there — and it has no file to name today, so the `src/` root
    // is pinned by extension-agnostic evidence instead.
    expect(SCAN.scannedFileList, 'the scripts/ root was not walked').toContain(
      'scripts/install-skills.mjs'
    );
    expect(SCAN.scannedFileList).toContain('src/services/context/auto-compact-reader.ts');
    // The regex branch's measured cost, pinned as a fact: no regex literal in
    // the scanned tree matches an id as a whole string today, so the branch
    // introduces no exemption and no false positive. A first real site fails
    // HERE (and in the debt ratchet) instead of appearing as an unexplained
    // new violation.
    expect(SCAN.comparisons.filter((hit) => hit.form === 'regex-literal')).toEqual([]);
    expect(IDE_IDS.has('claude-code')).toBe(true);
    expect(IDE_IDS.has('trae')).toBe(true);
    expect(IDE_IDS.has('opencode')).toBe(true);
    // `unknown` is a sentinel, never a vendor id.
    expect(IDE_IDS.has('unknown')).toBe(false);
    // The settings-dir set came from the adapter declarations, not from thin air.
    expect(SETTINGS_DIR_NAMES.has('.claude')).toBe(true);
    expect(SETTINGS_DIR_NAMES.has('.trae')).toBe(true);
    expect(SETTINGS_DIR_NAMES.size).toBeGreaterThanOrEqual(8);
    // Shapes 2/3 are scoped by this set; if it collapses, they check nothing.
    expect(SCAN.registryConsumers.length).toBeGreaterThan(10);
    for (const required of MUST_BE_COVERED) {
      expect(SCAN.registryConsumers, `${required} fell out of guard coverage`).toContain(required);
    }
  });

  it('finds no IDE identity comparison outside the adapter layer and the pinned debt', () => {
    const unexpected = SCAN.comparisons
      .filter((hit) => {
        const file = relativeToRoot(hit.file);
        return !inAllowedDir(file) && !isDebt(file);
      })
      .map(
        (hit) =>
          `${relativeToRoot(hit.file)}:${hit.line} ${hit.subject} vs '${hit.id}' (${hit.form})`
      );
    expect(unexpected).toEqual([]);
  });

  it('finds no IDE id asserted as a value inside a registry consumer', () => {
    const unexpected = SCAN.ideValues
      .filter((hit) => {
        const file = relativeToRoot(hit.file);
        return !inAllowedDir(file) && !isDebt(file);
      })
      .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} ${hit.position} '${hit.id}'`);
    expect(unexpected).toEqual([]);
  });

  it('finds no hardcoded IDE settings path inside a registry consumer', () => {
    const unexpected = SCAN.settingsPaths
      .filter((hit) => {
        const file = relativeToRoot(hit.file);
        return !inAllowedDir(file) && !isDebt(file);
      })
      .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} '${hit.text}' (${hit.dirName})`);
    expect(unexpected).toEqual([]);
  });

  it('the pinned debt is exactly the known set — no growth, no stale entries', () => {
    // Exact-set + exact-count equality on purpose, per shape. A new violation
    // in one of these files changes a count and fails; fixing one of them
    // leaves a stale entry and fails, forcing the list to shrink with the debt.
    const actual = KNOWN_DEBT.map((debt) => ({
      file: debt.file,
      comparisons: SCAN.comparisons.filter((hit) => relativeToRoot(hit.file) === debt.file).length,
      ideValues: SCAN.ideValues.filter((hit) => relativeToRoot(hit.file) === debt.file).length,
      settingsPaths: SCAN.settingsPaths.filter((hit) => relativeToRoot(hit.file) === debt.file)
        .length
    }));
    expect(actual).toEqual(
      KNOWN_DEBT.map((debt) => ({
        file: debt.file,
        comparisons: debt.comparisons,
        ideValues: debt.ideValues,
        settingsPaths: debt.settingsPaths
      }))
    );
  });

  it('the files this slice repaired stay clean in all three shapes (regression pin)', () => {
    // The sites the guard was written for. Asserted by name so a future
    // refactor that reintroduces any of the three shapes fails HERE, with the
    // file named, rather than as an anonymous entry in the list above.
    const repaired = [
      'src/services/context/auto-compact-dispatcher.ts',
      'src/services/context/main-session-monitor.ts'
    ];
    const offenders = [
      ...SCAN.comparisons
        .filter((hit) => repaired.includes(relativeToRoot(hit.file)))
        .map(
          (hit) =>
            `${relativeToRoot(hit.file)}:${hit.line} comparison ${hit.subject} vs '${hit.id}'`
        ),
      ...SCAN.ideValues
        .filter((hit) => repaired.includes(relativeToRoot(hit.file)))
        .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} value ${hit.position} '${hit.id}'`),
      ...SCAN.settingsPaths
        .filter((hit) => repaired.includes(relativeToRoot(hit.file)))
        .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} path '${hit.text}'`)
    ];
    expect(offenders).toEqual([]);
  });

  it('scope detector — a LAZY registry import counts as consuming it (real instance: share-commands.ts)', () => {
    // The static-only first draft of `isRegistryConsumer` dropped
    // `src/cli/commands/share-commands.ts` — a real consumer — out of scope
    // and nothing failed, because the file happens to have no hits. Scope
    // narrower than its own claim is the failure mode this guard's header
    // warns about; pin both forms here so it cannot regress silently.
    const lazy = `const { getAdapter } = await import('../../services/ide/ide-registry.js');`;
    const eager = `import { getAdapter } from '../../services/ide/ide-registry.js';`;
    const unrelated = `const x = await import('../context/auto-compact-types.js');`;
    expect(isRegistryConsumer(parseSourceFile('fixture.ts', lazy))).toBe(true);
    expect(isRegistryConsumer(parseSourceFile('fixture.ts', eager))).toBe(true);
    expect(isRegistryConsumer(parseSourceFile('fixture.ts', unrelated))).toBe(false);
    // ...and the real file is in the measured scope.
    expect(SCAN.registryConsumers).toContain('src/cli/commands/share-commands.ts');
  });

  it('limit 6, real instance — the compact hook installer keeps a Claude path default and is NOT covered by shape 3', () => {
    // The one compact-path module the scope rule does not reach. It is pinned
    // here so the gap is a tested fact, not a footnote: if someone deletes
    // the default (the good outcome) this test fails and the limit is revised;
    // if someone ADDS a second `.claude` literal there, this fails too.
    // The dispatcher — which IS covered — must pass the adapter-derived path,
    // so this default only serves callers holding no adapter.
    const sourceFile = parseSourceFile(
      HOOK_INSTALLER_PATH,
      readFileSync(join(PROJECT_ROOT, HOOK_INSTALLER_PATH), 'utf8')
    );
    expect(isRegistryConsumer(sourceFile)).toBe(false);
    const literals = findSettingsPathLiterals(sourceFile);
    // Keyed on the LITERAL, not its line: this arm's claim is that the file has
    // exactly one `.claude` path and that it is this one. A comment deleted above
    // it moves the address and changes nothing about the gap, so the line is
    // reported in the failure message rather than asserted.
    expect(
      literals.map((hit) => hit.text),
      `measured literals (with lines, for the note): ${JSON.stringify(
        literals.map((hit) => `${hit.line}:${hit.text}`)
      )}`
    ).toEqual(['.claude/settings.local.json']);
  });
});
