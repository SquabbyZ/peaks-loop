---
name: peaks-loop-mac-auto-compact-esm-fake-green-and-fix
description: "ESM `require is not defined` ReferenceError silently swallowed by outer try/catch made vitest 6/6 pass on a broken Mac auto-compact fix — caught only by QA repro at production ESM runtime, closed by 2-line top-level import fix at commit 22debcb"
metadata: 
  node_type: memory
  type: project
  originSessionId: ed56a640-2724-4d8f-b391-86ce1095ce1f
  modified: 2026-07-31T07:23:42.035Z
---

# Mac auto-compact fix landed (rid-001-r1, commit 22debcb) — 2026-07-31

## What this slice fixed

peaks-loop's `readClaudeTranscriptFallback` in `src/services/context/auto-compact-reader.ts`
returned `null` on Mac Claude Code because (a) Mac Claude Code does not inject
`CLAUDE_CONTEXT_USAGE_PERCENT` into PreToolUse hook sub-shells, and (b) Claude Code
nests the transcript jsonl under `~/.claude/projects/<hash>/...` with an extra directory
level the original flat `readdirSync` could not predict. Pre-fix, the orchestrator
stayed in the `none` zone and auto-compact silently never fired. The fix added a
recursive `findTranscriptJsonl` helper (cycle 0, commit `872985f`) plus a 2-line
ESM-compat patch (cycle 1, commit `22debcb`).

## Why the original fix passed all tests but was still broken (anti-fake-green)

The cycle 0 fix `872985f` shipped with 6/6 unit tests green and was reported PASS
in vitest, but the production ESM path was completely broken. Two compounding issues:

1. **ESM `require is not defined` ReferenceError** — `findTranscriptJsonl` called
   `const { readdirSync } = require('node:fs') as typeof import('node:fs');` at
   line 96. peaks-loop is `"type": "module"` + `tsconfig.json module: NodeNext`,
   so under pure Node 22 ESM, `require` is undefined. This threw a `ReferenceError`
   on the very first line of the function body.
2. **Silent catch swallow** — the outer `try { ... } catch { return null; }` block
   (a TODO(g2) legacy silent-catch) caught the ReferenceError and returned `null`,
   making the entire helper a no-op in production.
3. **vitest esbuild shim** — vitest's esbuild loader injects a CommonJS `require`
   shim, so the test runner never saw the ReferenceError. The 6/6 unit pass was
   a phantom — exactly the same class of bug as the B1 coverage global-setup
   false-positive (`peaks-b1-coverage-global-setup-false-positive-2026-07-26.md`)
   where V8 per-worker counters in a main-process setup file were structurally
   unmeasurable.

This is the second time in one week a peaks-loop test suite reported green on a
broken production path. The 4 anti-fake-green defenses (per the B1 sediment)
hold; **always run a production-reproduction script, not just vitest**, when
the fix involves any runtime module load pattern.

## How the QA repro catches this

QA-r1 (cycle 1) added a new mandatory Dim 1.5 — verbatim repro:

```bash
cd C:\Users\smallMark\Desktop\peaks-loop
./node_modules/.bin/tsc -p tsconfig.build.json --outDir /tmp/peaks-qa-r1-build-test-verify
node --input-type=module -e "
  import('file:///C:/Users/smallMark/AppData/Local/Temp/peaks-qa-r1-build-test-verify/services/context/auto-compact-reader.js')
    .then(async m => {
      const fs = await import('node:fs');
      const tmpDir = fs.mkdtempSync('/tmp/peaks-qa-r1-verify-');
      fs.writeFileSync(tmpDir + '/sid.jsonl', 'x'.repeat(1024));
      const result = m._internal.findTranscriptJsonl(tmpDir, 'sid');
      console.log('result:', result);
      if (result === null || result.bytes !== 1024) {
        console.error('FAIL: expected {path, bytes: 1024}');
        process.exit(1);
      }
      console.log('PASS: ESM readdirSync works in production');
    });"
```

Pre-fix output: `result: null` (silent). Post-fix: `result: {path: ..., bytes: 1024}`.
This repro is now the canonical acceptance criterion for any auto-compact reader change.

## Cycle 1 fix (commit 22debcb)

```diff
-import { existsSync, readFileSync, statSync } from 'node:fs';
+import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
 ...
-    const { readdirSync } = require('node:fs') as typeof import('node:fs');
```

2 lines, 1 file, SquabbyZ sole-author, no Co-Authored-By trailer. Production ESM
repro went from `null` → `{path, bytes: 1024}`. 6/6 unit + 38/38 integration still
green. `peaks -v` unchanged at 4.0.3.

## Outstanding (rid-001-r2 deferred)

The outer `try { ... } catch { return null; }` block is still in place. It now
correctly returns `null` for "transcript not found" (the intended behavior), but
a future `ReferenceError` (or any other non-IO error) would still be silently
swallowed. The proper follow-up is to change the catch to:

```ts
catch (err) {
  if (err instanceof ReferenceError) throw err;  // surface module-load bugs
  if (err instanceof SyntaxError) throw err;      // surface parse bugs
  return null;                                    // only swallow IO errors
}
```

This is `rid-001-r2` — surgical, 3-line diff, in scope for the next maintenance
window. **Do NOT bundle it into the 4.0.4 release** — keep it as a separate
discrete change so QA can verify the swallow list before/after.

## Audit grep for similar latent ESM bugs

To prevent the same class of bug elsewhere, audit-grep across the repo:

```bash
rg -nE 'require\(.node:' src/services/ packages/*/src/
rg -nE 'require\(.[^.][^/]' src/services/ packages/*/src/
```

Any hit under `src/services/**/*.ts` is a latent ESM ReferenceError waiting to
happen. As of 2026-07-31, **0 hits remain** (the pre-fix line 96 was the only
one in `src/services/context/`).

## Files touched

- `src/services/context/auto-compact-reader.ts` (+1/-2 prod LOC)
- `src/services/context/auto-compact-types.ts` (JSDoc only)
- `tests/unit/context/auto-compact-reader.test.ts` (NEW, 6 cases)
- `CHANGELOG.md` (4.0.4 unreleased entry)

**Why:** Without this sediment, the next time someone adds a helper under
`src/services/` and reaches for `require('node:...')` inside the function body
(vitest's esbuild shim will make their tests pass), nobody will catch it
until production.

**How to apply:** When reviewing any future peaks-loop slice that touches
`src/services/**/*.ts` for runtime correctness:
1. Read the file's `package.json#type` — should be `"module"`.
2. Grep for `require(` inside any function body — `require` is forbidden
   in ESM. If present, the helper is structurally broken under Node 22 ESM.
3. Add a production ESM repro step to QA brief (mirror the script above) —
   vitest green is necessary but not sufficient.

Related: [[peaks-loop-mac-auto-compact-no-env-injection]] (the upstream env-var
injection gap that motivated this slice in the first place);
[[peaks-b1-coverage-global-setup-false-positive-2026-07-26]] (the prior
anti-fake-green lesson from the same week).
