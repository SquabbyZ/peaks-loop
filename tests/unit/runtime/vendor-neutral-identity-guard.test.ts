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
//  14. A REGEX LITERAL is understood only as far as `regexAlternativeIds`
//      normalises it, and the boundary is deliberate: an id is reported when
//      a TOP-LEVEL ALTERNATIVE, after unwrapping whole-span groups, stripping
//      `^`/`$` anchors and unescaping escaped PUNCTUATION, EQUALS the id. So
//      these ARE caught — `/claude-code/`, `/^claude-code$/`, `/^claude-code/`,
//      `/claude-code$/`, `/^(claude-code|trae)$/`, `/^(?:claude-code)$/`,
//      `/claude\-code/` (`\-` unescapes to `-`), `(/claude-code/)`
//      (parentheses around the literal do not hide it). These are NOT caught:
//        a. a regex assembled at runtime — `new RegExp(ide)`, or a pattern
//           built by concatenation (same class as limit 13). NOT the same
//           thing as `new RegExp('claude-code')`, which is a plain string
//           literal in a value position and is owned by shape 2 (inside a
//           consumer; outside one it is limit 6, like any other value);
//        b. a pattern that CONTAINS an id rather than being one —
//           `/claude-code-settings/`, `/^claude-code-/`, `/claude-cod[e]/`,
//           `/claude_code/`. Only an alternative equal to the id counts, which
//           is also what keeps `VENDOR_VERBS` (`/claude\s+--compact/`) and
//           `.claude` path patterns out of this check's way;
//        c. an alternative carrying a regex-only escape — `/claude-code\b/`:
//           `\b` is left intact (a word boundary, not punctuation), so it does
//           not equal the id textually. Likewise no case folding:
//           `/CLAUDE-CODE/i` is not reported;
//        d. character-class obfuscation — `/[c]laude-code/`;
//        e. an alternative nested inside a group that is not a whole-span group
//           — `/x(claude-code)/`.
//      Note the asymmetry with (b) on purpose: a LONE `^` or `$` IS stripped,
//      so `/^claude-code/` (prefix) and `/claude-code$/` (suffix) are reported
//      even though they can match a longer string. A pattern anchored on the
//      id as a whole token is an identity decision; a pattern with MORE text
//      around the id (`/claude-code-settings/`) is not, and pretending to tell
//      prefix-anchors from no-anchors would add a rule with no detection
//      behind it — measured cost of the strict alternative rule is zero sites
//      in the tree today.
//      Residual risk, stated: a regex can still decide identity WITHOUT
//      matching an id as an alternative — the (a)-(e) forms above, plus any
//      `RegExp` composed from a non-literal. Those stay invisible, and this
//      guard's answer to them is this list, not a claim of coverage.
//
// ---------------------------------------------------------------------------
// AC-1 (vendor VERB strings) is enforced here too, in the same file, because
// both checks are the same property ("vendor knowledge lives in the adapter
// layer") applied to different shapes and they must be read together.
//
// AC-1's own scope was widened from `src/services/code/` to all of `src/` in
// this slice, and it could not stay a text grep: over `src/` the raw grep
// returns 13, of which 12 are COMMENTS quoting the verb (including AC-1's own
// doc block) and 1 is `compactCommand: 'claude --compact'` in the adapter
// that owns it. So the verb check below is also AST-based — it looks only at
// string literals and template literals, never at comments.
//
// What the AC-1 check does NOT catch:
//   a. A verb assembled at runtime — `'claude' + ' --compact'`, a template
//      with an interpolated binary name, a value read from config. Only
//      literal text is inspected.
//   b. VERBS OTHER THAN COMPACT. The three literals below are the set AC-1
//      names; a new vendor verb (`codex exec`, ...) is invisible until it is
//      added to `VENDOR_VERBS`, which is a deliberate edit in the guard.
//   c. Anything outside `src/**/*.ts` — same limit as check 4 above.
//   d. It asserts nothing about whether an allowed adapter's verb is
//      CORRECT; that is the adapter's own concern (and its own tests).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import * as ts from 'typescript';

const PROJECT_ROOT = resolve(__dirname, '..', '..', '..');
const SRC_ROOT = join(PROJECT_ROOT, 'src');

/** POSIX-normalised path relative to the project root. */
function relativeToRoot(absolutePath: string): string {
  return absolutePath.slice(PROJECT_ROOT.length + 1).split(sep).join('/');
}

/**
 * Directories the walk never enters. `dist/**` is GENERATED and every id in
 * it is a copy of one in `src/`, so scanning it would double-count every hit;
 * `node_modules` is not ours. Dot-directories (`.git`, `.peaks`, …) are
 * skipped by name prefix.
 */
const EXCLUDED_DIR_NAMES: ReadonlySet<string> = new Set(['node_modules', 'dist', 'coverage']);

/**
 * Every file under `dir` whose name ends with one of `extensions`, recursively.
 * `fs`, not a shell — `execSync('find …')` on this project's Windows CI runs
 * `find.exe`, a different program.
 *
 * One file at a time, each independent of the others: the walk returns the
 * complete list before anything is parsed, so a single unparseable file can
 * never decide whether the remaining files are seen.
 */
function listFilesRecursively(dir: string, extensions: readonly string[], out: string[] = []): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A root that does not exist contributes nothing rather than aborting the
    // walk — the anti-silence test pins what was actually reached, so a
    // missing root fails there instead of passing quietly here.
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;
      listFilesRecursively(full, extensions, out);
    } else if (entry.isFile() && extensions.some((ext) => entry.name.endsWith(ext))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The roots the scan walks, and the extensions each admits.
 *
 * `scripts/**` is here because it SHIPS — `package.json#files` lists
 * `scripts/install-skills.mjs` — and it held two live `ideId === 'claude-code'`
 * decisions that a `src/**`-only walk could not see even in principle (the
 * limit this replaces, formerly limit 4). Those two are pinned as debt below,
 * not fixed: making them adapter-driven would also enable the env-var
 * override for the six other platforms whose profile declares one, i.e. a
 * behaviour change to a published script's documented contract. Visibility
 * plus a ratchet is the honest step; the behaviour change is not this slice's.
 *
 * `.mjs` / `.cjs` / `.js` are parsed as JavaScript (`ScriptKind.JS`), which
 * the TypeScript parser supports natively — no new dependency.
 *
 * A root that contributes zero files cannot hide: the debt entry below pins
 * two comparison sites by exact count, so a `scripts/` walk that silently
 * stopped working fails that test rather than reporting clean.
 */
const SCAN_ROOTS: readonly { readonly root: string; readonly extensions: readonly string[] }[] = [
  // `.js` is here although `src/` holds no `.js` file today. It was added for
  // `src/services/hooks/write-gate.js`, a SHIPPED PreToolUse hook that sat
  // outside every shape of this guard purely because of its extension; slice
  // 2026-09-15-s10-misc-cleanup deleted that file (an installed handler that
  // abstained on every path — the installation was the defect), so the
  // extension now has no subject and matches zero files. Kept deliberately: the
  // blind spot was the CLASS, not the one file, and retiring an extension the
  // day its last file leaves means the next file of that extension is unguarded
  // until someone re-adds it — which is precisely how this root came to exist.
  // This is the only root here whose subject count is zero, and that is stated
  // rather than papered over.
  // There is also no `.tsx`/`.jsx`/`.mts`/`.cts` under `src/` today (limit 4).
  { root: join(PROJECT_ROOT, 'src'), extensions: ['.ts', '.js'] },
  { root: join(PROJECT_ROOT, 'scripts'), extensions: ['.mjs', '.cjs', '.js'] }
];

function scriptKindFor(absolutePath: string): ts.ScriptKind {
  return /\.(mjs|cjs|js)$/.test(absolutePath) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
}

function parseSourceFile(absolutePath: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    absolutePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(absolutePath)
  );
}

/**
 * The string-literal members of a named string-literal union type alias
 * (`export type IdeId = 'a' | 'b'`). Read from the declaration so the guard
 * cannot drift from the union it guards.
 */
function stringUnionMembers(sourceFile: ts.SourceFile, typeName: string): string[] {
  const members: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === typeName && ts.isUnionTypeNode(node.type)) {
      for (const member of node.type.types) {
        if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) {
          members.push(member.literal.text);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return members;
}

const IDE_TYPES_PATH = join(SRC_ROOT, 'services', 'ide', 'ide-types.ts');
const IDE_DETECT_PATH = join(SRC_ROOT, 'services', 'context', 'ide-detect.ts');

/**
 * The id set the guard enforces: the `IdeId` union (the canonical registry
 * keys) plus the ids `detectIdeFromEnv` can return that no adapter owns
 * (`opencode`). `unknown` is a sentinel, not a vendor, and is dropped.
 */
function ideIdsUnderGuard(): ReadonlySet<string> {
  const ideId = stringUnionMembers(
    parseSourceFile(IDE_TYPES_PATH, readFileSync(IDE_TYPES_PATH, 'utf8')),
    'IdeId'
  );
  const ideKind = stringUnionMembers(
    parseSourceFile(IDE_DETECT_PATH, readFileSync(IDE_DETECT_PATH, 'utf8')),
    'IdeKind'
  );
  return new Set([...ideId, ...ideKind].filter((id) => id !== 'unknown'));
}

const IDE_IDS = ideIdsUnderGuard();

/**
 * The settings DIRECTORY names the adapters declare (`dirName: '.claude'`).
 * Read from the declarations for the same reason `IDE_IDS` is: a list
 * maintained inside the guard drifts from the adapters it guards.
 */
function adapterSettingsDirNames(): ReadonlySet<string> {
  const names = new Set<string>();
  // `src/` only: `dirName` is an adapter-layer field and adapters live there.
  for (const absolutePath of listFilesRecursively(SRC_ROOT, ['.ts'])) {
    const sourceFile = parseSourceFile(absolutePath, readFileSync(absolutePath, 'utf8'));
    const visit = (node: ts.Node): void => {
      if (
        ts.isPropertyAssignment(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'dirName' &&
        ts.isStringLiteral(node.initializer)
      ) {
        names.add(node.initializer.text);
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(sourceFile, visit);
  }
  return names;
}

const SETTINGS_DIR_NAMES = adapterSettingsDirNames();

const IDENTITY_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsEqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsEqualsToken,
  ts.SyntaxKind.EqualsEqualsToken,
  ts.SyntaxKind.ExclamationEqualsToken
]);

/** Source text of a node, whitespace-collapsed and length-capped for messages. */
function briefText(sourceFile: ts.SourceFile, node: ts.Node): string {
  const text = node.getText(sourceFile).replace(/\s+/g, ' ').trim();
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

export interface IdentityComparison {
  readonly file: string;
  readonly line: number;
  /** The compared ID literal, so a failure names which vendor was hardcoded. */
  readonly id: string;
  /** `subject === 'id'`, `switch (subject) { case 'id' }`, or `/^id$/.test(subject)`. */
  readonly form: 'comparison' | 'switch-case' | 'regex-literal';
  /** Source text of the non-literal side, or the regex itself for `regex-literal`. */
  readonly subject: string;
}

const lineOf = (sourceFile: ts.SourceFile, node: ts.Node): number =>
  sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1;

/**
 * The STATIC string value a node denotes, or `null` when it is not statically
 * known. Folds the three spellings of the same literal that round-3 injection
 * used to walk past:
 *
 *   'claude-code'          string literal      → `node.text`
 *   `claude-code`          no-substitution template → `node.text`
 *   'claude' + '-code'     `+` chain of the above  → concatenation
 *   ('claude-code')        parenthesised form of any of the above
 *
 * The previous revision tested `ts.isStringLiteral(node)` directly, so an id
 * written in any other spelling was not even a CANDIDATE. The property this
 * guard asserts is about the id a node DENOTES, so the id is folded first and
 * the fold is shared by all three shapes — a shape that folds while its
 * sibling does not is how the next injection gets in.
 *
 * Template literals WITH substitutions (`${x}-code`) are not foldable and stay
 * a stated limit (header, limit 3/13).
 */
function staticStringValue(node: ts.Node): string | null {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isParenthesizedExpression(node)) return staticStringValue(node.expression);
  // Type wrappers are ERASED at runtime, so they do not change the value the
  // node denotes. `ide === ('claude-code' as const)` compares against the same
  // string `ide === 'claude-code'` does. This form was invisible until
  // 2026-09-13: an assertion hid the literal from every shape, so a
  // NON-consumer file (where shape 2 does not run) could re-inject an
  // identity comparison by adding `as const` and nothing failed.
  if (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return staticStringValue(node.expression);
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticStringValue(node.left);
    const right = staticStringValue(node.right);
    if (left !== null && right !== null) return left + right;
  }
  return null;
}

/**
 * True when an ENCLOSING node already folds to this node's string value — a
 * parenthesis, a `+` chain, or a type wrapper. Without this, one site reports
 * once per enclosing spelling (`('claude-code')`, `'claude-code' + ''`,
 * `'claude-code' as const`) and silently inflates the count-pinned assertions,
 * which are exact equalities.
 *
 * The enclosing node is REPORTED in place of this one (same line, same
 * `valuePositionLabel`), so folding a wrapper never loses a site: the site is
 * named by the outermost node that carries it. Blanket-skipping the wrapped
 * literal without that hand-off would have been a REGRESSION, not a
 * de-duplication — `{ ide: 'claude-code' as const }` in a consumer was caught
 * by shape 2 before this revision and must stay caught.
 */
function isFoldedIntoParent(node: ts.Node): boolean {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return false;
  if (ts.isParenthesizedExpression(parent)) return true;
  if (ts.isAsExpression(parent) || ts.isTypeAssertionExpression(parent)) return true;
  return (
    ts.isBinaryExpression(parent) &&
    parent.operatorToken.kind === ts.SyntaxKind.PlusToken &&
    staticStringValue(parent) !== null
  );
}

/**
 * The FOURTH literal form: a REGEX LITERAL, asked which guarded ids it matches
 * EXACTLY.
 *
 * Deliberately NOT part of `staticStringValue`. That fold answers "which string
 * does this node denote", and a regex denotes a LANGUAGE, not a string. Folding
 * it there would have made a regex satisfy the VALUE and PATH shapes it does
 * not actually decide (`const p = /\.claude\//` would have read as a hardcoded
 * settings path). The question this guard actually asks of a regex is the one
 * below: which ids does the pattern match as a whole string? A regex
 * `test`/`match` against an ide IS an identity decision — the 2026-09-13 QA
 * injection (`/^claude-code$/.test(ide)`, `ide.match(/claude-code/)`,
 * `/^(claude-code|trae)$/.test(ide)`) was 20/20 green because neither a
 * `RegularExpressionLiteral` nor a method call was any shape's business.
 *
 * A regex is a CALL, not a comparison, so this is reported by shape 1 (which
 * owns identity decisions wherever they appear), not by a `===` scan. See
 * limit 14 for what the normalisation below does NOT understand.
 */
const REGEX_LITERAL_TEXT = /^\/([\s\S]*)\/([a-z]*)$/;

/** The pattern between the delimiters: `/^(a|b)$/i` → `^(a|b)$`, or `null`. */
function regexPatternSource(text: string): string | null {
  const match = REGEX_LITERAL_TEXT.exec(text);
  return match === null ? null : (match[1] ?? '');
}

/** Split a pattern on top-level `|` (not inside a group, not inside `[…]`). */
function splitTopLevelAlternatives(pattern: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  let inCharacterClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i] as string;
    if (char === '\\') {
      current += char + (pattern[i + 1] ?? '');
      i += 1;
      continue;
    }
    if (char === '[') inCharacterClass = true;
    if (char === ']') inCharacterClass = false;
    if (char === '(') depth += 1;
    if (char === ')') depth -= 1;
    if (char === '|' && depth === 0 && !inCharacterClass) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

/** `(x)`, `(?:x)` — one whole-span group — unwrapped to `x`. */
function unwrapWholeGroup(text: string): string {
  if (!text.startsWith('(') || !text.endsWith(')')) return text;
  let depth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (char === '\\') {
      i += 1;
      continue;
    }
    if (char === '(') depth += 1;
    else if (char === ')') {
      depth -= 1;
      // The opening paren closed before the end → not one whole-span group
      // (`(a)|(b)` reaches here as `(a)`+`|`+`(b)`, never as one string).
      if (depth === 0) return i === text.length - 1 ? text.slice(1, -1).replace(/^\?:/, '') : text;
    }
  }
  return text;
}

/**
 * Structural normalisation — unwrap whole-span groups and strip `^`/`$`
 * anchors on either end. A lone `^` or `$` counts: `/^claude-code/` names the
 * id as its whole token even though it can match a longer string (see limit
 * 14's note on this asymmetry). ESCAPES ARE LEFT INTACT here, because the
 * caller still has to split on `|` and an escaped `\|` is a literal pipe, not
 * an alternative separator. Iterated because `^(?:x)$` needs both steps.
 */
function structuralNormalize(text: string): string {
  let current = text;
  for (;;) {
    const before = current;
    current = unwrapWholeGroup(current);
    if (current.startsWith('^')) current = current.slice(1);
    if (current.endsWith('$') && !current.endsWith('\\$')) current = current.slice(0, -1);
    if (current === before) break;
  }
  return current;
}

/** `\-` → `-`, `\/` → `/`; `\s`, `\d`, `\w`, `\b` keep their meaning. */
function unescapePunctuation(text: string): string {
  return text.replace(/\\(.)/g, (whole, escaped: string) => (/^[A-Za-z0-9]$/.test(escaped) ? whole : escaped));
}

/** The id text an alternative is keyed on: structural form, then unescaped. */
function normalizeAlternative(text: string): string {
  return unescapePunctuation(structuralNormalize(text));
}

/**
 * The guarded ids a regex literal keys on, deduplicated. One regex can name
 * several (`/^(claude-code|trae)$/` → both), which is why this returns a list
 * where every other literal form returns a single value.
 *
 * The whole pattern is normalised BEFORE the split on purpose: in
 * `/^(claude-code|trae)$/` the `|` sits inside a group, so it is not a
 * top-level alternative until the anchors are stripped and the group is
 * unwrapped — splitting first saw one alternative `^(claude-code|trae)$` and
 * reported nothing. Anchors are stripped again per alternative, so the two
 * placements (`^(a|b)$` and `^a$|^b$`) both resolve.
 */
function regexAlternativeIds(node: ts.Node): string[] {
  if (!ts.isRegularExpressionLiteral(node)) return [];
  const pattern = regexPatternSource(node.text);
  if (pattern === null) return [];
  const ids = new Set<string>();
  for (const alternative of splitTopLevelAlternatives(structuralNormalize(pattern))) {
    const normalized = normalizeAlternative(alternative);
    if (IDE_IDS.has(normalized)) ids.add(normalized);
  }
  return [...ids];
}

/** The id a node denotes, when that id is one the guard enforces. */
function ideIdOf(node: ts.Node): string | null {
  const value = staticStringValue(node);
  return value !== null && IDE_IDS.has(value) ? value : null;
}

/**
 * Shape 1 — IDE identity DECISIONS: comparisons, `case` clauses, and regex
 * tests.
 *
 * The non-literal side may be ANY expression (`ide`, `ideId`, `adapter.id`,
 * `detected.ide`, an index expression, a call). It used to have to carry a
 * name matching `/ide/i`, and that name rule was the hole: the same gate
 * re-keyed as `adapter.id !== 'claude-code'` — the most natural re-injection
 * in the file it was removed from — passed. Dropping the name rule costs two
 * pre-existing hits on the runtime-vendor axis (`vendor === 'codex'` in
 * `src/services/dispatch/dispatch-record-*.ts`); they are pinned as debt, not
 * excluded, because "the other side is called `vendor`" is exactly the kind
 * of exception that made the rule a hole.
 *
 * The regex branch is the fourth literal form. It is not a comparison node at
 * all — `/^claude-code$/.test(ide)` and `ide.match(/claude-code/)` are CALLS —
 * so a `===`-and-`case` scan could not reach them however the literal folded,
 * which is why the fold alone was not the fix (see `regexAlternativeIds`).
 * Rule: any regex literal whose whole-string alternative equals a guarded id.
 * Measured over the scanned tree at the 2026-09-13 revision: ZERO such literals
 * exist today, so this branch costs no exemption and no false positive; every
 * hit it reports from now on is new code, which is the point.
 */
export function findIdentityComparisons(sourceFile: ts.SourceFile): IdentityComparison[] {
  const found: IdentityComparison[] = [];
  const record = (
    node: ts.Node,
    form: IdentityComparison['form'],
    id: string,
    subject: string
  ): void => {
    found.push({
      file: sourceFile.fileName,
      line: lineOf(sourceFile, node),
      id,
      form,
      subject
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isBinaryExpression(node) && IDENTITY_OPERATORS.has(node.operatorToken.kind)) {
      const leftId = ideIdOf(node.left);
      const rightId = ideIdOf(node.right);
      // `!== null` on the OTHER side (not `!isStringLiteral`) on purpose: the
      // subject must be a non-literal EXPRESSION. Folding both sides keeps
      // `'claude-code' === 'claude' + '-code'` a no-op, as it should be.
      if (leftId !== null && staticStringValue(node.right) === null) {
        record(node, 'comparison', leftId, briefText(sourceFile, node.right));
      }
      if (rightId !== null && staticStringValue(node.left) === null) {
        record(node, 'comparison', rightId, briefText(sourceFile, node.left));
      }
    }
    if (ts.isSwitchStatement(node) && staticStringValue(node.expression) === null) {
      for (const clause of node.caseBlock.clauses) {
        if (!ts.isCaseClause(clause)) continue;
        const id = ideIdOf(clause.expression);
        if (id !== null) {
          record(clause, 'switch-case', id, briefText(sourceFile, node.expression));
        }
      }
    }
    // `isFoldedIntoParent` is deliberately NOT applied here: parentheses are
    // not regex literals, so a parenthesised regex cannot double-report, and
    // skipping on an enclosing node would make `(/claude-code/)` invisible —
    // a one-character escape from this branch.
    for (const id of regexAlternativeIds(node)) {
      record(node, 'regex-literal', id, briefText(sourceFile, node));
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

export interface IdeValueLiteral {
  readonly file: string;
  readonly line: number;
  readonly id: string;
  /** How the literal is bound, e.g. `ide: 'claude-code'` or `return 'claude-code'`. */
  readonly position: string;
}

/** True when the node sits inside a type annotation / literal type. */
function isTypePosition(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current !== undefined) {
    if (ts.isTypeNode(current)) return true;
    current = current.parent;
  }
  return false;
}

/**
 * The value positions this check deliberately does NOT own. Each is limit 7
 * in the header, named there with a live example. They are excluded because
 * they are id TABLES (`{ 'claude-code': … }`, `['claude-code']`, which only
 * decide anything through `.has()`/`.includes()` — limit 1) or the repo's
 * `unknown → claude-code` DEFAULT policy, which is the opposite of the C1
 * defect this check exists for (a literal that overrides a KNOWN adapter id).
 */
function isExcludedValuePosition(node: ts.Node): boolean {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return false;
  if (ts.isBinaryExpression(parent) && IDENTITY_OPERATORS.has(parent.operatorToken.kind)) return true;
  if (ts.isCaseClause(parent)) return true;
  if (ts.isPropertyAssignment(parent) && parent.name === node) return true;
  if (ts.isArrayLiteralExpression(parent)) return true;
  if (ts.isConditionalExpression(parent)) return true;
  if (
    ts.isBinaryExpression(parent) &&
    (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      parent.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    return true;
  }
  return false;
}

/** A short label for where the literal is bound, for failure messages. */
function valuePositionLabel(sourceFile: ts.SourceFile, node: ts.Node): string {
  const parent: ts.Node | undefined = node.parent;
  if (parent === undefined) return 'value';
  if (ts.isPropertyAssignment(parent)) return `${briefText(sourceFile, parent.name)}:`;
  if (ts.isVariableDeclaration(parent)) return `${briefText(sourceFile, parent.name)} =`;
  if (ts.isPropertyDeclaration(parent)) return `${briefText(sourceFile, parent.name)} =`;
  if (ts.isReturnStatement(parent)) return 'return';
  if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
    return `${briefText(sourceFile, parent.expression)}(...)`;
  }
  return ts.SyntaxKind[parent.kind];
}

/**
 * Shape 2 — an IDE id asserted as a VALUE.
 *
 * This is the shape that survived a comparison-only guard: `ide: 'claude-code'`
 * in an object literal and `return 'claude-code'` are not comparisons at all,
 * so no amount of id-set tuning would have caught them. See limit 7 for the
 * positions deliberately excluded.
 */
export function findIdeValueLiterals(sourceFile: ts.SourceFile): IdeValueLiteral[] {
  const found: IdeValueLiteral[] = [];
  const visit = (node: ts.Node): void => {
    const id = ideIdOf(node);
    if (
      id !== null &&
      !isFoldedIntoParent(node) &&
      !isTypePosition(node) &&
      !isExcludedValuePosition(node)
    ) {
      found.push({
        file: sourceFile.fileName,
        line: lineOf(sourceFile, node),
        id,
        position: valuePositionLabel(sourceFile, node)
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

export interface SettingsPathLiteral {
  readonly file: string;
  readonly line: number;
  /** The adapter-declared directory the literal starts with (`.claude`, `.trae`, …). */
  readonly dirName: string;
  readonly text: string;
}

/**
 * A literal that IS a path into an adapter-declared settings directory:
 * `.claude`, `.claude/settings.local.json`, `~/.claude/settings.json`.
 * PROSE mentioning `.claude` (`"install into the user-level ~/.claude/…"`)
 * is not path-shaped and is not a hit — same reason AC-1 is not a grep.
 */
function matchesSettingsDir(text: string): string | null {
  const stripped = text.replace(/^~[\\/]?/, '');
  for (const dirName of SETTINGS_DIR_NAMES) {
    if (stripped === dirName || stripped.startsWith(`${dirName}/`) || stripped.startsWith(`${dirName}\\`)) {
      return dirName;
    }
  }
  return null;
}

/**
 * Shape 3 — an IDE's settings DIRECTORY hardcoded as a path.
 *
 * Separate from shape 2 on purpose: a hardcoded path is not an id literal and
 * an id check can never see it. This is what made the `ide-native` hook land
 * in `.claude/settings.local.json` no matter which adapter asked for it.
 */
export function findSettingsPathLiterals(sourceFile: ts.SourceFile): SettingsPathLiteral[] {
  const found: SettingsPathLiteral[] = [];
  const visit = (node: ts.Node): void => {
    // Same fold as the id checks: `join(root, '.claude', …)` and
    // `join(root, '.' + 'claude', …)` are the same hardcoded path.
    const text = staticStringValue(node);
    if (text !== null && !isFoldedIntoParent(node)) {
      const dirName = matchesSettingsDir(text);
      if (dirName !== null && !isTypePosition(node)) {
        found.push({
          file: sourceFile.fileName,
          line: lineOf(sourceFile, node),
          dirName,
          text
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/**
 * The adapter layer. Its whole job is per-IDE knowledge, so naming an id or
 * one IDE's settings path here is the DESIGN, not a leak. See limit 5 in the
 * header for why this is a directory and not a file list.
 */
const ALLOWED_DIRS: readonly string[] = ['src/services/ide/'];

/** `import ... from '…/ide-registry'` — the mark of a module that routes per-IDE. */
const REGISTRY_MODULE = /(^|\/)ide-registry(\.js)?$/;

/**
 * True when a file consumes the adapter registry. Shapes 2 and 3 apply only
 * to these files (see the SCOPE block in the header): a module that asks the
 * registry which adapter is in play must not also hardcode an id or a path.
 *
 * THREE forms count — every way a module can name the registry module:
 *   - `import … from '…/ide-registry.js'` (static)
 *   - `await import('…/ide-registry.js')` (lazy) — the first draft saw only
 *     the static form and silently dropped `src/cli/commands/share-commands.ts`
 *     (a real consumer) out of scope.
 *   - `export … from '…/ide-registry.js'` (re-export) — round-3 injection:
 *     a barrel that re-exported the registry was not a consumer, so a barrel
 *     that ALSO hardcoded an id or a path was invisible to shapes 2/3. The
 *     `ExportDeclaration` node covers all four spellings at once —
 *     `export { getAdapter } from …`, the ALIASED
 *     `export { getAdapter as getIdeAdapter } from …`, `export * from …` and
 *     `export * as ns from …` — because all four carry the same
 *     `moduleSpecifier`. Patching only the `export { … } from` spelling would
 *     have left the other three open.
 *
 * Scope that is narrower than it claims is the one failure mode this guard's
 * own header warns about, which is why each of these is matched rather than
 * documented as a gap.
 *
 * NOT matched: `require(...)` — this is an ESM tree, and a CommonJS require
 * cannot be typed through it (limit 12 in the header). Also NOT matched: a
 * SECOND-HOP barrel (`a.ts` re-exports the registry, `b.ts` re-exports `a.ts`)
 * — limit 12.
 */
export function isRegistryConsumer(sourceFile: ts.SourceFile): boolean {
  let consumes = false;
  const note = (specifier: string): void => {
    if (REGISTRY_MODULE.test(specifier)) consumes = true;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      note(node.moduleSpecifier.text);
    }
    // `export … from '…'` — any of the four re-export spellings.
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      note(node.moduleSpecifier.text);
    }
    // `await import('…')` / `import('…')` — a lazy registry lookup.
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const specifier = node.arguments[0];
      if (specifier !== undefined && ts.isStringLiteral(specifier)) note(specifier.text);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return consumes;
}

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
      '(same class as the fixed dispatcher sites, out of this slice\'s scope)'
  },
  {
    file: 'src/services/skills/hooks-settings-service.ts',
    comparisons: 1,
    ideValues: 1,
    settingsPaths: 0,
    reason:
      'decides whether the settings writer emits env exemptions, keyed on the IDE ' +
      'name, and derives the default peaks-managed hook entries from ' +
      '`resolveHookSpec(\'claude-code\')`'
  },
  {
    file: 'src/cli/commands/hooks-commands.ts',
    comparisons: 0,
    ideValues: 0,
    settingsPaths: 2,
    reason:
      'REMAINING: the Claude Code skill-bridge copy targets ' +
      '(`resolve(userHome, \'.claude\', \'skills\', …)`). The `comparisons: 1` this ' +
      'entry used to carry was the `ide === \'trae\'` branch in ' +
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
      'runtime-VENDOR axis, not the IDE axis: `vendor === \'codex\'` on a dispatch ' +
      'record. Caught only because shape 1 no longer filters by the counterpart\'s ' +
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
      'B3(a): `ideId === \'claude-code\'` gates the PEAKS_CLAUDE_*_DIR env-var ' +
      'override for the agentsDir fan-out and the skillsDir fan-out. The env ' +
      'var name IS already declared per-platform (`IDE_SKILL_INSTALL_PROFILES[' +
      'ide].envVar` / `.agentsEnvVar`), so an adapter-driven version is ' +
      'available — but it would also switch ON the override for the other ' +
      'platforms whose profile declares one (_trae / _trae-cn / …), which is a ' +
      'behaviour change to a shipped script\'s documented 1.x-compat contract. ' +
      'Visible and ratcheted instead: a THIRD site here fails this test'
  }
];

// ---------------------------------------------------------------------------
// AC-1 — vendor VERB strings. See the header block for the measured counts
// (raw grep over `src/` = 13; parsed string literals = 1) and for this
// check's limits.
// ---------------------------------------------------------------------------

/** The three compact verbs AC-1 names, as patterns that survive whitespace. */
const VENDOR_VERBS: readonly RegExp[] = [
  /claude\s+--compact/,
  /codex\s+--compact/,
  /copilot\s+compact/
];

/**
 * Where a vendor verb is SUPPOSED to live: the adapter implementations, one
 * family per adapter interface. Narrower than the identity guard's
 * `src/services/ide/` allowlist on purpose — the registry and the shared
 * IDE types are part of the adapter LAYER but are not implementations, and
 * a verb belongs in the implementation only.
 */
const VERB_ALLOWED_DIRS: readonly string[] = [
  'src/services/runtime/vendors/',
  'src/services/ide/adapters/'
];

export interface VerbLiteral {
  readonly file: string;
  readonly line: number;
  readonly verb: string;
}

/**
 * Vendor verbs appearing in a STRING or TEMPLATE literal. Comments and JSDoc
 * are not AST nodes of these kinds, so the phrases quoted in the docs — which
 * are most of the raw grep's hits — are invisible here by construction.
 */
export function findVendorVerbLiterals(sourceFile: ts.SourceFile): VerbLiteral[] {
  const found: VerbLiteral[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      for (const pattern of VENDOR_VERBS) {
        if (pattern.test(node.text)) {
          found.push({
            file: sourceFile.fileName,
            line: lineOf(sourceFile, node),
            verb: node.text
          });
          break;
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

interface ScanResult {
  readonly scannedFiles: number;
  /**
   * Every file the walk reached, root-relative. Carried as a LIST, not only as
   * a count: a count cannot tell "the new root was walked" from "some other
   * file made up the number", and the two roots this guard added (the
   * `scripts/` directory, then the `.js` extension under `src/`) are exactly
   * the ones a count would fail to notice silently dropping.
   */
  readonly scannedFileList: readonly string[];
  readonly registryConsumers: readonly string[];
  readonly comparisons: readonly IdentityComparison[];
  readonly ideValues: readonly IdeValueLiteral[];
  readonly settingsPaths: readonly SettingsPathLiteral[];
  readonly verbLiterals: readonly VerbLiteral[];
}

function scanProject(): ScanResult {
  const files = SCAN_ROOTS.flatMap(({ root, extensions }) => listFilesRecursively(root, extensions));
  const comparisons: IdentityComparison[] = [];
  const ideValues: IdeValueLiteral[] = [];
  const settingsPaths: SettingsPathLiteral[] = [];
  const verbLiterals: VerbLiteral[] = [];
  const registryConsumers: string[] = [];
  for (const absolutePath of files) {
    const sourceFile = parseSourceFile(absolutePath, readFileSync(absolutePath, 'utf8'));
    const consumes = isRegistryConsumer(sourceFile);
    const file = relativeToRoot(absolutePath);
    if (consumes) registryConsumers.push(file);
    // Shape 1 is global; shapes 2/3 are scoped to registry consumers.
    comparisons.push(...findIdentityComparisons(sourceFile));
    if (consumes) {
      ideValues.push(...findIdeValueLiterals(sourceFile));
      settingsPaths.push(...findSettingsPathLiterals(sourceFile));
    }
    verbLiterals.push(...findVendorVerbLiterals(sourceFile));
  }
  return {
    scannedFiles: files.length,
    scannedFileList: files.map(relativeToRoot),
    registryConsumers,
    comparisons,
    ideValues,
    settingsPaths,
    verbLiterals
  };
}

const SCAN = scanProject();

const inAllowedDir = (file: string): boolean => ALLOWED_DIRS.some((dir) => file.startsWith(dir));
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
    expect(SCAN.scannedFileList, 'the scripts/ root was not walked').toContain('scripts/install-skills.mjs');
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
      .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} ${hit.subject} vs '${hit.id}' (${hit.form})`);
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
      settingsPaths: SCAN.settingsPaths.filter((hit) => relativeToRoot(hit.file) === debt.file).length
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
        .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} comparison ${hit.subject} vs '${hit.id}'`),
      ...SCAN.ideValues
        .filter((hit) => repaired.includes(relativeToRoot(hit.file)))
        .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} value ${hit.position} '${hit.id}'`),
      ...SCAN.settingsPaths
        .filter((hit) => repaired.includes(relativeToRoot(hit.file)))
        .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} path '${hit.text}'`)
    ];
    expect(offenders).toEqual([]);
  });

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
      "9:.claude"
    ]);
  });

  it('negative control — prose, the runtime-vendor axis and non-identity tests are NOT shape-1 hits', () => {
    const fixture = [
      "// ide === 'claude-code' used to decide this (comment, not code)",
      "const doc = \"an adapter that declares ide === 'trae' is fine\";",
      "const isUnknown = ide === 'unknown';",
      "const isPresent = ide !== undefined;",
      "const byTable = IDE_SET.has(ide);",
      "const sameConst = ide === IDE_DEFAULT;"
    ].join('\n');
    expect(findIdentityComparisons(parseSourceFile('fixture.ts', fixture))).toEqual([]);
    // The runtime-vendor axis is NOT invisible any more — it is caught and
    // pinned as debt (see KNOWN_DEBT). Pinned here so nobody "restores" a
    // name filter that would silently reopen the `adapter.id` hole.
    const vendorAxis = "const vendor = obj.vendor === 'codex';";
    expect(findIdentityComparisons(parseSourceFile('fixture.ts', vendorAxis)).map((h) => h.id)).toEqual([
      'codex'
    ]);
  });

  it('negative control — a SYNTHESIZED id is still an id (concatenation and backtick literals)', () => {
    // Round-3 injection: QA falsified the previous revision with
    // `ide === 'claude' + '-code'` and `` case `claude-code`: `` — both passed.
    // The cause was that the id test was `ts.isStringLiteral(node)`, so any
    // literal that is not a plain `'…'` token — a `+` chain, a no-substitution
    // template — was not even a candidate. The id a node DENOTES is what
    // matters, so both are folded to their static string value first.
    const fixture = [
      `import { getAdapter } from '../ide/ide-registry.js';`,
      `const a = ide === 'claude' + '-code';`,
      `const b = target === \`claude-code\`;`,
      `switch (ide) {`,
      `  case \`claude-code\` + '':`,
      `    break;`,
      `}`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findIdentityComparisons(parsed).map((h) => `${h.line}:${h.form}:${h.id}`)).toEqual([
      '2:comparison:claude-code',
      '3:comparison:claude-code',
      '5:switch-case:claude-code'
    ]);
  });

  it('negative control — a SYNTHESIZED id in a value position is caught too', () => {
    // Same fold, applied to shape 2. Recorded once per site: a `+` chain must
    // not also report its own sub-literals (`'claude' + '-code'` has two
    // string children, one hit).
    const fixture = [
      `const c1 = { ide: 'claude' + '-code' };`,
      `const c2 = \`claude-code\`;`
    ].join('\n');
    expect(
      findIdeValueLiterals(parseSourceFile('fixture.ts', fixture)).map((h) => `${h.line}:${h.position}:${h.id}`)
    ).toEqual(["1:ide::claude-code", '2:c2 =:claude-code']);
  });

  it('negative control — a REGEX test is an identity decision (the round-4 injection)', () => {
    // The three injections QA ran against `auto-compact-reader.ts` — a
    // MUST_BE_COVERED consumer — and got 20/20 green on that revision. Note
    // the shape: `.test(ide)` and `ide.match(re)` are CALLS. There is no
    // BinaryExpression and no `case` clause in any of them, so folding the
    // regex into a string value could not have reached them even if the fold
    // had existed; the branch that reaches them is what makes this shape
    // closed (see `regexAlternativeIds`).
    const fixture = [
      `const a = /^claude-code$/.test(ide);`,
      `const b = ide.match(/claude-code/);`,
      `const c = /^(claude-code|trae)$/.test(ide);`
    ].join('\n');
    expect(findIdentityComparisons(parseSourceFile('fixture.ts', fixture)).map((h) => `${h.line}:${h.form}:${h.id}`)).toEqual([
      '1:regex-literal:claude-code',
      '2:regex-literal:claude-code',
      '3:regex-literal:claude-code',
      '3:regex-literal:trae'
    ]);
  });

  it('negative control — regex normalisation: groups, anchors, escapes and parens do not hide an id', () => {
    const fixture = [
      `const a = /^(?:claude-code)$/i.test(ide);`,
      `const b = /claude\\-code/.test(ide);`,
      `const c = (/claude-code/).test(ide);`,
      `const d = /^(claude-code|codex|cursor)$/.test(ide);`,
      `const e = /trae$/.test(ide);`,
      `const f = /^codex/.test(ide);`
    ].join('\n');
    expect(findIdentityComparisons(parseSourceFile('fixture.ts', fixture)).map((h) => `${h.line}:${h.id}`)).toEqual([
      '1:claude-code',
      '2:claude-code',
      '3:claude-code',
      '4:claude-code',
      '4:codex',
      '4:cursor',
      '5:trae',
      '6:codex'
    ]);
  });

  it('negative control — a regex that only CONTAINS an id, or obfuscates it, is not a hit', () => {
    // The false-positive boundary of the alternative rule (header, limit 14):
    // the alternative must EQUAL the id. Every one of these is a plausible
    // non-identity pattern, and every one would be reported by a substring
    // rule. `v1` is the important one — `/claude-code-settings/` is the shape a
    // path/filename check takes, and reporting it would make the guard noise.
    const fixture = [
      `const v1 = /claude-code-settings/.test(x);`,
      `const v2 = /^claude-code-/.test(x);`,
      `const v3 = /claude-cod[e]/.test(x);`,
      `const v4 = /claude\\s+--compact/.test(x);`,
      `const v5 = /\\/\\.claude\\//.test(x);`,
      `const v6 = /x(claude-code)/.test(x);`,
      `const v7 = /claude-code\\b/.test(x);`,
      `const v8 = /claude_code/.test(x);`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findIdentityComparisons(parsed)).toEqual([]);
    // ...and the same decision keeps regexes out of the PATH shape: a regex
    // does not denote a string, so it must not read as a hardcoded settings
    // path (`v5` matches `.claude` exactly and is deliberately invisible here).
    expect(findSettingsPathLiterals(parsed)).toEqual([]);
  });

  it('negative control — a TYPE WRAPPER does not hide a comparison, even outside a consumer', () => {
    // Defect 2 of the 2026-09-13 QA round: the escape needed TWO conditions
    // together — a wrapped literal AND a file that is not a registry consumer
    // (where shape 2 does not run). The same file with a plain `!==` failed,
    // and an `as` coercion inside a CONSUMER failed via shape 2. So limit 6's
    // "Shape 1 still covers that file's comparisons" was false as written;
    // shape 1 now unfolds the assertion, and this case pins the non-consumer
    // half explicitly.
    const fixture = [
      `const a = ide === ('claude-code' as const);`,
      `const b = ide !== ('claude-code' as string);`,
      `const c = ide === <string>'trae';`,
      `const d = ('claude-code' as const) === ide;`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(isRegistryConsumer(parsed)).toBe(false);
    expect(findIdentityComparisons(parsed).map((h) => `${h.line}:${h.id}`)).toEqual([
      '1:claude-code',
      '2:claude-code',
      '3:trae',
      '4:claude-code'
    ]);
  });

  it('negative control — a wrapped literal is reported ONCE, at the wrapper (no regression, no double count)', () => {
    // `isFoldedIntoParent` hands the site to the outermost folding node. That
    // is what keeps a consumer's wrapped VALUE caught (it was caught before
    // this revision, by the inner literal) while keeping the count-pinned
    // assertions exact — skipping the inner literal WITHOUT the hand-off would
    // have silently dropped the site instead of de-duplicating it.
    const fixture = [
      `import { getAdapter } from '../ide/ide-registry.js';`,
      `const c1 = { ide: 'claude-code' as const };`,
      `const c2 = ('trae' as string);`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(isRegistryConsumer(parsed)).toBe(true);
    expect(findIdeValueLiterals(parsed).map((h) => `${h.line}:${h.position}:${h.id}`)).toEqual([
      '2:ide::claude-code',
      '3:c2 =:trae'
    ]);
  });

  it('negative control — an assertion into a LITERAL TYPE is still a type position, not a value', () => {
    // `x as 'claude-code'` narrows a type; it does not assert the id. The
    // assertion's own expression folds to `x` (not a literal) and the type
    // literal is excluded by `isTypePosition`, so neither shape reports it.
    const fixture = [
      `import { getAdapter } from '../ide/ide-registry.js';`,
      `const a = detected as 'claude-code';`,
      `const b: 'claude-code' = detected;`
    ].join('\n');
    const parsed = parseSourceFile('fixture.ts', fixture);
    expect(findIdeValueLiterals(parsed)).toEqual([]);
    expect(findIdentityComparisons(parsed)).toEqual([]);
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
      "1:ide::claude-code",
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
    expect(findSettingsPathLiterals(parseSourceFile('fixture.ts', fixture)).map((h) => `${h.line}:${h.text}`)).toEqual([
      '1:.claude',
      '2:.claude',
      '3:~/.claude/settings.json'
    ]);
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
    const sourceFile = parseSourceFile(HOOK_INSTALLER_PATH, readFileSync(join(PROJECT_ROOT, HOOK_INSTALLER_PATH), 'utf8'));
    expect(isRegistryConsumer(sourceFile)).toBe(false);
    expect(findSettingsPathLiterals(sourceFile).map((hit) => `${hit.line}:${hit.text}`)).toEqual([
      '87:.claude/settings.local.json'
    ]);
  });
});

describe('AC-1 — vendor verb strings live only in adapter implementations', () => {
  it('finds no vendor verb string outside the adapter implementations', () => {
    const unexpected = SCAN.verbLiterals
      .filter((hit) => !VERB_ALLOWED_DIRS.some((dir) => relativeToRoot(hit.file).startsWith(dir)))
      .map((hit) => `${relativeToRoot(hit.file)}:${hit.line} ${JSON.stringify(hit.verb)}`);
    expect(unexpected).toEqual([]);
  });

  it('the adapter implementation that owns the verb still carries it (anti-silence)', () => {
    // Pins the count in the ALLOWED side too: if the verb check silently
    // stopped recognising literals, the assertion above would go vacuously
    // green.
    //
    // PINNED BY PROPERTY, NOT BY COORDINATE (B1). This assertion used to read
    // `claude-code-adapter.ts:585`, and it broke TWICE inside a single slice
    // (585 → 618) — both times fixed by mechanically editing the number. An
    // assertion repaired by editing a number stops being read: the person who
    // edits it never asks why it moved, and after a few rounds it guards
    // nothing. A line number is not a property of "the verb lives in the
    // adapter that owns it"; these two are:
    //
    //   1. exactly ONE verb literal exists anywhere in the scanned tree, and
    //   2. the file carrying it is `claude-code-adapter.ts` — an ADAPTER
    //      IMPLEMENTATION, i.e. inside one of `VERB_ALLOWED_DIRS`.
    //
    // Both halves of the old value are kept and neither is a coordinate: a
    // second occurrence in the SAME file (the defect a line pin was supposed
    // to catch) makes the array two elements long and fails, exactly as a
    // second occurrence in any other file does.
    const allowed = SCAN.verbLiterals.filter((hit) =>
      VERB_ALLOWED_DIRS.some((dir) => relativeToRoot(hit.file).startsWith(dir))
    );
    expect(SCAN.verbLiterals, 'more than one vendor verb literal in the tree').toHaveLength(1);
    expect(allowed, 'the one verb literal is not in an adapter implementation').toHaveLength(1);
    expect(allowed.map((hit) => relativeToRoot(hit.file))).toEqual([
      'src/services/ide/adapters/claude-code-adapter.ts'
    ]);
  });

  it('negative control — a verb in a COMMENT is not a violation (this is why AC-1 is not a grep)', () => {
    // The raw grep over `src/` returns 13; 12 of those are lines exactly
    // like these. Prose is not a decision.
    const fixture = [
      '// AC-1: `rg -n "claude --compact|codex --compact|copilot compact"`',
      '/**',
      ' * heavy lifting (ratio probe + in-band `claude --compact` spawn)',
      ' */',
      'const banner = `run copilot compact to compact`;'
    ].join('\n');
    // Lines 1-4 are comments (line + block) → invisible. Line 5 is a REAL
    // template literal and IS a hit: a template can be an executed command,
    // so it is inspected like any other literal.
    expect(findVendorVerbLiterals(parseSourceFile('fixture.ts', fixture)).map((h) => h.line)).toEqual([5]);
  });

  it('negative control — a verb assembled at runtime is NOT flagged (check limit a)', () => {
    // Pinned so nobody reads the check above as "verbs cannot escape".
    const fixture = [
      "const binary = 'claude';",
      'const cmd = `${binary} --compact`;'
    ].join('\n');
    expect(findVendorVerbLiterals(parseSourceFile('fixture.ts', fixture))).toEqual([]);
  });
});
